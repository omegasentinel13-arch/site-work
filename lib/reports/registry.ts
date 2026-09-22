/**
 * SITE WORK — Canonical Report Capability Registry
 * Single authoritative source of truth for all persisted business report types.
 */

export type ReportScope = 'SITE' | 'ALL_SITES';

export type ReportType =
  | 'COMPLETE_REPORT'
  | 'DAILY_ATTENDANCE'
  | 'WEEKLY_ATTENDANCE'
  | 'MONTHLY_ATTENDANCE'
  | 'TRANSACTIONS'
  | 'MASTER_LEDGER'
  | 'LABOUR_WORKER'
  | 'ROLE_REPORT'
  | 'CATEGORY_REPORT'
  | 'SITE_PERFORMANCE'
  | 'ALL_SITES_CONSOLIDATED';

export interface ReportDefinition {
  id: ReportType;
  label: string;
  category: 'COMPREHENSIVE' | 'WORKFORCE' | 'FINANCIAL' | 'ANALYTICS';
  description: string;
  supportedScopes: ReportScope[];
  hasPdf: boolean;
  hasExcel: boolean;
  dateMode: 'RANGE' | 'SINGLE_DATE' | 'MONTH_RANGE' | 'WEEK_RANGE';
  requiredPermission: {
    page: string;
    action: string;
  };
}

/**
 * Exactly 11 User-Facing Report Capabilities
 * Note: COMPLETE_REPORT operates in either SITE or ALL_SITES scope
 * without cluttering the UI with an artificial 12th option.
 */
export const REPORT_DEFINITIONS: Record<ReportType, ReportDefinition> = {
  COMPLETE_REPORT: {
    id: 'COMPLETE_REPORT',
    label: 'Complete Project Report',
    category: 'COMPREHENSIVE',
    description: 'Comprehensive multi-discipline report combining site profile, attendance rosters, labour rollups, cash transactions, and master ledger reconciliation.',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_COMPLETE_EXPORT',
      action: 'EXPORT',
    },
  },
  DAILY_ATTENDANCE: {
    id: 'DAILY_ATTENDANCE',
    label: 'Daily Attendance Roster',
    category: 'WORKFORCE',
    description: 'Itemized headcount and worker-day roster for a specific operational date, broken down by work role.',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'SINGLE_DATE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  WEEKLY_ATTENDANCE: {
    id: 'WEEKLY_ATTENDANCE',
    label: 'Weekly Attendance Matrix',
    category: 'WORKFORCE',
    description: '7-day daily headcount and worker-day deployment matrix across all active work roles for a site.',
    supportedScopes: ['SITE'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'WEEK_RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  MONTHLY_ATTENDANCE: {
    id: 'MONTHLY_ATTENDANCE',
    label: 'Monthly Attendance Sheet',
    category: 'WORKFORCE',
    description: 'Comprehensive calendar-month attendance tally, total worker-days, and cumulative wages.',
    supportedScopes: ['SITE'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'MONTH_RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  TRANSACTIONS: {
    id: 'TRANSACTIONS',
    label: 'Transaction Ledger',
    category: 'FINANCIAL',
    description: 'Itemized cash inflow and outflow transactions, including material supplies, labour disbursements, and investor receipts.',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  MASTER_LEDGER: {
    id: 'MASTER_LEDGER',
    label: 'Master Ledger Statement',
    category: 'FINANCIAL',
    description: 'Monthly financial statement reconciling cumulative opening balance, periodic cash movements, and net closing funds.',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  LABOUR_WORKER: {
    id: 'LABOUR_WORKER',
    label: 'Labour & Workforce Deployment',
    category: 'WORKFORCE',
    description: 'Consolidated deployment analysis summarizing active workdays, daily headcounts, worker-days, and total wage accruals across all trades.',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  ROLE_REPORT: {
    id: 'ROLE_REPORT',
    label: 'Role Deployment Analysis',
    category: 'ANALYTICS',
    description: 'Detailed workforce metrics and wage costs filtered by specific trade role.',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  CATEGORY_REPORT: {
    id: 'CATEGORY_REPORT',
    label: 'Category Trade Breakdown',
    category: 'ANALYTICS',
    description: 'Distribution of workforce deployment, worker-days, and expenditure across work categories (e.g., Civil, Plumbing, Electrical).',
    supportedScopes: ['SITE', 'ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  SITE_PERFORMANCE: {
    id: 'SITE_PERFORMANCE',
    label: 'Site Financial Performance',
    category: 'FINANCIAL',
    description: 'Executive financial overview comparing labour expenditure against non-labour debits and net liquidity for a site.',
    supportedScopes: ['SITE'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_DATA_PROTECTION',
      action: 'VIEW',
    },
  },
  ALL_SITES_CONSOLIDATED: {
    id: 'ALL_SITES_CONSOLIDATED',
    label: 'All-Sites Consolidated Report',
    category: 'COMPREHENSIVE',
    description: 'Enterprise portfolio export consolidating all authorized project sites with individual site sections, overall balance reconciliation, and global summaries.',
    supportedScopes: ['ALL_SITES'],
    hasPdf: true,
    hasExcel: true,
    dateMode: 'RANGE',
    requiredPermission: {
      page: 'PAGE_COMPLETE_EXPORT',
      action: 'EXPORT',
    },
  },
};

export const REPORT_LIST: ReportDefinition[] = Object.values(REPORT_DEFINITIONS);

export function getReportDefinition(type: string): ReportDefinition | null {
  return REPORT_DEFINITIONS[type as ReportType] || null;
}
