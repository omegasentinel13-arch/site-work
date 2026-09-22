import JSZip from 'jszip';
import {
  PackageClassification,
  PackageInspectionResult,
  PackageAction,
  ContentsSummary,
  PACKAGE_SECURITY_LIMITS,
} from './types';

const SQLITE_HEADER_PREFIX = 'SQLite format 3\0';

/**
 * Universal Package Classifier & Content Inspector
 *
 * Implements strict content-based classification without trusting external filenames,
 * user-provided parameters, or contradictory manifest claims.
 *
 * "Manifest declares; archive contents prove."
 */
export async function classifyPackage(
  zipBuffer: Buffer,
  fileNameHint?: string
): Promise<PackageInspectionResult> {
  const rejectionReasons: string[] = [];

  // Default fallback metadata when manifest is absent or corrupt
  let fallbackId = 'unrecognized';
  let fallbackCreatedAt = new Date().toISOString();

  // 1. In-Memory ZIP Safety & Structure Check
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err: any) {
    return buildRejectionResult({
      rejectionReasons: [`Corrupt or invalid ZIP archive: ${err.message || 'Unable to decompress'}`],
      packageId: fallbackId,
      createdAt: fallbackCreatedAt,
      pathTraversalSafe: false,
      uncompressedSizeWithinLimits: false,
      fileCountWithinLimits: false,
    });
  }

  // 2. Security Boundaries & Traversal Guards
  const normalizedFilePaths: string[] = [];
  const seenPaths = new Set<string>();
  let cumulativeBytes = 0;
  let hasPathTraversal = false;
  let hasExcessiveEntries = false;
  let hasOversizedEntry = false;
  let hasExcessiveTotalBytes = false;
  let hasDuplicateEntries = false;

  // Check ALL entries in the archive (files and folders) for path traversal
  for (const rawPath of Object.keys(zip.files)) {
    const normalized = rawPath.replace(/\\/g, '/');
    if (
      normalized.includes('../') ||
      normalized.includes('/..') ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized)
    ) {
      hasPathTraversal = true;
      rejectionReasons.push(`Security violation: Malicious path traversal detected: '${rawPath}'`);
    }
  }

  const fileEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);

  if (fileEntries.length > PACKAGE_SECURITY_LIMITS.MAX_FILE_COUNT) {
    hasExcessiveEntries = true;
    rejectionReasons.push(
      `Security violation: Archive contains ${fileEntries.length} files (limit: ${PACKAGE_SECURITY_LIMITS.MAX_FILE_COUNT})`
    );
  }

  for (const [rawPath, entry] of fileEntries) {
    const normalized = rawPath.replace(/\\/g, '/');
    const lowerPath = normalized.toLowerCase();
    if (seenPaths.has(lowerPath)) {
      hasDuplicateEntries = true;
      rejectionReasons.push(`Suspicious archive: Duplicate case-insensitive entry detected: '${rawPath}'`);
    }
    seenPaths.add(lowerPath);
    normalizedFilePaths.push(normalized);

    // Cumulative & Single File Size Limits (ZIP Bomb Defense)
    const declaredSize = (entry as any)._data?.uncompressedSize ?? 0;
    if (declaredSize > PACKAGE_SECURITY_LIMITS.MAX_SINGLE_FILE_BYTES) {
      hasOversizedEntry = true;
      rejectionReasons.push(
        `Security violation: File '${normalized}' exceeds maximum allowed single file size (300 MB)`
      );
    }

    cumulativeBytes += declaredSize;
    if (cumulativeBytes > PACKAGE_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      hasExcessiveTotalBytes = true;
      rejectionReasons.push(
        `Security violation: Total uncompressed archive size exceeds safety boundary (500 MB)`
      );
      break;
    }
  }

  if (hasPathTraversal || hasExcessiveEntries || hasOversizedEntry || hasExcessiveTotalBytes || hasDuplicateEntries) {
    return buildRejectionResult({
      rejectionReasons,
      packageId: fallbackId,
      createdAt: fallbackCreatedAt,
      pathTraversalSafe: !hasPathTraversal,
      uncompressedSizeWithinLimits: !hasOversizedEntry && !hasExcessiveTotalBytes,
      fileCountWithinLimits: !hasExcessiveEntries,
      filePaths: normalizedFilePaths,
      totalFiles: fileEntries.length,
      totalBytes: cumulativeBytes,
    });
  }

  // 3. Content Inventory
  const hasDatabaseSnapshot = normalizedFilePaths.some(
    (p) => p === 'data/site_work.db' || p.endsWith('/site_work.db')
  );
  const hasPdf = normalizedFilePaths.some((p) => p.toLowerCase().endsWith('.pdf'));
  const hasExcel = normalizedFilePaths.some((p) => p.toLowerCase().endsWith('.xlsx'));
  const hasJson = normalizedFilePaths.some((p) => p.toLowerCase().endsWith('.json'));
  const checksumsFilePresent = normalizedFilePaths.some((p) => p === 'checksums.sha256');
  const readmePresent = normalizedFilePaths.some((p) => p === 'README.txt');

  const contentsSummary: ContentsSummary = {
    hasPdf,
    hasExcel,
    hasJson,
    hasDatabaseSnapshot,
    totalFiles: fileEntries.length,
    totalBytes: cumulativeBytes,
    filePaths: normalizedFilePaths,
    checksumsFilePresent,
    readmePresent,
  };

  // 4. Manifest Retrieval & Validation
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    rejectionReasons.push('Archive is missing required root manifest.json file');
    return buildRejectionResult({
      rejectionReasons,
      packageId: fallbackId,
      createdAt: fallbackCreatedAt,
      contentsSummary,
    });
  }

  let manifestRaw: any;
  try {
    const manifestText = await manifestFile.async('string');
    manifestRaw = JSON.parse(manifestText);
  } catch (err: any) {
    rejectionReasons.push(`Malformed manifest.json: ${err.message || 'Invalid JSON format'}`);
    return buildRejectionResult({
      rejectionReasons,
      packageId: fallbackId,
      createdAt: fallbackCreatedAt,
      contentsSummary,
    });
  }

  if (!manifestRaw || typeof manifestRaw !== 'object') {
    rejectionReasons.push('Malformed manifest.json: Manifest root must be an object');
    return buildRejectionResult({
      rejectionReasons,
      packageId: fallbackId,
      createdAt: fallbackCreatedAt,
      contentsSummary,
    });
  }

  // 5. CLASSIFICATION & INVARIANT VERIFICATION
  // A. REPORT_EXPORT (Task 1 Complete Export Contract)
  const isReportManifest =
    typeof manifestRaw.exportType === 'string' &&
    (manifestRaw.exportType === 'COMPLETE_SITE' || manifestRaw.exportType === 'COMPLETE_SYSTEM');

  if (isReportManifest) {
    // Anti-Spoofing Check A1: Physical database snapshot strictly prohibited
    if (hasDatabaseSnapshot) {
      rejectionReasons.push(
        'Contradictory archive: Manifest declares REPORT_EXPORT but archive contains physical SQLite database (site_work.db)'
      );
      return buildRejectionResult({
        rejectionReasons,
        packageId: manifestRaw.exportType || fallbackId,
        createdAt: manifestRaw.generatedAt || fallbackCreatedAt,
        contentsSummary,
      });
    }

    // Anti-Spoofing Check A2: Scope validation
    const scopeType = manifestRaw.scope?.type;
    if (scopeType !== 'SYSTEM' && scopeType !== 'SITE') {
      rejectionReasons.push(`Malformed REPORT_EXPORT: Invalid scope type '${scopeType}' in manifest`);
      return buildRejectionResult({
        rejectionReasons,
        packageId: fallbackId,
        createdAt: manifestRaw.generatedAt || fallbackCreatedAt,
        contentsSummary,
      });
    }

    // Anti-Spoofing Check A3: Payload existence
    const hasReportPayload = normalizedFilePaths.some(
      (p) => p.startsWith('data/') || p.startsWith('pdf/') || p.startsWith('excel/')
    );
    if (!hasReportPayload) {
      rejectionReasons.push('Malformed REPORT_EXPORT: Archive contains zero report payload files');
      return buildRejectionResult({
        rejectionReasons,
        packageId: fallbackId,
        createdAt: manifestRaw.generatedAt || fallbackCreatedAt,
        contentsSummary,
      });
    }

    const availableActions: PackageAction[] = ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES'];
    return {
      classification: 'REPORT_EXPORT',
      isValid: true,
      packageId: `export-${manifestRaw.exportType}-${manifestRaw.generatedAt || Date.now()}`,
      schemaVersion: String(manifestRaw.exportVersion || '1'),
      createdAt: manifestRaw.generatedAt || new Date().toISOString(),
      createdBy: {
        userId: manifestRaw.generatedBy?.id,
        username: manifestRaw.generatedBy?.username || 'unknown',
        role: manifestRaw.generatedBy?.role || 'unknown',
      },
      scope: scopeType,
      siteId: manifestRaw.scope?.siteId || null,
      siteName: manifestRaw.scope?.siteName || null,
      periodPreset: manifestRaw.period?.preset || 'CUSTOM',
      periodLabel: manifestRaw.period?.label || 'Custom Period',
      dateRange: {
        startDate: manifestRaw.period?.from || null,
        endDate: manifestRaw.period?.to || null,
      },
      isRestorableAsDatabase: false,
      contentsSummary,
      availableActions,
      rejectionReasons: [],
      security: {
        pathTraversalSafe: true,
        uncompressedSizeWithinLimits: true,
        fileCountWithinLimits: true,
      },
    };
  }

  // B. BACKUP PACKAGES (Task 2 Backup Contract)
  const isBackupManifest = typeof manifestRaw.manifestVersion === 'string';

  if (isBackupManifest) {
    const rawScope = manifestRaw.scope;
    const packageId = manifestRaw.backupId || fallbackId;
    const createdAt = manifestRaw.backupTimestamp || fallbackCreatedAt;

    // Check B1: SITE_LOGICAL_BACKUP
    if (rawScope === 'SITE') {
      // Anti-Spoofing Check: Must NEVER contain database snapshot
      if (hasDatabaseSnapshot) {
        rejectionReasons.push(
          'Security & Invariant Violation: SITE_LOGICAL_BACKUP must never contain physical SQLite database snapshot (Strict Site Isolation Violation)'
        );
        return buildRejectionResult({
          rejectionReasons,
          packageId,
          createdAt,
          contentsSummary,
        });
      }

      // Anti-Spoofing Check: Must NOT claim restorableAsDatabase
      if (manifestRaw.restorableAsDatabase === true) {
        rejectionReasons.push(
          'Contradictory archive: SITE_LOGICAL_BACKUP cannot be restorable as full application database'
        );
        return buildRejectionResult({
          rejectionReasons,
          packageId,
          createdAt,
          contentsSummary,
        });
      }

      // Anti-Spoofing Check: siteId must be present
      if (!manifestRaw.siteId || typeof manifestRaw.siteId !== 'string') {
        rejectionReasons.push('Malformed SITE_LOGICAL_BACKUP: siteId is missing from manifest');
        return buildRejectionResult({
          rejectionReasons,
          packageId,
          createdAt,
          contentsSummary,
        });
      }

      // Verify presence of at least one logical dataset
      const hasLogicalJson = normalizedFilePaths.some(
        (p) =>
          p === 'data/site_profile.json' ||
          p === 'data/attendance_records.json' ||
          p === 'data/financial_transactions.json'
      );
      if (!hasLogicalJson) {
        rejectionReasons.push('Malformed SITE_LOGICAL_BACKUP: Expected site logical datasets missing from archive');
        return buildRejectionResult({
          rejectionReasons,
          packageId,
          createdAt,
          contentsSummary,
        });
      }

      const availableActions: PackageAction[] = ['PREVIEW_LOGICAL_DATA', 'DIFF_WITH_ACTIVE_SITE'];
      return {
        classification: 'SITE_LOGICAL_BACKUP',
        isValid: true,
        packageId,
        schemaVersion: manifestRaw.manifestVersion || '1.0',
        createdAt,
        createdBy: {
          userId: manifestRaw.createdBy?.userId,
          username: manifestRaw.createdBy?.username || 'unknown',
          role: manifestRaw.createdBy?.role || 'unknown',
        },
        scope: 'SITE',
        siteId: manifestRaw.siteId,
        siteName: manifestRaw.siteName || null,
        periodPreset: manifestRaw.periodPreset || 'CUSTOM',
        periodLabel: manifestRaw.periodPreset || 'Custom Period',
        dateRange: {
          startDate: manifestRaw.dateRange?.startDate || null,
          endDate: manifestRaw.dateRange?.endDate || null,
        },
        isRestorableAsDatabase: false,
        contentsSummary,
        availableActions,
        rejectionReasons: [],
        security: {
          pathTraversalSafe: true,
          uncompressedSizeWithinLimits: true,
          fileCountWithinLimits: true,
        },
      };
    }

    // Check B2: SYSTEM BACKUPS
    if (rawScope === 'SYSTEM') {
      const isUnboundedAllData = manifestRaw.periodPreset === 'ALL_DATA' && manifestRaw.isUnbounded === true;

      if (!isUnboundedAllData) {
        // SYSTEM_LOGICAL_BACKUP (Date-Scoped System Archive - NON-RESTORABLE)
        // Invariant 1: Must never claim restorableAsDatabase
        if (manifestRaw.restorableAsDatabase === true) {
          rejectionReasons.push(
            'Contradictory archive: Date-filtered system backup cannot be restorable as full application database'
          );
          return buildRejectionResult({
            rejectionReasons,
            packageId,
            createdAt,
            contentsSummary,
          });
        }

        // Invariant 2: Must never contain physical SQLite database snapshot
        if (hasDatabaseSnapshot) {
          rejectionReasons.push(
            'Security & Invariant Violation: Date-filtered system backup must never contain physical SQLite database snapshot'
          );
          return buildRejectionResult({
            rejectionReasons,
            packageId,
            createdAt,
            contentsSummary,
          });
        }

        const availableActions: PackageAction[] = ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES'];
        return {
          classification: 'SYSTEM_LOGICAL_BACKUP',
          isValid: true,
          packageId,
          schemaVersion: manifestRaw.manifestVersion || '1.0',
          createdAt,
          createdBy: {
            userId: manifestRaw.createdBy?.userId,
            username: manifestRaw.createdBy?.username || 'unknown',
            role: manifestRaw.createdBy?.role || 'unknown',
          },
          scope: 'SYSTEM',
          siteId: null,
          siteName: null,
          periodPreset: manifestRaw.periodPreset || 'CUSTOM',
          periodLabel: manifestRaw.periodPreset || 'Custom Period',
          dateRange: {
            startDate: manifestRaw.dateRange?.startDate || null,
            endDate: manifestRaw.dateRange?.endDate || null,
          },
          isRestorableAsDatabase: false,
          contentsSummary,
          availableActions,
          rejectionReasons: [],
          security: {
            pathTraversalSafe: true,
            uncompressedSizeWithinLimits: true,
            fileCountWithinLimits: true,
          },
        };
      }

      // SYSTEM_RECOVERY_BACKUP (Unbounded All Data - RESTORABLE)
      let isSystemRecovery = true;

      // Invariant 2: Manifest must declare restorableAsDatabase === true
      if (manifestRaw.restorableAsDatabase !== true) {
        rejectionReasons.push('Manifest flags system archive as non-restorable (restorableAsDatabase is false)');
        isSystemRecovery = false;
      }

      // Invariant 3: data/site_work.db MUST physically exist in archive
      const dbEntry = zip.file('data/site_work.db');
      if (!dbEntry || !hasDatabaseSnapshot) {
        rejectionReasons.push(
          'Contradictory archive: Manifest declares restorable system recovery backup but data/site_work.db is absent from archive'
        );
        isSystemRecovery = false;
      } else {
        // Invariant 4: Validate SQLite binary header safely without database execution
        const dbHeaderBuf = await dbEntry.async('nodebuffer');
        if (dbHeaderBuf.length < 16) {
          rejectionReasons.push('Corrupted SQLite binary: File is smaller than SQLite header (16 bytes)');
          isSystemRecovery = false;
        } else {
          const headerString = dbHeaderBuf.subarray(0, 16).toString('utf-8');
          if (headerString !== SQLITE_HEADER_PREFIX) {
            rejectionReasons.push('Invalid SQLite binary: File header does not match SQLite format 3');
            isSystemRecovery = false;
          }
        }
      }

      // Invariant 5: Database metadata must declare standalone snapshot
      if (manifestRaw.database && manifestRaw.database.isStandalone !== true) {
        rejectionReasons.push('Database metadata indicates non-standalone database snapshot');
        isSystemRecovery = false;
      }

      if (!isSystemRecovery) {
        return buildRejectionResult({
          rejectionReasons,
          packageId,
          createdAt,
          contentsSummary,
        });
      }

      const availableActions: PackageAction[] = [
        'SIMULATE_DATABASE_RESTORE',
        'EXECUTE_DATABASE_RESTORE',
      ];

      return {
        classification: 'SYSTEM_RECOVERY_BACKUP',
        isValid: true,
        packageId,
        schemaVersion: manifestRaw.manifestVersion || '1.0',
        createdAt,
        createdBy: {
          userId: manifestRaw.createdBy?.userId,
          username: manifestRaw.createdBy?.username || 'unknown',
          role: manifestRaw.createdBy?.role || 'unknown',
        },
        scope: 'SYSTEM',
        siteId: null,
        siteName: null,
        periodPreset: manifestRaw.periodPreset,
        periodLabel: 'All Data (Full Recorded History)',
        dateRange: {
          startDate: manifestRaw.dateRange?.startDate || null,
          endDate: manifestRaw.dateRange?.endDate || null,
        },
        isRestorableAsDatabase: true,
        contentsSummary,
        availableActions,
        rejectionReasons: [],
        security: {
          pathTraversalSafe: true,
          uncompressedSizeWithinLimits: true,
          fileCountWithinLimits: true,
        },
      };
    }
  }

  // 6. Unknown or Unrecognized Schema
  rejectionReasons.push(
    'Unrecognized archive structure: Manifest does not conform to approved REPORT_EXPORT or BACKUP specification'
  );
  return buildRejectionResult({
    rejectionReasons,
    packageId: fallbackId,
    createdAt: fallbackCreatedAt,
    contentsSummary,
  });
}

function buildRejectionResult(params: {
  rejectionReasons: string[];
  packageId?: string;
  createdAt?: string;
  contentsSummary?: ContentsSummary;
  pathTraversalSafe?: boolean;
  uncompressedSizeWithinLimits?: boolean;
  fileCountWithinLimits?: boolean;
  filePaths?: string[];
  totalFiles?: number;
  totalBytes?: number;
}): PackageInspectionResult {
  const contentsSummary: ContentsSummary = params.contentsSummary || {
    hasPdf: false,
    hasExcel: false,
    hasJson: false,
    hasDatabaseSnapshot: false,
    totalFiles: params.totalFiles || 0,
    totalBytes: params.totalBytes || 0,
    filePaths: params.filePaths || [],
    checksumsFilePresent: false,
    readmePresent: false,
  };

  return {
    classification: 'CORRUPT_OR_UNRECOGNIZED',
    isValid: false,
    packageId: params.packageId || 'unrecognized',
    schemaVersion: 'unknown',
    createdAt: params.createdAt || new Date().toISOString(),
    createdBy: { username: 'unknown', role: 'unknown' },
    scope: 'UNKNOWN',
    siteId: null,
    siteName: null,
    periodPreset: 'UNKNOWN',
    periodLabel: 'Unknown Period',
    dateRange: { startDate: null, endDate: null },
    isRestorableAsDatabase: false,
    contentsSummary,
    availableActions: [],
    rejectionReasons: params.rejectionReasons,
    security: {
      pathTraversalSafe: params.pathTraversalSafe ?? true,
      uncompressedSizeWithinLimits: params.uncompressedSizeWithinLimits ?? true,
      fileCountWithinLimits: params.fileCountWithinLimits ?? true,
    },
  };
}
