import { BaseExcelMetadata } from '../types';
import { DailySummary } from '../../../domain/attendance-engine';
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

export async function generateDailyAttendanceExcel(
  meta: BaseExcelMetadata,
  summary: DailySummary
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();
  const ws = wb.addWorksheet('Daily Attendance');

  const totalCols = 8;

  // 1. Corporate Title Banner (Rows 1-2)
  const subtitle = `Site: ${meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName} | Date: ${meta.periodLabel || summary.date}`;
  applyExcelJsTitleBanner(ws, meta.reportTitle || 'Daily Attendance Report', subtitle, totalCols);

  // 2. Metadata Block (Rows 3-5 + spacing)
  const nextRow = applyExcelJsMetadataBlock(ws, 3, meta, totalCols);

  // 3. KPI Summary Strip
  const kpiRow = nextRow;
  applyExcelJsKpiStrip(
    ws,
    kpiRow,
    [
      { label: 'Total Workers', value: summary.totalWorkers },
      { label: 'Worker-Days', value: summary.workerDays },
      { label: 'Full / Half Days', value: `${summary.fullDayCount} / ${summary.halfDayCount}` },
      {
        label: 'Total Labour Outlay',
        value: `₹${(summary.totalLabourCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    totalCols
  );

  // 4. Table Headers
  const headerRow = kpiRow + 1;
  const columns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Category', width: 24, align: 'left' },
    { header: 'Role', width: 28, align: 'left' },
    { header: 'Daily Rate (INR)', width: 18, align: 'right' },
    { header: 'Full Day', width: 12, align: 'center' },
    { header: 'Half Day', width: 12, align: 'center' },
    { header: 'Total Workers', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 14, align: 'right' },
    { header: 'Total Cost (INR)', width: 20, align: 'right' },
  ];
  applyExcelJsTableHeader(ws, headerRow, columns);

  const dataStartRow = headerRow + 1;
  let currentRow = dataStartRow;

  if (summary.categories.length === 0) {
    // Professional empty state
    applyExcelJsEmptyState(ws, currentRow, 'No attendance records recorded for this date.', totalCols);
    currentRow++;

    // Total row with zeros
    const totalRow = ws.getRow(currentRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = 0;
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
    totalRow.getCell(5).value = 0;
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
    totalRow.getCell(6).value = 0;
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;
    totalRow.getCell(7).value = 0;
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.DECIMAL;
    totalRow.getCell(8).value = 0;
    totalRow.getCell(8).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(totalRow, ['left', 'left', 'right', 'center', 'center', 'center', 'right', 'right']);
    currentRow++;
  } else {
    let rowIndex = 0;
    for (const cat of summary.categories) {
      for (const r of cat.roles) {
        const row = ws.getRow(currentRow);
        const rateRupees = r.rateInPaise / 100;
        const costRupees = r.totalCostPaise / 100;

        row.values = [
          escapeExcelFormula(cat.categoryName),
          escapeExcelFormula(r.roleName),
          rateRupees,
          r.fullDayCount,
          r.halfDayCount,
          r.totalWorkers,
          r.workerDays,
          costRupees,
        ];

        row.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
        row.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
        row.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
        row.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;
        row.getCell(7).numFmt = EXCEL_FORMATS.DECIMAL;
        row.getCell(8).numFmt = EXCEL_FORMATS.CURRENCY;

        applyExcelJsDataRow(
          row,
          rowIndex % 2 === 1,
          ['left', 'left', 'right', 'center', 'center', 'center', 'right', 'right']
        );

        currentRow++;
        rowIndex++;
      }
    }

    const dataEndRow = currentRow - 1;
    const totalRow = ws.getRow(currentRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = {
      formula: `SUM(D${dataStartRow}:D${dataEndRow})`,
      result: summary.fullDayCount,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(5).value = {
      formula: `SUM(E${dataStartRow}:E${dataEndRow})`,
      result: summary.halfDayCount,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(6).value = {
      formula: `SUM(F${dataStartRow}:F${dataEndRow})`,
      result: summary.totalWorkers,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(7).value = {
      formula: `SUM(G${dataStartRow}:G${dataEndRow})`,
      result: summary.workerDays,
    };
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(8).value = {
      formula: `SUM(H${dataStartRow}:H${dataEndRow})`,
      result: summary.totalLabourCostPaise / 100,
    };
    totalRow.getCell(8).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(
      totalRow,
      ['left', 'left', 'right', 'center', 'center', 'center', 'right', 'right']
    );
  }

  // Configure view & print layout
  configureExcelJsWorksheet(ws, {
    orientation: 'portrait',
    freezeRow: headerRow,
    autoFilterRange: summary.categories.length > 0 ? `A${headerRow}:H${currentRow - 1}` : undefined,
    repeatHeaderRow: headerRow,
    reportTitle: meta.reportTitle || 'Daily Attendance Report',
  });

  return await writeExcelJsWorkbookToBuffer(wb);
}
