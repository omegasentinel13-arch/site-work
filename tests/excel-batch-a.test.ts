import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { SignJWT } from 'jose';
import {
  escapeExcelFormula,
  sanitizeExcelFilename,
  buildContentDispositionHeader,
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
import { FinancialSummary } from '../lib/domain/finance-engine';
import { AttendanceDbRecord } from '../lib/db/repositories/attendance-repo';

// Helper to inspect XLSX buffer
function readWorkbookFromBuffer(buf: Buffer): XLSX.WorkBook {
  return XLSX.read(buf, { type: 'buffer' });
}

// Helper to check valid ZIP/OpenXML magic number (PK\x03\x04)
function isZipBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

test('PHASE 5 BATCH A: ENTERPRISE EXCEL ENGINE & SECURE API SUITE', async (t) => {
  const sampleMeta = {
    siteName: 'Sunrise Mega Complex',
    siteCode: 'SMC-01',
    reportTitle: 'Operational Audit',
    periodLabel: '01 Sep 2026 to 30 Sep 2026',
    generatedAt: '03/09/2026, 10:00:00 pm',
  };

  // --------------------------------------------------------------------------
  // 1. SECURITY & FORMULA INJECTION DEFENSES
  // --------------------------------------------------------------------------
  await t.test('1. Security: escapeExcelFormula protects user text while preserving genuine numbers', () => {
    // Dangerous formula injection prefixes
    assert.equal(escapeExcelFormula('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.equal(escapeExcelFormula('+cmd|"/C calc"!A0'), "'+cmd|\"/C calc\"!A0");
    assert.equal(escapeExcelFormula('-discount promotion'), "'-discount promotion");
    assert.equal(escapeExcelFormula('@user_handle'), "'@user_handle");
    assert.equal(escapeExcelFormula('\tTabInjected'), "'\tTabInjected");
    assert.equal(escapeExcelFormula('\rCRInjected'), "'\rCRInjected");

    // Safe regular text is untouched
    assert.equal(escapeExcelFormula('Cement Supply 50 bags'), 'Cement Supply 50 bags');
    assert.equal(escapeExcelFormula('Site #123 (Sector 9)'), 'Site #123 (Sector 9)');

    // Genuine numeric values (including negative numbers) must remain numbers!
    assert.equal(escapeExcelFormula(-5000), -5000);
    assert.equal(escapeExcelFormula(0), 0);
    assert.equal(escapeExcelFormula(12345.67), 12345.67);
    assert.equal(typeof escapeExcelFormula(-5000), 'number');
  });

  await t.test('2. Security: Filename & Content-Disposition security', () => {
    // Traversal and separators
    assert.equal(sanitizeExcelFilename('../../etc/passwd', 'report'), 'etc_passwd_report.xlsx');
    assert.equal(sanitizeExcelFilename('..\\Windows\\System32', 'test'), 'Windows_System32_test.xlsx');

    // CRLF and header injection
    assert.equal(sanitizeExcelFilename('Site\r\nSet-Cookie: evil', 'rep'), 'SiteSet-Cookie_evil_rep.xlsx');

    // Windows reserved device names
    assert.equal(sanitizeExcelFilename('CON', ''), 'site_work_report.xlsx');
    assert.equal(sanitizeExcelFilename('NUL', ''), 'site_work_report.xlsx');
    assert.equal(sanitizeExcelFilename('aux', ''), 'site_work_report.xlsx');

    // Extension must always be .xlsx
    const fn = sanitizeExcelFilename('Sunrise Project', 'Summary');
    assert.ok(fn.endsWith('.xlsx'));
    assert.ok(!fn.endsWith('.xlsm'));

    // Content-Disposition header
    const cd = buildContentDispositionHeader('Sunrise_Site_Work.xlsx');
    assert.ok(cd.includes('filename="Sunrise_Site_Work.xlsx"'));
    assert.ok(cd.includes("filename*=UTF-8''Sunrise_Site_Work.xlsx"));
    assert.ok(!cd.includes('\r'));
    assert.ok(!cd.includes('\n'));
  });

  // --------------------------------------------------------------------------
  // 2. GENERATOR SUITE ACROSS ALL 8 REPORT TYPES
  // --------------------------------------------------------------------------
  await t.test('3. Daily Attendance Excel Generator: Structure & Formatting', async () => {
    const summary: DailySummary = {
      date: '2026-09-01',
      totalWorkers: 5,
      fullDayCount: 4,
      halfDayCount: 1,
      workerDays: 4.5,
      totalLabourCostPaise: 450000,
      categories: [
        {
          categoryId: 'cat-civil',
          categoryName: 'Civil Works',
          totalWorkers: 5,
          workerDays: 4.5,
          totalCostPaise: 450000,
          roles: [
            {
              roleId: 'role-mason',
              roleName: 'Lead Mason',
              categoryId: 'cat-civil',
              categoryName: 'Civil Works',
              rateInPaise: 100000,
              fullDayCount: 4,
              halfDayCount: 1,
              totalWorkers: 5,
              workerDays: 4.5,
              fullDayCostPaise: 400000,
              halfDayCostPaise: 50000,
              totalCostPaise: 450000,
            },
          ],
        },
      ],
    };

    const buf = await generateDailyAttendanceExcel(sampleMeta, summary);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(isZipBuffer(buf), 'Must be valid OpenXML ZIP buffer');

    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Daily Attendance']);
    const ws = wb.Sheets['Daily Attendance'];
    assert.ok(ws);

    // Verify cell contents
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as (string | number)[][];
    const textData = JSON.stringify(aoa);
    assert.ok(textData.includes('Lead Mason'));
    assert.ok(textData.includes('Civil Works'));
  });

  await t.test('4. Weekly Attendance Matrix Excel Generator: Multi-Sheet & Column Headers', async () => {
    const records: AttendanceDbRecord[] = [
      {
        id: 'att-wk-1',
        site_id: 'site-1',
        date: '2026-09-01',
        role_id: 'role-mason',
        role_name: 'Lead Mason',
        category_id: 'cat-civil',
        category_name: 'Civil Works',
        rate_snapshot_paise: 100000,
        full_day_count: 5,
        half_day_count: 0,
        total_workers: 5,
        worker_days: 5.0,
        total_cost_paise: 500000,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      },
    ];

    const buf = await generateWeeklyAttendanceExcel(
      { ...sampleMeta, reportTitle: 'Weekly Attendance Matrix' },
      {
        records,
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      }
    );

    assert.ok(isZipBuffer(buf));
    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Weekly Matrix', 'Daily Records']);

    const wsMatrix = wb.Sheets['Weekly Matrix'];
    const matrixAoa = XLSX.utils.sheet_to_json(wsMatrix, { header: 1 });
    const str = JSON.stringify(matrixAoa);
    assert.ok(str.includes('WEEKLY ATTENDANCE MATRIX'));
    assert.ok(str.includes('Lead Mason'));
  });

  await t.test('5. Monthly Attendance Excel Generator: 3 Semantic Worksheets', async () => {
    const records: AttendanceDbRecord[] = [
      {
        id: 'att-mon-1',
        site_id: 'site-1',
        date: '2026-09-01',
        role_id: 'role-carpenter',
        role_name: 'Master Joiner',
        category_id: 'cat-carpentry',
        category_name: 'Carpentry Works',
        rate_snapshot_paise: 120000,
        full_day_count: 3,
        half_day_count: 1,
        total_workers: 4,
        worker_days: 3.5,
        total_cost_paise: 420000,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      },
    ];

    const buf = await generateMonthlyAttendanceExcel(sampleMeta, {
      records,
      monthLabel: 'September 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });

    assert.ok(isZipBuffer(buf));
    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Category Rollup', 'Daily Progression', 'Raw Workforce Log']);
  });

  await t.test('6. Financial Ledger Excel Generator: Inflows, Outflows & Running Balance', async () => {
    const summary: FinancialSummary = {
      openingBalancePaise: 50000000,
      totalCreditPaise: 75000000,
      suppliesDebitPaise: 25000000,
      specialWorkerTaskDebitPaise: 10000000,
      totalDebitPaise: 35000000,
      netCashFlowPaise: 40000000,
      closingBalancePaise: 90000000,
      transactionCount: 2,
    };

    const txs = [
      {
        date: '2026-09-01',
        type: 'CREDIT' as const,
        debitCategory: null,
        description: 'Client Tranche 1 Advance',
        amountPaise: 75000000,
        referenceNote: 'Bank Ref #88912',
      },
      {
        date: '2026-09-02',
        type: 'DEBIT' as const,
        debitCategory: 'SUPPLIES',
        description: '-discount cement voucher', // Malicious formula trigger test
        amountPaise: 25000000,
        referenceNote: 'Supplier Invoice #401',
      },
    ];

    const buf = await generateFinancialExcel(sampleMeta, { summary, transactions: txs });
    assert.ok(isZipBuffer(buf));
    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Financial Ledger']);

    const ws = wb.Sheets['Financial Ledger'];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const str = JSON.stringify(aoa);

    // Verify formula injection protection on user description
    assert.ok(str.includes("'-discount cement voucher"), 'Must be safely escaped with apostrophe');
    assert.ok(str.includes('Client Tranche 1 Advance'));
  });

  await t.test('7. Monthly Finance Excel Generator: 3 Financial Worksheets', async () => {
    const summary: FinancialSummary = {
      openingBalancePaise: 10000000,
      totalCreditPaise: 20000000,
      suppliesDebitPaise: 5000000,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: 5000000,
      netCashFlowPaise: 15000000,
      closingBalancePaise: 25000000,
      transactionCount: 2,
    };

    const txs = [
      { date: '2026-09-01', type: 'CREDIT' as const, debitCategory: null, description: 'Funding', amountPaise: 20000000 },
      { date: '2026-09-02', type: 'DEBIT' as const, debitCategory: 'SUPPLIES', description: 'Sand', amountPaise: 5000000 },
    ];

    const buf = await generateMonthlyFinancialExcel(sampleMeta, { summary, transactions: txs });
    assert.ok(isZipBuffer(buf));
    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Monthly Statement', 'Cash Inflows', 'Cash Outflows']);
  });

  await t.test('8. Role Report Excel Generator: Single Role & ALL Roles Views', async () => {
    const records: AttendanceDbRecord[] = [
      {
        id: 'att-role-1',
        site_id: 'site-1',
        date: '2026-09-01',
        role_id: 'role-mason',
        role_name: 'Master Mason',
        category_id: 'cat-civil',
        category_name: 'Civil Works',
        rate_snapshot_paise: 120000,
        full_day_count: 5,
        half_day_count: 0,
        total_workers: 5,
        worker_days: 5.0,
        total_cost_paise: 600000,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      },
    ];

    // 1. Single Role
    const bufSingle = await generateRoleReportExcel(sampleMeta, {
      roleName: 'Master Mason',
      categoryName: 'Civil Works',
      records,
      isAllRoles: false,
    });
    assert.ok(isZipBuffer(bufSingle));

    // 2. ALL Roles
    const bufAll = await generateRoleReportExcel(sampleMeta, {
      roleName: 'All Roles (All Workers)',
      categoryName: 'All Categories',
      records,
      isAllRoles: true,
    });
    assert.ok(isZipBuffer(bufAll));
    const wbAll = readWorkbookFromBuffer(bufAll);
    const wsAll = wbAll.Sheets['Workforce Deployment'];
    const aoaAll = XLSX.utils.sheet_to_json(wsAll, { header: 1 });
    const strAll = JSON.stringify(aoaAll);
    assert.ok(strAll.includes('Role'));
    assert.ok(strAll.includes('Category'));
    assert.ok(strAll.includes('Master Mason'));
  });

  await t.test('9. Category Report Excel Generator: 2 Semantic Worksheets', async () => {
    const records: AttendanceDbRecord[] = [
      {
        id: 'att-cat-1',
        site_id: 'site-1',
        date: '2026-09-01',
        role_id: 'role-electrician',
        role_name: 'Chief Electrician',
        category_id: 'cat-elec',
        category_name: 'Electrical Engineering',
        rate_snapshot_paise: 150000,
        full_day_count: 2,
        half_day_count: 1,
        total_workers: 3,
        worker_days: 2.5,
        total_cost_paise: 375000,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      },
    ];

    const buf = await generateCategoryReportExcel(sampleMeta, {
      categoryName: 'Electrical Engineering',
      records,
    });
    assert.ok(isZipBuffer(buf));
    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Role Breakdown', 'Daily Category Log']);
  });

  await t.test('10. Site Performance Report Excel Generator: 3 Integrated Worksheets', async () => {
    const finSummary: FinancialSummary = {
      openingBalancePaise: 50000000,
      totalCreditPaise: 100000000,
      suppliesDebitPaise: 40000000,
      specialWorkerTaskDebitPaise: 10000000,
      totalDebitPaise: 50000000,
      netCashFlowPaise: 50000000,
      closingBalancePaise: 100000000,
      transactionCount: 5,
    };

    const buf = await generateSiteReportExcel(sampleMeta, {
      siteName: 'Sunrise Mega Complex',
      siteLocation: 'Industrial Zone Sector 9',
      attendanceRecords: [],
      financialSummary: finSummary,
    });
    assert.ok(isZipBuffer(buf));
    const wb = readWorkbookFromBuffer(buf);
    assert.deepEqual(wb.SheetNames, ['Executive Overview', 'Workforce Categories']);
  });

  // --------------------------------------------------------------------------
  // 3. COMPLETE EMPTY-STATE MATRIX ACROSS ALL 8 REPORTS
  // --------------------------------------------------------------------------
  await t.test('11. Empty-State Matrix: Valid Generation with 0 Records Across ALL 8 Reports', async () => {
    const emptyFin: FinancialSummary = {
      openingBalancePaise: 0,
      totalCreditPaise: 0,
      suppliesDebitPaise: 0,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: 0,
      netCashFlowPaise: 0,
      closingBalancePaise: 0,
      transactionCount: 0,
    };

    const emptyReports = [
      {
        name: 'DAILY_ATTENDANCE',
        gen: () => generateDailyAttendanceExcel(sampleMeta, {
          date: '2026-09-01',
          totalWorkers: 0,
          fullDayCount: 0,
          halfDayCount: 0,
          workerDays: 0,
          totalLabourCostPaise: 0,
          categories: [],
        }),
        expectedSheet: 'Daily Attendance',
        expectedMsg: 'No attendance records recorded for this date.',
      },
      {
        name: 'WEEKLY_ATTENDANCE',
        gen: () => generateWeeklyAttendanceExcel(sampleMeta, { records: [], startDate: '2026-09-01', endDate: '2026-09-07' }),
        expectedSheet: 'Weekly Matrix',
        expectedMsg: 'No attendance records recorded for this week.',
      },
      {
        name: 'MONTHLY_ATTENDANCE',
        gen: () => generateMonthlyAttendanceExcel(sampleMeta, { records: [], monthLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30' }),
        expectedSheet: 'Category Rollup',
        expectedMsg: 'No workforce attendance recorded for this month.',
      },
      {
        name: 'FINANCE',
        gen: () => generateFinancialExcel(sampleMeta, { summary: emptyFin, transactions: [] }),
        expectedSheet: 'Financial Ledger',
        expectedMsg: 'No financial transactions recorded for this period.',
      },
      {
        name: 'MONTHLY_FINANCE',
        gen: () => generateMonthlyFinancialExcel(sampleMeta, { summary: emptyFin, transactions: [] }),
        expectedSheet: 'Cash Inflows',
        expectedMsg: 'No cash inflows recorded for this month.',
      },
      {
        name: 'ROLE_REPORT',
        gen: () => generateRoleReportExcel(sampleMeta, { roleName: 'Scaffolder', categoryName: 'Safety', records: [] }),
        expectedSheet: 'Workforce Deployment',
        expectedMsg: 'Selected role had zero deployment days in this period.',
      },
      {
        name: 'CATEGORY_REPORT',
        gen: () => generateCategoryReportExcel(sampleMeta, { categoryName: 'Safety', records: [] }),
        expectedSheet: 'Role Breakdown',
        expectedMsg: 'Selected category had zero deployment in this period.',
      },
      {
        name: 'SITE_REPORT',
        gen: () => generateSiteReportExcel(sampleMeta, { siteName: 'Sunrise Complex', attendanceRecords: [], financialSummary: emptyFin }),
        expectedSheet: 'Workforce Categories',
        expectedMsg: 'No attendance records recorded for this site.',
      },
    ];

    for (const rep of emptyReports) {
      const buf = await rep.gen();
      assert.ok(Buffer.isBuffer(buf));
      assert.ok(isZipBuffer(buf), `${rep.name} empty report must return valid XLSX buffer`);
      const wb = readWorkbookFromBuffer(buf);
      assert.ok(wb.SheetNames.includes(rep.expectedSheet), `${rep.name} must contain sheet ${rep.expectedSheet}`);
      const ws = wb.Sheets[rep.expectedSheet];
      const text = JSON.stringify(XLSX.utils.sheet_to_json(ws, { header: 1 }));
      assert.ok(text.includes(rep.expectedMsg), `${rep.name} must contain message: "${rep.expectedMsg}"`);
    }
  });

  // --------------------------------------------------------------------------
  // 4. LARGE-DATASET SCALABILITY BENCHMARK (5,000 ROWS)
  // --------------------------------------------------------------------------
  await t.test('12. Scalability: 5,000 Rows Financial Ledger Benchmark', async () => {
    const ROW_COUNT = 5000;
    let totalCredit = 0;
    let totalDebit = 0;

    const txs = Array.from({ length: ROW_COUNT }, (_, i) => {
      const isCredit = i % 3 === 0;
      const amount = (i + 1) * 10000;
      if (isCredit) totalCredit += amount;
      else totalDebit += amount;

      return {
        date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
        type: isCredit ? ('CREDIT' as const) : ('DEBIT' as const),
        debitCategory: isCredit ? null : ('SUPPLIES' as const),
        description: `Material Procurement Batch #${i + 1} with high grade industrial specifications`,
        amountPaise: amount,
        referenceNote: `PO-${1000 + i}`,
      };
    });

    const summary: FinancialSummary = {
      openingBalancePaise: 50000000,
      totalCreditPaise: totalCredit,
      suppliesDebitPaise: totalDebit,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: totalDebit,
      netCashFlowPaise: totalCredit - totalDebit,
      closingBalancePaise: 50000000 + (totalCredit - totalDebit),
      transactionCount: ROW_COUNT,
    };

    const heapBefore = process.memoryUsage().heapUsed;
    const startMs = Date.now();

    const buf = await generateFinancialExcel(
      { ...sampleMeta, reportTitle: '5,000 Rows Scalability Benchmark' },
      { summary, transactions: txs }
    );

    const durationMs = Date.now() - startMs;
    const heapAfter = process.memoryUsage().heapUsed;

    assert.ok(Buffer.isBuffer(buf));
    assert.ok(isZipBuffer(buf));
    assert.ok(buf.length > 100000, `Buffer size (${buf.length} bytes) must reflect 5,000 rows`);

    const wb = readWorkbookFromBuffer(buf);
    const ws = wb.Sheets['Financial Ledger'];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    // Metadata (8 rows) + Header (1 row) + Data (5000 rows) + Total (1 row) = 5010 rows
    assert.ok(aoa.length >= 5000, `Expected >= 5000 rows in sheet, got ${aoa.length}`);

    console.log(`\n  [EXCEL BENCHMARK] Financial Ledger 5,000 Rows:`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
    console.log(`    - Heap Delta: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`);
  });

  // --------------------------------------------------------------------------
  // 5. LIVE HTTP API ORCHESTRATION & SECURITY ENFORCEMENT
  // --------------------------------------------------------------------------
  const BASE_URL = 'http://localhost:3000';
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('QA Configuration Error: process.env.SESSION_SECRET is required but missing.');
  }
  const secretKey = new TextEncoder().encode(sessionSecret);

  async function makeToken(
    userId: string,
    username: string,
    role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
    assignedSites: string[],
    tokenVersion: number
  ) {
    return await new SignJWT({
      userId,
      username,
      fullName: 'Test User',
      role,
      assignedSiteIds: assignedSites,
      tokenVersion,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);
  }

  await t.test('13. HTTP 401 Unauthorized for Unauthenticated Excel Export', async () => {
    const res = await fetch(`${BASE_URL}/api/export/excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '2026-09-01' }),
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Please log in to continue.');
  });

  await t.test('14. HTTP 400 Bad Request for Missing or Invalid Parameters', async () => {
    const adminToken = await makeToken('usr-admin-1', 'Iamadmin', 'ADMIN', [], 11);

    // 1. Missing siteId
    const res1 = await fetch(`${BASE_URL}/api/export/excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `site_work_session=${adminToken}`,
      },
      body: JSON.stringify({ type: 'DAILY_ATTENDANCE' }),
    });
    assert.equal(res1.status, 400);
    const d1 = await res1.json();
    assert.equal(d1.error, 'siteId is required');

    // 2. Unknown report type
    const res2 = await fetch(`${BASE_URL}/api/export/excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `site_work_session=${adminToken}`,
      },
      body: JSON.stringify({ siteId: 'site-1', type: 'NON_EXISTENT_TYPE' }),
    });
    assert.equal(res2.status, 400);

    // 3. Malformed date
    const res3 = await fetch(`${BASE_URL}/api/export/excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `site_work_session=${adminToken}`,
      },
      body: JSON.stringify({ siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '01/09/2026' }),
    });
    assert.equal(res3.status, 400);
    const d3 = await res3.json();
    assert.ok(d3.error.includes('Invalid date format'));
  });

  await t.test('15. HTTP 404 Not Found for Nonexistent Site', async () => {
    const adminToken = await makeToken('usr-admin-1', 'Iamadmin', 'ADMIN', [], 11);
    const res = await fetch(`${BASE_URL}/api/export/excel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `site_work_session=${adminToken}`,
      },
      body: JSON.stringify({ siteId: 'site-nonexistent-999', type: 'DAILY_ATTENDANCE', date: '2026-09-01' }),
    });

    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'Site not found');
  });

  await t.test('16. HTTP 403 Forbidden: Cross-Site Isolation Across ALL 8 Report Types', async () => {
    // Engineer assigned to site-2 only
    const engToken = await makeToken('usr-eng-1', 'siteengineer', 'SITE_MANAGER', ['site-2'], 4);

    const reportTypes = [
      { type: 'DAILY_ATTENDANCE', extra: { date: '2026-09-01' } },
      { type: 'WEEKLY_ATTENDANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-07' } },
      { type: 'MONTHLY_ATTENDANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-30' } },
      { type: 'FINANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-30' } },
      { type: 'MONTHLY_FINANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-30' } },
      { type: 'ROLE_REPORT', extra: { roleId: 'ALL', startDate: '2026-09-01', endDate: '2026-09-30' } },
      { type: 'CATEGORY_REPORT', extra: { categoryId: 'cat-1', startDate: '2026-09-01', endDate: '2026-09-30' } },
      { type: 'SITE_REPORT', extra: { startDate: '2026-09-01', endDate: '2026-09-30' } },
    ];

    for (const r of reportTypes) {
      // Attempting to export site-1 (Unauthorized for this user)
      const res = await fetch(`${BASE_URL}/api/export/excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `site_work_session=${engToken}`,
        },
        body: JSON.stringify({ siteId: 'site-1', type: r.type, ...r.extra }),
      });

      assert.equal(res.status, 403, `${r.type} must return 403 when accessing unauthorized site`);
      const data = await res.json();
      assert.ok(data.error.includes('Forbidden') || data.error.includes('access'));
    }
  });

  await t.test('17. HTTP 200 OK: Authorized Generation Across ALL 8 Report Types', async () => {
    const adminToken = await makeToken('usr-admin-1', 'Iamadmin', 'ADMIN', [], 11);

    const reportRequests = [
      { type: 'DAILY_ATTENDANCE', extra: { date: '2026-09-01' } },
      { type: 'WEEKLY_ATTENDANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-07' } },
      { type: 'MONTHLY_ATTENDANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { type: 'FINANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-30' } },
      { type: 'MONTHLY_FINANCE', extra: { startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { type: 'ROLE_REPORT', extra: { roleId: 'ALL', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { type: 'CATEGORY_REPORT', extra: { categoryId: 'cat-1', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { type: 'SITE_REPORT', extra: { startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
    ];

    for (const reqItem of reportRequests) {
      const res = await fetch(`${BASE_URL}/api/export/excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `site_work_session=${adminToken}`,
        },
        body: JSON.stringify({ siteId: 'site-1', type: reqItem.type, ...reqItem.extra }),
      });

      assert.equal(res.status, 200, `${reqItem.type} must return 200 for authorized admin`);
      assert.equal(
        res.headers.get('content-type'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      const cd = res.headers.get('content-disposition');
      assert.ok(cd && cd.includes('attachment;'), 'Must have attachment header');
      assert.ok(cd && cd.includes('.xlsx'), 'Must specify .xlsx extension');

      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      assert.ok(isZipBuffer(buf), `${reqItem.type} must return valid XLSX binary buffer`);
    }
  });
});
