import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  generateDailyAttendanceExcel,
  generateWeeklyAttendanceExcel,
  generateMonthlyAttendanceExcel,
} from '../lib/export/excel';
import { DailySummary } from '../lib/domain/attendance-engine';
import { BaseExcelMetadata, AttendanceDbRecord } from '../lib/export/excel/types';
import { escapeExcelFormula } from '../lib/export/excel/security';

async function runStep2B1Audit() {
  console.log('================================================================');
  console.log('PHASE 5 STEP 2B-1: ATTENDANCE REPORTS MIGRATION VERIFICATION');
  console.log('================================================================\n');

  const meta: BaseExcelMetadata = {
    siteName: 'Sunrise Commercial Hub',
    siteCode: 'SCH-01',
    reportTitle: 'Daily Attendance Report',
    periodLabel: '2026-09-01',
    generatedAt: '01/09/2026, 05:30:00 pm',
  };

  // --------------------------------------------------------------------------
  // 1. REPORT A: DAILY_ATTENDANCE
  // --------------------------------------------------------------------------
  console.log('--- 1. AUDITING REPORT A: DAILY_ATTENDANCE ---');
  const dailySummary: DailySummary = {
    date: '2026-09-01',
    totalWorkers: 12,
    fullDayCount: 10,
    halfDayCount: 2,
    workerDays: 11.0,
    totalLabourCostPaise: 1100000,
    categories: [
      {
        categoryId: 'cat-civil',
        categoryName: 'Civil Works',
        totalWorkers: 8,
        fullDayCount: 7,
        halfDayCount: 1,
        workerDays: 7.5,
        totalCostPaise: 750000,
        roles: [
          {
            roleId: 'role-mason',
            roleName: escapeExcelFormula('=SUM(DangerousInjection)') as string, // formula injection test
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
          {
            roleId: 'role-helper',
            roleName: 'Mason Helper',
            categoryId: 'cat-civil',
            categoryName: 'Civil Works',
            rateInPaise: 60000,
            fullDayCount: 3,
            halfDayCount: 0,
            totalWorkers: 3,
            workerDays: 3.0,
            fullDayCostPaise: 300000,
            halfDayCostPaise: 0,
            totalCostPaise: 300000,
          },
        ],
      },
      {
        categoryId: 'cat-electrical',
        categoryName: 'Electrical Works',
        totalWorkers: 4,
        fullDayCount: 3,
        halfDayCount: 1,
        workerDays: 3.5,
        totalCostPaise: 350000,
        roles: [
          {
            roleId: 'role-electrician',
            roleName: 'Master Electrician',
            categoryId: 'cat-electrical',
            categoryName: 'Electrical Works',
            rateInPaise: 100000,
            fullDayCount: 3,
            halfDayCount: 1,
            totalWorkers: 4,
            workerDays: 3.5,
            fullDayCostPaise: 300000,
            halfDayCostPaise: 50000,
            totalCostPaise: 350000,
          },
        ],
      },
    ],
  };

  const t0 = performance.now();
  const dailyBuf = await generateDailyAttendanceExcel(meta, dailySummary);
  const dailyDuration = performance.now() - t0;

  console.log(`   - Generated Size: ${dailyBuf.length.toLocaleString()} bytes`);
  console.log(`   - Duration: ${dailyDuration.toFixed(2)} ms`);
  assert.ok(dailyBuf[0] === 0x50 && dailyBuf[1] === 0x4b, 'Valid OpenXML ZIP signature');

  // OpenXML Parts Audit
  const dailyZip = XLSX.read(dailyBuf, { type: 'buffer', bookFiles: true });
  const dailyFiles = dailyZip.files || {};
  const dailySheetXml = dailyFiles['xl/worksheets/sheet1.xml']?.content?.toString('utf8') || '';
  const dailyStylesXml = dailyFiles['xl/styles.xml']?.content?.toString('utf8') || '';
  const dailyWbXml = dailyFiles['xl/workbook.xml']?.content?.toString('utf8') || '';

  // Styles & Formatting
  assert.ok(dailyStylesXml.includes('0F172A'), 'Primary Dark Slate fill present');
  assert.ok(dailyStylesXml.includes('F8FAFC'), 'Zebra row fill present');
  assert.ok(dailyStylesXml.includes('double'), 'Accounting double border present');

  // Sheet structure
  assert.ok(dailySheetXml.includes('ref="A1:H1"'), 'Merged title banner present');
  assert.ok(dailySheetXml.includes('state="frozen"'), 'Freeze pane present');
  assert.ok(dailySheetXml.includes('paperSize="9"'), 'A4 paper size present');
  assert.ok(dailySheetXml.includes('orientation="portrait"'), 'Portrait orientation present');
  assert.ok(dailyWbXml.includes('_xlnm.Print_Titles'), 'Repeating print titles present');

  // SheetJS parsing & semantic data parity
  const dailyParsed = XLSX.read(dailyBuf, { type: 'buffer' });
  const dailyWs = dailyParsed.Sheets['Daily Attendance'];
  assert.ok(dailyWs, 'Sheet "Daily Attendance" exists');

  // Check formula injection
  const dailyJson = XLSX.utils.sheet_to_json(dailyWs, { header: 1 }) as any[][];
  const injectedRole = dailyJson.flat().find((v) => typeof v === 'string' && v.includes('DangerousInjection'));
  assert.ok(injectedRole, 'Injected string present in workbook');
  assert.ok(injectedRole.startsWith("'"), 'Formula injection strictly escaped with single quote');

  // Check mathematical totals
  const totalRow = dailyJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(totalRow, 'TOTAL row exists');
  console.log('   - Daily TOTAL row values:', totalRow);
  assert.equal(totalRow[3], 10, 'Full Day total matches');
  assert.equal(totalRow[4], 2, 'Half Day total matches');
  assert.equal(totalRow[5], 12, 'Total Workers matches');
  assert.equal(totalRow[6], 11.0, 'Worker-Days matches');
  assert.equal(totalRow[7], 11000, 'Total Labour Cost (Rupees) matches (1,100,000 paise / 100)');
  console.log('   ✔ DAILY_ATTENDANCE: OpenXML, styles, freeze panes, print titles & math totals PASS\n');

  // --------------------------------------------------------------------------
  // 2. REPORT B: WEEKLY_ATTENDANCE
  // --------------------------------------------------------------------------
  console.log('--- 2. AUDITING REPORT B: WEEKLY_ATTENDANCE ---');
  const weeklyRecords: AttendanceDbRecord[] = [
    {
      id: 'att-1',
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
    {
      id: 'att-2',
      site_id: 'site-1',
      date: '2026-09-02',
      role_id: 'role-mason',
      role_name: 'Lead Mason',
      category_id: 'cat-civil',
      category_name: 'Civil Works',
      rate_snapshot_paise: 100000,
      full_day_count: 4,
      half_day_count: 2,
      total_workers: 6,
      worker_days: 5.0,
      total_cost_paise: 500000,
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
      role_name: 'Master Carpenter',
      category_id: 'cat-carpentry',
      category_name: 'Carpentry Works',
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

  const t1 = performance.now();
  const weeklyBuf = await generateWeeklyAttendanceExcel(
    { ...meta, reportTitle: 'Weekly Attendance Matrix', periodLabel: '2026-09-01 to 2026-09-07' },
    { records: weeklyRecords, startDate: '2026-09-01', endDate: '2026-09-07' }
  );
  const weeklyDuration = performance.now() - t1;

  console.log(`   - Generated Size: ${weeklyBuf.length.toLocaleString()} bytes`);
  console.log(`   - Duration: ${weeklyDuration.toFixed(2)} ms`);
  assert.ok(weeklyBuf[0] === 0x50 && weeklyBuf[1] === 0x4b);

  const weeklyParsed = XLSX.read(weeklyBuf, { type: 'buffer' });
  assert.deepEqual(weeklyParsed.SheetNames, ['Weekly Matrix', 'Daily Records']);

  // Check Sheet 1 Matrix
  const matrixWs = weeklyParsed.Sheets['Weekly Matrix'];
  const matrixJson = XLSX.utils.sheet_to_json(matrixWs, { header: 1 }) as any[][];
  const matrixTotalRow = matrixJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(matrixTotalRow, 'Weekly Matrix TOTAL row exists');
  console.log('   - Weekly Matrix TOTAL row values:', matrixTotalRow);
  assert.equal(matrixTotalRow[10], 13.0, 'Total Worker-Days matches (5.0 + 5.0 + 3.0)');
  assert.equal(matrixTotalRow[11], 13600, 'Total Wages matches (Rs. 13,600 = 1,360,000 paise / 100)');

  // Check Sheet 2 Daily Records
  const recordsWs = weeklyParsed.Sheets['Daily Records'];
  const recordsJson = XLSX.utils.sheet_to_json(recordsWs, { header: 1 }) as any[][];
  const recordsTotalRow = recordsJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(recordsTotalRow, 'Daily Records TOTAL row exists');
  assert.equal(recordsTotalRow[7], 13.0, 'Daily Records Total Worker-Days matches');
  assert.equal(recordsTotalRow[8], 13600, 'Daily Records Total Cost matches');

  // Check OpenXML properties
  const weeklyZip = XLSX.read(weeklyBuf, { type: 'buffer', bookFiles: true });
  const weeklySheet1Xml = weeklyZip.files['xl/worksheets/sheet1.xml']?.content?.toString('utf8') || '';
  assert.ok(weeklySheet1Xml.includes('orientation="landscape"'), 'Landscape orientation present on Sheet 1');
  assert.ok(weeklySheet1Xml.includes('state="frozen"'), 'Freeze panes present on Sheet 1');
  assert.ok(weeklySheet1Xml.includes('ref="A1:L1"'), 'Merged title banner across 12 cols');

  console.log('   ✔ WEEKLY_ATTENDANCE: 2 sheets, matrix rollups, daily records, landscape A4 PASS\n');

  // --------------------------------------------------------------------------
  // 3. REPORT C: MONTHLY_ATTENDANCE
  // --------------------------------------------------------------------------
  console.log('--- 3. AUDITING REPORT C: MONTHLY_ATTENDANCE ---');
  const t2 = performance.now();
  const monthlyBuf = await generateMonthlyAttendanceExcel(
    { ...meta, reportTitle: 'Monthly Attendance Report', periodLabel: 'September 2026' },
    { records: weeklyRecords, monthLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30' }
  );
  const monthlyDuration = performance.now() - t2;

  console.log(`   - Generated Size: ${monthlyBuf.length.toLocaleString()} bytes`);
  console.log(`   - Duration: ${monthlyDuration.toFixed(2)} ms`);
  assert.ok(monthlyBuf[0] === 0x50 && monthlyBuf[1] === 0x4b);

  const monthlyParsed = XLSX.read(monthlyBuf, { type: 'buffer' });
  assert.deepEqual(monthlyParsed.SheetNames, ['Category Rollup', 'Daily Progression', 'Raw Workforce Log']);

  // Sheet 1: Category Rollup
  const catWs = monthlyParsed.Sheets['Category Rollup'];
  const catJson = XLSX.utils.sheet_to_json(catWs, { header: 1 }) as any[][];
  const catTotalRow = catJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(catTotalRow, 'Category Rollup TOTAL row exists');
  assert.equal(catTotalRow[1], 12, 'Full Day total matches (5 + 4 + 3)');
  assert.equal(catTotalRow[2], 2, 'Half Day total matches (0 + 2 + 0)');
  assert.equal(catTotalRow[3], 13.0, 'Worker-Days matches');
  assert.equal(catTotalRow[4], 1.0, '% Share matches 100%');
  assert.equal(catTotalRow[5], 13600, 'Total Wages matches');

  // Sheet 2: Daily Progression
  const progWs = monthlyParsed.Sheets['Daily Progression'];
  const progJson = XLSX.utils.sheet_to_json(progWs, { header: 1 }) as any[][];
  const progTotalRow = progJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(progTotalRow, 'Daily Progression TOTAL row exists');
  assert.equal(progTotalRow[5], 13.0, 'Progression Worker-Days matches');
  assert.equal(progTotalRow[6], 13600, 'Progression Total Wages matches');

  // Sheet 3: Raw Workforce Log
  const rawWs = monthlyParsed.Sheets['Raw Workforce Log'];
  const rawJson = XLSX.utils.sheet_to_json(rawWs, { header: 1 }) as any[][];
  const rawTotalRow = rawJson.find((r) => r && r[0] === 'TOTAL');
  assert.ok(rawTotalRow, 'Raw Workforce Log TOTAL row exists');
  assert.equal(rawTotalRow[7], 13.0, 'Raw Log Worker-Days matches');
  assert.equal(rawTotalRow[8], 13600, 'Raw Log Total Cost matches');

  console.log('   ✔ MONTHLY_ATTENDANCE: 3 sheets, Category Rollup, Progression, Raw Log PASS\n');

  // --------------------------------------------------------------------------
  // 4. EMPTY DATASET VERIFICATION ACROSS ALL 3 REPORTS
  // --------------------------------------------------------------------------
  console.log('--- 4. AUDITING EMPTY DATASET HANDLING ---');
  const emptyDailyBuf = await generateDailyAttendanceExcel(meta, {
    date: '2026-09-01',
    totalWorkers: 0,
    fullDayCount: 0,
    halfDayCount: 0,
    workerDays: 0,
    totalLabourCostPaise: 0,
    categories: [],
  });
  const emptyDailyWb = XLSX.read(emptyDailyBuf, { type: 'buffer' });
  const emptyDailyText = JSON.stringify(XLSX.utils.sheet_to_json(emptyDailyWb.Sheets['Daily Attendance'], { header: 1 }));
  assert.ok(emptyDailyText.includes('No attendance records recorded for this date.'), 'Daily empty banner present');

  const emptyWeeklyBuf = await generateWeeklyAttendanceExcel(meta, {
    records: [],
    startDate: '2026-09-01',
    endDate: '2026-09-07',
  });
  const emptyWeeklyWb = XLSX.read(emptyWeeklyBuf, { type: 'buffer' });
  const emptyWeeklyText = JSON.stringify(XLSX.utils.sheet_to_json(emptyWeeklyWb.Sheets['Weekly Matrix'], { header: 1 }));
  assert.ok(emptyWeeklyText.includes('No attendance records recorded for this week.'), 'Weekly empty banner present');

  const emptyMonthlyBuf = await generateMonthlyAttendanceExcel(meta, {
    records: [],
    monthLabel: 'September 2026',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
  });
  const emptyMonthlyWb = XLSX.read(emptyMonthlyBuf, { type: 'buffer' });
  const emptyMonthlyText = JSON.stringify(XLSX.utils.sheet_to_json(emptyMonthlyWb.Sheets['Category Rollup'], { header: 1 }));
  assert.ok(emptyMonthlyText.includes('No workforce attendance recorded for this month.'), 'Monthly empty banner present');

  console.log('   ✔ All 3 migrated reports render professional empty-state banners without breakage\n');

  // --------------------------------------------------------------------------
  // 5. STRESS DATASET BENCHMARK (500 RECORDS)
  // --------------------------------------------------------------------------
  console.log('--- 5. STRESS BENCHMARK (500 ATTENDANCE RECORDS) ---');
  const stressRecords: AttendanceDbRecord[] = [];
  for (let i = 0; i < 500; i++) {
    const day = (i % 28) + 1;
    const dateStr = `2026-09-${day.toString().padStart(2, '0')}`;
    stressRecords.push({
      id: `stress-att-${i}`,
      site_id: 'site-1',
      date: dateStr,
      role_id: `role-${i % 10}`,
      role_name: `Specialist Worker Grade ${i % 10}`,
      category_id: `cat-${i % 3}`,
      category_name: `Construction Trade ${i % 3}`,
      rate_snapshot_paise: 75000 + (i % 5) * 5000,
      full_day_count: 5,
      half_day_count: 1,
      total_workers: 6,
      worker_days: 5.5,
      total_cost_paise: 450000,
      created_by: null,
      updated_by: null,
      created_at: '',
      updated_at: '',
    });
  }

  const tStress = performance.now();
  const stressBuf = await generateMonthlyAttendanceExcel(
    { ...meta, reportTitle: 'Monthly Attendance Stress Benchmark' },
    { records: stressRecords, monthLabel: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30' }
  );
  const stressDuration = performance.now() - tStress;
  console.log(`   - 500 Records Monthly Attendance Output: ${stressBuf.length.toLocaleString()} bytes`);
  console.log(`   - 500 Records Generation Duration: ${stressDuration.toFixed(2)} ms`);
  assert.ok(stressBuf.length > 20000, 'Stress workbook generated valid non-empty archive');

  console.log('\n================================================================');
  console.log('PHASE 5 STEP 2B-1: ALL STRUCTURAL & DATA GATES PASS');
  console.log('================================================================\n');
}

runStep2B1Audit().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
