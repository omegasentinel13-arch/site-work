/**
 * Backward compatibility facade for legacy prototypes.
 * Delegates directly to the modular lib/export/excel engine.
 */
import { DailySummary } from '../domain/attendance-engine';
import { FinancialSummary } from '../domain/finance-engine';
import { AttendanceDbRecord } from '../db/repositories/attendance-repo';
import { FinancialDbRecord } from '../db/repositories/finance-repo';
import {
  generateDailyAttendanceExcel as modularDailyExcel,
  generateMonthlyAttendanceExcel as modularMonthlyAttendanceExcel,
} from './excel';

export async function generateDailyAttendanceExcel(
  siteName: string,
  date: string,
  summary: DailySummary
): Promise<Buffer> {
  return await modularDailyExcel(
    {
      siteName,
      reportTitle: 'Daily Attendance Report',
      periodLabel: date,
    },
    summary
  );
}

export async function generateMonthlyComprehensiveExcel(data: {
  siteName: string;
  monthLabel: string;
  attendanceRecords: AttendanceDbRecord[];
  financialTransactions: FinancialDbRecord[];
  financialSummary: FinancialSummary;
  totalLabourCostPaise: number;
  totalWorkers: number;
  totalWorkerDays: number;
}): Promise<Buffer> {
  return await modularMonthlyAttendanceExcel(
    {
      siteName: data.siteName,
      reportTitle: 'Monthly Attendance Report',
      periodLabel: data.monthLabel,
    },
    {
      records: data.attendanceRecords,
      monthLabel: data.monthLabel,
      startDate: '',
      endDate: '',
    }
  );
}
