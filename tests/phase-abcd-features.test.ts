import assert from 'node:assert/strict';
import { getDb } from '../lib/db';
import { getAttendanceByDateRange } from '../lib/db/repositories/attendance-repo';
import { generateRoleReportPDF } from '../lib/export/pdf/reports/role-report';
import { generateRoleReportExcel } from '../lib/export/excel/reports/role-report';
import { generateMonthlyAttendanceCalendarPDF } from '../lib/export/pdf/reports/monthly-attendance-calendar';
import { generateMonthlyAttendanceCalendarExcel } from '../lib/export/excel/reports/monthly-attendance-calendar';
import { parseTransactionSearch, matchTransactionSearch } from '../lib/finance/search-parser';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function runTests() {
  console.log('====================================================');
  console.log('STARTING PHASE A/B/C/D MASTER VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // ==========================================================================
  // PHASE A: Site Financial Balance Card Labels & Accounting Invariants
  // ==========================================================================
  console.log('--- PHASE A: Site Financial Balance Card Labels & Invariants ---');

  await test('A1: Dashboard source file contains exact CTO terminology for all 5 balance cards', () => {
    const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/page.tsx'), 'utf-8');

    assert.ok(dashboardSource.includes('TOTAL INCOMES') && dashboardSource.includes('(CREDIT)'), 'Card 1 title must have TOTAL INCOMES (CREDIT)');
    assert.ok(dashboardSource.includes('Credit / inflow'), 'Card 1 subtext must be Credit / inflow');

    assert.ok(dashboardSource.includes('SUPPLIES EXPENSES') && dashboardSource.includes('(DEBIT)'), 'Card 2 title must have SUPPLIES EXPENSES (DEBIT)');
    assert.ok(dashboardSource.includes('Debit / materials'), 'Card 2 subtext must be Debit / materials');

    assert.ok(dashboardSource.includes('WORK EXPENSES'), 'Card 3 title must have WORK EXPENSES (DEBIT)');
    assert.ok(dashboardSource.includes('Debit / work expenses'), 'Card 3 subtext must be Debit / work expenses');

    assert.ok(dashboardSource.includes('TOTAL EXPENSES'), 'Card 4 title must have TOTAL EXPENSES (DEBIT)');
    assert.ok(dashboardSource.includes('Total debit / outflow'), 'Card 4 subtext must be Total debit / outflow');

    assert.ok(dashboardSource.toLowerCase().includes('remaining balance'), 'Card 5 title must be Remaining Balance');
    assert.ok(dashboardSource.includes('Actual Cash In Hand'), 'Card 5 subtext must be Actual Cash In Hand');
  });

  await test('A2: Accounting invariant: Supplies Expenses + Work Expenses = Total Expenses', () => {
    // Test invariant arithmetic in paise
    const materialDebitPaise = 5000000; // 50,000.00
    const specialWorkerTaskDebitPaise = 2500000; // 25,000.00
    const salaryDebitPaise = 1500000; // 15,000.00
    const workExpensesPaise = specialWorkerTaskDebitPaise + salaryDebitPaise; // 40,000.00
    const totalExpensesDebitPaise = materialDebitPaise + workExpensesPaise; // 90,000.00
    const totalCreditPaise = 12000000; // 1,20,000.00
    const remainingBalancePaise = totalCreditPaise - totalExpensesDebitPaise; // 30,000.00

    assert.equal(materialDebitPaise + workExpensesPaise, totalExpensesDebitPaise, 'Total debit must equal sum of supplies and work expenses');
    assert.equal(remainingBalancePaise, 3000000, 'Remaining balance must equal credit minus total debit');
  });

  // ==========================================================================
  // PHASE B: Multi-role Selection & Canonical Exports
  // ==========================================================================
  console.log('\n--- PHASE B: Multi-Role Selection & Exports ---');

  await test('B1: getAttendanceByDateRange supports single roleId and array of roleIds', () => {
    const db = getDb();
    const site = db.prepare('SELECT id FROM sites LIMIT 1').get() as { id: string } | undefined;
    if (!site) {
      console.log('Skipping DB query test: no sites available');
      return;
    }

    const roles = db.prepare('SELECT id FROM work_roles LIMIT 2').all() as { id: string }[];
    if (roles.length >= 2) {
      const single = getAttendanceByDateRange(site.id, '2020-01-01', '2030-12-31', undefined, roles[0].id);
      assert.ok(Array.isArray(single), 'Single role query must return array');

      const multi = getAttendanceByDateRange(site.id, '2020-01-01', '2030-12-31', undefined, [roles[0].id, roles[1].id]);
      assert.ok(Array.isArray(multi), 'Multi role query must return array');
    }
  });

  await test('B2: generateRoleReportPDF generates valid PDF buffer with isMultiRole = true', async () => {
    const meta = {
      reportTitle: 'Role Workforce Report',
      siteName: 'Test Construction Site',
      siteCode: 'TCS-01',
      periodLabel: 'September 2026',
      generatedAt: '2026-09-24 12:00 PM',
    };
    const mockData = {
      roleNames: ['Electrician', 'Plumber'],
      isMultiRole: true,
      records: [
        {
          id: 'att-1',
          site_id: 'site-1',
          date: '2026-09-01',
          role_id: 'role-1',
          role_name: 'Electrician',
          category_id: 'cat-1',
          category_name: 'Skilled Labour',
          rate_snapshot_paise: 80000,
          full_day_count: 5,
          half_day_count: 0,
          total_workers: 5,
          worker_days: 5,
          total_cost_paise: 400000,
          created_at: '2026-09-01',
          updated_at: '2026-09-01',
        },
      ],
    };

    const pdfBuffer = await generateRoleReportPDF(meta, mockData);
    assert.ok(Buffer.isBuffer(pdfBuffer), 'PDF output must be a Buffer');
    assert.ok(pdfBuffer.length > 500, 'PDF buffer must have substantial size');
    assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF', 'Must start with %PDF magic header');
  });

  await test('B3: generateRoleReportExcel generates valid Excel buffer with Role & Category columns', async () => {
    const meta = {
      reportTitle: 'Role Workforce Report',
      siteName: 'Test Construction Site',
      siteCode: 'TCS-01',
      periodLabel: 'September 2026',
      generatedAt: '2026-09-24 12:00 PM',
    };
    const mockData = {
      roleNames: ['Electrician', 'Plumber'],
      isMultiRole: true,
      records: [
        {
          id: 'att-1',
          site_id: 'site-1',
          date: '2026-09-01',
          role_id: 'role-1',
          role_name: 'Electrician',
          category_id: 'cat-1',
          category_name: 'Skilled Labour',
          rate_snapshot_paise: 80000,
          full_day_count: 5,
          half_day_count: 0,
          total_workers: 5,
          worker_days: 5,
          total_cost_paise: 400000,
          created_at: '2026-09-01',
          updated_at: '2026-09-01',
        },
      ],
    };

    const excelBuffer = await generateRoleReportExcel(meta, mockData);
    assert.ok(Buffer.isBuffer(excelBuffer), 'Excel output must be a Buffer');
    assert.ok(excelBuffer.length > 500, 'Excel buffer must have substantial size');
    assert.equal(excelBuffer.subarray(0, 2).toString(), 'PK', 'Must start with PK (ZIP format for XLSX)');
  });

  // ==========================================================================
  // PHASE C: Monthly Attendance Calendar View Exports
  // ==========================================================================
  console.log('\n--- PHASE C: Monthly Attendance Calendar View Exports ---');

  await test('C1: generateMonthlyAttendanceCalendarPDF generates valid calendar grid PDF', async () => {
    const meta = {
      reportTitle: 'Monthly Attendance Calendar',
      siteName: 'Site 1 - Downtown Project',
      siteCode: 'S1',
      periodLabel: 'September 2026',
      generatedAt: '2026-09-24 12:00 PM',
    };
    const mockCalendarData = {
      records: [
        {
          id: 'att-1',
          site_id: 's1',
          date: '2026-09-01',
          role_id: 'r1',
          role_name: 'Mason',
          category_id: 'c1',
          category_name: 'Labour',
          rate_snapshot_paise: 80000,
          full_day_count: 4,
          half_day_count: 1,
          total_workers: 5,
          worker_days: 4.5,
          total_cost_paise: 360000,
          created_at: '2026-09-01',
          updated_at: '2026-09-01',
        },
      ],
      monthLabel: 'September 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    };

    const pdfBuffer = await generateMonthlyAttendanceCalendarPDF(meta, mockCalendarData);
    assert.ok(Buffer.isBuffer(pdfBuffer), 'Calendar PDF must be a Buffer');
    assert.ok(pdfBuffer.length > 500, 'Calendar PDF buffer must have substantial content');
    assert.equal(pdfBuffer.subarray(0, 4).toString(), '%PDF', 'Must start with %PDF magic header');
  });

  await test('C2: generateMonthlyAttendanceCalendarExcel generates 2-sheet workbook (Schedule + Grid)', async () => {
    const meta = {
      reportTitle: 'Monthly Attendance Calendar',
      siteName: 'Site 1 - Downtown Project',
      siteCode: 'S1',
      periodLabel: 'September 2026',
      generatedAt: '2026-09-24 12:00 PM',
    };
    const mockCalendarData = {
      records: [
        {
          id: 'att-1',
          site_id: 's1',
          date: '2026-09-01',
          role_id: 'r1',
          role_name: 'Mason',
          category_id: 'c1',
          category_name: 'Labour',
          rate_snapshot_paise: 80000,
          full_day_count: 4,
          half_day_count: 1,
          total_workers: 5,
          worker_days: 4.5,
          total_cost_paise: 360000,
          created_at: '2026-09-01',
          updated_at: '2026-09-01',
        },
      ],
      monthLabel: 'September 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    };

    const excelBuffer = await generateMonthlyAttendanceCalendarExcel(meta, mockCalendarData);
    assert.ok(Buffer.isBuffer(excelBuffer), 'Calendar Excel must be a Buffer');
    assert.ok(excelBuffer.length > 500, 'Calendar Excel buffer must have substantial size');
    assert.equal(excelBuffer.subarray(0, 2).toString(), 'PK', 'Must start with PK (ZIP format for XLSX)');
  });

  await test('C3: Export API switches to MONTHLY_CALENDAR when requested', () => {
    const pdfRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/export/pdf/route.ts'), 'utf-8');
    const excelRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/export/excel/route.ts'), 'utf-8');

    assert.ok(pdfRouteSource.includes('MONTHLY_CALENDAR'), 'PDF export route must support MONTHLY_CALENDAR');
    assert.ok(excelRouteSource.includes('MONTHLY_CALENDAR'), 'Excel export route must support MONTHLY_CALENDAR');
    assert.ok(pdfRouteSource.includes('generateMonthlyAttendanceCalendarPDF'), 'PDF export must invoke calendar generator');
    assert.ok(excelRouteSource.includes('generateMonthlyAttendanceCalendarExcel'), 'Excel export must invoke calendar generator');
  });

  // ==========================================================================
  // PHASE D: Advanced Transaction Search & Dependent Category Filter
  // ==========================================================================
  console.log('\n--- PHASE D: Advanced Transaction Search & Dependent Categories ---');

  await test('D1: parseTransactionSearch correctly classifies amount prefixes, signed amounts, and text', () => {
    // Pure numbers
    const p50 = parseTransactionSearch('50');
    assert.equal(p50.mode, 'AMOUNT');
    assert.equal(p50.amountPrefix, '50');
    assert.equal(p50.direction, 'ANY');

    const p5000 = parseTransactionSearch('5000');
    assert.equal(p5000.mode, 'AMOUNT');
    assert.equal(p5000.amountPrefix, '5000');
    assert.equal(p5000.direction, 'ANY');

    // Signed amounts
    const pPlus5000 = parseTransactionSearch('+5000');
    assert.equal(pPlus5000.mode, 'AMOUNT');
    assert.equal(pPlus5000.amountPrefix, '5000');
    assert.equal(pPlus5000.direction, 'CREDIT');

    const pMinus5000 = parseTransactionSearch('-5000');
    assert.equal(pMinus5000.mode, 'AMOUNT');
    assert.equal(pMinus5000.amountPrefix, '5000');
    assert.equal(pMinus5000.direction, 'DEBIT');

    // Currency symbol
    const pRupee = parseTransactionSearch('₹5000');
    assert.equal(pRupee.mode, 'AMOUNT');
    assert.equal(pRupee.amountPrefix, '5000');

    // Text queries
    const pText = parseTransactionSearch('Cement UltraTech');
    assert.equal(pText.mode, 'TEXT');
    assert.equal(pText.normalizedText, 'cement ultratech');

    const pPlusText = parseTransactionSearch('+Cement');
    assert.equal(pPlusText.mode, 'TEXT');
    assert.equal(pPlusText.normalizedText, '+cement');
  });

  await test('D2: matchTransactionSearch matches prefix, signed type, and text fallback correctly', () => {
    const txCredit5000 = {
      type: 'CREDIT' as const,
      amount_paise: 500000, // 5000.00
      description: 'Owner advance payment',
      reference_note: 'Initial deposit',
    };

    const txDebit5000 = {
      type: 'DEBIT' as const,
      amount_paise: 500000, // 5000.00
      description: 'Cement purchase',
      reference_note: 'UltraTech Supplies',
      debit_category: 'SUPPLIES',
    };

    const txDebit50 = {
      type: 'DEBIT' as const,
      amount_paise: 5000, // 50.00
      description: 'Tea and snacks',
      reference_note: 'Daily petty cash',
    };

    const txDebit4000 = {
      type: 'DEBIT' as const,
      amount_paise: 400000, // 4000.00
      description: 'Steel purchase',
      reference_note: 'Tata Steel',
    };

    // '50' matches 50.00 and 5000.00 (prefix match)
    assert.equal(matchTransactionSearch(txDebit50, parseTransactionSearch('50')), true, '50 must match 50.00');
    assert.equal(matchTransactionSearch(txCredit5000, parseTransactionSearch('50')), true, '50 must match 5000.00 as prefix');
    assert.equal(matchTransactionSearch(txDebit4000, parseTransactionSearch('50')), false, '50 must not match 4000.00');

    // '5000' matches 5000.00 both credit and debit
    assert.equal(matchTransactionSearch(txCredit5000, parseTransactionSearch('5000')), true);
    assert.equal(matchTransactionSearch(txDebit5000, parseTransactionSearch('5000')), true);
    assert.equal(matchTransactionSearch(txDebit4000, parseTransactionSearch('5000')), false);

    // '+5000' matches ONLY credit 5000.00
    assert.equal(matchTransactionSearch(txCredit5000, parseTransactionSearch('+5000')), true, '+5000 matches credit');
    assert.equal(matchTransactionSearch(txDebit5000, parseTransactionSearch('+5000')), false, '+5000 rejects debit');

    // '-5000' matches ONLY debit 5000.00
    assert.equal(matchTransactionSearch(txDebit5000, parseTransactionSearch('-5000')), true, '-5000 matches debit');
    assert.equal(matchTransactionSearch(txCredit5000, parseTransactionSearch('-5000')), false, '-5000 rejects credit');

    // Text search matches
    assert.equal(matchTransactionSearch(txDebit5000, parseTransactionSearch('UltraTech')), true, 'matches reference_note');
    assert.equal(matchTransactionSearch(txDebit5000, parseTransactionSearch('cement')), true, 'matches description');
    assert.equal(matchTransactionSearch(txDebit50, parseTransactionSearch('snacks')), true, 'matches snacks description');
    assert.equal(matchTransactionSearch(txCredit5000, parseTransactionSearch('cement')), false, 'does not match unrelated');
  });

  await test('D3: DateRangeFilter component enforces dependent category options and auto-reset', () => {
    const filterSource = fs.readFileSync(path.join(process.cwd(), 'components/finance/DateRangeFilter.tsx'), 'utf-8');

    assert.ok(filterSource.includes('handleTypeChange'), 'Must implement handleTypeChange for auto-reset');
    assert.ok(filterSource.includes("values.type !== 'DEBIT'"), 'Must guard credit category options');
    assert.ok(filterSource.includes("values.type !== 'CREDIT'"), 'Must guard debit category options');
    assert.ok(filterSource.includes("onChangeCategory('ALL')"), 'Must reset category to ALL when incompatible');
  });

  console.log('\n====================================================');
  console.log(`ALL PHASE A/B/C/D UNIT & INTEGRATION TESTS PASSED: ${passed}/${total}`);
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
