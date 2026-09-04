import { BaseExcelMetadata, WeeklyAttendanceExcelData } from '../types';
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
  getColumnLetter,
} from '../shared';
import { EXCEL_FORMATS } from '../formatters';
import { escapeExcelFormula } from '../security';

export async function generateWeeklyAttendanceExcel(
  meta: BaseExcelMetadata,
  data: WeeklyAttendanceExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();

  // Generate 7-day date list
  const start = new Date(data.startDate);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  // --------------------------------------------------------------------------
  // SHEET 1: Weekly Matrix
  // --------------------------------------------------------------------------
  const wsMatrix = wb.addWorksheet('Weekly Matrix');
  const matrixCols = 12; // Category, Role, Rate, 7 Days, Total Days, Total Wages

  // 1. Corporate Title Banner
  const matrixSubtitle = `Site: ${meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName} | Period: ${meta.periodLabel}`;
  applyExcelJsTitleBanner(wsMatrix, meta.reportTitle || 'Weekly Attendance Matrix', matrixSubtitle, matrixCols);

  // 2. Metadata Block
  const matrixMetaEnd = applyExcelJsMetadataBlock(wsMatrix, 3, meta, matrixCols);

  // Group records by role_id
  const roleMap = new Map<
    string,
    {
      roleName: string;
      categoryName: string;
      ratePaise: number;
      dayWorkerDays: { [dateStr: string]: number };
      totalWorkerDays: number;
      totalCostPaise: number;
    }
  >();

  for (const r of data.records) {
    if (!roleMap.has(r.role_id)) {
      roleMap.set(r.role_id, {
        roleName: r.role_name || 'Role',
        categoryName: r.category_name || 'General',
        ratePaise: r.rate_snapshot_paise,
        dayWorkerDays: {},
        totalWorkerDays: 0,
        totalCostPaise: 0,
      });
    }
    const item = roleMap.get(r.role_id)!;
    item.dayWorkerDays[r.date] = (item.dayWorkerDays[r.date] || 0) + r.worker_days;
    item.totalWorkerDays += r.worker_days;
    item.totalCostPaise += r.total_cost_paise;
  }

  let grandWorkerDays = 0;
  let grandCostPaise = 0;
  const dayTotals: { [dateStr: string]: number } = {};

  for (const r of Array.from(roleMap.values())) {
    grandWorkerDays += r.totalWorkerDays;
    grandCostPaise += r.totalCostPaise;
    for (const dt of dates) {
      const val = r.dayWorkerDays[dt] || 0;
      dayTotals[dt] = (dayTotals[dt] || 0) + val;
    }
  }

  // 3. KPI Summary Strip
  const matrixKpiRow = matrixMetaEnd;
  applyExcelJsKpiStrip(
    wsMatrix,
    matrixKpiRow,
    [
      { label: 'Roles Deployed', value: roleMap.size },
      { label: 'Weekly Worker-Days', value: grandWorkerDays },
      {
        label: 'Total Wage Outlay',
        value: `₹${(grandCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    matrixCols
  );

  // 4. Matrix Headers
  const matrixHeaderRow = matrixKpiRow + 1;
  const dayHeaders = dates.map((dt) => {
    const dObj = new Date(dt);
    const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
    return { header: `${dayName} (${dt.slice(5)})`, width: 14, align: 'center' as const };
  });

  const matrixColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Category', width: 24, align: 'left' },
    { header: 'Role', width: 28, align: 'left' },
    { header: 'Daily Rate (INR)', width: 18, align: 'right' },
    ...dayHeaders,
    { header: 'Total Worker-Days', width: 18, align: 'right' },
    { header: 'Total Wages (INR)', width: 20, align: 'right' },
  ];
  applyExcelJsTableHeader(wsMatrix, matrixHeaderRow, matrixColumns);

  const matrixDataStart = matrixHeaderRow + 1;
  let currentMatrixRow = matrixDataStart;

  const matrixAligns: Array<'left' | 'center' | 'right'> = [
    'left',
    'left',
    'right',
    'center',
    'center',
    'center',
    'center',
    'center',
    'center',
    'center',
    'right',
    'right',
  ];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(wsMatrix, currentMatrixRow, 'No attendance records recorded for this week.', matrixCols);
    currentMatrixRow++;

    const totalRow = wsMatrix.getRow(currentMatrixRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    for (let i = 0; i < 7; i++) {
      totalRow.getCell(4 + i).value = 0;
      totalRow.getCell(4 + i).numFmt = EXCEL_FORMATS.DECIMAL;
    }
    totalRow.getCell(11).value = 0;
    totalRow.getCell(11).numFmt = EXCEL_FORMATS.DECIMAL;
    totalRow.getCell(12).value = 0;
    totalRow.getCell(12).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(totalRow, matrixAligns);
    currentMatrixRow++;
  } else {
    let rIdx = 0;
    for (const r of Array.from(roleMap.values())) {
      const row = wsMatrix.getRow(currentMatrixRow);
      const dayCells = dates.map((dt) => r.dayWorkerDays[dt] || 0);

      row.values = [
        escapeExcelFormula(r.categoryName),
        escapeExcelFormula(r.roleName),
        r.ratePaise / 100,
        ...dayCells,
        r.totalWorkerDays,
        r.totalCostPaise / 100,
      ];

      row.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
      for (let i = 0; i < 7; i++) {
        row.getCell(4 + i).numFmt = EXCEL_FORMATS.DECIMAL;
      }
      row.getCell(11).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(12).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, rIdx % 2 === 1, matrixAligns);
      currentMatrixRow++;
      rIdx++;
    }

    const matrixEndRow = currentMatrixRow - 1;
    const totalRow = wsMatrix.getRow(currentMatrixRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';

    for (let idx = 0; idx < dates.length; idx++) {
      const colLetter = getColumnLetter(4 + idx);
      totalRow.getCell(4 + idx).value = {
        formula: `SUM(${colLetter}${matrixDataStart}:${colLetter}${matrixEndRow})`,
        result: dayTotals[dates[idx]] || 0,
      };
      totalRow.getCell(4 + idx).numFmt = EXCEL_FORMATS.DECIMAL;
    }

    totalRow.getCell(11).value = {
      formula: `SUM(K${matrixDataStart}:K${matrixEndRow})`,
      result: grandWorkerDays,
    };
    totalRow.getCell(11).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(12).value = {
      formula: `SUM(L${matrixDataStart}:L${matrixEndRow})`,
      result: grandCostPaise / 100,
    };
    totalRow.getCell(12).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, matrixAligns);
  }

  configureExcelJsWorksheet(wsMatrix, {
    orientation: 'landscape',
    freezeRow: matrixHeaderRow,
    freezeCol: 2,
    autoFilterRange: data.records.length > 0 ? `A${matrixHeaderRow}:L${currentMatrixRow - 1}` : undefined,
    repeatHeaderRow: matrixHeaderRow,
    reportTitle: meta.reportTitle || 'Weekly Attendance Matrix',
  });

  // --------------------------------------------------------------------------
  // SHEET 2: Daily Records
  // --------------------------------------------------------------------------
  const wsRecords = wb.addWorksheet('Daily Records');
  const recordCols = 9;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsRecords, 'Weekly Attendance: Daily Records', matrixSubtitle, recordCols);

  // 2. Metadata Block
  const recordsMetaEnd = applyExcelJsMetadataBlock(wsRecords, 3, meta, recordCols);

  // 3. Table Headers
  const recordsHeaderRow = recordsMetaEnd;
  const recordColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
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
  applyExcelJsTableHeader(wsRecords, recordsHeaderRow, recordColumns);

  const recordsDataStart = recordsHeaderRow + 1;
  let currentRecordRow = recordsDataStart;

  const recordAligns: Array<'left' | 'center' | 'right'> = [
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
    applyExcelJsEmptyState(wsRecords, currentRecordRow, 'No attendance records recorded for this week.', recordCols);
    currentRecordRow++;
  } else {
    let recIdx = 0;
    let totalFull = 0;
    let totalHalf = 0;
    let totalWorkersAll = 0;
    let totalWorkerDaysAll = 0;
    let totalCostPaiseAll = 0;

    for (const r of data.records) {
      const row = wsRecords.getRow(currentRecordRow);
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

      totalFull += r.full_day_count;
      totalHalf += r.half_day_count;
      totalWorkersAll += r.total_workers;
      totalWorkerDaysAll += r.worker_days;
      totalCostPaiseAll += r.total_cost_paise;

      applyExcelJsDataRow(row, recIdx % 2 === 1, recordAligns);
      currentRecordRow++;
      recIdx++;
    }

    const recordsEndRow = currentRecordRow - 1;
    const totalRow = wsRecords.getRow(currentRecordRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = '';

    totalRow.getCell(5).value = {
      formula: `SUM(E${recordsDataStart}:E${recordsEndRow})`,
      result: totalFull,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(6).value = {
      formula: `SUM(F${recordsDataStart}:F${recordsEndRow})`,
      result: totalHalf,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(7).value = {
      formula: `SUM(G${recordsDataStart}:G${recordsEndRow})`,
      result: totalWorkersAll,
    };
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(8).value = {
      formula: `SUM(H${recordsDataStart}:H${recordsEndRow})`,
      result: totalWorkerDaysAll,
    };
    totalRow.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(9).value = {
      formula: `SUM(I${recordsDataStart}:I${recordsEndRow})`,
      result: totalCostPaiseAll / 100,
    };
    totalRow.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, recordAligns);
  }

  configureExcelJsWorksheet(wsRecords, {
    orientation: 'landscape',
    freezeRow: recordsHeaderRow,
    autoFilterRange: data.records.length > 0 ? `A${recordsHeaderRow}:I${currentRecordRow - 1}` : undefined,
    repeatHeaderRow: recordsHeaderRow,
    reportTitle: 'Daily Attendance Records',
  });

  return await writeExcelJsWorkbookToBuffer(wb);
}
