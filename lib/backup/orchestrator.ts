import crypto from 'node:crypto';
import { UserSession } from '../auth/session';
import { BackupScope, BackupManifest } from './types';
import { RestoreCoordinator } from './coordinator';
import {
  resolveExportPeriod,
  getScopeHistoricalDateBounds,
  PeriodPreset,
} from '../export/complete';
import {
  generateSystemDatabaseSnapshot,
  extractSystemLogicalDatasets,
  extractSiteLogicalDatasets,
} from './snapshot-engine';
import { buildBackupManifest } from './manifest-service';
import { packageBackupArchive, PackageFilePayload } from './packager';
import { saveBackupToStorage } from './storage-registry';
import { logAudit } from '../audit/logger';
import { getSiteById } from '../db/repositories/site-repo';

export interface CreateBackupRequest {
  scope: BackupScope;
  siteId?: string;
  period?: PeriodPreset;
  from?: string;
  to?: string;
  includePdf?: boolean;
  includeExcel?: boolean;
}

export interface BackupExecutionResult {
  backupId: string;
  fileName: string;
  filePath: string;
  zipBuffer: Buffer;
  zipSha256: string;
  sizeBytes: number;
  manifest: BackupManifest;
}

export async function createEnterpriseBackup(
  req: CreateBackupRequest,
  session: UserSession
): Promise<BackupExecutionResult> {
  // 1. RBAC Guard
  if (session.role === 'VIEWER') {
    throw new Error('Access denied: Viewers cannot generate backup archives.');
  }

  if (req.scope === 'SYSTEM' && session.role !== 'ADMIN') {
    throw new Error('Access denied: System-wide backup requires Administrator privileges.');
  }

  if (req.scope === 'SITE') {
    if (!req.siteId || !req.siteId.trim()) {
      throw new Error('siteId is required for site-scoped backup.');
    }
    const siteId = req.siteId.trim();
    if (session.role !== 'ADMIN' && !session.assignedSiteIds.includes(siteId)) {
      throw new Error(`Access denied: You are not authorized to access site ${siteId}.`);
    }
  }

  // 2. Concurrency: Deduplicate concurrent requests for the same target & acquire lock
  const flightTarget = req.scope === 'SITE' ? req.siteId : 'SYSTEM';
  const flightKey = `${session.userId}:${req.scope}:${flightTarget}:${req.period || 'ALL_DATA'}:${req.from || ''}:${req.to || ''}`;

  if (!RestoreCoordinator.acquireBackupFlightLock(flightKey)) {
    throw new Error('CONCURRENT_BACKUP_IN_PROGRESS: A backup generation operation for this target is already in progress. Please wait for it to complete.');
  }

  let releaseReadLock: (() => void) | null = null;

  try {
    releaseReadLock = await RestoreCoordinator.acquireSharedReadLock();
    const backupId = `bak-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
    const periodPreset = req.period || 'ALL_DATA';

    const bounds = getScopeHistoricalDateBounds(req.scope === 'SITE' ? req.siteId : undefined);
    const resolvedPeriod = resolveExportPeriod(periodPreset, req.from, req.to, bounds);

    const payloadFiles: PackageFilePayload[] = [];
    let siteName: string | null = null;
    let siteCode: string | null = null;
    let databaseMetadata: any = undefined;

    // 3. Assemble components based on Scope — RECOVERY DATA ONLY (Zero PDF, Zero Excel)
    if (req.scope === 'SYSTEM') {
      // SYSTEM SCOPE:
      // If ALL_DATA: Include full standalone SQLite snapshot (restorableAsDatabase = true)
      if (resolvedPeriod.isUnbounded && periodPreset === 'ALL_DATA') {
        const snapshot = generateSystemDatabaseSnapshot();
        databaseMetadata = snapshot.metadata;
        payloadFiles.push({
          zipPath: 'data/site_work.db',
          format: 'SQLITE',
          buffer: snapshot.buffer,
        });
      }

      // Comprehensive system recovery datasets across all application tables (sanitized, zero secrets)
      const systemDatasets = extractSystemLogicalDatasets();

      payloadFiles.push({
        zipPath: 'data/system_state.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.systemStateJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/master_export.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.masterExportJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/users.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.usersJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/sites.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.sitesJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/attendance_records.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.attendanceJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/financial_transactions.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.financeJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/work_roles.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.workRolesJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/work_categories.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.workCategoriesJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/site_role_rates.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.siteRoleRatesJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/investors.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.investorsJson, 'utf-8'),
      });

      payloadFiles.push({
        zipPath: 'data/audit_logs.json',
        format: 'JSON',
        buffer: Buffer.from(systemDatasets.auditLogsJson, 'utf-8'),
      });
    } else {
      // SITE SCOPE:
      // STRICT SITE ISOLATION: Under no circumstances is site_work.db included!
      const siteId = req.siteId!.trim();
      const site = getSiteById(siteId);
      if (!site) throw new Error(`Site not found: ${siteId}`);
      siteName = site.name;
      siteCode = site.code;

      const logicalData = extractSiteLogicalDatasets(siteId, resolvedPeriod);

      payloadFiles.push({
        zipPath: 'data/site_profile.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.siteProfileJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/site_users.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.siteUsersJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/attendance_records.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.attendanceJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/financial_transactions.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.financeJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/utilized_roles.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.rolesJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/utilized_categories.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.categoriesJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/site_role_rates.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.ratesJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/supply_items.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.supplyItemsJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/site_lifecycle_records.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.lifecycleJson, 'utf-8'),
      });
      payloadFiles.push({
        zipPath: 'data/site_audit_logs.json',
        format: 'JSON',
        buffer: Buffer.from(logicalData.auditLogsJson, 'utf-8'),
      });
    }

    // 4. Build Manifest & Package Archive
    const baseManifest = buildBackupManifest({
      backupId,
      scope: req.scope,
      siteId: req.scope === 'SITE' ? req.siteId : null,
      siteName,
      siteCode,
      periodPreset,
      isUnbounded: resolvedPeriod.isUnbounded,
      startDate: resolvedPeriod.startDate || null,
      endDate: resolvedPeriod.endDate || null,
      user: {
        userId: session.userId,
        username: session.username,
        role: session.role,
      },
      databaseMetadata,
      files: [],
    });

    const packaged = await packageBackupArchive(baseManifest, payloadFiles);

    const safeScopeName = req.scope === 'SYSTEM' ? 'SYSTEM' : (siteCode || siteName || 'SITE').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `SITE_WORK_BACKUP_${safeScopeName}_${periodPreset}_${timestampStr}_${backupId}.zip`;

    // 5. Save Archive to Storage
    const filePath = saveBackupToStorage(fileName, packaged.zipBuffer);

    // 6. Record Audit Log
    try {
      logAudit({
        entityType: 'SECURITY',
        entityId: backupId,
        action: 'CREATE',
        siteId: req.scope === 'SITE' ? req.siteId : null,
        userId: session.userId,
        beforeState: null,
        afterState: {
          action: 'BACKUP_CREATED',
          scope: req.scope,
          periodPreset,
          fileName,
          sizeBytes: packaged.sizeBytes,
          sha256: packaged.zipSha256,
          restorableAsDatabase: packaged.manifest.restorableAsDatabase,
        },
      });
    } catch {}

    return {
      backupId,
      fileName,
      filePath,
      zipBuffer: packaged.zipBuffer,
      zipSha256: packaged.zipSha256,
      sizeBytes: packaged.sizeBytes,
      manifest: packaged.manifest,
    };
  } finally {
    try {
      RestoreCoordinator.releaseBackupFlightLock(flightKey);
    } catch {}
    if (releaseReadLock) {
      try {
        releaseReadLock();
      } catch {}
    }
  }
}
