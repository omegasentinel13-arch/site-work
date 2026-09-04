import { BaseExcelMetadata, CategoryReportExcelData } from '../types';
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

export async function generateCategoryReportExcel(
  meta: BaseExcelMetadata,
  data: CategoryReportExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();
  const sharedSubtitle = `Site: ${meta.siteName}${meta.siteCode ? ` (${meta.siteCode})` : ''} | Period: ${meta.periodLabel || 'All Recorded'}`;

  const totalFull = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkers = data.records.reduce((sum, r) => sum + r.total_workers, 0);
  const totalWorkerDays = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const activeDays = data.records.length;
  const avgDaily = activeDays > 0 ? (totalWorkerDays / activeDays).toFixed(1) : '0';

  // --------------------------------------------------------------------------
  // SHEET 1: Role Breakdown
  // --------------------------------------------------------------------------
  const wsRole = wb.addWorksheet('Role Breakdown');
  const roleCols = 6;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsRole, `Category Audit: ${data.categoryName}`, sharedSubtitle, roleCols);

  // 2. Metadata Block
  const roleMetaEnd = applyExcelJsMetadataBlock(wsRole, 3, meta, roleCols);

  // 3. KPI Summary Strip
  const roleKpiRow = roleMetaEnd;
  applyExcelJsKpiStrip(
    wsRole,
    roleKpiRow,
    [
      { label: 'Active Deployment Days', value: activeDays },
      { label: 'Average Daily Headcount', value: avgDaily },
      { label: 'Total Worker-Days', value: totalWorkerDays.toFixed(1) },
      {
        label: 'Total Wages Paid',
        value: `₹${(totalCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    roleCols
  );

  // 4. Table Headers
  const roleHeaderRow = roleKpiRow + 1;
  const roleColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Role Name', width: 32, align: 'left' },
    { header: 'Full Day', width: 14, align: 'center' },
    { header: 'Half Day', width: 14, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: '% Share', width: 16, align: 'right' },
    { header: 'Total Labour Cost (INR)', width: 24, align: 'right' },
  ];
  applyExcelJsTableHeader(wsRole, roleHeaderRow, roleColumns);

  const roleDataStart = roleHeaderRow + 1;
  let currentRoleRow = roleDataStart;
  const roleAligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'center', 'right', 'right', 'right'];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(
      wsRole,
      currentRoleRow,
      'Selected category had zero deployment in this period.',
      roleCols
    );
    currentRoleRow++;

    const totalRow = wsRole.getRow(currentRoleRow);
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

    applyExcelJsGrandTotalRow(totalRow, roleAligns);
    currentRoleRow++;
  } else {
    const roleRollup = new Map<
      string,
      { name: string; full: number; half: number; workerDays: number; costPaise: number }
    >();

    for (const r of data.records) {
      if (!roleRollup.has(r.role_id)) {
        roleRollup.set(r.role_id, {
          name: r.role_name || 'Role',
          full: 0,
          half: 0,
          workerDays: 0,
          costPaise: 0,
        });
      }
      const item = roleRollup.get(r.role_id)!;
      item.full += r.full_day_count;
      item.half += r.half_day_count;
      item.workerDays += r.worker_days;
      item.costPaise += r.total_cost_paise;
    }

    let rIdx = 0;
    for (const item of Array.from(roleRollup.values())) {
      const share = totalWorkerDays > 0 ? item.workerDays / totalWorkerDays : 0;
      const row = wsRole.getRow(currentRoleRow);

      row.values = [
        escapeExcelFormula(item.name),
        item.full,
        item.half,
        item.workerDays,
        share,
        item.costPaise / 100,
      ];

      row.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(5).numFmt = EXCEL_FORMATS.PERCENT;
      row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, rIdx % 2 === 1, roleAligns);
      currentRoleRow++;
      rIdx++;
    }

    const roleEndRow = currentRoleRow - 1;
    const totalRow = wsRole.getRow(currentRoleRow);

    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = {
      formula: `SUM(B${roleDataStart}:B${roleEndRow})`,
      result: totalFull,
    };
    totalRow.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(3).value = {
      formula: `SUM(C${roleDataStart}:C${roleEndRow})`,
      result: totalHalf,
    };
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(4).value = {
      formula: `SUM(D${roleDataStart}:D${roleEndRow})`,
      result: totalWorkerDays,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(5).value = 1.0;
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.PERCENT;

    totalRow.getCell(6).value = {
      formula: `SUM(F${roleDataStart}:F${roleEndRow})`,
      result: totalCostPaise / 100,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, roleAligns);
    currentRoleRow++;
  }

  configureExcelJsWorksheet(wsRole, {
    orientation: 'portrait',
    freezeRow: roleHeaderRow,
    autoFilterRange: `A${roleHeaderRow}:F${Math.max(roleHeaderRow, currentRoleRow - 2)}`,
    repeatHeaderRow: roleHeaderRow,
    reportTitle: `Category Audit - ${data.categoryName}`,
  });

  // --------------------------------------------------------------------------
  // SHEET 2: Daily Category Log
  // --------------------------------------------------------------------------
  const wsDaily = wb.addWorksheet('Daily Category Log');
  const dailyCols = 5;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsDaily, `Daily Operational Log: ${data.categoryName}`, sharedSubtitle, dailyCols);

  // 2. Metadata Block
  const dailyMetaEnd = applyExcelJsMetadataBlock(wsDaily, 3, meta, dailyCols);

  // 3. Table Headers
  const dailyHeaderRow = dailyMetaEnd;
  const dailyColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Day of Week', width: 14, align: 'center' },
    { header: 'Total Workers', width: 16, align: 'center' },
    { header: 'Worker-Days', width: 16, align: 'right' },
    { header: 'Daily Labour Cost (INR)', width: 24, align: 'right' },
  ];
  applyExcelJsTableHeader(wsDaily, dailyHeaderRow, dailyColumns);

  const dailyDataStart = dailyHeaderRow + 1;
  let currentDailyRow = dailyDataStart;
  const dailyAligns: Array<'left' | 'center' | 'right'> = ['center', 'center', 'center', 'right', 'right'];

  if (data.records.length === 0) {
    applyExcelJsEmptyState(
      wsDaily,
      currentDailyRow,
      'Selected category had zero deployment in this period.',
      dailyCols
    );
    currentDailyRow++;

    const totalRow = wsDaily.getRow(currentDailyRow);
    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = 0;
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
    totalRow.getCell(4).value = 0;
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
    totalRow.getCell(5).value = 0;
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, dailyAligns);
    currentDailyRow++;
  } else {
    const dayMap = new Map<string, { workers: number; workerDays: number; costPaise: number }>();
    for (const r of data.records) {
      if (!dayMap.has(r.date)) {
        dayMap.set(r.date, { workers: 0, workerDays: 0, costPaise: 0 });
      }
      const d = dayMap.get(r.date)!;
      d.workers += r.total_workers;
      d.workerDays += r.worker_days;
      d.costPaise += r.total_cost_paise;
    }

    const sortedDates = Array.from(dayMap.keys()).sort();
    let dIdx = 0;
    for (const dt of sortedDates) {
      const dObj = new Date(dt);
      const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
      const stats = dayMap.get(dt)!;
      const row = wsDaily.getRow(currentDailyRow);

      row.values = [
        dt,
        dayName,
        stats.workers,
        stats.workerDays,
        stats.costPaise / 100,
      ];

      row.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;
      row.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;
      row.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, dIdx % 2 === 1, dailyAligns);
      currentDailyRow++;
      dIdx++;
    }

    const dailyEndRow = currentDailyRow - 1;
    const totalRow = wsDaily.getRow(currentDailyRow);

    totalRow.getCell(1).value = 'TOTAL';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = {
      formula: `SUM(C${dailyDataStart}:C${dailyEndRow})`,
      result: totalWorkers,
    };
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.INTEGER;

    totalRow.getCell(4).value = {
      formula: `SUM(D${dailyDataStart}:D${dailyEndRow})`,
      result: totalWorkerDays,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.DECIMAL;

    totalRow.getCell(5).value = {
      formula: `SUM(E${dailyDataStart}:E${dailyEndRow})`,
      result: totalCostPaise / 100,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

    applyExcelJsGrandTotalRow(totalRow, dailyAligns);
    currentDailyRow++;
  }

  configureExcelJsWorksheet(wsDaily, {
    orientation: 'portrait',
    freezeRow: dailyHeaderRow,
    autoFilterRange: `A${dailyHeaderRow}:E${Math.max(dailyHeaderRow, currentDailyRow - 2)}`,
    repeatHeaderRow: dailyHeaderRow,
    reportTitle: `Daily Category Log - ${data.categoryName}`,
  });

  return writeExcelJsWorkbookToBuffer(wb);
}
