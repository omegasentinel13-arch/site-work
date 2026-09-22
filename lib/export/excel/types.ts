import { AttendanceDbRecord } from '../../db/repositories/attendance-repo';
import { FinancialDbRecord } from '../../db/repositories/finance-repo';
import { DailySummary } from '../../domain/attendance-engine';
import { FinancialSummary } from '../../domain/finance-engine';

export type ExcelReportType =
  | 'DAILY_ATTENDANCE'
  | 'WEEKLY_ATTENDANCE'
  | 'MONTHLY_ATTENDANCE'
  | 'FINANCE'
  | 'MONTHLY_FINANCE'
  | 'ROLE_REPORT'
  | 'CATEGORY_REPORT'
  | 'SITE_REPORT';

export interface BaseExcelMetadata {
  siteName: string;
  siteCode?: string | null;
  reportTitle: string;
  periodLabel?: string;
  generatedAt?: string;
  generatedBy?: string;
  filtersSummary?: string;
}

export interface WeeklyAttendanceExcelData {
  records: AttendanceDbRecord[];
  startDate: string;
  endDate: string;
}

export interface MonthlyAttendanceExcelData {
  records: AttendanceDbRecord[];
  monthLabel: string;
  startDate: string;
  endDate: string;
}

export interface FinancialExcelData {
  summary: FinancialSummary;
  transactions: {
    date: string;
    type: 'CREDIT' | 'DEBIT';
    debitCategory: string | null;
    description: string;
    amountPaise: number;
    referenceNote?: string | null;
  }[];
}

export interface MonthlyFinancialExcelData {
  summary: FinancialSummary;
  transactions: {
    date: string;
    type: 'CREDIT' | 'DEBIT';
    debitCategory: string | null;
    description: string;
    amountPaise: number;
    referenceNote?: string | null;
  }[];
}

export interface RoleReportExcelData {
  roleName: string;
  categoryName: string;
  records: AttendanceDbRecord[];
  isAllRoles?: boolean;
}

export interface CategoryReportExcelData {
  categoryName: string;
  records: AttendanceDbRecord[];
}

export interface SiteReportExcelData {
  siteName: string;
  siteLocation?: string | null;
  attendanceRecords: AttendanceDbRecord[];
  financialSummary: FinancialSummary;
}
