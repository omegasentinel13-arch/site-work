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

export async function generateMonthlyAttendanceCalendarExcel(
  meta: BaseExcelMetadata,
  data: MonthlyAttendanceExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();

  const totalWorkerDaysAll = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaiseAll = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const totalFullAll = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalfAll = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkersAll = data.records.reduce((sum, r) => sum + r.total_workers, 0);

  // Group attendance by date
  const dailyMap = new Map<
    string,
    {
      workers: number;
      full: number;
      half: number;
      workerDays: number;
      costPaise: number;
    }
  >();

  for (const r of data.records) {
    if (!dailyMap.has(r.date)) {
      dailyMap.set(r.date, { workers: 0, full: 0, half: 0, workerDays: 0, costPaise: 0 });
    }
    const d = dailyMap.get(r.date)!;
    d.workers += r.total_workers;
    d.full += r.full_day_count;
    d.half += r.half_day_count;
    d.workerDays += r.worker_days;
    d.costPaise += r.total_cost_paise;
  }

  const activeDaysCount = dailyMap.size;
  const avgHeadcount = activeDaysCount > 0 ? (totalWorkerDaysAll / activeDaysCount).toFixed(1) : '0';
  const sharedSubtitle = `Site: ${meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName} | Month: ${data.monthLabel || meta.periodLabel}`;

  // --------------------------------------------------------------------------
  // SHEET 1: Daily Attendance Schedule (Canonical Calendar Model)
  // --------------------------------------------------------------------------
  const wsDaily = wb.addWorksheet('Daily Schedule');
  const dailyCols = 8;

  applyExcelJsTitleBanner(wsDaily, `Monthly Attendance: ${data.monthLabel}`, sharedSubtitle, dailyCols);
  const dailyMetaEnd = applyExcelJsMetadataBlock(wsDaily, 3, meta, dailyCols);

  const kpiRow = dailyMetaEnd;
  applyExcelJsKpiStrip(
    wsDaily,
    kpiRow,
    [
      { label: 'Active Deployment Days', value: activeDaysCount },
      { label: 'Average Daily Headcount', value: avgHeadcount },
      { label: 'Total Worker-Days', value: totalWorkerDaysAll.toFixed(1) },
      {
        label: 'Total Labour Wages',
        value: `₹${(totalCostPaiseAll / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    dailyCols
  );

  const dailyHeaderRow = kpiRow + 1;
  const dailyColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date (ISO)', width: 14, align: 'center' },
    { header: 'Day of Week', width: 14, align: 'center' },
    { header: 'Full Day', width: 12, align: 'center' },
    { header: 'Half Day', width: 12, align: 'center' },
    { header: 'Total Workers', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 14, align: 'right' },
    { header: 'Labour Cost (INR)', width: 20, align: 'right' },
    { header: 'Deployment Status', width: 22, align: 'left' },
  ];

  applyExcelJsTableHeader(wsDaily, dailyHeaderRow, dailyColumns);

  // Derive all days of the month from startDate to endDate
  const [yStr, mStr] = data.startDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const totalDays = new Date(year, month, 0).getDate();

  const dailyAligns: Array<'left' | 'center' | 'right'> = [
    'center',
    'center',
    'center',
    'center',
    'center',
    'right',
    'right',
    'left',
  ];

  const dataStartRow = dailyHeaderRow + 1;
  let currRow = dataStartRow;

  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dateObj = new Date(year, month - 1, dayNum);
    const weekdayStr = dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const dayData = dailyMap.get(dateStr);
    const hasData = dayData && dayData.workerDays > 0;

    const row = wsDaily.getRow(currRow);
    row.values = [
      dateStr,
      weekdayStr,
      hasData ? dayData.full : 0,
      hasData ? dayData.half : 0,
      hasData ? dayData.workers : 0,
      hasData ? dayData.workerDays : 0,
      hasData ? dayData.costPaise / 100 : 0,
      hasData ? `${dayData.workers} Worker(s) Active` : 'Rest Day / Zero Attendance',
    ];

    row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
    row.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
    row.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
    row.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;
    row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsDataRow(row, dayNum % 2 === 1, dailyAligns);
    currRow++;
  }

  const dataEndRow = currRow - 1;
  const dailyTotalRow = wsDaily.getRow(currRow);
  dailyTotalRow.getCell(1).value = 'MONTH TOTALS';
  dailyTotalRow.getCell(2).value = '';
  dailyTotalRow.getCell(3).value = { formula: `SUM(C${dataStartRow}:C${dataEndRow})`, result: totalFullAll };
  dailyTotalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
  dailyTotalRow.getCell(4).value = { formula: `SUM(D${dataStartRow}:D${dataEndRow})`, result: totalHalfAll };
  dailyTotalRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
  dailyTotalRow.getCell(5).value = { formula: `SUM(E${dataStartRow}:E${dataEndRow})`, result: totalWorkersAll };
  dailyTotalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
  dailyTotalRow.getCell(6).value = { formula: `SUM(F${dataStartRow}:F${dataEndRow})`, result: totalWorkerDaysAll };
  dailyTotalRow.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;
  dailyTotalRow.getCell(7).value = { formula: `SUM(G${dataStartRow}:G${dataEndRow})`, result: totalCostPaiseAll / 100 };
  dailyTotalRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
  dailyTotalRow.getCell(8).value = `${activeDaysCount} Days Active`;

  applyExcelJsGrandTotalRow(dailyTotalRow, dailyAligns);
  configureExcelJsWorksheet(wsDaily, {
    orientation: 'portrait',
    freezeRow: dailyHeaderRow,
    autoFilterRange: `A${dailyHeaderRow}:H${dataEndRow}`,
    repeatHeaderRow: dailyHeaderRow,
    reportTitle: 'Daily Attendance Schedule',
  });

  // --------------------------------------------------------------------------
  // SHEET 2: Monthly Calendar Grid (7-Column Week Grid)
  // --------------------------------------------------------------------------
  const wsGrid = wb.addWorksheet('Calendar Grid');
  applyExcelJsTitleBanner(wsGrid, `Attendance Calendar Grid: ${data.monthLabel}`, sharedSubtitle, 7);
  const gridMetaEnd = applyExcelJsMetadataBlock(wsGrid, 3, meta, 7);

  const gridHeaderRow = gridMetaEnd + 1;
  const gridColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Monday', width: 22, align: 'center' },
    { header: 'Tuesday', width: 22, align: 'center' },
    { header: 'Wednesday', width: 22, align: 'center' },
    { header: 'Thursday', width: 22, align: 'center' },
    { header: 'Friday', width: 22, align: 'center' },
    { header: 'Saturday', width: 22, align: 'center' },
    { header: 'Sunday', width: 22, align: 'center' },
  ];
  applyExcelJsTableHeader(wsGrid, gridHeaderRow, gridColumns);

  const firstDay = new Date(year, month - 1, 1);
  const startingOffset = (firstDay.getDay() + 6) % 7;
  let calDay = 1;
  const totalGridWeeks = Math.ceil((startingOffset + totalDays) / 7);
  let gridRow = gridHeaderRow + 1;

  for (let w = 0; w < totalGridWeeks; w++) {
    const row = wsGrid.getRow(gridRow);
    const rowVals: string[] = [];

    for (let c = 0; c < 7; c++) {
      const slot = w * 7 + c;
      if (slot < startingOffset || calDay > totalDays) {
        rowVals.push('—');
      } else {
        const dStr = `${year}-${String(month).padStart(2, '0')}-${String(calDay).padStart(2, '0')}`;
        const dayMetrics = dailyMap.get(dStr);
        if (dayMetrics && dayMetrics.workerDays > 0) {
          rowVals.push(`Day ${calDay}\n${dayMetrics.full}F+${dayMetrics.half}H (${dayMetrics.workers}w)\n${dayMetrics.workerDays}d | ₹${(dayMetrics.costPaise / 100).toFixed(0)}`);
        } else {
          rowVals.push(`Day ${calDay}\n(No Attendance)`);
        }
        calDay++;
      }
    }

    row.values = rowVals;
    row.height = 42;
    for (let i = 1; i <= 7; i++) {
      const cell = row.getCell(i);
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.font = { name: 'Calibri', size: 9, bold: false };
    }
    gridRow++;
  }

  configureExcelJsWorksheet(wsGrid, {
    orientation: 'landscape',
    freezeRow: gridHeaderRow,
    repeatHeaderRow: gridHeaderRow,
    reportTitle: 'Attendance Calendar Grid',
  });

  return writeExcelJsWorkbookToBuffer(wb);
}
