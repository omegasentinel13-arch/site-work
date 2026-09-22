import ExcelJS from 'exceljs';
import { SiteExportData, SystemExportData } from './types';
import { BaseExcelMetadata } from '../excel/types';
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
} from '../excel/shared';
import { EXCEL_FORMATS } from '../excel/formatters';
import { escapeExcelFormula } from '../excel/security';

/**
 * Generates an Enterprise Consolidated Multi-Sheet Excel Workbook for a single site.
 */
export async function generateCompleteSiteExcel(
  data: SiteExportData,
  meta: BaseExcelMetadata
): Promise<Buffer> {
  const wb = createExcelJsWorkbook('SITE WORK Enterprise Reporting Engine');
  const siteCodeStr = data.site.code ? ` (${data.site.code})` : '';
  const siteHeaderSubtitle = `Site: ${data.site.name}${siteCodeStr} | Location: ${data.site.location || 'Project Site'} | Period: ${data.period.label}`;

  // ==========================================================================
  // SHEET 1: EXECUTIVE OVERVIEW
  // ==========================================================================
  const wsExec = wb.addWorksheet('Executive Overview');
  const execCols = 4;
  applyExcelJsTitleBanner(wsExec, 'Complete Site Performance Overview', siteHeaderSubtitle, execCols);
  const execMetaEnd = applyExcelJsMetadataBlock(wsExec, 3, meta, execCols);

  const totalFull = data.attendanceRecords.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = data.attendanceRecords.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkers = totalFull + totalHalf;

  applyExcelJsKpiStrip(
    wsExec,
    execMetaEnd,
    [
      { label: 'Worker-Days', value: data.totalWorkerDays.toFixed(1) },
      { label: 'Labour Outlay', value: `₹${(data.totalLabourCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Cash Inflows', value: `₹${(data.financialSummary.totalCreditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Closing Balance', value: `₹${(data.closingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
    ],
    execCols
  );

  const execHeaderRow = execMetaEnd + 1;
  applyExcelJsTableHeader(wsExec, execHeaderRow, [
    { header: 'Metric Classification', width: 32, align: 'left' },
    { header: 'Key Performance Indicator', width: 42, align: 'left' },
    { header: 'Value', width: 22, align: 'right' },
    { header: 'Unit / Currency', width: 18, align: 'center' },
  ]);

  let curExecRow = execHeaderRow + 1;
  const execAligns: Array<'left' | 'center' | 'right'> = ['left', 'left', 'right', 'center'];

  // Workforce Metrics
  const wfMetrics = [
    ['Workforce Deployment', 'Total Recorded Shift Headcount', totalWorkers, 'Workers', EXCEL_FORMATS.INTEGER],
    ['Workforce Deployment', 'Total Full-Day Shifts', totalFull, 'Shifts', EXCEL_FORMATS.INTEGER],
    ['Workforce Deployment', 'Total Half-Day Shifts', totalHalf, 'Shifts', EXCEL_FORMATS.INTEGER],
    ['Workforce Deployment', 'Standardized Worker-Days', data.totalWorkerDays, 'Worker-Days', EXCEL_FORMATS.DECIMAL],
    ['Workforce Deployment', 'Cumulative Labour Cost Outlay', data.totalLabourCostPaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
  ];

  for (let i = 0; i < wfMetrics.length; i++) {
    const [cls, kpi, val, unit, fmt] = wfMetrics[i];
    const row = wsExec.getRow(curExecRow);
    row.values = [cls, kpi, val, unit];
    row.getCell(3).numFmt = fmt as string;
    applyExcelJsDataRow(row, i % 2 === 1, execAligns);
    curExecRow++;
  }

  // Financial Metrics
  const finMetrics = [
    ['Financial Summary', 'Period Opening Cash Balance', data.openingBalancePaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Financial Summary', 'Total Credits / Inflows', data.financialSummary.totalCreditPaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Financial Summary', 'Total Debits / Outflows', data.financialSummary.totalDebitPaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Financial Summary', 'Period Net Cash Flow', (data.financialSummary.totalCreditPaise - data.financialSummary.totalDebitPaise) / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Financial Summary', 'Period Closing Cash Balance', data.closingBalancePaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
  ];

  for (let i = 0; i < finMetrics.length; i++) {
    const [cls, kpi, val, unit, fmt] = finMetrics[i];
    const row = wsExec.getRow(curExecRow);
    row.values = [cls, kpi, val, unit];
    row.getCell(3).numFmt = fmt as string;
    applyExcelJsDataRow(row, i % 2 === 1, execAligns);
    curExecRow++;
  }

  configureExcelJsWorksheet(wsExec, {
    orientation: 'portrait',
    freezeRow: execHeaderRow,
    reportTitle: 'Executive Overview',
  });

  // ==========================================================================
  // SHEET 2: ATTENDANCE ROLLUP (BY ROLE & CATEGORY)
  // ==========================================================================
  const wsRollup = wb.addWorksheet('Role Rollup');
  const rollupCols = 7;
  applyExcelJsTitleBanner(wsRollup, 'Workforce Deployment & Wage Rollup', siteHeaderSubtitle, rollupCols);
  const rollupMetaEnd = applyExcelJsMetadataBlock(wsRollup, 3, meta, rollupCols);

  const rollupHeaderRow = rollupMetaEnd;
  applyExcelJsTableHeader(wsRollup, rollupHeaderRow, [
    { header: 'Category', width: 24, align: 'left' },
    { header: 'Role Designation', width: 28, align: 'left' },
    { header: 'Full Days', width: 14, align: 'center' },
    { header: 'Half Days', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: 'Avg Daily Rate (₹)', width: 20, align: 'right' },
    { header: 'Total Wages (₹)', width: 22, align: 'right' },
  ]);

  let curRollupRow = rollupHeaderRow + 1;
  const rollupAligns: Array<'left' | 'center' | 'right'> = ['left', 'left', 'center', 'center', 'right', 'right', 'right'];

  if (data.roleRollup.length === 0) {
    applyExcelJsEmptyState(wsRollup, curRollupRow, 'No workforce attendance recorded in this period.', rollupCols);
    curRollupRow++;
  } else {
    data.roleRollup.forEach((item, idx) => {
      const row = wsRollup.getRow(curRollupRow);
      const avgRate = item.workerDays > 0 ? (item.totalCostPaise / item.workerDays / 100) : 0;
      row.values = [
        escapeExcelFormula(item.categoryName),
        escapeExcelFormula(item.roleName),
        item.fullDays,
        item.halfDays,
        item.workerDays,
        avgRate,
        item.totalCostPaise / 100,
      ];
      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(5).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
      applyExcelJsDataRow(row, idx % 2 === 1, rollupAligns);
      curRollupRow++;
    });

    const totRow = wsRollup.getRow(curRollupRow);
    totRow.values = [
      'TOTAL',
      '',
      totalFull,
      totalHalf,
      data.totalWorkerDays,
      '',
      data.totalLabourCostPaise / 100,
    ];
    totRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
    totRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
    totRow.getCell(5).numFmt = EXCEL_FORMATS.DECIMAL;
    totRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(totRow, rollupAligns);
  }

  configureExcelJsWorksheet(wsRollup, {
    orientation: 'landscape',
    freezeRow: rollupHeaderRow,
    reportTitle: 'Role Rollup',
  });

  // ==========================================================================
  // SHEET 3: CATEGORY SUMMARY
  // ==========================================================================
  const wsCat = wb.addWorksheet('Category Summary');
  const catCols = 6;
  applyExcelJsTitleBanner(wsCat, 'Workforce Category Deployment Summary', siteHeaderSubtitle, catCols);
  const catMetaEnd = applyExcelJsMetadataBlock(wsCat, 3, meta, catCols);

  const catHeaderRow = catMetaEnd;
  applyExcelJsTableHeader(wsCat, catHeaderRow, [
    { header: 'Category Name', width: 30, align: 'left' },
    { header: 'Full Days', width: 14, align: 'center' },
    { header: 'Half Days', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 18, align: 'right' },
    { header: 'Total Cost (₹)', width: 22, align: 'right' },
    { header: 'Outlay Share (%)', width: 18, align: 'right' },
  ]);

  let curCatRow = catHeaderRow + 1;
  const catAligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'center', 'right', 'right', 'right'];

  if (data.categoryRollup.length === 0) {
    applyExcelJsEmptyState(wsCat, curCatRow, 'No category data recorded in this period.', catCols);
    curCatRow++;
  } else {
    data.categoryRollup.forEach((item, idx) => {
      const row = wsCat.getRow(curCatRow);
      const sharePct = data.totalLabourCostPaise > 0 ? (item.totalCostPaise / data.totalLabourCostPaise) * 100 : 0;
      row.values = [
        escapeExcelFormula(item.categoryName),
        item.fullDays,
        item.halfDays,
        item.workerDays,
        item.totalCostPaise / 100,
        sharePct,
      ];
      row.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(6).numFmt = '0.00%';
      applyExcelJsDataRow(row, idx % 2 === 1, catAligns);
      curCatRow++;
    });

    const catTotRow = wsCat.getRow(curCatRow);
    catTotRow.values = [
      'TOTAL',
      totalFull,
      totalHalf,
      data.totalWorkerDays,
      data.totalLabourCostPaise / 100,
      100,
    ];
    catTotRow.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;
    catTotRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
    catTotRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
    catTotRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
    catTotRow.getCell(6).numFmt = '0.00%';
    applyExcelJsGrandTotalRow(catTotRow, catAligns);
  }

  configureExcelJsWorksheet(wsCat, {
    orientation: 'portrait',
    freezeRow: catHeaderRow,
    reportTitle: 'Category Summary',
  });

  // ==========================================================================
  // SHEET 4: ATTENDANCE RECORDS (RAW LOG)
  // ==========================================================================
  const wsLog = wb.addWorksheet('Attendance Log');
  const logCols = 9;
  applyExcelJsTitleBanner(wsLog, 'Detailed Daily Shift Attendance Log', siteHeaderSubtitle, logCols);
  const logMetaEnd = applyExcelJsMetadataBlock(wsLog, 3, meta, logCols);

  const logHeaderRow = logMetaEnd;
  applyExcelJsTableHeader(wsLog, logHeaderRow, [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Category', width: 22, align: 'left' },
    { header: 'Role Designation', width: 26, align: 'left' },
    { header: 'Daily Rate (₹)', width: 16, align: 'right' },
    { header: 'Full Day', width: 12, align: 'center' },
    { header: 'Half Day', width: 12, align: 'center' },
    { header: 'Total Workers', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 14, align: 'right' },
    { header: 'Shift Cost (₹)', width: 20, align: 'right' },
  ]);

  let curLogRow = logHeaderRow + 1;
  const logAligns: Array<'left' | 'center' | 'right'> = [
    'center', 'left', 'left', 'right', 'center', 'center', 'center', 'right', 'right'
  ];

  if (data.attendanceRecords.length === 0) {
    applyExcelJsEmptyState(wsLog, curLogRow, 'No daily attendance records found.', logCols);
    curLogRow++;
  } else {
    data.attendanceRecords.forEach((rec, idx) => {
      const row = wsLog.getRow(curLogRow);
      row.values = [
        rec.date,
        escapeExcelFormula(rec.category_name || 'Unassigned'),
        escapeExcelFormula(rec.role_name || 'Worker'),
        rec.rate_snapshot_paise / 100,
        rec.full_day_count,
        rec.half_day_count,
        rec.total_workers,
        rec.worker_days,
        rec.total_cost_paise / 100,
      ];
      row.getCell(4).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;
      applyExcelJsDataRow(row, idx % 2 === 1, logAligns);
      curLogRow++;
    });

    const logTotRow = wsLog.getRow(curLogRow);
    logTotRow.values = [
      'TOTAL', '', '', '',
      totalFull, totalHalf, totalWorkers, data.totalWorkerDays,
      data.totalLabourCostPaise / 100,
    ];
    logTotRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
    logTotRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;
    logTotRow.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;
    logTotRow.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;
    logTotRow.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(logTotRow, logAligns);
  }

  configureExcelJsWorksheet(wsLog, {
    orientation: 'landscape',
    freezeRow: logHeaderRow,
    reportTitle: 'Attendance Log',
  });

  // ==========================================================================
  // SHEET 5: FINANCIAL TRANSACTIONS LEDGER
  // ==========================================================================
  const wsFin = wb.addWorksheet('Financial Ledger');
  const finCols = 8;
  applyExcelJsTitleBanner(wsFin, 'Financial Transactions Ledger', siteHeaderSubtitle, finCols);
  const finMetaEnd = applyExcelJsMetadataBlock(wsFin, 3, meta, finCols);

  applyExcelJsKpiStrip(
    wsFin,
    finMetaEnd,
    [
      { label: 'Opening Balance', value: `₹${(data.openingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Total Inflows', value: `₹${(data.financialSummary.totalCreditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Total Outflows', value: `₹${(data.financialSummary.totalDebitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Closing Balance', value: `₹${(data.closingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
    ],
    finCols
  );

  const finHeaderRow = finMetaEnd + 1;
  applyExcelJsTableHeader(wsFin, finHeaderRow, [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Type', width: 12, align: 'center' },
    { header: 'Debit Category', width: 22, align: 'left' },
    { header: 'Description', width: 36, align: 'left' },
    { header: 'Credit (₹)', width: 18, align: 'right' },
    { header: 'Debit (₹)', width: 18, align: 'right' },
    { header: 'Running Balance (₹)', width: 22, align: 'right' },
    { header: 'Reference Note', width: 24, align: 'left' },
  ]);

  let curFinRow = finHeaderRow + 1;
  const finAligns: Array<'left' | 'center' | 'right'> = [
    'center', 'center', 'left', 'left', 'right', 'right', 'right', 'left'
  ];

  if (data.financialRecords.length === 0) {
    applyExcelJsEmptyState(wsFin, curFinRow, 'No financial transactions recorded in this period.', finCols);
    curFinRow++;
  } else {
    let runningPaise = data.openingBalancePaise;
    data.financialRecords.forEach((tx, idx) => {
      const row = wsFin.getRow(curFinRow);
      const isCredit = tx.type === 'CREDIT';
      const creditAmt = isCredit ? tx.amount_paise / 100 : null;
      const debitAmt = !isCredit ? tx.amount_paise / 100 : null;

      if (isCredit) {
        runningPaise += tx.amount_paise;
      } else {
        runningPaise -= tx.amount_paise;
      }

      row.values = [
        tx.date,
        tx.type,
        escapeExcelFormula(tx.debit_category || '—'),
        escapeExcelFormula(tx.description),
        creditAmt,
        debitAmt,
        runningPaise / 100,
        escapeExcelFormula(tx.reference_note || '—'),
      ];

      if (creditAmt !== null) row.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
      if (debitAmt !== null) row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, idx % 2 === 1, finAligns);
      curFinRow++;
    });

    const finTotRow = wsFin.getRow(curFinRow);
    finTotRow.values = [
      'TOTAL', '', '', '',
      data.financialSummary.totalCreditPaise / 100,
      data.financialSummary.totalDebitPaise / 100,
      data.closingBalancePaise / 100,
      '',
    ];
    finTotRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
    finTotRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
    finTotRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(finTotRow, finAligns);
  }

  configureExcelJsWorksheet(wsFin, {
    orientation: 'landscape',
    freezeRow: finHeaderRow,
    reportTitle: 'Financial Ledger',
  });

  // ==========================================================================
  // SHEET 6: REPORT METADATA & SYSTEM AUDIT
  // ==========================================================================
  const wsMeta = wb.addWorksheet('Report Metadata');
  const metaCols = 3;
  applyExcelJsTitleBanner(wsMeta, 'System Generation Audit & Metadata', siteHeaderSubtitle, metaCols);
  applyExcelJsTableHeader(wsMeta, 3, [
    { header: 'Property', width: 28, align: 'left' },
    { header: 'Value', width: 50, align: 'left' },
    { header: 'Description', width: 40, align: 'left' },
  ]);

  const auditItems = [
    ['Application', 'SITE WORK Enterprise System', 'Corporate Construction ERP & Management Platform'],
    ['Export Version', '1.0.0', 'Schema version for enterprise automated parsing'],
    ['Report Scope', 'COMPLETE_SITE', 'Consolidated multi-module report for specific site'],
    ['Site Name', data.site.name, 'Name of construction project site'],
    ['Site Code', data.site.code || 'N/A', 'Internal tracking site code'],
    ['Site Location', data.site.location || 'N/A', 'Physical location / address'],
    ['Site Status', data.site.is_archived ? 'ARCHIVED' : 'ACTIVE', 'Operational status (ACTIVE / COMPLETED / ARCHIVED)'],
    ['Period Preset', data.period.preset, 'Selected time range window preset'],
    ['Period Label', data.period.label, 'Human-readable period description'],
    ['Period Start Date', data.period.startDate || 'Dynamic Earliest Record', 'Effective start filter boundary'],
    ['Period End Date', data.period.endDate || 'Dynamic Latest Record', 'Effective end filter boundary'],
    ['Total Attendance Rows', String(data.attendanceRecords.length), 'Number of daily role shift records'],
    ['Total Financial Rows', String(data.financialRecords.length), 'Number of ledger transactions'],
    ['Generated By', meta.generatedBy || 'Enterprise Operator', 'Authenticated session user'],
    ['Generated At (UTC/IST)', meta.generatedAt || new Date().toISOString(), 'System generation timestamp'],
    ['Data Integrity', 'VERIFIED', 'Canonical zero-secret operational snapshot'],
  ];

  auditItems.forEach((item, idx) => {
    const row = wsMeta.getRow(4 + idx);
    row.values = [item[0], item[1], item[2]];
    applyExcelJsDataRow(row, idx % 2 === 1, ['left', 'left', 'left']);
  });

  configureExcelJsWorksheet(wsMeta, {
    orientation: 'portrait',
    freezeRow: 3,
    reportTitle: 'Report Metadata',
  });

  return writeExcelJsWorkbookToBuffer(wb);
}

/**
 * Generates an Enterprise Consolidated Multi-Sheet Excel Workbook for the whole system (ADMIN only).
 */
export async function generateCompleteSystemExcel(
  data: SystemExportData,
  meta: BaseExcelMetadata
): Promise<Buffer> {
  const wb = createExcelJsWorkbook('SITE WORK Enterprise Reporting Engine');
  const sysSubtitle = `Enterprise System-Wide Overall Export | Sites: ${data.aggregatedSummary.totalSites} | Period: ${data.period.label}`;

  // ==========================================================================
  // SHEET 1: SYSTEM OVERVIEW
  // ==========================================================================
  const wsSys = wb.addWorksheet('System Overview');
  const sysCols = 4;
  applyExcelJsTitleBanner(wsSys, 'Enterprise System-Wide Overview', sysSubtitle, sysCols);
  const sysMetaEnd = applyExcelJsMetadataBlock(wsSys, 3, meta, sysCols);

  applyExcelJsKpiStrip(
    wsSys,
    sysMetaEnd,
    [
      { label: 'Active Sites', value: data.aggregatedSummary.totalSites },
      { label: 'Worker-Days', value: data.aggregatedSummary.totalWorkerDays.toFixed(1) },
      { label: 'Labour Outlay', value: `₹${(data.aggregatedSummary.totalLabourCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Total Inflows', value: `₹${(data.aggregatedSummary.totalCreditsPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Total Outflows', value: `₹${(data.aggregatedSummary.totalDebitsPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
      { label: 'Net Cashflow', value: `₹${(data.aggregatedSummary.netClosingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` },
    ],
    sysCols
  );

  const sysHeaderRow = sysMetaEnd + 1;
  applyExcelJsTableHeader(wsSys, sysHeaderRow, [
    { header: 'System Metric Category', width: 32, align: 'left' },
    { header: 'Key Performance Indicator', width: 42, align: 'left' },
    { header: 'Consolidated Value', width: 24, align: 'right' },
    { header: 'Unit / Currency', width: 18, align: 'center' },
  ]);

  let curSysRow = sysHeaderRow + 1;
  const sysAligns: Array<'left' | 'center' | 'right'> = ['left', 'left', 'right', 'center'];

  const overviewRows = [
    ['Operations', 'Total Managed Construction Sites', data.aggregatedSummary.totalSites, 'Sites', EXCEL_FORMATS.INTEGER],
    ['Workforce', 'Total Recorded Shift Headcount', data.aggregatedSummary.totalWorkers, 'Workers', EXCEL_FORMATS.INTEGER],
    ['Workforce', 'Total Standardized Worker-Days', data.aggregatedSummary.totalWorkerDays, 'Worker-Days', EXCEL_FORMATS.DECIMAL],
    ['Workforce', 'Total Consolidated Labour Cost', data.aggregatedSummary.totalLabourCostPaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Finance', 'Consolidated Capital Inflows (Credits)', data.aggregatedSummary.totalCreditsPaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Finance', 'Consolidated Project Expenditures (Debits)', data.aggregatedSummary.totalDebitsPaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
    ['Finance', 'Consolidated Net Closing Balance', data.aggregatedSummary.netClosingBalancePaise / 100, 'INR (₹)', EXCEL_FORMATS.CURRENCY],
  ];

  overviewRows.forEach((item, idx) => {
    const row = wsSys.getRow(curSysRow);
    row.values = [item[0], item[1], item[2], item[3]];
    row.getCell(3).numFmt = item[4] as string;
    applyExcelJsDataRow(row, idx % 2 === 1, sysAligns);
    curSysRow++;
  });

  configureExcelJsWorksheet(wsSys, {
    orientation: 'portrait',
    freezeRow: sysHeaderRow,
    reportTitle: 'System Overview',
  });

  // ==========================================================================
  // SHEET 2: SITES SUMMARY BREAKDOWN
  // ==========================================================================
  const wsSites = wb.addWorksheet('Sites Summary');
  const sitesCols = 9;
  applyExcelJsTitleBanner(wsSites, 'Sites Performance & Financial Summary', sysSubtitle, sitesCols);
  const sitesMetaEnd = applyExcelJsMetadataBlock(wsSites, 3, meta, sitesCols);

  const sitesHeaderRow = sitesMetaEnd;
  applyExcelJsTableHeader(wsSites, sitesHeaderRow, [
    { header: 'Site Code', width: 14, align: 'center' },
    { header: 'Site Name', width: 30, align: 'left' },
    { header: 'Location', width: 24, align: 'left' },
    { header: 'Status', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: 'Labour Cost (₹)', width: 20, align: 'right' },
    { header: 'Inflows (₹)', width: 18, align: 'right' },
    { header: 'Outflows (₹)', width: 18, align: 'right' },
    { header: 'Closing Bal (₹)', width: 20, align: 'right' },
  ]);

  let curSitesRow = sitesHeaderRow + 1;
  const sitesAligns: Array<'left' | 'center' | 'right'> = [
    'center', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right'
  ];

  if (data.sitesData.length === 0) {
    applyExcelJsEmptyState(wsSites, curSitesRow, 'No site data available.', sitesCols);
    curSitesRow++;
  } else {
    data.sitesData.forEach((siteData, idx) => {
      const row = wsSites.getRow(curSitesRow);
      row.values = [
        siteData.site.code || '—',
        escapeExcelFormula(siteData.site.name),
        escapeExcelFormula(siteData.site.location || '—'),
        siteData.site.is_archived ? 'ARCHIVED' : 'ACTIVE',
        siteData.totalWorkerDays,
        siteData.totalLabourCostPaise / 100,
        siteData.financialSummary.totalCreditPaise / 100,
        siteData.financialSummary.totalDebitPaise / 100,
        siteData.closingBalancePaise / 100,
      ];
      row.getCell(5).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(8).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;
      applyExcelJsDataRow(row, idx % 2 === 1, sitesAligns);
      curSitesRow++;
    });

    const sitesTotRow = wsSites.getRow(curSitesRow);
    sitesTotRow.values = [
      'TOTAL', '', '', `${data.sitesData.length} Sites`,
      data.aggregatedSummary.totalWorkerDays,
      data.aggregatedSummary.totalLabourCostPaise / 100,
      data.aggregatedSummary.totalCreditsPaise / 100,
      data.aggregatedSummary.totalDebitsPaise / 100,
      data.aggregatedSummary.netClosingBalancePaise / 100,
    ];
    sitesTotRow.getCell(5).numFmt = EXCEL_FORMATS.DECIMAL;
    sitesTotRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
    sitesTotRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    sitesTotRow.getCell(8).numFmt = EXCEL_FORMATS.CURRENCY;
    sitesTotRow.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(sitesTotRow, sitesAligns);
  }

  configureExcelJsWorksheet(wsSites, {
    orientation: 'landscape',
    freezeRow: sitesHeaderRow,
    reportTitle: 'Sites Summary',
  });

  // ==========================================================================
  // SHEET 3: CONSOLIDATED ATTENDANCE ROLLUP
  // ==========================================================================
  const wsConsAtt = wb.addWorksheet('Consolidated Attendance');
  const consAttCols = 7;
  applyExcelJsTitleBanner(wsConsAtt, 'Enterprise Consolidated Role Rollup', sysSubtitle, consAttCols);
  const consAttMetaEnd = applyExcelJsMetadataBlock(wsConsAtt, 3, meta, consAttCols);

  const consAttHeaderRow = consAttMetaEnd;
  applyExcelJsTableHeader(wsConsAtt, consAttHeaderRow, [
    { header: 'Category', width: 24, align: 'left' },
    { header: 'Role Designation', width: 28, align: 'left' },
    { header: 'Full Days', width: 14, align: 'center' },
    { header: 'Half Days', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: 'Avg Daily Rate (₹)', width: 20, align: 'right' },
    { header: 'Total Wages (₹)', width: 22, align: 'right' },
  ]);

  let curConsAttRow = consAttHeaderRow + 1;
  const consAttAligns: Array<'left' | 'center' | 'right'> = ['left', 'left', 'center', 'center', 'right', 'right', 'right'];

  // Aggregate role rollup across all sites
  const roleMap = new Map<string, { roleName: string; categoryName: string; fullDays: number; halfDays: number; workerDays: number; totalCostPaise: number }>();
  for (const sd of data.sitesData) {
    for (const r of sd.roleRollup) {
      const existing = roleMap.get(r.roleId) || {
        roleName: r.roleName,
        categoryName: r.categoryName,
        fullDays: 0,
        halfDays: 0,
        workerDays: 0,
        totalCostPaise: 0,
      };
      existing.fullDays += r.fullDays;
      existing.halfDays += r.halfDays;
      existing.workerDays += r.workerDays;
      existing.totalCostPaise += r.totalCostPaise;
      roleMap.set(r.roleId, existing);
    }
  }

  const consolidatedRoles = Array.from(roleMap.values()).sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.roleName.localeCompare(b.roleName));

  if (consolidatedRoles.length === 0) {
    applyExcelJsEmptyState(wsConsAtt, curConsAttRow, 'No workforce attendance recorded across sites.', consAttCols);
    curConsAttRow++;
  } else {
    consolidatedRoles.forEach((r, idx) => {
      const row = wsConsAtt.getRow(curConsAttRow);
      const avgRate = r.workerDays > 0 ? (r.totalCostPaise / r.workerDays / 100) : 0;
      row.values = [
        escapeExcelFormula(r.categoryName),
        escapeExcelFormula(r.roleName),
        r.fullDays,
        r.halfDays,
        r.workerDays,
        avgRate,
        r.totalCostPaise / 100,
      ];
      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(5).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
      applyExcelJsDataRow(row, idx % 2 === 1, consAttAligns);
      curConsAttRow++;
    });

    const consAttTotRow = wsConsAtt.getRow(curConsAttRow);
    consAttTotRow.values = [
      'TOTAL', '', '', '',
      data.aggregatedSummary.totalWorkerDays,
      '',
      data.aggregatedSummary.totalLabourCostPaise / 100,
    ];
    consAttTotRow.getCell(5).numFmt = EXCEL_FORMATS.DECIMAL;
    consAttTotRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(consAttTotRow, consAttAligns);
  }

  configureExcelJsWorksheet(wsConsAtt, {
    orientation: 'landscape',
    freezeRow: consAttHeaderRow,
    reportTitle: 'Consolidated Attendance',
  });

  // ==========================================================================
  // SHEET 4: CONSOLIDATED FINANCIAL TRANSACTIONS
  // ==========================================================================
  const wsConsFin = wb.addWorksheet('Consolidated Finance');
  const consFinCols = 8;
  applyExcelJsTitleBanner(wsConsFin, 'Enterprise Consolidated Financial Ledger', sysSubtitle, consFinCols);
  const consFinMetaEnd = applyExcelJsMetadataBlock(wsConsFin, 3, meta, consFinCols);

  const consFinHeaderRow = consFinMetaEnd;
  applyExcelJsTableHeader(wsConsFin, consFinHeaderRow, [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Site', width: 24, align: 'left' },
    { header: 'Type', width: 12, align: 'center' },
    { header: 'Debit Category', width: 20, align: 'left' },
    { header: 'Description', width: 34, align: 'left' },
    { header: 'Credit (₹)', width: 18, align: 'right' },
    { header: 'Debit (₹)', width: 18, align: 'right' },
    { header: 'Reference Note', width: 22, align: 'left' },
  ]);

  let curConsFinRow = consFinHeaderRow + 1;
  const consFinAligns: Array<'left' | 'center' | 'right'> = [
    'center', 'left', 'center', 'left', 'left', 'right', 'right', 'left'
  ];

  // Flatten all transactions with site identifier
  const allTxs: Array<{ siteName: string; siteCode?: string | null; date: string; type: string; debit_category?: string | null; description: string; amount_paise: number; reference_note?: string | null }> = [];
  for (const sd of data.sitesData) {
    for (const tx of sd.financialRecords) {
      allTxs.push({
        siteName: sd.site.name,
        siteCode: sd.site.code,
        date: tx.date,
        type: tx.type,
        debit_category: tx.debit_category,
        description: tx.description,
        amount_paise: tx.amount_paise,
        reference_note: tx.reference_note,
      });
    }
  }

  allTxs.sort((a, b) => b.date.localeCompare(a.date));

  if (allTxs.length === 0) {
    applyExcelJsEmptyState(wsConsFin, curConsFinRow, 'No transactions found across sites.', consFinCols);
    curConsFinRow++;
  } else {
    allTxs.forEach((tx, idx) => {
      const row = wsConsFin.getRow(curConsFinRow);
      const isCredit = tx.type === 'CREDIT';
      const creditAmt = isCredit ? tx.amount_paise / 100 : null;
      const debitAmt = !isCredit ? tx.amount_paise / 100 : null;
      const siteStr = tx.siteCode ? `${tx.siteName} (${tx.siteCode})` : tx.siteName;

      row.values = [
        tx.date,
        escapeExcelFormula(siteStr),
        tx.type,
        escapeExcelFormula(tx.debit_category || '—'),
        escapeExcelFormula(tx.description),
        creditAmt,
        debitAmt,
        escapeExcelFormula(tx.reference_note || '—'),
      ];

      if (creditAmt !== null) row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
      if (debitAmt !== null) row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, idx % 2 === 1, consFinAligns);
      curConsFinRow++;
    });

    const consFinTotRow = wsConsFin.getRow(curConsFinRow);
    consFinTotRow.values = [
      'TOTAL', '', '', '', '',
      data.aggregatedSummary.totalCreditsPaise / 100,
      data.aggregatedSummary.totalDebitsPaise / 100,
      '',
    ];
    consFinTotRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
    consFinTotRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    applyExcelJsGrandTotalRow(consFinTotRow, consFinAligns);
  }

  configureExcelJsWorksheet(wsConsFin, {
    orientation: 'landscape',
    freezeRow: consFinHeaderRow,
    reportTitle: 'Consolidated Finance',
  });

  // ==========================================================================
  // SHEET 5: REPORT METADATA
  // ==========================================================================
  const wsMeta = wb.addWorksheet('Report Metadata');
  const metaCols = 3;
  applyExcelJsTitleBanner(wsMeta, 'System Generation Audit & Metadata', sysSubtitle, metaCols);
  applyExcelJsTableHeader(wsMeta, 3, [
    { header: 'Property', width: 28, align: 'left' },
    { header: 'Value', width: 50, align: 'left' },
    { header: 'Description', width: 40, align: 'left' },
  ]);

  const auditItems = [
    ['Application', 'SITE WORK Enterprise System', 'Corporate Construction ERP & Management Platform'],
    ['Export Version', '1.0.0', 'Schema version for enterprise automated parsing'],
    ['Report Scope', 'COMPLETE_SYSTEM', 'Consolidated multi-site enterprise export'],
    ['Total Managed Sites', String(data.aggregatedSummary.totalSites), 'Count of active and recorded project sites'],
    ['Period Preset', data.period.preset, 'Selected time range window preset'],
    ['Period Label', data.period.label, 'Human-readable period description'],
    ['Period Start Date', data.period.startDate || 'Dynamic Earliest Record', 'Effective start filter boundary'],
    ['Period End Date', data.period.endDate || 'Dynamic Latest Record', 'Effective end filter boundary'],
    ['Total Consolidated Worker-Days', data.aggregatedSummary.totalWorkerDays.toFixed(1), 'Sum of all site worker days'],
    ['Total Consolidated Labour Cost', `₹${(data.aggregatedSummary.totalLabourCostPaise / 100).toFixed(2)}`, 'Cumulative wage outlay'],
    ['Total Consolidated Cash Inflows', `₹${(data.aggregatedSummary.totalCreditsPaise / 100).toFixed(2)}`, 'Cumulative site credits'],
    ['Total Consolidated Cash Outflows', `₹${(data.aggregatedSummary.totalDebitsPaise / 100).toFixed(2)}`, 'Cumulative site debits'],
    ['Generated By', meta.generatedBy || 'Enterprise Administrator', 'Authenticated session user'],
    ['Generated At (UTC/IST)', meta.generatedAt || new Date().toISOString(), 'System generation timestamp'],
    ['Data Integrity', 'VERIFIED', 'Canonical zero-secret operational snapshot'],
  ];

  auditItems.forEach((item, idx) => {
    const row = wsMeta.getRow(4 + idx);
    row.values = [item[0], item[1], item[2]];
    applyExcelJsDataRow(row, idx % 2 === 1, ['left', 'left', 'left']);
  });

  configureExcelJsWorksheet(wsMeta, {
    orientation: 'portrait',
    freezeRow: 3,
    reportTitle: 'Report Metadata',
  });

  return writeExcelJsWorkbookToBuffer(wb);
}
