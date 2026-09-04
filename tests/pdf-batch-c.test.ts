import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDailyAttendancePDF,
  generateWeeklyAttendancePDF,
  generateMonthlyAttendancePDF,
  generateFinancialPDF,
  generateMonthlyFinancialPDF,
  generateRoleReportPDF,
  generateCategoryReportPDF,
  generateSitePerformancePDF,
  sanitizeReportFilename,
  buildContentDispositionHeader,
} from '../lib/export/pdf';
import { DailySummary } from '../lib/domain/attendance-engine';
import { FinancialSummary } from '../lib/domain/finance-engine';
import { AttendanceDbRecord } from '../lib/db/repositories/attendance-repo';

// Helper to extract text from pure ASCII / WinAnsi jsPDF binary buffer
function extractPdfText(buf: Buffer): string {
  return buf.toString('latin1');
}

// Helper to inspect total pages and page labels from raw PDF buffer
function inspectPdfPages(buf: Buffer): { totalPages: number; pagesFound: number[] } {
  const str = buf.toString('latin1');
  const matches = str.match(/\(Page\s+(\d+)\s+of\s+(\d+)\)/g) || [];
  let maxTotal = 0;
  const pages: number[] = [];

  for (const m of matches) {
    const sub = m.match(/\(Page\s+(\d+)\s+of\s+(\d+)\)/);
    if (sub) {
      const pNum = parseInt(sub[1], 10);
      const pTot = parseInt(sub[2], 10);
      pages.push(pNum);
      if (pTot > maxTotal) maxTotal = pTot;
    }
  }

  return {
    totalPages: maxTotal,
    pagesFound: Array.from(new Set(pages)).sort((a, b) => a - b),
  };
}

test('PHASE 4 BATCH C: FINAL ACCEPTANCE, SCALABILITY, 50+ PAGES, 500+ ROWS & PARITY GATE', async (t) => {
  const sampleMeta = {
    siteName: 'Sunrise Mega Complex',
    siteCode: 'SMC-01',
    reportTitle: 'Scalability Stress Test',
    periodLabel: '01 Sep 2026 to 30 Sep 2026',
    generatedAt: '03/09/2026, 09:00:00 pm',
  };

  // --------------------------------------------------------------------------
  // 1. SCALABILITY: 50+ PAGES & 500+ ROWS STRESS TESTING
  // --------------------------------------------------------------------------
  await t.test('1. Financial Ledger: 1,600 Rows Stress Test (Generates 50+ Pages)', () => {
    const ROW_COUNT = 1600;
    let totalCredit = 0;
    let totalDebit = 0;

    const manyTxs = Array.from({ length: ROW_COUNT }, (_, i) => {
      const isCredit = i % 3 === 0;
      const amountPaise = (i + 1) * 10000;
      if (isCredit) totalCredit += amountPaise;
      else totalDebit += amountPaise;

      return {
        date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
        type: isCredit ? ('CREDIT' as const) : ('DEBIT' as const),
        debitCategory: isCredit ? null : ('SUPPLIES' as const),
        description: `Material Supply Invoice #${i + 1} with high grade industrial specifications and multi-batch tracking`,
        amountPaise,
      };
    });

    const openingBalance = 50000000; // 5,00,000.00
    const netCashFlow = totalCredit - totalDebit;
    const closingBalance = openingBalance + netCashFlow;

    const summary: FinancialSummary = {
      openingBalancePaise: openingBalance,
      totalCreditPaise: totalCredit,
      suppliesDebitPaise: totalDebit,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: totalDebit,
      netCashFlowPaise: netCashFlow,
      closingBalancePaise: closingBalance,
      transactionCount: ROW_COUNT,
    };

    const heapBefore = process.memoryUsage().heapUsed;
    const startMs = Date.now();

    const buf = generateFinancialPDF(
      { ...sampleMeta, reportTitle: 'High Volume Financial Ledger' },
      summary,
      manyTxs
    );

    const durationMs = Date.now() - startMs;
    const heapAfter = process.memoryUsage().heapUsed;

    assert.ok(Buffer.isBuffer(buf), 'Must return Buffer');
    assert.ok(buf.length > 1000000, `Buffer size (${buf.length} bytes) must reflect 50+ pages`);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');

    const pageInspection = inspectPdfPages(buf);
    assert.ok(
      pageInspection.totalPages >= 50,
      `Expected >= 50 pages, but generated ${pageInspection.totalPages} pages`
    );

    // Verify first and last page labels
    const text = extractPdfText(buf);
    assert.ok(text.includes(`Page 1 of ${pageInspection.totalPages}`), 'First page numbering must exist');
    assert.ok(text.includes(`Page ${pageInspection.totalPages} of ${pageInspection.totalPages}`), 'Last page numbering must exist');

    // Verify running headers on continuation pages
    assert.ok(text.includes('Sunrise Mega Complex'), 'Must include site name on pages');
    assert.ok(text.includes('High Volume Financial Ledger'), 'Must include report title in running headers');

    // Semantic Data Parity checks
    assert.ok(text.includes('Rs. 5,00,000.00'), 'Opening balance in Indian currency notation must appear in summary KPI');
    assert.ok(text.includes(summary.transactionCount.toString()), 'Transaction count must match');

    // Log benchmark for final report
    console.log(`\n  [BENCHMARK] Financial Ledger 1,600 Rows:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
    console.log(`    - Heap Delta: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`);
  });

  await t.test('2. Role Report: 1,500 Rows Stress Test (Generates 50+ Pages)', () => {
    const ROW_COUNT = 1500;
    let totalWorkerDays = 0;
    let totalCost = 0;

    const records: AttendanceDbRecord[] = Array.from({ length: ROW_COUNT }, (_, i) => {
      const fullDays = (i % 5) + 1;
      const halfDays = i % 2;
      const wDays = fullDays + halfDays * 0.5;
      const rate = 120000;
      const cost = Math.round(wDays * rate);

      totalWorkerDays += wDays;
      totalCost += cost;

      return {
        id: `att-stress-${i}`,
        site_id: 'site-1',
        date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
        role_id: 'role-mason',
        role_name: 'Master Mason',
        category_id: 'cat-civil',
        category_name: 'Civil Works',
        rate_snapshot_paise: rate,
        full_day_count: fullDays,
        half_day_count: halfDays,
        total_workers: fullDays + halfDays,
        worker_days: wDays,
        total_cost_paise: cost,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      };
    });

    const startMs = Date.now();
    const buf = generateRoleReportPDF(
      { ...sampleMeta, reportTitle: 'Master Mason Role Audit' },
      {
        roleName: 'Master Mason',
        categoryName: 'Civil Works',
        records,
      }
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 500000);
    const pageInspection = inspectPdfPages(buf);
    assert.ok(
      pageInspection.totalPages >= 50,
      `Expected >= 50 pages, got ${pageInspection.totalPages} pages`
    );

    const text = extractPdfText(buf);
    assert.ok(text.includes('Master Mason'));
    assert.ok(text.includes(`Page 1 of ${pageInspection.totalPages}`));
    assert.ok(text.includes(`Page ${pageInspection.totalPages} of ${pageInspection.totalPages}`));

    console.log(`\n  [BENCHMARK] Role Report 1,500 Rows:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  await t.test('3. Category Report: 750 Rows Semantic Rollup Test', () => {
    const ROW_COUNT = 750;
    const records: AttendanceDbRecord[] = Array.from({ length: ROW_COUNT }, (_, i) => {
      const fullDays = 3;
      const halfDays = 1;
      const wDays = 3.5;
      const rate = 150000;
      const cost = 525000;

      return {
        id: `att-cat-stress-${i}`,
        site_id: 'site-1',
        date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
        role_id: `role-${i % 10}`,
        role_name: `Electrical Specialist Level ${(i % 10) + 1}`,
        category_id: 'cat-elec',
        category_name: 'Electrical Engineering',
        rate_snapshot_paise: rate,
        full_day_count: fullDays,
        half_day_count: halfDays,
        total_workers: 4,
        worker_days: wDays,
        total_cost_paise: cost,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      };
    });

    const startMs = Date.now();
    const buf = generateCategoryReportPDF(
      { ...sampleMeta, reportTitle: 'Electrical Category Comprehensive' },
      {
        categoryName: 'Electrical Engineering',
        records,
      }
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 15000, `Buffer size (${buf.length} bytes) must be substantial`);
    const pageInspection = inspectPdfPages(buf);
    assert.ok(pageInspection.totalPages >= 2);

    const text = extractPdfText(buf);
    assert.ok(text.includes('Electrical Engineering'));

    console.log(`\n  [BENCHMARK] Category Report 750 Rows:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  await t.test('4. Monthly Attendance: 500 Records Scalability Test', () => {
    const ROW_COUNT = 500;
    const records: AttendanceDbRecord[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
      id: `att-mon-${i}`,
      site_id: 'site-1',
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      role_id: `role-${i % 8}`,
      role_name: `Construction Trade Specialist ${(i % 8) + 1}`,
      category_id: `cat-${i % 4}`,
      category_name: `Category ${(i % 4) + 1}`,
      rate_snapshot_paise: 110000,
      full_day_count: 5,
      half_day_count: 2,
      total_workers: 7,
      worker_days: 6.0,
      total_cost_paise: 660000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    }));

    const startMs = Date.now();
    const buf = generateMonthlyAttendancePDF(
      { ...sampleMeta, reportTitle: 'Monthly Workforce Audit' },
      {
        records,
        monthLabel: 'September 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 20000);
    const pageInspection = inspectPdfPages(buf);
    assert.ok(pageInspection.totalPages >= 2);

    console.log(`\n  [BENCHMARK] Monthly Attendance 500 Rows:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  await t.test('5. Weekly Attendance: 500 Records Scalability Test', () => {
    const ROW_COUNT = 500;
    const records: AttendanceDbRecord[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
      id: `att-wk-${i}`,
      site_id: 'site-1',
      date: `2026-09-${String((i % 7) + 1).padStart(2, '0')}`,
      role_id: `role-${i % 25}`,
      role_name: `Trade Role #${(i % 25) + 1}`,
      category_id: `cat-${i % 5}`,
      category_name: `Division ${(i % 5) + 1}`,
      rate_snapshot_paise: 100000,
      full_day_count: 4,
      half_day_count: 0,
      total_workers: 4,
      worker_days: 4.0,
      total_cost_paise: 400000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    }));

    const startMs = Date.now();
    const buf = generateWeeklyAttendancePDF(
      { ...sampleMeta, reportTitle: 'Weekly Matrix Scalability Test' },
      {
        records,
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      }
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 20000);
    const pageInspection = inspectPdfPages(buf);
    assert.ok(pageInspection.totalPages >= 2);

    console.log(`\n  [BENCHMARK] Weekly Attendance Matrix 500 Rows:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  await t.test('6. Monthly Finance: 500 Transactions Scalability Test', () => {
    const ROW_COUNT = 500;
    let credit = 0;
    let debit = 0;

    const txs = Array.from({ length: ROW_COUNT }, (_, i) => {
      const isCredit = i % 4 === 0;
      const amount = (i + 1) * 20000;
      if (isCredit) credit += amount;
      else debit += amount;

      return {
        date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
        type: isCredit ? ('CREDIT' as const) : ('DEBIT' as const),
        debitCategory: isCredit ? null : ('SUPPLIES' as const),
        description: `Operational invoice payment tranche #${i + 1}`,
        amountPaise: amount,
      };
    });

    const summary: FinancialSummary = {
      openingBalancePaise: 20000000,
      totalCreditPaise: credit,
      suppliesDebitPaise: debit,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: debit,
      netCashFlowPaise: credit - debit,
      closingBalancePaise: 20000000 + (credit - debit),
      transactionCount: ROW_COUNT,
    };

    const startMs = Date.now();
    const buf = generateMonthlyFinancialPDF(
      { ...sampleMeta, reportTitle: 'Monthly Statement Scalability Test' },
      summary,
      txs
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 50000);
    const pageInspection = inspectPdfPages(buf);
    assert.ok(pageInspection.totalPages >= 15);

    console.log(`\n  [BENCHMARK] Monthly Finance 500 Rows:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  await t.test('7. Daily Attendance: 500 Roles & Categories Scalability Test', () => {
    const categories: DailySummary['categories'] = Array.from({ length: 25 }, (_, cIdx) => ({
      categoryId: `cat-stress-${cIdx}`,
      categoryName: `Major Division Work Category #${cIdx + 1}`,
      totalWorkers: 40,
      workerDays: 35.0,
      totalCostPaise: 3500000,
      roles: Array.from({ length: 20 }, (_, rIdx) => ({
        roleId: `role-${cIdx}-${rIdx}`,
        roleName: `Specialized Trade Level ${rIdx + 1}`,
        categoryId: `cat-stress-${cIdx}`,
        categoryName: `Major Division Work Category #${cIdx + 1}`,
        rateInPaise: 100000,
        fullDayCount: 1,
        halfDayCount: 1,
        totalWorkers: 2,
        workerDays: 1.75,
        fullDayCostPaise: 100000,
        halfDayCostPaise: 75000,
        totalCostPaise: 175000,
      })),
    }));

    const summary: DailySummary = {
      date: '2026-09-01',
      totalWorkers: 1000,
      fullDayCount: 750,
      halfDayCount: 250,
      workerDays: 875.0,
      totalLabourCostPaise: 87500000,
      categories,
    };

    const startMs = Date.now();
    const buf = generateDailyAttendancePDF(
      { ...sampleMeta, reportTitle: 'High Volume Daily Deployment' },
      summary
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 50000);
    const pageInspection = inspectPdfPages(buf);
    assert.ok(pageInspection.totalPages >= 15);

    console.log(`\n  [BENCHMARK] Daily Attendance 500 Roles:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  await t.test('8. Site Performance Report: Combined 500 Records Scalability Test', () => {
    const attRecords: AttendanceDbRecord[] = Array.from({ length: 500 }, (_, i) => ({
      id: `att-site-stress-${i}`,
      site_id: 'site-1',
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      role_id: `role-${i % 10}`,
      role_name: `Role ${(i % 10) + 1}`,
      category_id: `cat-${i % 3}`,
      category_name: `Category ${(i % 3) + 1}`,
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
    }));

    const finSummary: FinancialSummary = {
      openingBalancePaise: 50000000,
      totalCreditPaise: 150000000,
      suppliesDebitPaise: 80000000,
      specialWorkerTaskDebitPaise: 20000000,
      totalDebitPaise: 100000000,
      netCashFlowPaise: 50000000,
      closingBalancePaise: 100000000,
      transactionCount: 250,
    };

    const startMs = Date.now();
    const buf = generateSitePerformancePDF(
      { ...sampleMeta, reportTitle: 'Executive Site Performance Audit' },
      {
        siteName: 'Sunrise Mega Complex',
        siteLocation: 'Industrial Corridor Sector 9',
        attendanceRecords: attRecords,
        financialSummary: finSummary,
      }
    );
    const durationMs = Date.now() - startMs;

    assert.ok(buf.length > 2000);
    const pageInspection = inspectPdfPages(buf);
    assert.equal(pageInspection.totalPages, 1, 'Site report executive format renders on 1 dense summary page');

    console.log(`\n  [BENCHMARK] Site Performance Report:`);
    console.log(`    - Pages Generated: ${pageInspection.totalPages}`);
    console.log(`    - Output Size: ${(buf.length / 1024).toFixed(1)} KB`);
    console.log(`    - Duration: ${durationMs} ms`);
  });

  // --------------------------------------------------------------------------
  // 2. MATHEMATICAL & SEMANTIC DATA PARITY
  // --------------------------------------------------------------------------
  await t.test('9. Mathematical & Semantic Parity: Financial Balance Equations', () => {
    const opening = 25000000;
    const credits = 75000000;
    const supplies = 30000000;
    const special = 15000000;
    const totalDebits = supplies + special;
    const netCashFlow = credits - totalDebits;
    const closing = opening + netCashFlow;

    const summary: FinancialSummary = {
      openingBalancePaise: opening,
      totalCreditPaise: credits,
      suppliesDebitPaise: supplies,
      specialWorkerTaskDebitPaise: special,
      totalDebitPaise: totalDebits,
      netCashFlowPaise: netCashFlow,
      closingBalancePaise: closing,
      transactionCount: 2,
    };

    const txs = [
      { date: '2026-09-01', type: 'CREDIT' as const, description: 'Client Initial Advance', amountPaise: credits },
      { date: '2026-09-02', type: 'DEBIT' as const, debitCategory: 'SUPPLIES' as const, description: 'Cement Purchases', amountPaise: supplies },
    ];

    const buf = generateFinancialPDF(sampleMeta, summary, txs);
    const text = extractPdfText(buf);

    // Verify mathematical semantics in generated PDF text
    assert.ok(text.includes('Rs. 2,50,000.00'), 'Opening balance Rs. 2,50,000.00 must exist');
    assert.ok(text.includes('Rs. 7,50,000.00'), 'Total Credit Rs. 7,50,000.00 must exist');
    assert.ok(text.includes('Rs. 4,50,000.00'), 'Total Debit Rs. 4,50,000.00 must exist');
    assert.ok(text.includes('Rs. 3,00,000.00'), 'Net Cash Flow Rs. 3,00,000.00 must exist');
    assert.ok(text.includes('Rs. 5,50,000.00'), 'Closing Balance Rs. 5,50,000.00 must exist');
  });

  await t.test('10. Mathematical & Semantic Parity: Attendance Worker-Days & Costs', () => {
    const rate = 120000; // 1,200.00
    const fullDayCount = 4;
    const halfDayCount = 1;
    const workerDays = 4 + 0.5 * 1; // 4.5
    const totalCost = Math.round(workerDays * rate); // 5,400.00 -> 540000 paise

    const summary: DailySummary = {
      date: '2026-09-01',
      totalWorkers: 5,
      fullDayCount,
      halfDayCount,
      workerDays,
      totalLabourCostPaise: totalCost,
      categories: [
        {
          categoryId: 'cat-carpentry',
          categoryName: 'Carpentry Division',
          totalWorkers: 5,
          workerDays,
          totalCostPaise: totalCost,
          roles: [
            {
              roleId: 'role-carp-lead',
              roleName: 'Lead Joiner',
              categoryId: 'cat-carpentry',
              categoryName: 'Carpentry Division',
              rateInPaise: rate,
              fullDayCount,
              halfDayCount,
              totalWorkers: 5,
              workerDays,
              fullDayCostPaise: 480000,
              halfDayCostPaise: 60000,
              totalCostPaise: totalCost,
            },
          ],
        },
      ],
    };

    const buf = generateDailyAttendancePDF(sampleMeta, summary);
    const text = extractPdfText(buf);

    assert.ok(text.includes('4.5'), 'Worker-days 4.5 must exist in summary');
    assert.ok(text.includes('Rs. 5,400.00'), 'Labour cost Rs. 5,400.00 must exist in summary');
    assert.ok(text.includes('Lead Joiner'), 'Role name must appear in table');
    assert.ok(text.includes('Carpentry Division'), 'Category name must appear');
  });

  // --------------------------------------------------------------------------
  // 3. COMPLETE EMPTY-STATE MATRIX FOR ALL 8 REPORTS
  // --------------------------------------------------------------------------
  await t.test('11. Empty-State Matrix: Valid Generation with Zero Records Across ALL 8 Reports', () => {
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
        generate: () => generateDailyAttendancePDF(sampleMeta, {
          date: '2026-09-01',
          totalWorkers: 0,
          fullDayCount: 0,
          halfDayCount: 0,
          workerDays: 0,
          totalLabourCostPaise: 0,
          categories: [],
        }),
        expectedMsg: 'No attendance records recorded for this date.',
      },
      {
        name: 'WEEKLY_ATTENDANCE',
        generate: () => generateWeeklyAttendancePDF(sampleMeta, { records: [], startDate: '2026-09-01', endDate: '2026-09-07' }),
        expectedMsg: 'No attendance records recorded for this week.',
      },
      {
        name: 'MONTHLY_ATTENDANCE',
        generate: () => generateMonthlyAttendancePDF(sampleMeta, { records: [], monthLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30' }),
        expectedMsg: 'No workforce attendance recorded for this month.',
      },
      {
        name: 'FINANCE',
        generate: () => generateFinancialPDF(sampleMeta, emptyFin, []),
        expectedMsg: 'No financial transactions recorded for this period.',
      },
      {
        name: 'MONTHLY_FINANCE',
        generate: () => generateMonthlyFinancialPDF(sampleMeta, emptyFin, []),
        expectedMsg: 'No cash movements recorded for this month.',
      },
      {
        name: 'ROLE_REPORT',
        generate: () => generateRoleReportPDF(sampleMeta, { roleName: 'Scaffolder', categoryName: 'Safety', records: [] }),
        expectedMsg: 'Selected role had zero deployment days in this period.',
      },
      {
        name: 'CATEGORY_REPORT',
        generate: () => generateCategoryReportPDF(sampleMeta, { categoryName: 'Safety', records: [] }),
        expectedMsg: 'Selected category had zero deployment in this period.',
      },
      {
        name: 'SITE_REPORT',
        generate: () => generateSitePerformancePDF(sampleMeta, { siteName: 'Sunrise Complex', attendanceRecords: [], financialSummary: emptyFin }),
        expectedMsg: 'No operational or financial data recorded for this period.',
      },
    ];

    for (const rep of emptyReports) {
      const buf = rep.generate();
      assert.ok(buf.length > 500, `${rep.name} empty report must return non-empty buffer`);
      assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-', `${rep.name} empty report must have valid signature`);

      const text = extractPdfText(buf);
      assert.ok(text.includes(rep.expectedMsg), `${rep.name} must display empty-state message: "${rep.expectedMsg}"`);
      assert.ok(text.includes('Page 1 of 1'), `${rep.name} empty report must have valid Page 1 of 1 footer`);
      assert.ok(!text.includes('NaN'), `${rep.name} must not contain NaN`);
      assert.ok(!text.includes('undefined'), `${rep.name} must not contain undefined`);
    }
  });

  // --------------------------------------------------------------------------
  // 4. FILENAME SECURITY COMPREHENSIVE STRESS TESTING
  // --------------------------------------------------------------------------
  await t.test('12. Filename Security: Traversal, CRLF, Quotes, Windows Devices & Long Names', () => {
    // 1. Directory Traversal
    assert.equal(sanitizeReportFilename('../../../etc/passwd', 'report'), 'etc_passwd_report.pdf');
    assert.equal(sanitizeReportFilename('..\\..\\Windows\\System32\\cmd.exe', 'test'), 'Windows_System32_cmd.exe_test.pdf');

    // 2. CRLF & Header Injection
    assert.equal(sanitizeReportFilename('Site\r\nSet-Cookie: session=evil', 'rep'), 'SiteSet-Cookie_session=evil_rep.pdf');
    assert.equal(sanitizeReportFilename('Site\nInjected', ''), 'SiteInjected.pdf');

    // 3. Quotes, Semicolons & Control Characters
    assert.equal(sanitizeReportFilename('Site"Name;Injected=True', 'test'), 'Site_Name_Injected=True_test.pdf');
    assert.equal(sanitizeReportFilename('Site\x00\x1FName', 'test'), 'SiteName_test.pdf');

    // 4. Windows Reserved Device Names
    const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM9', 'LPT1', 'LPT9'];
    for (const r of reserved) {
      assert.equal(sanitizeReportFilename(r, ''), 'site_work_report.pdf');
      assert.equal(sanitizeReportFilename(r.toLowerCase(), ''), 'site_work_report.pdf');
    }

    // 5. Excessive Length Truncation
    const excessive = 'A'.repeat(250);
    const sanitized = sanitizeReportFilename(excessive, 'daily');
    assert.ok(sanitized.length <= 85, `Length ${sanitized.length} must be <= 85 chars`);
    assert.ok(sanitized.endsWith('.pdf'));

    // 6. RFC 5987 / RFC 6266 Header Output
    const header = buildContentDispositionHeader('Sunrise_Site_Report_2026.pdf');
    assert.ok(header.startsWith('attachment; filename="Sunrise_Site_Report_2026.pdf"'));
    assert.ok(header.includes("filename*=UTF-8''Sunrise_Site_Report_2026.pdf"));
    assert.ok(!header.includes('\r'));
    assert.ok(!header.includes('\n'));
  });

  await t.test('13. Role Report: ALL Roles (All Workers) View & Export Verification', () => {
    const records: AttendanceDbRecord[] = [
      {
        id: 'att-1',
        site_id: 'site-1',
        date: '2026-09-01',
        role_id: 'role-mason',
        role_name: 'Master Mason',
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
        date: '2026-09-01',
        role_id: 'role-carpenter',
        role_name: 'Lead Carpenter',
        category_id: 'cat-finish',
        category_name: 'Finishing Works',
        rate_snapshot_paise: 110000,
        full_day_count: 3,
        half_day_count: 0,
        total_workers: 3,
        worker_days: 3.0,
        total_cost_paise: 330000,
        created_by: null,
        updated_by: null,
        created_at: '',
        updated_at: '',
      },
    ];

    const buf = generateRoleReportPDF(
      { ...sampleMeta, reportTitle: 'All Workforce Roles & Deployment' },
      {
        roleName: 'All Roles (All Workers)',
        categoryName: 'All Categories',
        records,
        isAllRoles: true,
      }
    );

    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const text = extractPdfText(buf);
    assert.ok(text.includes('All Workforce Roles & Deployment'));
    assert.ok(text.includes('Master Mason'));
    assert.ok(text.includes('Lead Carpenter'));
    assert.ok(text.includes('Civil Works'));
    assert.ok(text.includes('Finishing Works'));
    assert.ok(text.includes('Role & Category'));
  });
});
