import { BaseExcelMetadata, FinancialExcelData } from '../types';
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

export async function generateFinancialExcel(
  meta: BaseExcelMetadata,
  data: FinancialExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();
  const ws = wb.addWorksheet('Financial Ledger');
  const totalCols = 8;

  // 1. Corporate Title Banner (Rows 1-2)
  const subtitle = `Site: ${meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName} | Period: ${meta.periodLabel}`;
  applyExcelJsTitleBanner(ws, meta.reportTitle || 'Financial Transactions Ledger', subtitle, totalCols);

  // 2. Metadata Block (Rows 3-5 + spacing)
  const nextRow = applyExcelJsMetadataBlock(ws, 3, meta, totalCols);

  // 3. Executive Financial KPI Strip
  const kpiRow = nextRow;
  applyExcelJsKpiStrip(
    ws,
    kpiRow,
    [
      {
        label: 'Opening Balance',
        value: `₹${(data.summary.openingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Total Inflows',
        value: `₹${(data.summary.totalCreditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Total Outflows',
        value: `₹${(data.summary.totalDebitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Closing Balance',
        value: `₹${(data.summary.closingBalancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    totalCols
  );

  // 4. Table Headers
  const headerRow = kpiRow + 1;
  const columns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Type', width: 12, align: 'center' },
    { header: 'Debit Category', width: 22, align: 'left' },
    { header: 'Description', width: 38, align: 'left' },
    { header: 'Credit (INR)', width: 18, align: 'right' },
    { header: 'Debit (INR)', width: 18, align: 'right' },
    { header: 'Running Balance (INR)', width: 22, align: 'right' },
    { header: 'Reference Note', width: 26, align: 'left' },
  ];
  applyExcelJsTableHeader(ws, headerRow, columns);

  const dataStartRow = headerRow + 1;
  let currentRow = dataStartRow;

  const rowAligns: Array<'left' | 'center' | 'right'> = [
    'center',
    'center',
    'left',
    'left',
    'right',
    'right',
    'right',
    'left',
  ];

  if (data.transactions.length === 0) {
    applyExcelJsEmptyState(ws, currentRow, 'No financial transactions recorded for this period.', totalCols);
    currentRow++;

    const totalRow = ws.getRow(currentRow);
    totalRow.getCell(1).value = 'TOTAL MOVEMENTS';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = '';
    totalRow.getCell(5).value = 0;
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(6).value = 0;
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(7).value = data.summary.closingBalancePaise / 100;
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(8).value = '';

    applyExcelJsGrandTotalRow(totalRow, rowAligns);
    currentRow++;
  } else {
    // Sort transactions chronologically
    const sorted = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date));
    let runningBalancePaise = data.summary.openingBalancePaise;
    let txIdx = 0;

    for (const t of sorted) {
      const isCredit = t.type === 'CREDIT';
      if (isCredit) runningBalancePaise += t.amountPaise;
      else runningBalancePaise -= t.amountPaise;

      const debCategoryLabel = isCredit
        ? '—'
        : t.debitCategory === 'SPECIAL_WORKER_TASK'
        ? 'Special Worker/Task'
        : t.debitCategory || 'Supplies';

      const creditRupees = isCredit ? t.amountPaise / 100 : 0;
      const debitRupees = isCredit ? 0 : t.amountPaise / 100;
      const balanceRupees = runningBalancePaise / 100;

      const row = ws.getRow(currentRow);
      row.values = [
        t.date,
        t.type,
        debCategoryLabel,
        escapeExcelFormula(t.description),
        creditRupees,
        debitRupees,
        balanceRupees,
        escapeExcelFormula(t.referenceNote || '—'),
      ];

      row.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;
      row.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

      applyExcelJsDataRow(row, txIdx % 2 === 1, rowAligns);
      currentRow++;
      txIdx++;
    }

    const dataEndRow = currentRow - 1;
    const totalRow = ws.getRow(currentRow);
    totalRow.getCell(1).value = 'TOTAL MOVEMENTS';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = '';

    totalRow.getCell(5).value = {
      formula: `SUM(E${dataStartRow}:E${dataEndRow})`,
      result: data.summary.totalCreditPaise / 100,
    };
    totalRow.getCell(5).numFmt = EXCEL_FORMATS.CURRENCY;

    totalRow.getCell(6).value = {
      formula: `SUM(F${dataStartRow}:F${dataEndRow})`,
      result: data.summary.totalDebitPaise / 100,
    };
    totalRow.getCell(6).numFmt = EXCEL_FORMATS.CURRENCY;

    totalRow.getCell(7).value = data.summary.closingBalancePaise / 100;
    totalRow.getCell(7).numFmt = EXCEL_FORMATS.CURRENCY;

    totalRow.getCell(8).value = '';

    applyExcelJsGrandTotalRow(totalRow, rowAligns);
  }

  configureExcelJsWorksheet(ws, {
    orientation: 'landscape',
    freezeRow: headerRow,
    autoFilterRange: data.transactions.length > 0 ? `A${headerRow}:H${currentRow - 1}` : undefined,
    repeatHeaderRow: headerRow,
    reportTitle: meta.reportTitle || 'Financial Ledger',
  });

  return await writeExcelJsWorkbookToBuffer(wb);
}
