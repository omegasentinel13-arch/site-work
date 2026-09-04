import { BaseExcelMetadata, SiteReportExcelData } from '../types';
import {
  createExcelJsWorkbook,
  writeExcelJsWorkbookToBuffer,
  applyExcelJsTitleBanner,
  applyExcelJsMetadataBlock,
  applyExcelJsKpiStrip,
  applyExcelJsTableHeader,
  applyExcelJsDataRow,
  applyExcelJsSubtotalRow,
  applyExcelJsGrandTotalRow,
  applyExcelJsEmptyState,
  configureExcelJsWorksheet,
  getColumnLetter,
} from '../shared';
import { EXCEL_FORMATS } from '../formatters';
import { escapeExcelFormula } from '../security';

export async function generateSiteReportExcel(
  meta: BaseExcelMetadata,
  data: SiteReportExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();
  const sharedSubtitle = `Site: ${data.siteName}${meta.siteCode ? ` (${meta.siteCode})` : ''} | Location: ${data.siteLocation || 'Main Project Area'} | Period: ${meta.periodLabel || 'All Recorded'}`;

  const totalFull = data.attendanceRecords.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = data.attendanceRecords.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkerDays = data.attendanceRecords.reduce((sum, r) => sum + r.worker_days, 0);
  const totalLabourCostPaise = data.attendanceRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);

  // --------------------------------------------------------------------------
  // SHEET 1: Executive Overview
  // --------------------------------------------------------------------------
  const wsExec = wb.addWorksheet('Executive Overview');
  const execCols = 3;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsExec, 'Site Executive Performance Overview', sharedSubtitle, execCols);

  // 2. Metadata Block
  const execMetaEnd = applyExcelJsMetadataBlock(wsExec, 3, meta, execCols);

  // 3. KPI Strip (Top)
  const execKpiRow = execMetaEnd;
  applyExcelJsKpiStrip(
    wsExec,
    execKpiRow,
    [
      { label: 'Worker-Days', value: totalWorkerDays.toFixed(1) },
      {
        label: 'Labour Outlay',
        value: `₹${(totalLabourCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Cash Inflows',
        value: `₹${(data.financialSummary.totalCreditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Closing Balance',
        value: `₹${(data.financialSummary.closingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    execCols
  );

  // 4. Executive Table Header
  const execHeaderRow = execKpiRow + 1;
  const execColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Operational & Financial Performance Metric', width: 44, align: 'left' },
    { header: 'Classification', width: 24, align: 'center' },
    { header: 'Value / Amount (INR)', width: 26, align: 'right' },
  ];
  applyExcelJsTableHeader(wsExec, execHeaderRow, execColumns);

  let currentExecRow = execHeaderRow + 1;
  const execAligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];

  // SECTION A: WORKFORCE OPERATIONAL METRICS
  const secARow = wsExec.getRow(currentExecRow);
  secARow.getCell(1).value = 'A. WORKFORCE OPERATIONAL METRICS';
  secARow.getCell(2).value = 'Summary';
  secARow.getCell(3).value = '';
  applyExcelJsSubtotalRow(secARow, execAligns);
  currentExecRow++;

  const workforceMetrics = [
    { label: 'Total Full Day Shifts', class: 'Workforce Shifts', val: totalFull, fmt: EXCEL_FORMATS.INTEGER },
    { label: 'Total Half Day Shifts', class: 'Workforce Shifts', val: totalHalf, fmt: EXCEL_FORMATS.INTEGER },
    { label: 'Total Recorded Worker-Days', class: 'Deployment Volume', val: totalWorkerDays, fmt: EXCEL_FORMATS.DECIMAL },
    { label: 'Total Operational Labour Cost (INR)', class: 'Direct Wage Cost', val: totalLabourCostPaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
  ];

  for (let i = 0; i < workforceMetrics.length; i++) {
    const m = workforceMetrics[i];
    const row = wsExec.getRow(currentExecRow);
    row.values = [m.label, m.class, m.val];
    row.getCell(3).numFmt = m.fmt;
    applyExcelJsDataRow(row, i % 2 === 1, execAligns);
    currentExecRow++;
  }

  // SECTION B: FINANCIAL PERFORMANCE METRICS
  const secBRow = wsExec.getRow(currentExecRow);
  secBRow.getCell(1).value = 'B. FINANCIAL PERFORMANCE METRICS';
  secBRow.getCell(2).value = 'Summary';
  secBRow.getCell(3).value = '';
  applyExcelJsSubtotalRow(secBRow, execAligns);
  currentExecRow++;

  const financeMetrics = [
    { label: 'Opening Cash Balance (INR)', class: 'Starting Position', val: data.financialSummary.openingBalancePaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
    { label: 'Total Credits Received (INR)', class: 'Operational Inflows', val: data.financialSummary.totalCreditPaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
    { label: 'Material / Supplies Outflows (INR)', class: 'Disbursements', val: data.financialSummary.suppliesDebitPaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
    { label: 'Special Worker / Task Outflows (INR)', class: 'Disbursements', val: data.financialSummary.specialWorkerTaskDebitPaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
    { label: 'Total Outflows / Debits (INR)', class: 'Total Disbursements', val: data.financialSummary.totalDebitPaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
    { label: 'Net Cash Flow (INR)', class: 'Period Cash Movement', val: data.financialSummary.netCashFlowPaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
    { label: 'Closing Cash Balance (INR)', class: 'Ending Position', val: data.financialSummary.closingBalancePaise / 100, fmt: EXCEL_FORMATS.CURRENCY },
  ];

  for (let i = 0; i < financeMetrics.length; i++) {
    const m = financeMetrics[i];
    const row = wsExec.getRow(currentExecRow);
    row.values = [m.label, m.class, m.val];
    row.getCell(3).numFmt = m.fmt;
    applyExcelJsDataRow(row, i % 2 === 1, execAligns);
    currentExecRow++;
  }

  // SECTION C: TOTAL COMBINED SITE OUTLAY
  const totalOutlayRow = wsExec.getRow(currentExecRow);
  totalOutlayRow.getCell(1).value = 'TOTAL SITE OUTLAY (Labour + Material Debits) (INR)';
  totalOutlayRow.getCell(2).value = 'Combined Outlay';
  totalOutlayRow.getCell(3).value = (totalLabourCostPaise + data.financialSummary.totalDebitPaise) / 100;
  totalOutlayRow.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
  applyExcelJsGrandTotalRow(totalOutlayRow, execAligns);
  currentExecRow++;

  configureExcelJsWorksheet(wsExec, {
    orientation: 'portrait',
    freezeRow: execHeaderRow,
    repeatHeaderRow: execHeaderRow,
    reportTitle: 'Site Executive Overview',
  });

  // --------------------------------------------------------------------------
  // SHEET 2: Workforce Category Breakdown
  // --------------------------------------------------------------------------
  const wsCat = wb.addWorksheet('Workforce Categories');
  const catCols = 5;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsCat, 'Workforce Category Performance Breakdown', sharedSubtitle, catCols);

  // 2. Metadata Block
  const catMetaEnd = applyExcelJsMetadataBlock(wsCat, 3, meta, catCols);

  // 3. Table Headers
  const catHeaderRow = catMetaEnd;
  const catColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Work Category', width: 32, align: 'left' },
    { header: 'Full Day', width: 14, align: 'center' },
    { header: 'Half Day', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: 'Labour Cost (INR)', width: 24, align: 'right' },
  ];
  applyExcelJsTableHeader(wsCat, catHeaderRow, catColumns);

  const catDataStart = catHeaderRow + 1;
  let currentCatRow = catDataStart;
  const catAligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'center', 'right', 'right'];

  if (data.attendanceRecords.length === 0) {
    applyExcelJsEmptyState(
      wsCat,
      currentCatRow,
      'No attendance records recorded for this site.',
      catCols
    );
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
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, catAligns);
    currentCatRow++;
  } else {
    const catMap = new Map<string, { name: string; full: number; half: number; workerDays: number; costPaise: number }>();
    for (const r of data.attendanceRecords) {
      const cId = r.category_id || 'other';
      if (!catMap.has(cId)) {
        catMap.set(cId, { name: r.category_name || 'General', full: 0, half: 0, workerDays: 0, costPaise: 0 });
      }
      const item = catMap.get(cId)!;
      item.full += r.full_day_count;
      item.half += r.half_day_count;
      item.workerDays += r.worker_days;
      item.costPaise += r.total_cost_paise;
    }

    let cIdx = 0;
    for (const item of Array.from(catMap.values())) {
      const row = wsCat.getRow(currentCatRow);
      row.values = [
        escapeExcelFormula(item.name),
        item.full,
        item.half,
        item.workerDays,
        item.costPaise / 100,
      ];

      row.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, cIdx % 2 === 1, catAligns);
      currentCatRow++;
      cIdx++;
    }

    const catEndRow = currentCatRow - 1;
    const totalRow = wsCat.getRow(currentCatRow);

    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = {
      formula: `SUM(B${catDataStart}:B${catEndRow})`,
      result: totalFull,
    };
    totalRow.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(3).value = {
      formula: `SUM(C${catDataStart}:C${catEndRow})`,
      result: totalHalf,
    };
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(4).value = {
      formula: `SUM(D${catDataStart}:D${catEndRow})`,
      result: totalWorkerDays,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(5).value = {
      formula: `SUM(E${catDataStart}:E${catEndRow})`,
      result: totalLabourCostPaise / 100,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, catAligns);
    currentCatRow++;
  }

  configureExcelJsWorksheet(wsCat, {
    orientation: 'portrait',
    freezeRow: catHeaderRow,
    autoFilterRange: `A${catHeaderRow}:E${Math.max(catHeaderRow, currentCatRow - 2)}`,
    repeatHeaderRow: catHeaderRow,
    reportTitle: `Workforce Categories - ${data.siteName}`,
  });

  return writeExcelJsWorkbookToBuffer(wb);
}
