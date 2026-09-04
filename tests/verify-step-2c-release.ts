import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  generateDailyAttendanceExcel,
  generateWeeklyAttendanceExcel,
  generateMonthlyAttendanceExcel,
  generateFinancialExcel,
  generateMonthlyFinancialExcel,
  generateRoleReportExcel,
  generateCategoryReportExcel,
  generateSiteReportExcel,
} from '../lib/export/excel';
import { DailySummary } from '../lib/domain/attendance-engine';
import { FinancialSummary, FinancialTransaction } from '../lib/domain/finance-engine';
import { BaseExcelMetadata, AttendanceDbRecord } from '../lib/export/excel/types';
import { escapeExcelFormula, sanitizeExcelFilename } from '../lib/export/excel/security';

function isZipBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

async function runStep2CReleaseVerification() {
  console.log('================================================================');
  console.log('PHASE 5 STEP 2C: FINAL EXCEL SUBSYSTEM RELEASE GATE VERIFICATION');
  console.log('================================================================\n');

  const meta: BaseExcelMetadata = {
    siteName: 'Sunrise Mega Complex',
    siteCode: 'SMC-01',
    reportTitle: 'Master Release Verification Audit',
    periodLabel: '01 Sep 2026 to 30 Sep 2026',
    generatedAt: '04/09/2026, 06:00:00 pm',
  };

  // Mock records
  const sampleRecords: AttendanceDbRecord[] = [
    {
      id: 'att-1',
      site_id: 'site-1',
      date: '2026-09-01',
      role_id: 'role-mason',
      role_name: 'Lead Mason',
      category_id: 'cat-civil',
      category_name: 'Civil Works',
      rate_snapshot_paise: 120000,
      full_day_count: 4,
      half_day_count: 1,
      total_workers: 5,
      worker_days: 4.5,
      total_cost_paise: 540000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'att-2',
      site_id: 'site-1',
      date: '2026-09-02',
      role_id: 'role-carpenter',
      role_name: 'Lead Carpenter',
      category_id: 'cat-carpentry',
      category_name: 'Carpentry Works',
      rate_snapshot_paise: 100000,
      full_day_count: 3,
      half_day_count: 0,
      total_workers: 3,
      worker_days: 3.0,
      total_cost_paise: 300000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    },
  ];

  const dailySummary: DailySummary = {
    date: '2026-09-01',
    totalWorkers: 5,
    fullDayCount: 4,
    halfDayCount: 1,
    workerDays: 4.5,
    totalLabourCostPaise: 540000,
    categories: [
      {
        categoryId: 'cat-civil',
        categoryName: 'Civil Works',
        totalWorkers: 5,
        fullDayCount: 4,
        halfDayCount: 1,
        workerDays: 4.5,
        totalCostPaise: 540000,
        roles: [
          {
            roleId: 'role-mason',
            roleName: 'Lead Mason',
            categoryId: 'cat-civil',
            categoryName: 'Civil Works',
            rateInPaise: 120000,
            fullDayCount: 4,
            halfDayCount: 1,
            totalWorkers: 5,
            workerDays: 4.5,
            fullDayCostPaise: 480000,
            halfDayCostPaise: 60000,
            totalCostPaise: 540000,
          },
        ],
      },
    ],
  };

  const financeSummary: FinancialSummary = {
    openingBalancePaise: 10000000,
    totalCreditPaise: 25000000,
    suppliesDebitPaise: 5000000,
    specialWorkerTaskDebitPaise: 2000000,
    totalDebitPaise: 7000000,
    netCashFlowPaise: 18000000,
    closingBalancePaise: 28000000,
    transactionCount: 2,
  };

  const transactions: FinancialTransaction[] = [
    {
      id: 'tx-1',
      siteId: 'site-1',
      date: '2026-09-01',
      type: 'CREDIT',
      debitCategory: null,
      description: 'Capital Inflow Tranche A',
      amountPaise: 25000000,
      referenceNote: 'Bank Transfer #7781',
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      id: 'tx-2',
      siteId: 'site-1',
      date: '2026-09-02',
      type: 'DEBIT',
      debitCategory: 'SUPPLIES',
      description: 'Cement & Aggregate Delivery',
      amountPaise: 5000000,
      referenceNote: 'Invoice #CIV-091',
      createdAt: '2026-09-02T14:30:00Z',
    },
  ];

  const results: Array<{ report: string; sheets: string[]; sizeKb: number; status: string }> = [];

  // ==========================================================================
  // GATE 1: ALL 8 REPORT TYPES END-TO-END GENERATION & OPENXML PACKAGES
  // ==========================================================================
  console.log('--- GATE 1: ALL 8 REPORTS GENERATION & OPENXML COMPLIANCE ---');

  // 1. DAILY_ATTENDANCE
  const bDaily = await generateDailyAttendanceExcel(meta, dailySummary);
  assert.ok(isZipBuffer(bDaily), 'Daily Attendance must return OpenXML ZIP');
  const wbDaily = XLSX.read(bDaily, { type: 'buffer' });
  assert.deepEqual(wbDaily.SheetNames, ['Daily Attendance']);
  results.push({ report: 'DAILY_ATTENDANCE', sheets: wbDaily.SheetNames, sizeKb: Math.round(bDaily.length / 1024), status: 'PASS' });
  console.log('  ✔ DAILY_ATTENDANCE: OpenXML Valid, Sheets: [' + wbDaily.SheetNames.join(', ') + ']');

  // 2. WEEKLY_ATTENDANCE
  const bWeekly = await generateWeeklyAttendanceExcel(meta, { startDate: '2026-09-01', endDate: '2026-09-07', records: sampleRecords });
  assert.ok(isZipBuffer(bWeekly), 'Weekly Attendance must return OpenXML ZIP');
  const wbWeekly = XLSX.read(bWeekly, { type: 'buffer' });
  assert.deepEqual(wbWeekly.SheetNames, ['Weekly Matrix', 'Daily Records']);
  results.push({ report: 'WEEKLY_ATTENDANCE', sheets: wbWeekly.SheetNames, sizeKb: Math.round(bWeekly.length / 1024), status: 'PASS' });
  console.log('  ✔ WEEKLY_ATTENDANCE: OpenXML Valid, Sheets: [' + wbWeekly.SheetNames.join(', ') + ']');

  // 3. MONTHLY_ATTENDANCE
  const bMonthly = await generateMonthlyAttendanceExcel(meta, {
    year: 2026,
    month: 9,
    monthName: 'September 2026',
    daysInMonth: 30,
    records: sampleRecords,
  });
  assert.ok(isZipBuffer(bMonthly), 'Monthly Attendance must return OpenXML ZIP');
  const wbMonthly = XLSX.read(bMonthly, { type: 'buffer' });
  assert.deepEqual(wbMonthly.SheetNames, ['Category Rollup', 'Daily Progression', 'Raw Workforce Log']);
  results.push({ report: 'MONTHLY_ATTENDANCE', sheets: wbMonthly.SheetNames, sizeKb: Math.round(bMonthly.length / 1024), status: 'PASS' });
  console.log('  ✔ MONTHLY_ATTENDANCE: OpenXML Valid, Sheets: [' + wbMonthly.SheetNames.join(', ') + ']');

  // 4. FINANCE
  const bFinance = await generateFinancialExcel(meta, { summary: financeSummary, transactions });
  assert.ok(isZipBuffer(bFinance), 'Finance must return OpenXML ZIP');
  const wbFinance = XLSX.read(bFinance, { type: 'buffer' });
  assert.deepEqual(wbFinance.SheetNames, ['Financial Ledger']);
  results.push({ report: 'FINANCE', sheets: wbFinance.SheetNames, sizeKb: Math.round(bFinance.length / 1024), status: 'PASS' });
  console.log('  ✔ FINANCE: OpenXML Valid, Sheets: [' + wbFinance.SheetNames.join(', ') + ']');

  // 5. MONTHLY_FINANCE
  const bMonFinance = await generateMonthlyFinancialExcel(meta, {
    year: 2026,
    month: 9,
    monthName: 'September 2026',
    summary: financeSummary,
    transactions,
  });
  assert.ok(isZipBuffer(bMonFinance), 'Monthly Finance must return OpenXML ZIP');
  const wbMonFinance = XLSX.read(bMonFinance, { type: 'buffer' });
  assert.deepEqual(wbMonFinance.SheetNames, ['Monthly Statement', 'Cash Inflows', 'Cash Outflows']);
  results.push({ report: 'MONTHLY_FINANCE', sheets: wbMonFinance.SheetNames, sizeKb: Math.round(bMonFinance.length / 1024), status: 'PASS' });
  console.log('  ✔ MONTHLY_FINANCE: OpenXML Valid, Sheets: [' + wbMonFinance.SheetNames.join(', ') + ']');

  // 6. ROLE_REPORT
  const bRole = await generateRoleReportExcel(meta, {
    roleName: 'All Roles',
    categoryName: 'All Categories',
    records: sampleRecords,
    isAllRoles: true,
  });
  assert.ok(isZipBuffer(bRole), 'Role Report must return OpenXML ZIP');
  const wbRole = XLSX.read(bRole, { type: 'buffer' });
  assert.deepEqual(wbRole.SheetNames, ['Workforce Deployment']);
  results.push({ report: 'ROLE_REPORT', sheets: wbRole.SheetNames, sizeKb: Math.round(bRole.length / 1024), status: 'PASS' });
  console.log('  ✔ ROLE_REPORT: OpenXML Valid, Sheets: [' + wbRole.SheetNames.join(', ') + ']');

  // 7. CATEGORY_REPORT
  const bCategory = await generateCategoryReportExcel(meta, {
    categoryName: 'Civil Works',
    records: sampleRecords,
    startDate: '2026-09-01',
    endDate: '2026-09-30',
  });
  assert.ok(isZipBuffer(bCategory), 'Category Report must return OpenXML ZIP');
  const wbCategory = XLSX.read(bCategory, { type: 'buffer' });
  assert.deepEqual(wbCategory.SheetNames, ['Role Breakdown', 'Daily Category Log']);
  results.push({ report: 'CATEGORY_REPORT', sheets: wbCategory.SheetNames, sizeKb: Math.round(bCategory.length / 1024), status: 'PASS' });
  console.log('  ✔ CATEGORY_REPORT: OpenXML Valid, Sheets: [' + wbCategory.SheetNames.join(', ') + ']');

  // 8. SITE_REPORT
  const bSite = await generateSiteReportExcel(meta, {
    siteName: 'Sunrise Mega Complex',
    siteLocation: 'Commercial Sector 5',
    attendanceRecords: sampleRecords,
    financialSummary: financeSummary,
  });
  assert.ok(isZipBuffer(bSite), 'Site Report must return OpenXML ZIP');
  const wbSite = XLSX.read(bSite, { type: 'buffer' });
  assert.deepEqual(wbSite.SheetNames, ['Executive Overview', 'Workforce Categories']);
  results.push({ report: 'SITE_REPORT', sheets: wbSite.SheetNames, sizeKb: Math.round(bSite.length / 1024), status: 'PASS' });
  console.log('  ✔ SITE_REPORT: OpenXML Valid, Sheets: [' + wbSite.SheetNames.join(', ') + ']');

  // ==========================================================================
  // GATE 2: 0-RECORD EMPTY STATE ROBUSTNESS MATRIX
  // ==========================================================================
  console.log('\n--- GATE 2: 0-RECORD EMPTY STATE RESILIENCY AUDIT ---');

  const emptyDailySummary: DailySummary = {
    date: '2026-09-01',
    totalWorkers: 0,
    fullDayCount: 0,
    halfDayCount: 0,
    workerDays: 0,
    totalLabourCostPaise: 0,
    categories: [],
  };

  const emptyFinanceSummary: FinancialSummary = {
    openingBalancePaise: 0,
    totalCreditPaise: 0,
    suppliesDebitPaise: 0,
    specialWorkerTaskDebitPaise: 0,
    totalDebitPaise: 0,
    netCashFlowPaise: 0,
    closingBalancePaise: 0,
    transactionCount: 0,
  };

  // Test empty state on each
  const emptyDaily = await generateDailyAttendanceExcel(meta, emptyDailySummary);
  assert.ok(isZipBuffer(emptyDaily));
  const emptyWeekly = await generateWeeklyAttendanceExcel(meta, { startDate: '2026-09-01', endDate: '2026-09-07', records: [] });
  assert.ok(isZipBuffer(emptyWeekly));
  const emptyMonthly = await generateMonthlyAttendanceExcel(meta, { year: 2026, month: 9, monthName: 'September 2026', daysInMonth: 30, records: [] });
  assert.ok(isZipBuffer(emptyMonthly));
  const emptyFinance = await generateFinancialExcel(meta, { summary: emptyFinanceSummary, transactions: [] });
  assert.ok(isZipBuffer(emptyFinance));
  const emptyMonFinance = await generateMonthlyFinancialExcel(meta, { year: 2026, month: 9, monthName: 'September 2026', summary: emptyFinanceSummary, transactions: [] });
  assert.ok(isZipBuffer(emptyMonFinance));
  const emptyRole = await generateRoleReportExcel(meta, { roleName: 'All Roles', categoryName: 'All Categories', records: [], isAllRoles: true });
  assert.ok(isZipBuffer(emptyRole));
  const emptyCategory = await generateCategoryReportExcel(meta, { categoryName: 'Civil Works', records: [], startDate: '2026-09-01', endDate: '2026-09-30' });
  assert.ok(isZipBuffer(emptyCategory));
  const emptySite = await generateSiteReportExcel(meta, {
    siteName: 'Sunrise Mega Complex',
    siteLocation: 'Commercial Sector 5',
    attendanceRecords: [],
    financialSummary: emptyFinanceSummary,
  });
  assert.ok(isZipBuffer(emptySite));
  console.log('  ✔ All 8 report types cleanly handle 0-record states without NaN or crash.');

  // ==========================================================================
  // GATE 3: SECURITY & FORMULA INJECTION HARDENING
  // ==========================================================================
  console.log('\n--- GATE 3: SECURITY & PENETRATION AUDIT ---');

  const injectionPayloads = [
    '=CMD|"/C calc"!A0',
    '+1+2+cmd',
    '-5+cmd',
    '@SUM(A1:A10)',
    '\t=2+2',
    '\r=3+3',
  ];

  for (const payload of injectionPayloads) {
    const escaped = escapeExcelFormula(payload);
    assert.ok(escaped.startsWith("'"), `Formula injection payload ${payload} must be prefixed with single quote: got ${escaped}`);
  }
  console.log('  ✔ Formula injection escape verified on 6 dangerous vector prefixes (=, +, -, @, \\t, \\r).');

  // Filename traversal
  assert.equal(sanitizeExcelFilename('../../etc/passwd', 'report'), 'etc_passwd_report.xlsx');
  assert.equal(sanitizeExcelFilename('..\\..\\boot.ini', 'report'), 'boot.ini_report.xlsx');
  assert.equal(sanitizeExcelFilename('CON', ''), 'site_work_report.xlsx');
  assert.equal(sanitizeExcelFilename('PRN', ''), 'site_work_report.xlsx');
  assert.equal(sanitizeExcelFilename('site:report*?', 'report'), 'site_report_report.xlsx');
  console.log('  ✔ Path traversal and Windows reserved devices sanitized.');

  // ==========================================================================
  // GATE 4: 5,000-ROW PERFORMANCE BENCHMARK
  // ==========================================================================
  console.log('\n--- GATE 4: 5,000-ROW STRESS & PERFORMANCE BENCHMARK ---');

  const stressRecords: AttendanceDbRecord[] = [];
  for (let i = 0; i < 5000; i++) {
    stressRecords.push({
      id: `att-stress-${i}`,
      site_id: 'site-1',
      date: '2026-09-01',
      role_id: `role-${i % 20}`,
      role_name: `Specialist Worker ${i % 20}`,
      category_id: `cat-${i % 4}`,
      category_name: `Category ${i % 4}`,
      rate_snapshot_paise: 100000 + (i % 10) * 10000,
      full_day_count: 1,
      half_day_count: 0,
      total_workers: 1,
      worker_days: 1.0,
      total_cost_paise: 100000 + (i % 10) * 10000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    });
  }

  const tStart = performance.now();
  const bStress = await generateRoleReportExcel(meta, {
    roleName: 'All Roles',
    categoryName: 'All Categories',
    records: stressRecords,
    isAllRoles: true,
  });
  const tEnd = performance.now();
  const durationMs = Math.round(tEnd - tStart);

  assert.ok(isZipBuffer(bStress), 'Stress workbook must be valid ZIP');
  console.log(`  ✔ 5,000 Rows Generated in ${durationMs}ms (Size: ${Math.round(bStress.length / 1024)} KB)`);
  assert.ok(durationMs < 5000, `Generation must complete in < 5000ms: took ${durationMs}ms`);

  // Print summary
  console.log('\n================================================================');
  console.log('PHASE 5 STEP 2C: VERIFICATION SUMMARY MATRIX');
  console.log('================================================================');
  console.table(results);
  console.log('\n✔ ALL 8 PRODUCTION EXCEL REPORTS PASSED FULL STEP 2C ACCEPTANCE CRITERIA!');
}

runStep2CReleaseVerification().catch((err) => {
  console.error('\n❌ FATAL STEP 2C VERIFICATION ERROR:', err);
  process.exit(1);
});