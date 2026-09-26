import { BaseExcelMetadata, RoleReportExcelData } from '../types';
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

export async function generateRoleReportExcel(
  meta: BaseExcelMetadata,
  data: RoleReportExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();
  const ws = wb.addWorksheet('Workforce Deployment');
  const isAll = !!data.isAllRoles;
  const isMulti = !!data.isMultiRole || (Array.isArray(data.roleNames) && data.roleNames.length > 1);

  const totalCols = (isAll || isMulti) ? 9 : 7;
  const sharedSubtitle = `Site: ${meta.siteName}${meta.siteCode ? ` (${meta.siteCode})` : ''} | Period: ${meta.periodLabel || 'All Recorded'}`;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(
    ws,
    isAll
      ? 'All Workforce Roles & Deployment'
      : isMulti && data.roleNames && data.roleNames.length > 0
      ? `Workforce Deployment: ${data.roleNames.join(', ')}`
      : `Workforce Deployment: ${data.roleName}`,
    sharedSubtitle,
    totalCols
  );

  // 2. Metadata Block
  const metaEndRow = applyExcelJsMetadataBlock(ws, 3, meta, totalCols);

  // 3. KPI Overview Calculations
  const totalFull = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkers = data.records.reduce((sum, r) => sum + r.total_workers, 0);
  const totalWorkerDays = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const activeDays = data.records.length;
  const avgDaily = activeDays > 0 ? (totalWorkerDays / activeDays).toFixed(1) : '0';

  const kpiRow = metaEndRow;
  applyExcelJsKpiStrip(
    ws,
    kpiRow,
    [
      { label: 'Active Deployment Days', value: activeDays },
      { label: 'Average Daily Headcount', value: avgDaily },
      { label: 'Total Worker-Days', value: totalWorkerDays.toFixed(1) },
      {
        label: 'Total Wages Paid',
        value: `₹${(totalCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    totalCols
  );

  // 4. Table Headers
  const headerRow = kpiRow + 1;
  const columns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = (isAll || isMulti)
    ? [
        { header: 'Date', width: 14, align: 'center' },
        { header: 'Role', width: 28, align: 'left' },
        { header: 'Category', width: 24, align: 'left' },
        { header: 'Rate Snapshot (INR)', width: 20, align: 'right' },
        { header: 'Full Day', width: 12, align: 'center' },
        { header: 'Half Day', width: 12, align: 'center' },
        { header: 'Total Workers', width: 14, align: 'center' },
        { header: 'Worker-Days', width: 16, align: 'right' },
        { header: 'Labour Cost (INR)', width: 22, align: 'right' },
      ]
    : [
        { header: 'Date', width: 14, align: 'center' },
        { header: 'Rate Snapshot (INR)', width: 20, align: 'right' },
        { header: 'Full Day', width: 12, align: 'center' },
        { header: 'Half Day', width: 12, align: 'center' },
        { header: 'Total Workers', width: 14, align: 'center' },
        { header: 'Worker-Days', width: 16, align: 'right' },
        { header: 'Labour Cost (INR)', width: 22, align: 'right' },
      ];

  applyExcelJsTableHeader(ws, headerRow, columns);

  const dataStartRow = headerRow + 1;
  let currentRow = dataStartRow;

  const rowAligns: Array<'left' | 'center' | 'right'> = (isAll || isMulti)
    ? ['center', 'left', 'left', 'right', 'center', 'center', 'center', 'right', 'right']
    : ['center', 'right', 'center', 'center', 'center', 'right', 'right'];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(
      ws,
      currentRow,
      isAll ? 'No workforce deployment recorded for this period.' : 'Selected role had zero deployment days in this period.',
      totalCols
    );
    currentRow++;

    const totalRow = ws.getRow(currentRow);
    if (isAll || isMulti) {
      totalRow.getCell(1).value = 'PERIOD TOTALS';
      totalRow.getCell(2).value = '';
      totalRow.getCell(3).value = '';
      totalRow.getCell(4).value = '';
      totalRow.getCell(5).value = 0;
      totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
      totalRow.getCell(6).value = 0;
      totalRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;
      totalRow.getCell(7).value = 0;
      totalRow.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;
      totalRow.getCell(8).value = 0;
      totalRow.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;
      totalRow.getCell(9).value = 0;
      totalRow.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;
    } else {
      totalRow.getCell(1).value = 'PERIOD TOTALS';
      totalRow.getCell(2).value = '';
      totalRow.getCell(3).value = 0;
      totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      totalRow.getCell(4).value = 0;
      totalRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
      totalRow.getCell(5).value = 0;
      totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
      totalRow.getCell(6).value = 0;
      totalRow.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;
      totalRow.getCell(7).value = 0;
      totalRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    }
    applyExcelJsGrandTotalRow(totalRow, rowAligns);
    currentRow++;
  } else {
    // Sort chronological, then by role name
    const sorted = [...data.records].sort((a, b) => {
      const dComp = a.date.localeCompare(b.date);
      if (dComp !== 0) return dComp;
      return (a.role_name || '').localeCompare(b.role_name || '');
    });

    let rIdx = 0;
    for (const r of sorted) {
      const row = ws.getRow(currentRow);

      if (isAll || isMulti) {
        row.values = [
          r.date,
          escapeExcelFormula(r.role_name || '—'),
          escapeExcelFormula(r.category_name || '—'),
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
      } else {
        row.values = [
          r.date,
          r.rate_snapshot_paise / 100,
          r.full_day_count,
          r.half_day_count,
          r.total_workers,
          r.worker_days,
          r.total_cost_paise / 100,
        ];
        row.getCell(2).numFmt = EXCEL_FORMATS.CURRENCY;
        row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
        row.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;
        row.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;
        row.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;
        row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
      }

      applyExcelJsDataRow(row, rIdx % 2 === 1, rowAligns);
      currentRow++;
      rIdx++;
    }

    const dataEndRow = currentRow - 1;
    const totalRow = ws.getRow(currentRow);

    if (isAll || isMulti) {
      const fullCol = 'E';
      const halfCol = 'F';
      const workersCol = 'G';
      const wDaysCol = 'H';
      const costCol = 'I';

      totalRow.getCell(1).value = 'PERIOD TOTALS';
      totalRow.getCell(2).value = '';
      totalRow.getCell(3).value = '';
      totalRow.getCell(4).value = '';

      totalRow.getCell(5).value = {
        formula: `SUM(${fullCol}${dataStartRow}:${fullCol}${dataEndRow})`,
        result: totalFull,
      };
      totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;

      totalRow.getCell(6).value = {
        formula: `SUM(${halfCol}${dataStartRow}:${halfCol}${dataEndRow})`,
        result: totalHalf,
      };
      totalRow.getCell(6).numFmt = EXCEL_FORMATS.INTEGER;

      totalRow.getCell(7).value = {
        formula: `SUM(${workersCol}${dataStartRow}:${workersCol}${dataEndRow})`,
        result: totalWorkers,
      };
      totalRow.getCell(7).numFmt = EXCEL_FORMATS.INTEGER;

      totalRow.getCell(8).value = {
        formula: `SUM(${wDaysCol}${dataStartRow}:${wDaysCol}${dataEndRow})`,
        result: totalWorkerDays,
      };
      totalRow.getCell(8).numFmt = EXCEL_FORMATS.DECIMAL;

      totalRow.getCell(9).value = {
        formula: `SUM(${costCol}${dataStartRow}:${costCol}${dataEndRow})`,
        result: totalCostPaise / 100,
      };
      totalRow.getCell(9).numFmt = EXCEL_FORMATS.CURRENCY;
    } else {
      const fullCol = 'C';
      const halfCol = 'D';
      const workersCol = 'E';
      const wDaysCol = 'F';
      const costCol = 'G';

      totalRow.getCell(1).value = 'PERIOD TOTALS';
      totalRow.getCell(2).value = '';

      totalRow.getCell(3).value = {
        formula: `SUM(${fullCol}${dataStartRow}:${fullCol}${dataEndRow})`,
        result: totalFull,
      };
      totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;

      totalRow.getCell(4).value = {
        formula: `SUM(${halfCol}${dataStartRow}:${halfCol}${dataEndRow})`,
        result: totalHalf,
      };
      totalRow.getCell(4).numFmt = EXCEL_FORMATS.INTEGER;

      totalRow.getCell(5).value = {
        formula: `SUM(${workersCol}${dataStartRow}:${workersCol}${dataEndRow})`,
        result: totalWorkers,
      };
      totalRow.getCell(5).numFmt = EXCEL_FORMATS.INTEGER;

      totalRow.getCell(6).value = {
        formula: `SUM(${wDaysCol}${dataStartRow}:${wDaysCol}${dataEndRow})`,
        result: totalWorkerDays,
      };
      totalRow.getCell(6).numFmt = EXCEL_FORMATS.DECIMAL;

      totalRow.getCell(7).value = {
        formula: `SUM(${costCol}${dataStartRow}:${costCol}${dataEndRow})`,
        result: totalCostPaise / 100,
      };
      totalRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    }

    applyExcelJsGrandTotalRow(totalRow, rowAligns);
    currentRow++;
  }

  // 5. Worksheet View & Print Setup
  const lastColLetter = getColumnLetter(totalCols);
  configureExcelJsWorksheet(ws, {
    orientation: isAll ? 'landscape' : 'portrait',
    freezeRow: headerRow,
    autoFilterRange: `A${headerRow}:${lastColLetter}${Math.max(headerRow, currentRow - 2)}`,
    repeatHeaderRow: headerRow,
    reportTitle: isAll ? 'All Workforce Roles & Deployment' : `Workforce Deployment - ${data.roleName}`,
  });

  return writeExcelJsWorkbookToBuffer(wb);
}
