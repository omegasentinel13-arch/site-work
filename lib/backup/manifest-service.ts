import { BackupManifest, BackupScope, BackupDatabaseMetadata, ManifestFileEntry } from './types';

export interface CreateManifestInput {
  backupId: string;
  scope: BackupScope;
  siteId?: string | null;
  siteName?: string | null;
  siteCode?: string | null;
  periodPreset: string;
  isUnbounded: boolean;
  startDate: string | null;
  endDate: string | null;
  user: {
    userId: string;
    username: string;
    role: string;
  };
  databaseMetadata?: BackupDatabaseMetadata;
  files: ManifestFileEntry[];
}

export function buildBackupManifest(input: CreateManifestInput): BackupManifest {
  // CRITICAL INVARIANT:
  // restorableAsDatabase is TRUE IF AND ONLY IF:
  // 1. scope is strictly 'SYSTEM'
  // 2. period is unbounded 'ALL_DATA'
  // 3. database snapshot is included and standalone
  const restorableAsDatabase =
    input.scope === 'SYSTEM' &&
    input.periodPreset === 'ALL_DATA' &&
    input.isUnbounded &&
    Boolean(input.databaseMetadata?.included && input.databaseMetadata?.isStandalone);

  return {
    manifestVersion: '2.0.0',
    backupId: input.backupId,
    backupTimestamp: new Date().toISOString(),
    projectName: 'SITE WORK',
    applicationVersion: '1.0.0',
    schemaVersion: '1.2.0',
    scope: input.scope,
    siteId: input.siteId || null,
    siteName: input.siteName || null,
    siteCode: input.siteCode || null,
    periodPreset: input.periodPreset,
    isUnbounded: input.isUnbounded,
    dateRange: {
      startDate: input.startDate,
      endDate: input.endDate,
    },
    restorableAsDatabase,
    createdBy: {
      userId: input.user.userId,
      username: input.user.username,
      role: input.user.role,
    },
    database: input.databaseMetadata,
    files: input.files,
    security: {
      envLocalExcluded: true,
      sessionSecretsExcluded: true,
      databaseContainsProductionAuthenticationData: Boolean(input.databaseMetadata?.included),
    },
  };
}

export function validateManifestStructure(manifest: unknown): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    return { isValid: false, errors: ['Manifest must be a valid JSON object.'] };
  }

  const m = manifest as Record<string, unknown>;
  if (!m.manifestVersion) errors.push('Missing manifestVersion');
  if (!m.backupId) errors.push('Missing backupId');
  if (!m.backupTimestamp) errors.push('Missing backupTimestamp');
  if (!m.scope || (m.scope !== 'SYSTEM' && m.scope !== 'SITE')) errors.push('Invalid scope');
  if (!m.periodPreset) errors.push('Missing periodPreset');
  if (typeof m.restorableAsDatabase !== 'boolean') errors.push('Missing restorableAsDatabase boolean');
  if (!Array.isArray(m.files)) errors.push('files must be an array');

  return {
    isValid: errors.length === 0,
    errors,
  };
}
