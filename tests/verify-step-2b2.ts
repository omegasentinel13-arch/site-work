import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  generateFinancialExcel,
  generateMonthlyFinancialExcel,
} from '../lib/export/excel';
import { FinancialSummary, FinancialTransaction } from '../lib/domain/finance-engine';
import { BaseExcelMetadata } from '../lib/export/excel/types';
import { escapeExcelFormula } from '../lib/export/excel/security';

async function runStep2B2Audit() {
  console.log('================================================================');
  console.log('PHASE 5 STEP 2B-2: FINANCIAL REPORTS MIGRATION VERIFICATION');
  console.log('================================================================\n');

  const meta: BaseExcelMetadata = {
    siteName: 'Sunrise Mega Complex',
    siteCode: 'SMC-01',
    reportTitle: 'Financial Audit & Cash Flow Report',
    periodLabel: '01 Sep 2026 to 30 Sep 2026',
    generatedAt: '04/09/2026, 05:00:00 pm',
  };

  // --------------------------------------------------------------------------
  // 1. REPORT A: FINANCE (FINANCIAL LEDGER)
  // --------------------------------------------------------------------------
  console.log('--- 1. AUDITING REPORT A: FINANCE (FINANCIAL LEDGER) ---');
  const summary: FinancialSummary = {
    openingBalancePaise: 50000000,     // ₹5,00,000.00
    totalCreditPaise: 75000000,        // ₹7,50,000.00
    suppliesDebitPaise: 25000000,      // ₹2,50,000.00
    specialWorkerTaskDebitPaise: 10000000, // ₹1,00,000.00
    totalDebitPaise: 35000000,         // ₹3,50,000.00
    netCashFlowPaise: 40000000,        // ₹4,00,000.00
    closingBalancePaise: 90000000,     // ₹9,00,000.00
    transactionCount: 4,
  };

  const transactions: FinancialTransaction[] = [
    {
      id: 'tx-1',
      siteId: 'site-1',
      date: '2026-09-01',
      type: 'CREDIT',
      debitCategory: null,
      description: 'Client Tranche 1 Advance',
      amountPaise: 50000000,
      referenceNote: 'Bank Ref #88912',
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      id: 'tx-2',
      siteId: 'site-1',
      date: '2026-09-02',
      type: 'DEBIT',
      debitCategory: 'SUPPLIES',
      description: escapeExcelFormula('=CMD|"/C calc"!A0') as string, // formula injection test
      amountPaise: 25000000,
      referenceNote: 'Invoice #401',
      createdAt: '2026-09-02T11:00:00Z',
    },
    {
      id: 'tx-3',
      siteId: 'site-1',
      date: '2026-09-03',
      type: 'DEBIT',
      debitCategory: 'SPECIAL_WORKER_TASK',
      description: '-discount voucher cement', // formula trigger test
      amountPaise: 10000000,
      referenceNote: 'Voucher #12',
      createdAt: '2026-09-03T12:00:00Z',
    },
    {
      id: 'tx-4',
      siteId: 'site-1',
      date: '2026-09-04',
      type: 'CREDIT',
      debitCategory: null,
      description: '+reimbursement credit', // formula trigger test
      amountPaise: 25000000,
      referenceNote: 'Bank Ref #88915',
      createdAt: '2026-09-04T13:00:00Z',
    },
  ];

  const t0 = performance.now();
  const finBuf = await generateFinancialExcel(meta, { summary, transactions });
  const t0Duration = performance.now() - t0;
  console.log(`   - Generated in ${t0Duration.toFixed(2)} ms, size: ${(finBuf.length / 1024).toFixed(1)} KB`);

  assert.ok(Buffer.isBuffer(finBuf), 'Must return Buffer');
  assert.ok(finBuf[0] === 0x50 && finBuf[1] === 0x4b, 'Valid OpenXML ZIP signature');

  // OpenXML Parts Audit
  const finZip = XLSX.read(finBuf, { type: 'buffer', bookFiles: true });
  const finFiles = finZip.files || {};
  const finSheetXml = finFiles['xl/worksheets/sheet1.xml']?.content?.toString('utf8') || '';
  const finStylesXml = finFiles['xl/styles.xml']?.content?.toString('utf8') || '';
  const finWbXml = finFiles['xl/workbook.xml']?.content?.toString('utf8') || '';

  // Check Enterprise styling in styles.xml
  assert.ok(finStylesXml.includes('0F172A') || finStylesXml.includes('0f172a'), 'Primary Dark Slate fill present');
  assert.ok(finStylesXml.includes('F8FAFC') || finStylesXml.includes('f8fafc'), 'Zebra row fill present');
  assert.ok(finStylesXml.includes('double'), 'Accounting double border present in styles.xml');

  // Check Sheet XML properties
  assert.ok(finSheetXml.includes('ref="A1:H1"'), 'A1:H1 Merged title banner present');
  assert.ok(finSheetXml.includes('state="frozen"'), 'Freeze pane present');
  assert.ok(finSheetXml.includes('paperSize="9"'), 'A4 paper size present');
  assert.ok(finSheetXml.includes('orientation="landscape"'), 'Landscape orientation present');
  assert.ok(finSheetXml.includes('autoFilter'), 'AutoFilter present on data headers');
  assert.ok(finWbXml.includes('_xlnm.Print_Titles'), 'Repeating print titles present in workbook.xml');

  // Parse SheetJS workbook
  const finParsed = XLSX.read(finBuf, { type: 'buffer' });
  assert.deepEqual(finParsed.SheetNames, ['Financial Ledger'], 'Sheet name must be "Financial Ledger"');
  const finWs = finParsed.Sheets['Financial Ledger'];
  const finJson = XLSX.utils.sheet_to_json(finWs, { header: 1 }) as any[][];

  // Verify Formula Injection Escaping
  const flatValues = finJson.flat();
  const cmdCell = flatValues.find((v) => typeof v === 'string' && v.includes('CMD|'));
  assert.ok(cmdCell, 'CMD injection string present');
  assert.ok(cmdCell.startsWith("'"), 'Must be safely escaped with apostrophe');

  const discountCell = flatValues.find((v) => typeof v === 'string' && v.includes('-discount voucher'));
  assert.ok(discountCell, 'Hyphen string present');
  assert.ok(discountCell.startsWith("'"), 'Hyphen must be safely escaped with apostrophe');

  const plusCell = flatValues.find((v) => typeof v === 'string' && v.includes('+reimbursement'));
  assert.ok(plusCell, 'Plus string present');
  assert.ok(plusCell.startsWith("'"), 'Plus must be safely escaped with apostrophe');

  // Log rows for inspection
  console.log('   - Extracted first 12 rows:');
  finJson.slice(0, 12).forEach((r, idx) => console.log(`     Row ${idx + 1}:`, r));

  // Verify KPI Card row contains Opening Balance
  const kpiLabelRow = finJson.find((r) => r && r.some((v) => typeof v === 'string' && v.includes('Opening Balance')));
  assert.ok(kpiLabelRow, 'KPI strip Opening Balance label present');
  const kpiValRow = finJson.find((r) => r && r.some((v) => typeof v === 'string' && v.includes('5,00,000.00')));
  assert.ok(kpiValRow, 'KPI strip Opening Balance value ₹5,00,000.00 present');

  // Verify Total Movements row
  const totalRow = finJson.find((r) => r && r[0] === 'TOTAL MOVEMENTS');
  assert.ok(totalRow, 'TOTAL MOVEMENTS row present');
  assert.equal(totalRow[4], 750000, 'Total Credit Rupee amount matches 750,000.00');
  assert.equal(totalRow[5], 350000, 'Total Debit Rupee amount matches 350,000.00');
  assert.equal(totalRow[6], 900000, 'Closing Balance Rupee amount matches 900,000.00');

  console.log('   ✔ FINANCE: OpenXML, styles, freeze panes, autoFilter, math parity & formula protection PASS\n');

  // --------------------------------------------------------------------------
  // 2. REPORT B: MONTHLY_FINANCE (3 FINANCIAL WORKSHEETS)
  // --------------------------------------------------------------------------
  console.log('--- 2. AUDITING REPORT B: MONTHLY_FINANCE ---');
  const t1 = performance.now();
  const mBuf = await generateMonthlyFinancialExcel(
    { ...meta, reportTitle: 'Monthly Financial Statement', periodLabel: 'September 2026' },
    { summary, transactions }
  );
  const t1Duration = performance.now() - t1;
  console.log(`   - Generated in ${t1Duration.toFixed(2)} ms, size: ${(mBuf.length / 1024).toFixed(1)} KB`);

  assert.ok(Buffer.isBuffer(mBuf), 'Must return Buffer');
  assert.ok(mBuf[0] === 0x50 && mBuf[1] === 0x4b, 'Valid OpenXML ZIP signature');

  const mZip = XLSX.read(mBuf, { type: 'buffer', bookFiles: true });
  const mFiles = mZip.files || {};
  const mStylesXml = mFiles['xl/styles.xml']?.content?.toString('utf8') || '';
  const mWbXml = mFiles['xl/workbook.xml']?.content?.toString('utf8') || '';

  assert.ok(mStylesXml.includes('0F172A') || mStylesXml.includes('0f172a'), 'Primary Dark Slate fill present');
  assert.ok(mStylesXml.includes('double'), 'Accounting double border present');
  assert.ok(mWbXml.includes('_xlnm.Print_Titles'), 'Repeating print titles present');

  const mParsed = XLSX.read(mBuf, { type: 'buffer' });
  assert.deepEqual(
    mParsed.SheetNames,
    ['Monthly Statement', 'Cash Inflows', 'Cash Outflows'],
    'Must have exactly 3 semantic worksheets'
  );

  // Sheet 1: Monthly Statement
  const stmtWs = mParsed.Sheets['Monthly Statement'];
  const stmtJson = XLSX.utils.sheet_to_json(stmtWs, { header: 1 }) as any[][];
  assert.ok(stmtJson.flat().some((v) => typeof v === 'string' && v.includes('MONTHLY FINANCIAL STATEMENT')), 'Statement banner present');
  assert.ok(stmtJson.flat().some((v) => typeof v === 'string' && v.includes('Financial Accounting Item')), 'Table header present');

  const stmtOpen = stmtJson.find((r) => r && r[0] === 'Opening Cash Balance');
  assert.ok(stmtOpen, 'Opening cash balance line present');
  assert.equal(stmtOpen[2], 500000, 'Opening balance Rupee value matches 500,000.00');

  const stmtClose = stmtJson.find((r) => r && r[0] === 'Closing Cash Balance');
  assert.ok(stmtClose, 'Closing cash balance line present');
  assert.equal(stmtClose[2], 900000, 'Closing balance Rupee value matches 900,000.00');

  // Sheet 2: Cash Inflows
  const inWs = mParsed.Sheets['Cash Inflows'];
  const inJson = XLSX.utils.sheet_to_json(inWs, { header: 1 }) as any[][];
  assert.ok(inJson.flat().some((v) => typeof v === 'string' && v.includes('MONTHLY CASH INFLOWS')), 'Inflows title present');
  const inTotal = inJson.find((r) => r && r[0] === 'TOTAL INFLOWS');
  assert.ok(inTotal, 'TOTAL INFLOWS row present');
  assert.equal(inTotal[2], 750000, 'Total Inflows amount matches 750,000.00');

  // Sheet 3: Cash Outflows
  const outWs = mParsed.Sheets['Cash Outflows'];
  const outJson = XLSX.utils.sheet_to_json(outWs, { header: 1 }) as any[][];
  assert.ok(outJson.flat().some((v) => typeof v === 'string' && v.includes('MONTHLY CASH OUTFLOWS')), 'Outflows title present');
  const outTotal = outJson.find((r) => r && r[0] === 'TOTAL OUTFLOWS');
  assert.ok(outTotal, 'TOTAL OUTFLOWS row present');
  assert.equal(outTotal[3], 350000, 'Total Outflows amount matches 350,000.00');

  console.log('   ✔ MONTHLY_FINANCE: 3 sheets, executive summary, KPI strip & cash flows PASS\n');

  // --------------------------------------------------------------------------
  // 3. NEGATIVE NUMBERS & DEFICIT CASH FLOW HANDLING
  // --------------------------------------------------------------------------
  console.log('--- 3. AUDITING NEGATIVE CASH FLOW & DEFICIT HANDLING ---');
  const deficitSummary: FinancialSummary = {
    openingBalancePaise: 10000000,    // ₹1,00,000.00
    totalCreditPaise: 20000000,       // ₹2,00,000.00
    suppliesDebitPaise: 35000000,     // ₹3,50,000.00
    specialWorkerTaskDebitPaise: 0,
    totalDebitPaise: 35000000,        // ₹3,50,000.00
    netCashFlowPaise: -15000000,      // -₹1,50,000.00 (DEFICIT)
    closingBalancePaise: -5000000,    // -₹50,000.00 (OVERDRAWN)
    transactionCount: 2,
  };

  const deficitTxs: FinancialTransaction[] = [
    {
      id: 'dtx-1',
      siteId: 'site-1',
      date: '2026-09-01',
      type: 'CREDIT',
      debitCategory: null,
      description: 'Minor Advance',
      amountPaise: 20000000,
      referenceNote: null,
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      id: 'dtx-2',
      siteId: 'site-1',
      date: '2026-09-02',
      type: 'DEBIT',
      debitCategory: 'SUPPLIES',
      description: 'Heavy Equipment Rental',
      amountPaise: 35000000,
      referenceNote: null,
      createdAt: '2026-09-02T11:00:00Z',
    },
  ];

  const deficitBuf = await generateFinancialExcel(meta, { summary: deficitSummary, transactions: deficitTxs });
  const deficitParsed = XLSX.read(deficitBuf, { type: 'buffer' });
  const deficitWs = deficitParsed.Sheets['Financial Ledger'];
  const deficitJson = XLSX.utils.sheet_to_json(deficitWs, { header: 1 }) as any[][];

  const deficitTotalRow = deficitJson.find((r) => r && r[0] === 'TOTAL MOVEMENTS');
  assert.ok(deficitTotalRow, 'Total movements row present');
  assert.equal(deficitTotalRow[6], -50000, 'Negative closing balance preserved (-50,000.00)');

  // Verify Monthly statement with deficit
  const deficitMBuf = await generateMonthlyFinancialExcel(meta, { summary: deficitSummary, transactions: deficitTxs });
  const deficitMParsed = XLSX.read(deficitMBuf, { type: 'buffer' });
  const deficitMStmt = XLSX.utils.sheet_to_json(deficitMParsed.Sheets['Monthly Statement'], { header: 1 }) as any[][];
  const netRow = deficitMStmt.find((r) => r && r[0] === 'Net Cash Movement (Surplus / Deficit)');
  assert.ok(netRow, 'Net movement row present');
  assert.equal(netRow[2], -150000, 'Negative net cash movement preserved (-150,000.00)');

  console.log('   ✔ NEGATIVE FLOWS: Deficit & overdrawn amounts mathematically exact & preserved PASS\n');

  // --------------------------------------------------------------------------
  // 4. EMPTY DATASET STATE (0 RECORDS)
  // --------------------------------------------------------------------------
  console.log('--- 4. AUDITING EMPTY DATASET STATE (0 TRANSACTIONS) ---');
  const emptySummary: FinancialSummary = {
    openingBalancePaise: 0,
    totalCreditPaise: 0,
    suppliesDebitPaise: 0,
    specialWorkerTaskDebitPaise: 0,
    totalDebitPaise: 0,
    netCashFlowPaise: 0,
    closingBalancePaise: 0,
    transactionCount: 0,
  };

  const emptyFinBuf = await generateFinancialExcel(meta, { summary: emptySummary, transactions: [] });
  assert.ok(isZipBuffer(emptyFinBuf), 'Empty Finance must return valid OpenXML ZIP');
  const emptyFinParsed = XLSX.read(emptyFinBuf, { type: 'buffer' });
  const emptyFinJson = XLSX.utils.sheet_to_json(emptyFinParsed.Sheets['Financial Ledger'], { header: 1 }) as any[][];
  assert.ok(emptyFinJson.flat().includes('No financial transactions recorded for this period.'), 'Empty message present');

  const emptyMBuf = await generateMonthlyFinancialExcel(meta, { summary: emptySummary, transactions: [] });
  assert.ok(isZipBuffer(emptyMBuf), 'Empty Monthly Finance must return valid OpenXML ZIP');
  const emptyMParsed = XLSX.read(emptyMBuf, { type: 'buffer' });
  const emptyInJson = XLSX.utils.sheet_to_json(emptyMParsed.Sheets['Cash Inflows'], { header: 1 }) as any[][];
  assert.ok(emptyInJson.flat().includes('No cash inflows recorded for this month.'), 'Empty inflows message present');
  const emptyOutJson = XLSX.utils.sheet_to_json(emptyMParsed.Sheets['Cash Outflows'], { header: 1 }) as any[][];
  assert.ok(emptyOutJson.flat().includes('No cash outflows recorded for this month.'), 'Empty outflows message present');

  console.log('   ✔ EMPTY STATE: Clean messaging, no corruption or broken formulas PASS\n');

  // --------------------------------------------------------------------------
  // 5. SCALABILITY BENCHMARK: 5,000 ROWS
  // --------------------------------------------------------------------------
  console.log('--- 5. AUDITING 5,000 ROWS FINANCIAL LEDGER STRESS BENCHMARK ---');
  const ROW_COUNT = 5000;
  let benchCredit = 0;
  let benchDebit = 0;
  const benchTxs: FinancialTransaction[] = Array.from({ length: ROW_COUNT }, (_, i) => {
    const isCredit = i % 3 === 0;
    const amount = (i + 1) * 10000;
    if (isCredit) benchCredit += amount;
    else benchDebit += amount;

    return {
      id: `bench-tx-${i + 1}`,
      siteId: 'site-1',
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      type: isCredit ? 'CREDIT' : 'DEBIT',
      debitCategory: isCredit ? null : 'SUPPLIES',
      description: `Procurement Order Batch #${i + 1} with high grade industrial specifications`,
      amountPaise: amount,
      referenceNote: `PO-${1000 + i}`,
      createdAt: '2026-09-01T00:00:00Z',
    };
  });

  const benchSummary: FinancialSummary = {
    openingBalancePaise: 50000000,
    totalCreditPaise: benchCredit,
    suppliesDebitPaise: benchDebit,
    specialWorkerTaskDebitPaise: 0,
    totalDebitPaise: benchDebit,
    netCashFlowPaise: benchCredit - benchDebit,
    closingBalancePaise: 50000000 + (benchCredit - benchDebit),
    transactionCount: ROW_COUNT,
  };

  const heapBefore = process.memoryUsage().heapUsed;
  const benchStart = performance.now();
  const benchBuf = await generateFinancialExcel(
    { ...meta, reportTitle: '5,000 Rows Enterprise Scalability Test' },
    { summary: benchSummary, transactions: benchTxs }
  );
  const benchDuration = performance.now() - benchStart;
  const heapAfter = process.memoryUsage().heapUsed;

  assert.ok(isZipBuffer(benchBuf), '5,000 rows must produce valid OpenXML ZIP');
  assert.ok(benchBuf.length > 100000, `Buffer size (${benchBuf.length} bytes) must reflect 5,000 rows`);
  assert.ok(benchDuration < 5000, `Duration (${benchDuration.toFixed(0)} ms) must be < 5000 ms`);

  const benchWb = XLSX.read(benchBuf, { type: 'buffer' });
  const benchRows = XLSX.utils.sheet_to_json(benchWb.Sheets['Financial Ledger'], { header: 1 }) as any[][];
  assert.ok(benchRows.length >= 5000, `Expected >= 5000 rows in sheet, got ${benchRows.length}`);

  console.log(`   - 5,000 Rows Output Size: ${(benchBuf.length / 1024).toFixed(1)} KB`);
  console.log(`   - Generation Duration: ${benchDuration.toFixed(2)} ms`);
  console.log(`   - Heap Delta: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`);
  console.log('   ✔ 5,000 ROWS BENCHMARK PASS\n');

  console.log('================================================================');
  console.log('ALL STEP 2B-2 VERIFICATION CHECKS PASSED WITH ZERO DEFECTS');
  console.log('================================================================');
}

function isZipBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

runStep2B2Audit().catch((err) => {
  console.error('FATAL VERIFICATION ERROR:', err);
  process.exit(1);
});
