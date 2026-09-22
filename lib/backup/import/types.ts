/**
 * Task 4 — Step 4: Logical Backup Ingestion, Analysis & Recovery Types
 */

export type RecordClassification =
  | 'MATCHED_EXACT'
  | 'NEW_RECORD'
  | 'CONFLICT'
  | 'DEPENDENCY_BLOCKED'
  | 'UNRESOLVED_HISTORICAL';

export interface FieldDiff {
  field: string;
  existingValue: unknown;
  incomingValue: unknown;
}

export interface ConflictRecord {
  table: string;
  naturalKey: string;
  existingRecord: Record<string, unknown>;
  incomingRecord: Record<string, unknown>;
  fieldDifferences: FieldDiff[];
  resolutionRecommendation: 'SKIP' | 'KEEP_EXISTING';
}

export interface ClassifiedRecord {
  table: string;
  naturalKey: string;
  classification: RecordClassification;
  record: Record<string, unknown>;
  reason?: string;
  conflict?: ConflictRecord;
}

export interface TableAnalysisSummary {
  table: string;
  totalIncoming: number;
  matchedExact: number;
  newRecords: number;
  conflicts: number;
  dependencyBlocked: number;
  unresolvedHistorical: number;
}

export interface AnalysisReport {
  analysisId: string;
  packageId: string;
  analyzedAt: string;
  scope: 'SYSTEM' | 'SITE';
  siteId?: string | null;
  siteName?: string | null;
  siteCode?: string | null;
  isTampered: boolean;
  tamperDetails?: string[];
  manifest: any;
  tableSummaries: TableAnalysisSummary[];
  totalIncoming: number;
  totalMatchedExact: number;
  totalNewRecords: number;
  totalConflicts: number;
  totalDependencyBlocked: number;
  totalUnresolvedHistorical: number;
  conflicts: ConflictRecord[];
  classifiedRecords: ClassifiedRecord[];
  safeToExecute: boolean;
  warnings: string[];
}

export interface RecoveryExecutionResult {
  operationId: string;
  packageId: string;
  startedAt: string;
  completedAt: string;
  actor: {
    userId: string;
    username: string;
    role: string;
  };
  totalInserted: number;
  totalSkipped: number;
  insertedPerTable: Record<string, number>;
  skippedPerTable: Record<string, number>;
  quarantinedUsersCount: number;
  kingMakerProtected: boolean;
  auditLogId: string;
  success: boolean;
  error?: string;
}

export interface RecoveryHistoryEntry {
  operationId: string;
  packageId: string;
  executedAt: string;
  actor: {
    userId: string;
    username: string;
    role: string;
  };
  scope: 'SYSTEM' | 'SITE';
  siteId?: string | null;
  siteName?: string | null;
  packageChecksum: string;
  analysisChecksum: string;
  totalInserted: number;
  totalSkipped: number;
  totalConflicts: number;
  insertedPerTable: Record<string, number>;
  status: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
}
