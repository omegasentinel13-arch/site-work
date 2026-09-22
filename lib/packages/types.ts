/**
 * Task 3: Universal Package Contract & Classification System
 * Core Data Models & Security Limits
 */

export type PackageClassification =
  | 'REPORT_EXPORT'
  | 'SITE_LOGICAL_BACKUP'
  | 'SYSTEM_RECOVERY_BACKUP'
  | 'SYSTEM_LOGICAL_BACKUP'
  | 'CORRUPT_OR_UNRECOGNIZED';

export type PackageAction =
  | 'VIEW_REPORT_PREVIEW'
  | 'DOWNLOAD_EXTRACTED_FILES'
  | 'PREVIEW_LOGICAL_DATA'
  | 'DIFF_WITH_ACTIVE_SITE'
  | 'SIMULATE_DATABASE_RESTORE'
  | 'EXECUTE_DATABASE_RESTORE';

export interface ContentsSummary {
  hasPdf: boolean;
  hasExcel: boolean;
  hasJson: boolean;
  hasDatabaseSnapshot: boolean;
  totalFiles: number;
  totalBytes: number;
  filePaths: string[];
  checksumsFilePresent: boolean;
  readmePresent: boolean;
}

export interface PackageSecurityAudit {
  pathTraversalSafe: boolean;
  uncompressedSizeWithinLimits: boolean;
  fileCountWithinLimits: boolean;
}

export interface PackageInspectionResult {
  classification: PackageClassification;
  isValid: boolean;
  packageId: string;
  schemaVersion: string;
  createdAt: string;
  createdBy: {
    userId?: string;
    username: string;
    role: string;
  };
  scope: 'SYSTEM' | 'SITE' | 'UNKNOWN';
  siteId: string | null;
  siteName: string | null;
  periodPreset: string;
  periodLabel: string;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  isRestorableAsDatabase: boolean;
  contentsSummary: ContentsSummary;
  availableActions: PackageAction[];
  rejectionReasons: string[];
  security: PackageSecurityAudit;
}

/**
 * Security Boundaries for Archive Processing
 */
export const PACKAGE_SECURITY_LIMITS = {
  MAX_TOTAL_UNCOMPRESSED_BYTES: 500 * 1024 * 1024, // 500 MB Cumulative Decompressed Limit
  MAX_SINGLE_FILE_BYTES: 300 * 1024 * 1024,        // 300 MB per entry limit
  MAX_FILE_COUNT: 1000,                            // Maximum 1,000 files per archive
} as const;
