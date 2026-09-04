export type ReportType =
  | 'DAILY_ATTENDANCE'
  | 'WEEKLY_ATTENDANCE'
  | 'MONTHLY_ATTENDANCE'
  | 'FINANCE'
  | 'MONTHLY_FINANCE'
  | 'ROLE_REPORT'
  | 'CATEGORY_REPORT'
  | 'SITE_REPORT';

export interface BaseReportMetadata {
  siteName: string;
  siteCode?: string | null;
  reportTitle: string;
  periodLabel: string;
  generatedAt?: string;
  generatedBy?: string | null;
  filtersSummary?: string;
}

export type PageOrientation = 'portrait' | 'landscape';
