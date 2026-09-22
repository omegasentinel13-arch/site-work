import JSZip from 'jszip';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { calculateBufferSha256 } from '../backup/checksum-service';
import { BackupManifest, ConflictItem } from '../backup/types';
import { PACKAGE_SECURITY_LIMITS } from '../packages/types';

export interface DeepValidationResult {
  isValid: boolean;
  hasBlockingIssues: boolean;
  manifest: BackupManifest | null;
  extractedDbBuffer: Buffer | null;
  conflicts: ConflictItem[];
  dbMetrics?: {
    sizeBytes: number;
    sha256: string;
    integrityCheck: string;
    foreignKeyViolations: number;
    tableCounts: Record<string, number>;
  };
}

const REQUIRED_CORE_TABLES = [
  'users',
  'recovery_tokens',
  'sites',
  'site_users',
  'work_categories',
  'work_roles',
  'site_role_rates',
  'attendance_records',
  'financial_transactions',
  'audit_logs',
];

export async function deepValidateBackupArchive(zipBuffer: Buffer): Promise<DeepValidationResult> {
  const conflicts: ConflictItem[] = [];

  // 1. Unpack ZIP
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err: any) {
    conflicts.push({
      code: 'CORRUPT_ZIP_ARCHIVE',
      title: 'Corrupted Backup Archive',
      description: `Unable to unpack backup archive: ${err.message || 'Invalid ZIP format'}`,
      severity: 'BLOCKING',
    });
    return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
  }

  // 1b. Path Traversal & Archive Security Limits (ZIP Bomb Defense)
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
      conflicts.push({
        code: 'SECURITY_VIOLATION_PATH_TRAVERSAL',
        title: 'Malicious Path Traversal Detected',
        description: `Archive contains potentially malicious file path: '${rawPath}'`,
        severity: 'BLOCKING',
      });
      return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
    }
  }

  const fileEntries = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);
  if (fileEntries.length > PACKAGE_SECURITY_LIMITS.MAX_FILE_COUNT) {
    conflicts.push({
      code: 'SECURITY_VIOLATION_FILE_COUNT',
      title: 'File Count Exceeds Safe Limit',
      description: `Archive contains ${fileEntries.length} files, exceeding limit of ${PACKAGE_SECURITY_LIMITS.MAX_FILE_COUNT}.`,
      severity: 'BLOCKING',
    });
    return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
  }

  let totalUncompressedBytes = 0;
  for (const [rawPath, entry] of fileEntries) {
    const declaredSize = (entry as any)._data?.uncompressedSize ?? 0;
    if (declaredSize > PACKAGE_SECURITY_LIMITS.MAX_SINGLE_FILE_BYTES) {
      conflicts.push({
        code: 'SECURITY_VIOLATION_SINGLE_FILE_SIZE',
        title: 'Single File Exceeds Size Limit',
        description: `File '${rawPath}' exceeds maximum single file size limit (${PACKAGE_SECURITY_LIMITS.MAX_SINGLE_FILE_BYTES} bytes).`,
        severity: 'BLOCKING',
      });
      return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
    }
    totalUncompressedBytes += declaredSize;
    if (totalUncompressedBytes > PACKAGE_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      conflicts.push({
        code: 'SECURITY_VIOLATION_TOTAL_SIZE',
        title: 'Total Uncompressed Size Exceeds Limit',
        description: `Cumulative uncompressed archive size exceeds limit of ${PACKAGE_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES} bytes.`,
        severity: 'BLOCKING',
      });
      return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
    }
  }

  // 2. Read manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    conflicts.push({
      code: 'MISSING_MANIFEST',
      title: 'Missing Backup Manifest',
      description: 'Archive is missing the authoritative manifest.json file.',
      severity: 'BLOCKING',
    });
    return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
  }

  let manifest: BackupManifest;
  try {
    const manifestText = await manifestFile.async('string');
    manifest = JSON.parse(manifestText);
  } catch (err: any) {
    conflicts.push({
      code: 'MALFORMED_MANIFEST',
      title: 'Malformed Manifest JSON',
      description: `Unable to parse manifest.json: ${err.message}`,
      severity: 'BLOCKING',
    });
    return { isValid: false, hasBlockingIssues: true, manifest: null, extractedDbBuffer: null, conflicts };
  }

  // 3. Verify Item Checksums & Actual Extraction Limits
  let decompressedBytesAccumulator = 0;
  for (const item of manifest.files) {
    const entry = zip.file(item.path);
    if (!entry) {
      conflicts.push({
        code: 'MISSING_DECLARED_FILE',
        title: 'Declared File Missing from Archive',
        description: `Manifest declares '${item.path}', but it is missing from the ZIP.`,
        severity: 'BLOCKING',
      });
      continue;
    }

    const fileBuf = await entry.async('nodebuffer');
    decompressedBytesAccumulator += fileBuf.length;
    if (decompressedBytesAccumulator > PACKAGE_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      conflicts.push({
        code: 'SECURITY_VIOLATION_TOTAL_SIZE',
        title: 'Total Decompressed Size Limit Exceeded',
        description: `Archive decompressed size exceeded safety limit of ${PACKAGE_SECURITY_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES} bytes.`,
        severity: 'BLOCKING',
      });
      return { isValid: false, hasBlockingIssues: true, manifest, extractedDbBuffer: null, conflicts };
    }

    const actualSha = calculateBufferSha256(fileBuf);
    if (actualSha.toLowerCase() !== item.sha256.toLowerCase()) {
      conflicts.push({
        code: 'CHECKSUM_MISMATCH',
        title: 'Cryptographic Checksum Mismatch',
        description: `File '${item.path}' SHA-256 does not match declared manifest hash! File may be corrupted or tampered with.`,
        severity: 'BLOCKING',
        details: { expected: item.sha256, actual: actualSha },
      });
    }
  }

  // 4. RESTORABLE DATABASE INVARIANT VERIFICATION
  // A backup is eligible for physical database restoration IF AND ONLY IF:
  // - scope is strictly 'SYSTEM'
  // - periodPreset is strictly 'ALL_DATA'
  // - manifest declares restorableAsDatabase === true
  // - data/site_work.db physically exists
  if (manifest.scope !== 'SYSTEM') {
    conflicts.push({
      code: 'SITE_SCOPE_RESTORE_BLOCKED',
      title: 'Site-Scoped Backup Cannot Replace Full Database',
      description: 'This is a site-scoped logical backup. It does not contain a full database snapshot and cannot be used to overwrite the application database.',
      severity: 'BLOCKING',
    });
  }

  if (manifest.periodPreset !== 'ALL_DATA' || !manifest.isUnbounded) {
    conflicts.push({
      code: 'DATE_SCOPED_RESTORE_BLOCKED',
      title: 'Date-Filtered Archive Cannot Replace Database',
      description: `This backup covers a scoped date period (${manifest.periodPreset}). Restoring a partial date archive would destroy historical records and is strictly prohibited.`,
      severity: 'BLOCKING',
    });
  }

  if (!manifest.restorableAsDatabase) {
    conflicts.push({
      code: 'NON_RESTORABLE_FLAG',
      title: 'Archive Flagged Non-Restorable',
      description: 'Manifest explicitly flags this archive as non-restorable (Reporting Archive).',
      severity: 'BLOCKING',
    });
  }

  const dbEntry = zip.file('data/site_work.db');
  if (!dbEntry) {
    conflicts.push({
      code: 'MISSING_DATABASE_FILE',
      title: 'Missing SQLite Database Snapshot',
      description: 'The archive does not contain data/site_work.db required for database restoration.',
      severity: 'BLOCKING',
    });
    return {
      isValid: false,
      hasBlockingIssues: conflicts.some((c) => c.severity === 'BLOCKING'),
      manifest,
      extractedDbBuffer: null,
      conflicts,
    };
  }

  // 5. Extract DB and Verify in Isolated Sandbox
  const dbBuffer = await dbEntry.async('nodebuffer');
  const dbSha256 = calculateBufferSha256(dbBuffer);

  const tmpSandboxPath = path.join(os.tmpdir(), `deep_val_${Date.now()}_${crypto.randomUUID().substring(0, 8)}.db`);
  fs.writeFileSync(tmpSandboxPath, dbBuffer);

  let sandboxDb: DatabaseSync;
  let integrityCheck = 'unknown';
  const fkViolations: any[] = [];
  const tableCounts: Record<string, number> = {};

  try {
    try {
      sandboxDb = new DatabaseSync(tmpSandboxPath, { readOnly: true } as any);

      // PRAGMA integrity_check
      const integrityRows = sandboxDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      integrityCheck = integrityRows[0]?.integrity_check || 'unknown';
      if (integrityCheck !== 'ok') {
        conflicts.push({
          code: 'SQLITE_INTEGRITY_FAILED',
          title: 'SQLite Page Integrity Check Failed',
          description: `Database failed integrity check: ${integrityCheck}`,
          severity: 'BLOCKING',
        });
      }

      // PRAGMA foreign_key_check
      const violations = sandboxDb.prepare('PRAGMA foreign_key_check').all();
      if (violations.length > 0) {
        fkViolations.push(...violations);
        conflicts.push({
          code: 'FOREIGN_KEY_VIOLATION',
          title: 'Foreign Key Referential Violations',
          description: `Database contains ${violations.length} foreign key referential violations!`,
          severity: 'BLOCKING',
          details: { violations },
        });
      }

      // Verify all 10 core tables exist in schema
      const existingTables = sandboxDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const tableSet = new Set(existingTables.map((t) => t.name));

      for (const reqTable of REQUIRED_CORE_TABLES) {
        if (!tableSet.has(reqTable)) {
          conflicts.push({
            code: 'MISSING_SCHEMA_TABLE',
            title: `Required Table Missing: ${reqTable}`,
            description: `The database snapshot is missing the required schema table '${reqTable}'.`,
            severity: 'BLOCKING',
          });
        }
      }

      // Verify at least one active Admin exists
      if (tableSet.has('users')) {
        const adminCount = (
          sandboxDb
            .prepare("SELECT count(*) as count FROM users WHERE role = 'ADMIN' AND is_active = 1")
            .get() as { count: number }
        )?.count || 0;

        if (adminCount === 0) {
          conflicts.push({
            code: 'NO_ADMIN_USER',
            title: 'No Active Administrator Found',
            description: 'Restoring this database would lock out all system administrators because it contains zero active ADMIN accounts.',
            severity: 'BLOCKING',
          });
        }
      }

      // Table row counts
      for (const t of REQUIRED_CORE_TABLES) {
        if (tableSet.has(t)) {
          const row = sandboxDb.prepare(`SELECT count(*) as count FROM ${t}`).get() as { count: number };
          tableCounts[t] = row?.count || 0;
        }
      }

      sandboxDb.close();
    } catch (err: any) {
      conflicts.push({
        code: 'SQLITE_CORRUPT_BINARY',
        title: 'Database Binary Corrupted',
        description: `Failed to inspect SQLite database snapshot: ${err.message}`,
        severity: 'BLOCKING',
      });
      return {
        isValid: false,
        hasBlockingIssues: true,
        manifest,
        extractedDbBuffer: dbBuffer,
        conflicts,
      };
    }
  } finally {
    try {
      if (fs.existsSync(tmpSandboxPath)) fs.unlinkSync(tmpSandboxPath);
      const walTmp = `${tmpSandboxPath}-wal`;
      const shmTmp = `${tmpSandboxPath}-shm`;
      if (fs.existsSync(walTmp)) fs.unlinkSync(walTmp);
      if (fs.existsSync(shmTmp)) fs.unlinkSync(shmTmp);
    } catch {}
  }

  const hasBlocking = conflicts.some((c) => c.severity === 'BLOCKING');

  return {
    isValid: !hasBlocking,
    hasBlockingIssues: hasBlocking,
    manifest,
    extractedDbBuffer: dbBuffer,
    conflicts,
    dbMetrics: {
      sizeBytes: dbBuffer.length,
      sha256: dbSha256,
      integrityCheck,
      foreignKeyViolations: fkViolations.length,
      tableCounts,
    },
  };
}
