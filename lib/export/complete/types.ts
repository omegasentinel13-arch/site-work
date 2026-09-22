import { SiteRecord } from '@/lib/db/repositories/site-repo';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { FinancialDbRecord } from '@/lib/db/repositories/finance-repo';
import { CategoryRecord, RoleRecord } from '@/lib/db/repositories/role-repo';
import { DailySummary } from '@/lib/domain/attendance-engine';
import { FinancialSummary } from '@/lib/domain/finance-engine';

export type ExportScope = 'SYSTEM' | 'SITE';

export type PeriodPreset =
  | 'ALL_DATA'
  | 'TODAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_MONTH'
  | 'PREVIOUS_MONTH'
  | 'THIS_YEAR'
  | 'PREVIOUS_YEAR'
  | 'CUSTOM';

export type ExportFormat = 'PDF' | 'EXCEL' | 'JSON' | 'ZIP';

export interface CompleteExportRequest {
  scope: ExportScope;
  siteId?: string;
  period: PeriodPreset;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  formats?: Array<'PDF' | 'EXCEL' | 'JSON'>;
}

export interface ResolvedPeriod {
  preset: PeriodPreset;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  label: string;
  isUnbounded: boolean;
}

export interface RoleRollupItem {
  roleId: string;
  roleName: string;
  categoryId: string;
  categoryName: string;
  workerDays: number;
  fullDays: number;
  halfDays: number;
  totalCostPaise: number;
  ratePaise?: number;
}

export interface CategoryRollupItem {
  categoryId: string;
  categoryName: string;
  workerDays: number;
  fullDays: number;
  halfDays: number;
  totalCostPaise: number;
}

export interface SiteExportData {
  site: SiteRecord;
  period: ResolvedPeriod;
  attendanceRecords: AttendanceDbRecord[];
  financialRecords: FinancialDbRecord[];
  categories: CategoryRecord[];
  roles: RoleRecord[];
  dailySummaries: DailySummary[];
  financialSummary: FinancialSummary;
  openingBalancePaise: number;
  closingBalancePaise: number;
  totalWorkerDays: number;
  totalLabourCostPaise: number;
  roleRollup: RoleRollupItem[];
  categoryRollup: CategoryRollupItem[];
}

export interface SystemExportData {
  period: ResolvedPeriod;
  sitesData: SiteExportData[];
  aggregatedSummary: {
    totalSites: number;
    totalWorkers: number;
    totalWorkerDays: number;
    totalLabourCostPaise: number;
    totalCreditsPaise: number;
    totalDebitsPaise: number;
    netClosingBalancePaise: number;
  };
}

export interface ManifestFileEntry {
  path: string;
  format: 'JSON' | 'PDF' | 'XLSX' | 'TXT';
  bytes: number;
  sha256?: string;
}

export interface ExportManifest {
  application: string;
  exportVersion: number;
  exportType: 'COMPLETE_SITE' | 'COMPLETE_SYSTEM';
  generatedAt: string;
  generatedBy: {
    id: string;
    username: string;
    role: string;
  };
  scope: {
    type: ExportScope;
    siteId?: string;
    siteName?: string;
    siteCode?: string | null;
    totalSites?: number;
  };
  period: {
    preset: PeriodPreset;
    from: string | null;
    to: string | null;
    label: string;
  };
  formatsIncluded: string[];
  recordCounts: {
    attendanceRecords: number;
    financialTransactions: number;
    workRoles: number;
    workCategories: number;
    sites: number;
  };
  files: ManifestFileEntry[];
}
