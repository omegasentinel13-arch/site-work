/**
 * Task 2: Enterprise Backup, Disaster Recovery & Controlled Restore System
 * Core Data Models & Type Definitions
 */

export type BackupScope = 'SYSTEM' | 'SITE';

export type BackupFormat = 'SQLITE' | 'JSON' | 'PDF' | 'EXCEL';

export type ConflictSeverity = 'BLOCKING' | 'WARNING' | 'SAFE';

export interface ManifestFileEntry {
  path: string;
  format: string;
  sizeBytes: number;
  sha256: string;
}

export interface BackupDatabaseMetadata {
  included: boolean;
  isStandalone: boolean;
  sizeBytes: number;
  sha256: string;
  integrityCheck: string;
  tableCounts: {
    users: number;
    sites: number;
    site_users: number;
    work_categories: number;
    work_roles: number;
    attendance_records: number;
    financial_transactions: number;
    audit_logs: number;
    site_role_rates?: number;
    investors?: number;
    supply_items?: number;
    system_lifecycle_records?: number;
    permission_definitions?: number;
    role_permissions?: number;
    user_permission_overrides?: number;
  };
}

export interface BackupManifest {
  manifestVersion: string;
  backupId: string;
  backupTimestamp: string;
  projectName: string;
  applicationVersion: string;
  schemaVersion: string;
  scope: BackupScope;
  siteId?: string | null;
  siteName?: string | null;
  siteCode?: string | null;
  periodPreset: string;
  isUnbounded: boolean;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  restorableAsDatabase: boolean;
  createdBy: {
    userId: string;
    username: string;
    role: string;
  };
  database?: BackupDatabaseMetadata;
  files: ManifestFileEntry[];
  security: {
    envLocalExcluded: boolean;
    sessionSecretsExcluded: boolean;
    databaseContainsProductionAuthenticationData: boolean;
  };
}

export interface StoredBackupRecord {
  id: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  sizeFormatted: string;
  sha256: string;
  createdAt: string;
  manifest: BackupManifest;
  isPreRestoreBackup?: boolean;
}

export interface ConflictItem {
  code: string;
  title: string;
  description: string;
  severity: ConflictSeverity;
  affectedEntity?: string;
  details?: Record<string, unknown>;
}

export interface RecordDiffItem {
  entityName: string;
  currentCount: number;
  restoredCount: number;
  delta: number;
  action: 'INCREASE' | 'DECREASE' | 'UNCHANGED';
}

export interface RestorePlan {
  backupId: string;
  backupTimestamp: string;
  scope: BackupScope;
  siteName?: string;
  restorableAsDatabase: boolean;
  canExecuteRestore: boolean;
  conflicts: ConflictItem[];
  hasBlockingConflicts: boolean;
  hasWarnings: boolean;
  recordDiff: RecordDiffItem[];
  preRestoreSafetyBackupRequired: boolean;
}

export interface RecoveryJournalEntry {
  eventId: string;
  operationId: string;
  eventType: 
    | 'RESTORE_INITIATED' 
    | 'PRE_RESTORE_BACKUP_CREATED' 
    | 'DATABASE_SWAP_STARTED' 
    | 'RESTORE_SUCCESS' 
    | 'RESTORE_FAILED_ROLLED_BACK' 
    | 'RESTORE_CRITICAL_FAILURE';
  timestamp: string;
  operator: {
    userId: string;
    username: string;
    role: string;
  };
  sourceBackup?: {
    backupId: string;
    scope: string;
    sha256: string;
    declaredCounts?: Record<string, number>;
  };
  preRestoreDatabase?: {
    sizeBytes: number;
    sha256: string;
    counts?: Record<string, number>;
  };
  restoredDatabaseSha256?: string;
  verifiedCounts?: Record<string, number>;
  preRestoreBackupPath?: string;
  error?: string;
  durationMs?: number;
}
