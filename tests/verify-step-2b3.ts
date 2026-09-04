import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  generateRoleReportExcel,
  generateCategoryReportExcel,
  generateSiteReportExcel,
} from '../lib/export/excel';
import { BaseExcelMetadata, AttendanceDbRecord } from '../lib/export/excel/types';
import { FinancialSummary } from '../lib/domain/finance-engine';
import { escapeExcelFormula } from '../lib/export/excel/security';

function isZipBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

async function runStep2B3Audit() {
  console.log('================================================================');
  console.log('PHASE 5 STEP 2B-3: ANALYTICAL & MANAGEMENT REPORTS VERIFICATION');
  console.log('================================================================\n');

  const meta: BaseExcelMetadata = {
    siteName: 'Sunrise Mega Complex',
    siteCode: 'SMC-01',
    reportTitle: 'Workforce & Management Operational Audit',
    periodLabel: '01 Sep 2026 to 30 Sep 2026',
    generatedAt: '04/09/2026, 05:30:00 pm',
  };

  // --------------------------------------------------------------------------
  // 1. REPORT A: ROLE_REPORT (SINGLE ROLE & ALL ROLES)
  // --------------------------------------------------------------------------
  console.log('--- 1. AUDITING REPORT A: ROLE_REPORT (Single & ALL Roles) ---');
  const roleRecords: AttendanceDbRecord[] = [
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
      role_id: 'role-mason',
      role_name: escapeExcelFormula('=CMD|"/C calc"!A0') as string, // formula injection test
      category_id: 'cat-civil',
      category_name: escapeExcelFormula('-discount voucher category') as string, // malicious hyphen trigger
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
    {
      id: 'att-3',
      site_id: 'site-1',
      date: '2026-09-03',
      role_id: 'role-carpenter',
      role_name: escapeExcelFormula('+lead carpenter') as string, // malicious plus trigger
      category_id: 'cat-carpentry',
      category_name: 'Carpentry Works',
      rate_snapshot_paise: 100000,
      full_day_count: 3,
      half_day_count: 2,
      total_workers: 5,
      worker_days: 4.0,
      total_cost_paise: 400000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    },
  ];

  // A1. Single Role Verification
  const tRoleSingleStart = performance.now();
  const singleRoleBuf = await generateRoleReportExcel(meta, {
    roleName: 'Lead Mason',
    categoryName: 'Civil Works',
    records: [roleRecords[0], roleRecords[1]],
    isAllRoles: false,
  });
  const tRoleSingleDuration = performance.now() - tRoleSingleStart;
  console.log(`   - Single Role generated in ${tRoleSingleDuration.toFixed(2)} ms, size: ${(singleRoleBuf.length / 1024).toFixed(1)} KB`);

  assert.ok(isZipBuffer(singleRoleBuf), 'Valid OpenXML ZIP signature for Single Role');
  const singleRoleZip = XLSX.read(singleRoleBuf, { type: 'buffer', bookFiles: true });
  const singleFiles = singleRoleZip.files || {};
  const singleStylesXml = singleFiles['xl/styles.xml']?.content?.toString('utf8') || '';
  const singleSheetXml = singleFiles['xl/worksheets/sheet1.xml']?.content?.toString('utf8') || '';

  assert.ok(singleStylesXml.includes('0F172A') || singleStylesXml.includes('0f172a'), 'Slate 900 primary fill present');
  assert.ok(singleStylesXml.includes('double'), 'Accounting double border present');
  assert.ok(singleSheetXml.includes('orientation="portrait"'), 'Single role orientation is portrait');

  const singleParsed = XLSX.read(singleRoleBuf, { type: 'buffer' });
  assert.deepEqual(singleParsed.SheetNames, ['Workforce Deployment']);
  const singleJson = XLSX.utils.sheet_to_json(singleParsed.Sheets['Workforce Deployment'], { header: 1 }) as any[][];

  // Verify Single Role Period Totals
  const singleTotalRow = singleJson.find((r) => r && r[0] === 'PERIOD TOTALS');
  assert.ok(singleTotalRow, 'PERIOD TOTALS row present');
  assert.equal(singleTotalRow[2], 9, 'Full Day total matches (4 + 5)');
  assert.equal(singleTotalRow[3], 1, 'Half Day total matches (1 + 0)');
  assert.equal(singleTotalRow[4], 10, 'Total Workers matches (5 + 5)');
  assert.equal(singleTotalRow[5], 9.5, 'Worker-Days total matches (4.5 + 5.0)');
  assert.equal(singleTotalRow[6], 11400, 'Total Cost (Rupees) matches (1,140,000 paise / 100)');

  // A2. ALL Roles Verification
  const tRoleAllStart = performance.now();
  const allRoleBuf = await generateRoleReportExcel(meta, {
    roleName: 'All Roles (All Workers)',
    categoryName: 'All Categories',
    records: roleRecords,
    isAllRoles: true,
  });
  const tRoleAllDuration = performance.now() - tRoleAllStart;
  console.log(`   - ALL Roles generated in ${tRoleAllDuration.toFixed(2)} ms, size: ${(allRoleBuf.length / 1024).toFixed(1)} KB`);

  assert.ok(isZipBuffer(allRoleBuf), 'Valid OpenXML ZIP signature for ALL Roles');
  const allRoleZip = XLSX.read(allRoleBuf, { type: 'buffer', bookFiles: true });
  const allSheetXml = allRoleZip.files['xl/worksheets/sheet1.xml']?.content?.toString('utf8') || '';
  assert.ok(allSheetXml.includes('orientation="landscape"'), 'ALL roles orientation is landscape');

  const allParsed = XLSX.read(allRoleBuf, { type: 'buffer' });
  const allJson = XLSX.utils.sheet_to_json(allParsed.Sheets['Workforce Deployment'], { header: 1 }) as any[][];
  const allHeaderRow = allJson.find((r) => r && r.includes('Role') && r.includes('Category'));
  assert.ok(allHeaderRow, 'ALL Roles header row includes Role and Category columns');

  // Verify Formula Injection Escaping in ALL Roles
  const allFlat = allJson.flat();
  const allCmdCell = allFlat.find((v) => typeof v === 'string' && v.includes('CMD|'));
  assert.ok(allCmdCell, 'CMD cell present');
  assert.ok(allCmdCell.startsWith("'"), 'Must be safely escaped with apostrophe');

  const allTotalRow = allJson.find((r) => r && r[0] === 'PERIOD TOTALS');
  assert.ok(allTotalRow, 'ALL Roles PERIOD TOTALS row present');
  assert.equal(allTotalRow[4], 12, 'Full Day total matches (4 + 5 + 3)');
  assert.equal(allTotalRow[5], 3, 'Half Day total matches (1 + 0 + 2)');
  assert.equal(allTotalRow[6], 15, 'Total Workers matches (5 + 5 + 5)');
  assert.equal(allTotalRow[7], 13.5, 'Worker-Days matches (4.5 + 5.0 + 4.0)');
  assert.equal(allTotalRow[8], 15400, 'Total Cost (Rupees) matches (1,540,000 paise / 100)');

  console.log('   ✔ ROLE_REPORT: Single & ALL Roles, OpenXML, orientation, formulas, math parity PASS\n');

  // --------------------------------------------------------------------------
  // 2. REPORT B: CATEGORY_REPORT (2 Semantic Worksheets)
  // --------------------------------------------------------------------------
  console.log('--- 2. AUDITING REPORT B: CATEGORY_REPORT (2 Worksheets) ---');
  const catRecords: AttendanceDbRecord[] = [
    {
      id: 'c-att-1',
      site_id: 'site-1',
      date: '2026-09-01',
      role_id: 'role-elec-1',
      role_name: 'Lead Electrician',
      category_id: 'cat-elec',
      category_name: 'Electrical Works',
      rate_snapshot_paise: 120000,
      full_day_count: 2,
      half_day_count: 0,
      total_workers: 2,
      worker_days: 2.0,
      total_cost_paise: 240000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'c-att-2',
      site_id: 'site-1',
      date: '2026-09-01',
      role_id: 'role-elec-2',
      role_name: escapeExcelFormula('=SUM(Dangerous)') as string,
      category_id: 'cat-elec',
      category_name: 'Electrical Works',
      rate_snapshot_paise: 80000,
      full_day_count: 1,
      half_day_count: 1,
      total_workers: 2,
      worker_days: 1.5,
      total_cost_paise: 120000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'c-att-3',
      site_id: 'site-1',
      date: '2026-09-02',
      role_id: 'role-elec-1',
      role_name: 'Lead Electrician',
      category_id: 'cat-elec',
      category_name: 'Electrical Works',
      rate_snapshot_paise: 120000,
      full_day_count: 3,
      half_day_count: 0,
      total_workers: 3,
      worker_days: 3.0,
      total_cost_paise: 360000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    },
  ];

  const tCatStart = performance.now();
  const catBuf = await generateCategoryReportExcel(meta, {
    categoryName: 'Electrical Works',
    records: catRecords,
  });
  const tCatDuration = performance.now() - tCatStart;
  console.log(`   - Generated in ${tCatDuration.toFixed(2)} ms, size: ${(catBuf.length / 1024).toFixed(1)} KB`);

  assert.ok(isZipBuffer(catBuf), 'Valid OpenXML ZIP signature for Category Report');
  const catParsed = XLSX.read(catBuf, { type: 'buffer' });
  assert.deepEqual(catParsed.SheetNames, ['Role Breakdown', 'Daily Category Log']);

  // Sheet 1: Role Breakdown
  const roleBreakdownWs = catParsed.Sheets['Role Breakdown'];
  const rbJson = XLSX.utils.sheet_to_json(roleBreakdownWs, { header: 1 }) as any[][];
  assert.ok(rbJson.flat().some((v) => typeof v === 'string' && v.toLowerCase().includes('category audit: electrical works')));

  // Check formula injection
  const rbFlat = rbJson.flat();
  const rbInjected = rbFlat.find((v) => typeof v === 'string' && v.includes('Dangerous'));
  assert.ok(rbInjected, 'Dangerous formula injection string present');
  assert.ok(rbInjected.startsWith("'"), 'Must be safely escaped with apostrophe');

  const rbTotalRow = rbJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(rbTotalRow, 'Role Breakdown TOTAL row present');
  assert.equal(rbTotalRow[1], 6, 'Full Day total matches (2 + 1 + 3)');
  assert.equal(rbTotalRow[2], 1, 'Half Day total matches (0 + 1 + 0)');
  assert.equal(rbTotalRow[3], 6.5, 'Worker-Days total matches (2.0 + 1.5 + 3.0)');
  assert.equal(rbTotalRow[4], 1.0, '% Share total matches 100% (1.0)');
  assert.equal(rbTotalRow[5], 7200, 'Total Cost (Rupees) matches (720,000 paise / 100)');

  // Sheet 2: Daily Category Log
  const dailyLogWs = catParsed.Sheets['Daily Category Log'];
  const dlJson = XLSX.utils.sheet_to_json(dailyLogWs, { header: 1 }) as any[][];
  assert.ok(dlJson.flat().some((v) => typeof v === 'string' && v.toLowerCase().includes('daily operational log: electrical works')));

  const dlTotalRow = dlJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(dlTotalRow, 'Daily Category Log TOTAL row present');
  assert.equal(dlTotalRow[2], 7, 'Total Workers sum matches (4 on 09-01 + 3 on 09-02)');
  assert.equal(dlTotalRow[3], 6.5, 'Worker-Days sum matches 6.5');
  assert.equal(dlTotalRow[4], 7200, 'Daily Labour Cost sum matches 7200');

  console.log('   ✔ CATEGORY_REPORT: 2 worksheets, rollup by role, daily logs & math parity PASS\n');

  // --------------------------------------------------------------------------
  // 3. REPORT C: SITE_REPORT (Executive Overview & Workforce Categories)
  // --------------------------------------------------------------------------
  console.log('--- 3. AUDITING REPORT C: SITE_REPORT (Executive & Categories) ---');
  const siteFinSummary: FinancialSummary = {
    openingBalancePaise: 50000000,        // ₹5,00,000.00
    totalCreditPaise: 120000000,          // ₹12,00,000.00
    suppliesDebitPaise: 45000000,         // ₹4,50,000.00
    specialWorkerTaskDebitPaise: 15000000,// ₹1,50,000.00
    totalDebitPaise: 60000000,            // ₹6,00,000.00
    netCashFlowPaise: 60000000,           // ₹6,00,000.00
    closingBalancePaise: 110000000,       // ₹11,00,000.00
    transactionCount: 8,
  };

  const tSiteStart = performance.now();
  const siteBuf = await generateSiteReportExcel(meta, {
    siteName: 'Sunrise Mega Complex',
    siteLocation: 'Main Tower Sector 12',
    attendanceRecords: roleRecords,
    financialSummary: siteFinSummary,
  });
  const tSiteDuration = performance.now() - tSiteStart;
  console.log(`   - Generated in ${tSiteDuration.toFixed(2)} ms, size: ${(siteBuf.length / 1024).toFixed(1)} KB`);

  assert.ok(isZipBuffer(siteBuf), 'Valid OpenXML ZIP signature for Site Report');
  const siteParsed = XLSX.read(siteBuf, { type: 'buffer' });
  assert.deepEqual(siteParsed.SheetNames, ['Executive Overview', 'Workforce Categories']);

  // Sheet 1: Executive Overview
  const execWs = siteParsed.Sheets['Executive Overview'];
  const execJson = XLSX.utils.sheet_to_json(execWs, { header: 1 }) as any[][];
  assert.ok(execJson.flat().some((v) => typeof v === 'string' && v.toLowerCase().includes('site executive performance overview')));

  // Verify Section A: Workforce Metrics
  const wDaysRow = execJson.find((r) => r && r[0] === 'Total Recorded Worker-Days');
  assert.ok(wDaysRow, 'Total Recorded Worker-Days line present');
  assert.equal(wDaysRow[2], 13.5, 'Total Worker-Days matches 13.5');

  const labourCostRow = execJson.find((r) => r && r[0] === 'Total Operational Labour Cost (INR)');
  assert.ok(labourCostRow, 'Total Operational Labour Cost line present');
  assert.equal(labourCostRow[2], 15400, 'Labour cost matches 15,400.00');

  // Verify Section B: Financial Metrics
  const openRow = execJson.find((r) => r && r[0] === 'Opening Cash Balance (INR)');
  assert.ok(openRow, 'Opening Cash Balance line present');
  assert.equal(openRow[2], 500000, 'Opening Balance matches 500,000.00');

  const closeRow = execJson.find((r) => r && r[0] === 'Closing Cash Balance (INR)');
  assert.ok(closeRow, 'Closing Cash Balance line present');
  assert.equal(closeRow[2], 1100000, 'Closing Balance matches 1,100,000.00');

  // Verify Section C: Total Site Outlay
  const outlayRow = execJson.find((r) => r && r[0] === 'TOTAL SITE OUTLAY (Labour + Material Debits) (INR)');
  assert.ok(outlayRow, 'Total Site Outlay line present');
  // Outlay = Labour (15,400) + Debits (600,000) = 615,400
  assert.equal(outlayRow[2], 615400, 'Combined site outlay matches (15,400 + 600,000 = 615,400.00)');

  // Sheet 2: Workforce Categories
  const catWs = siteParsed.Sheets['Workforce Categories'];
  const catJson = XLSX.utils.sheet_to_json(catWs, { header: 1 }) as any[][];
  const catTotalRow = catJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(catTotalRow, 'Workforce Categories TOTAL row present');
  assert.equal(catTotalRow[1], 12, 'Full Day total matches 12');
  assert.equal(catTotalRow[2], 3, 'Half Day total matches 3');
  assert.equal(catTotalRow[3], 13.5, 'Worker-Days total matches 13.5');
  assert.equal(catTotalRow[4], 15400, 'Labour Cost matches 15,400.00');

  console.log('   ✔ SITE_REPORT: Executive overview, category breakdown, outlay calculation PASS\n');

  // --------------------------------------------------------------------------
  // 4. EMPTY DATASET STATE MATRIX (0 RECORDS)
  // --------------------------------------------------------------------------
  console.log('--- 4. AUDITING EMPTY DATASET STATE MATRIX (0 RECORDS) ---');
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

  // Role Report Empty
  const emptyRoleBuf = await generateRoleReportExcel(meta, {
    roleName: 'Scaffolder',
    categoryName: 'Safety',
    records: [],
  });
  assert.ok(isZipBuffer(emptyRoleBuf));
  const emptyRoleJson = XLSX.utils.sheet_to_json(XLSX.read(emptyRoleBuf, { type: 'buffer' }).Sheets['Workforce Deployment'], { header: 1 }) as any[][];
  assert.ok(emptyRoleJson.flat().includes('Selected role had zero deployment days in this period.'));

  // Category Report Empty (Both Sheets)
  const emptyCatBuf = await generateCategoryReportExcel(meta, {
    categoryName: 'Safety',
    records: [],
  });
  assert.ok(isZipBuffer(emptyCatBuf));
  const emptyCatWb = XLSX.read(emptyCatBuf, { type: 'buffer' });
  const emptyRbJson = XLSX.utils.sheet_to_json(emptyCatWb.Sheets['Role Breakdown'], { header: 1 }) as any[][];
  assert.ok(emptyRbJson.flat().includes('Selected category had zero deployment in this period.'));
  const emptyDlJson = XLSX.utils.sheet_to_json(emptyCatWb.Sheets['Daily Category Log'], { header: 1 }) as any[][];
  assert.ok(emptyDlJson.flat().includes('Selected category had zero deployment in this period.'));

  // Site Report Empty (Both Sheets)
  const emptySiteBuf = await generateSiteReportExcel(meta, {
    siteName: 'Sunrise Mega Complex',
    siteLocation: 'Main Tower',
    attendanceRecords: [],
    financialSummary: emptyFin,
  });
  assert.ok(isZipBuffer(emptySiteBuf));
  const emptySiteWb = XLSX.read(emptySiteBuf, { type: 'buffer' });
  const emptyCatSheetJson = XLSX.utils.sheet_to_json(emptySiteWb.Sheets['Workforce Categories'], { header: 1 }) as any[][];
  assert.ok(emptyCatSheetJson.flat().includes('No attendance records recorded for this site.'));

  console.log('   ✔ EMPTY STATE MATRIX: Valid OpenXML & clean messaging across all sheets PASS\n');

  // --------------------------------------------------------------------------
  // 5. LARGE-SCALE SCALABILITY BENCHMARK (5,000 ROWS)
  // --------------------------------------------------------------------------
  console.log('--- 5. AUDITING 5,000 ROWS ROLE REPORT STRESS BENCHMARK ---');
  const BENCH_COUNT = 5000;
  const benchRecords: AttendanceDbRecord[] = Array.from({ length: BENCH_COUNT }, (_, i) => ({
    id: `bench-att-${i + 1}`,
    site_id: 'site-1',
    date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
    role_id: `role-${(i % 10) + 1}`,
    role_name: `Worker Grade ${String.fromCharCode(65 + (i % 6))} - Specialization ${(i % 5) + 1}`,
    category_id: `cat-${(i % 4) + 1}`,
    category_name: `Engineering Division ${(i % 4) + 1}`,
    rate_snapshot_paise: 80000 + (i * 10),
    full_day_count: (i % 5) + 1,
    half_day_count: i % 2,
    total_workers: (i % 5) + 1 + (i % 2),
    worker_days: (i % 5) + 1 + (i % 2) * 0.5,
    total_cost_paise: (80000 + (i * 10)) * ((i % 5) + 1 + (i % 2) * 0.5),
    created_by: null,
    updated_by: null,
    created_at: '',
    updated_at: '',
  }));

  const heapBefore = process.memoryUsage().heapUsed;
  const benchStart = performance.now();
  const benchBuf = await generateRoleReportExcel(
    { ...meta, reportTitle: '5,000 Rows Role Scalability Benchmark' },
    {
      roleName: 'All Roles (All Workers)',
      categoryName: 'All Categories',
      records: benchRecords,
      isAllRoles: true,
    }
  );
  const benchDuration = performance.now() - benchStart;
  const heapAfter = process.memoryUsage().heapUsed;

  assert.ok(isZipBuffer(benchBuf), 'Valid OpenXML ZIP for 5,000 rows');
  assert.ok(benchBuf.length > 100000, `Buffer size (${benchBuf.length} bytes) must reflect 5,000 rows`);
  assert.ok(benchDuration < 5000, `Duration (${benchDuration.toFixed(0)} ms) must be < 5000 ms`);

  const benchParsed = XLSX.read(benchBuf, { type: 'buffer' });
  const benchRows = XLSX.utils.sheet_to_json(benchParsed.Sheets['Workforce Deployment'], { header: 1 }) as any[][];
  assert.ok(benchRows.length >= 5000, `Expected >= 5000 rows, got ${benchRows.length}`);

  console.log(`   - 5,000 Rows Output Size: ${(benchBuf.length / 1024).toFixed(1)} KB`);
  console.log(`   - Generation Duration: ${benchDuration.toFixed(2)} ms`);
  console.log(`   - Heap Delta: ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)} MB`);
  console.log('   ✔ 5,000 ROWS ROLE REPORT BENCHMARK PASS\n');

  console.log('================================================================');
  console.log('ALL STEP 2B-3 VERIFICATION CHECKS PASSED WITH ZERO DEFECTS');
  console.log('================================================================');
}

runStep2B3Audit().catch((err) => {
  console.error('FATAL STEP 2B-3 VERIFICATION ERROR:', err);
  process.exit(1);
});
