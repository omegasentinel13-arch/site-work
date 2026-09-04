import { BaseExcelMetadata, MonthlyAttendanceExcelData } from '../types';
import {
  createExcelJsWorkbook,
  writeExcelJsWorkbookToBuffer,
  applyExcelJsTitleBanner,
  applyExcelJsMetadataBlock,
  applyExcelJsKpiStrip,
  applyExcelJsTableHeader,
  applyExcelJsDataRow,
  applyExcelJsGrandTotalRow,
  applyExcelJsEmptyState,
  configureExcelJsWorksheet,
} from '../shared';
import { EXCEL_FORMATS } from '../formatters';
import { escapeExcelFormula } from '../security';

export async function generateMonthlyAttendanceExcel(
  meta: BaseExcelMetadata,
  data: MonthlyAttendanceExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();

  const totalWorkerDaysAll = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaiseAll = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const totalFullAll = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalfAll = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkersAll = data.records.reduce((sum, r) => sum + r.total_workers, 0);

  const sharedSubtitle = `Site: ${meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName} | Month: ${meta.periodLabel}`;

  // --------------------------------------------------------------------------
  // SHEET 1: Category Rollup
  // --------------------------------------------------------------------------
  const wsCat = wb.addWorksheet('Category Rollup');
  const catCols = 6;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsCat, 'Monthly Attendance: Category Rollup', sharedSubtitle, catCols);

  // 2. Metadata Block
  const catMetaEnd = applyExcelJsMetadataBlock(wsCat, 3, meta, catCols);

  // Group records by category
  const catMap = new Map<
    string,
    { name: string; full: number; half: number; workerDays: number; costPaise: number }
  >();

  for (const r of data.records) {
    const cId = r.category_id || 'other';
    if (!catMap.has(cId)) {
      catMap.set(cId, { name: r.category_name || 'General', full: 0, half: 0, workerDays: 0, costPaise: 0 });
    }
    const c = catMap.get(cId)!;
    c.full += r.full_day_count;
    c.half += r.half_day_count;
    c.workerDays += r.worker_days;
    c.costPaise += r.total_cost_paise;
  }

  // 3. KPI Summary Strip
  const catKpiRow = catMetaEnd;
  applyExcelJsKpiStrip(
    wsCat,
    catKpiRow,
    [
      { label: 'Workforce Categories', value: catMap.size },
      { label: 'Total Worker-Days', value: totalWorkerDaysAll },
      {
        label: 'Total Labour Outlay',
        value: `₹${(totalCostPaiseAll / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    catCols
  );

  // 4. Table Headers
  const catHeaderRow = catKpiRow + 1;
  const catColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Category', width: 28, align: 'left' },
    { header: 'Full Day', width: 14, align: 'center' },
    { header: 'Half Day', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: '% Share of Days', width: 18, align: 'right' },
    { header: 'Total Wages (INR)', width: 22, align: 'right' },
  ];
  applyExcelJsTableHeader(wsCat, catHeaderRow, catColumns);

  const catDataStart = catHeaderRow + 1;
  let currentCatRow = catDataStart;

  const catAligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'center', 'right', 'right', 'right'];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(wsCat, currentCatRow, 'No workforce attendance recorded for this month.', catCols);
    currentCatRow++;

    const totalRow = wsCat.getRow(currentCatRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = 0;
    totalRow.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;
    totalRow.getCell(3).value = 0;
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
    totalRow.getCell(4).value = 0;
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
    totalRow.getCell(5).value = 0;
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.PERCENT;
    totalRow.getCell(6).value = 0;
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(totalRow, catAligns);
    currentCatRow++;
  } else {
    let catIdx = 0;
    for (const c of Array.from(catMap.values())) {
      const row = wsCat.getRow(currentCatRow);
      const share = totalWorkerDaysAll > 0 ? c.workerDays / totalWorkerDaysAll : 0;

      row.values = [
        escapeExcelFormula(c.name),
        c.full,
        c.half,
        c.workerDays,
        share,
        c.costPaise / 100,
      ];

      row.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(5).numFmt = EXCEL_FORMATS.PERCENT;
      row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, catIdx % 2 === 1, catAligns);
      currentCatRow++;
      catIdx++;
    }

    const catEndRow = currentCatRow - 1;
    const totalRow = wsCat.getRow(currentCatRow);
    totalRow.getCell(1).value = 'TOTAL';

    totalRow.getCell(2).value = {
      formula: `SUM(B${catDataStart}:B${catEndRow})`,
      result: totalFullAll,
    };
    totalRow.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(3).value = {
      formula: `SUM(C${catDataStart}:C${catEndRow})`,
      result: totalHalfAll,
    };
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(4).value = {
      formula: `SUM(D${catDataStart}:D${catEndRow})`,
      result: totalWorkerDaysAll,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(5).value = 1.0;
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.PERCENT;

    totalRow.getCell(6).value = {
      formula: `SUM(F${catDataStart}:F${catEndRow})`,
      result: totalCostPaiseAll / 100,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, catAligns);
  }

  configureExcelJsWorksheet(wsCat, {
    orientation: 'portrait',
    freezeRow: catHeaderRow,
    autoFilterRange: data.records.length > 0 ? `A${catHeaderRow}:F${currentCatRow - 1}` : undefined,
    repeatHeaderRow: catHeaderRow,
    reportTitle: 'Monthly Category Rollup',
  });

  // --------------------------------------------------------------------------
  // SHEET 2: Daily Progression
  // --------------------------------------------------------------------------
  const wsProg = wb.addWorksheet('Daily Progression');
  const progCols = 7;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsProg, 'Monthly Attendance: Daily Progression', sharedSubtitle, progCols);

  // 2. Metadata Block
  const progMetaEnd = applyExcelJsMetadataBlock(wsProg, 3, meta, progCols);

  // 3. Table Headers
  const progHeaderRow = progMetaEnd;
  const progColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Day', width: 12, align: 'center' },
    { header: 'Full Day', width: 14, align: 'center' },
    { header: 'Half Day', width: 14, align: 'center' },
    { header: 'Total Workers', width: 16, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: 'Daily Wages (INR)', width: 22, align: 'right' },
  ];
  applyExcelJsTableHeader(wsProg, progHeaderRow, progColumns);

  const progDataStart = progHeaderRow + 1;
  let currentProgRow = progDataStart;

  const progAligns: Array<'left' | 'center' | 'right'> = [
    'center',
    'center',
    'center',
    'center',
    'center',
    'right',
    'right',
  ];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(wsProg, currentProgRow, 'No workforce attendance recorded for this month.', progCols);
    currentProgRow++;
  } else {
    const dayMap = new Map<
      string,
      { full: number; half: number; workers: number; workerDays: number; costPaise: number }
    >();

    for (const r of data.records) {
      if (!dayMap.has(r.date)) {
        dayMap.set(r.date, { full: 0, half: 0, workers: 0, workerDays: 0, costPaise: 0 });
      }
      const d = dayMap.get(r.date)!;
      d.full += r.full_day_count;
      d.half += r.half_day_count;
      d.workers += r.total_workers;
      d.workerDays += r.worker_days;
      d.costPaise += r.total_cost_paise;
    }

    const sortedDates = Array.from(dayMap.keys()).sort();
    let progIdx = 0;
    for (const dt of sortedDates) {
      const dObj = new Date(dt);
      const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
      const stats = dayMap.get(dt)!;

      const row = wsProg.getRow(currentProgRow);
      row.values = [
        dt,
        dayName,
        stats.full,
        stats.half,
        stats.workers,
        stats.workerDays,
        stats.costPaise / 100,
      ];

      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, progIdx % 2 === 1, progAligns);
      currentProgRow++;
      progIdx++;
    }

    const progEndRow = currentProgRow - 1;
    const totalRow = wsProg.getRow(currentProgRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';

    totalRow.getCell(3).value = {
      formula: `SUM(C${progDataStart}:C${progEndRow})`,
      result: totalFullAll,
    };
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(4).value = {
      formula: `SUM(D${progDataStart}:D${progEndRow})`,
      result: totalHalfAll,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(5).value = {
      formula: `SUM(E${progDataStart}:E${progEndRow})`,
      result: totalWorkersAll,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(6).value = {
      formula: `SUM(F${progDataStart}:F${progEndRow})`,
      result: totalWorkerDaysAll,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(7).value = {
      formula: `SUM(G${progDataStart}:G${progEndRow})`,
      result: totalCostPaiseAll / 100,
    };
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, progAligns);
  }

  configureExcelJsWorksheet(wsProg, {
    orientation: 'portrait',
    freezeRow: progHeaderRow,
    autoFilterRange: data.records.length > 0 ? `A${progHeaderRow}:G${currentProgRow - 1}` : undefined,
    repeatHeaderRow: progHeaderRow,
    reportTitle: 'Daily Attendance Progression',
  });

  // --------------------------------------------------------------------------
  // SHEET 3: Raw Workforce Log
  // --------------------------------------------------------------------------
  const wsRaw = wb.addWorksheet('Raw Workforce Log');
  const rawCols = 9;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsRaw, 'Monthly Attendance: Raw Workforce Log', sharedSubtitle, rawCols);

  // 2. Metadata Block
  const rawMetaEnd = applyExcelJsMetadataBlock(wsRaw, 3, meta, rawCols);

  // 3. Table Headers
  const rawHeaderRow = rawMetaEnd;
  const rawColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Category', width: 24, align: 'left' },
    { header: 'Role', width: 28, align: 'left' },
    { header: 'Rate (INR)', width: 18, align: 'right' },
    { header: 'Full Day', width: 12, align: 'center' },
    { header: 'Half Day', width: 12, align: 'center' },
    { header: 'Total Workers', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 14, align: 'right' },
    { header: 'Total Cost (INR)', width: 20, align: 'right' },
  ];
  applyExcelJsTableHeader(wsRaw, rawHeaderRow, rawColumns);

  const rawDataStart = rawHeaderRow + 1;
  let currentRawRow = rawDataStart;

  const rawAligns: Array<'left' | 'center' | 'right'> = [
    'center',
    'left',
    'left',
    'right',
    'center',
    'center',
    'center',
    'right',
    'right',
  ];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(wsRaw, currentRawRow, 'No attendance records recorded for this month.', rawCols);
    currentRawRow++;
  } else {
    let rawIdx = 0;
    for (const r of data.records) {
      const row = wsRaw.getRow(currentRawRow);
      row.values = [
        r.date,
        escapeExcelFormula(r.category_name || ''),
        escapeExcelFormula(r.role_name || ''),
        r.rate_snapshot_paise / 100,
        r.full_day_count,
        r.half_day_count,
        r.total_workers,
        r.worker_days,
        r.total_cost_paise / 100,
      ];

      row.getCell(4).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, rawIdx % 2 === 1, rawAligns);
      currentRawRow++;
      rawIdx++;
    }

    const rawEndRow = currentRawRow - 1;
    const totalRow = wsRaw.getRow(currentRawRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = '';

    totalRow.getCell(5).value = {
      formula: `SUM(E${rawDataStart}:E${rawEndRow})`,
      result: totalFullAll,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(6).value = {
      formula: `SUM(F${rawDataStart}:F${rawEndRow})`,
      result: totalHalfAll,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(7).value = {
      formula: `SUM(G${rawDataStart}:G${rawEndRow})`,
      result: totalWorkersAll,
    };
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(8).value = {
      formula: `SUM(H${rawDataStart}:H${rawEndRow})`,
      result: totalWorkerDaysAll,
    };
    totalRow.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(9).value = {
      formula: `SUM(I${rawDataStart}:I${rawEndRow})`,
      result: totalCostPaiseAll / 100,
    };
    totalRow.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, rawAligns);
  }

  configureExcelJsWorksheet(wsRaw, {
    orientation: 'landscape',
    freezeRow: rawHeaderRow,
    autoFilterRange: data.records.length > 0 ? `A${rawHeaderRow}:I${currentRawRow - 1}` : undefined,
    repeatHeaderRow: rawHeaderRow,
    reportTitle: 'Raw Workforce Log',
  });

  return await writeExcelJsWorkbookToBuffer(wb);
}
