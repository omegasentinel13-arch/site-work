import { BaseExcelMetadata, MonthlyFinancialExcelData } from '../types';
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

export async function generateMonthlyFinancialExcel(
  meta: BaseExcelMetadata,
  data: MonthlyFinancialExcelData
): Promise<Buffer> {
  const wb = createExcelJsWorkbook();
  const sharedSubtitle = `Site: ${meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName} | Month: ${meta.periodLabel}`;

  // --------------------------------------------------------------------------
  // SHEET 1: Monthly Statement (Executive Summary)
  // --------------------------------------------------------------------------
  const wsStmt = wb.addWorksheet('Monthly Statement');
  const stmtCols = 4;

  // 1. Corporate Title Banner
  applyExcelJsTitleBanner(wsStmt, 'Monthly Financial Statement', sharedSubtitle, stmtCols);

  // 2. Metadata Block
  const stmtMetaEnd = applyExcelJsMetadataBlock(wsStmt, 3, meta, stmtCols);

  // 3. Statement Table Headers
  const stmtHeaderRow = stmtMetaEnd;
  const stmtColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Financial Accounting Item', width: 38, align: 'left' },
    { header: 'Classification', width: 22, align: 'center' },
    { header: 'Amount (INR)', width: 24, align: 'right' },
    { header: '% of Inflows', width: 18, align: 'right' },
  ];
  applyExcelJsTableHeader(wsStmt, stmtHeaderRow, stmtColumns);

  const totalInflowsPaise = data.summary.totalCreditPaise;
  const calcShare = (amountPaise: number) => {
    if (totalInflowsPaise <= 0) return 0;
    return amountPaise / totalInflowsPaise;
  };

  const statementItems = [
    {
      item: 'Opening Cash Balance',
      classification: 'Initial Position',
      amount: data.summary.openingBalancePaise / 100,
      share: null,
      isTotal: false,
    },
    {
      item: 'Total Cash Inflows (Credits)',
      classification: 'Operational Inflows',
      amount: data.summary.totalCreditPaise / 100,
      share: totalInflowsPaise > 0 ? 1.0 : 0.0,
      isTotal: false,
    },
    {
      item: 'Material / Supplies Outflows',
      classification: 'Operating Expense (Debit)',
      amount: data.summary.suppliesDebitPaise / 100,
      share: calcShare(data.summary.suppliesDebitPaise),
      isTotal: false,
    },
    {
      item: 'Special Worker / Task Outflows',
      classification: 'Operating Expense (Debit)',
      amount: data.summary.specialWorkerTaskDebitPaise / 100,
      share: calcShare(data.summary.specialWorkerTaskDebitPaise),
      isTotal: false,
    },
    {
      item: 'Total Cash Outflows (Debits)',
      classification: 'Total Disbursements',
      amount: data.summary.totalDebitPaise / 100,
      share: calcShare(data.summary.totalDebitPaise),
      isTotal: false,
    },
    {
      item: 'Net Cash Movement (Surplus / Deficit)',
      classification: 'Period Movement',
      amount: data.summary.netCashFlowPaise / 100,
      share: calcShare(data.summary.netCashFlowPaise),
      isTotal: false,
    },
    {
      item: 'Closing Cash Balance',
      classification: 'Terminal Position',
      amount: data.summary.closingBalancePaise / 100,
      share: null,
      isTotal: true,
    },
  ];

  let currentStmtRow = stmtHeaderRow + 1;
  const stmtAligns: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right', 'right'];

  for (let i = 0; i < statementItems.length; i++) {
    const itm = statementItems[i];
    const row = wsStmt.getRow(currentStmtRow);

    row.values = [
      itm.item,
      itm.classification,
      itm.amount,
      itm.share !== null ? itm.share : '—',
    ];

    row.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
    if (itm.share !== null) {
      row.getCell(4).numFmt = EXCEL_FORMATS.PERCENT;
    }

    if (itm.isTotal) {
      applyExcelJsGrandTotalRow(row, stmtAligns);
    } else {
      applyExcelJsDataRow(row, i % 2 === 1, stmtAligns);
    }

    currentStmtRow++;
  }

  // Spacing and volume indicator
  currentStmtRow++;
  const volumeRow = wsStmt.getRow(currentStmtRow);
  volumeRow.getCell(1).value = 'Total Transactions Audited';
  volumeRow.getCell(2).value = data.summary.transactionCount;
  volumeRow.getCell(2).numFmt = EXCEL_FORMATS.INTEGER;

  configureExcelJsWorksheet(wsStmt, {
    orientation: 'portrait',
    freezeRow: stmtHeaderRow,
    reportTitle: 'Monthly Financial Statement',
  });

  // --------------------------------------------------------------------------
  // SHEET 2: Cash Inflows (Credits)
  // --------------------------------------------------------------------------
  const wsInflows = wb.addWorksheet('Cash Inflows');
  const inflowCols = 4;

  // 1. Title Banner
  applyExcelJsTitleBanner(wsInflows, 'Monthly Cash Inflows (Credits)', sharedSubtitle, inflowCols);

  // 2. Metadata Block
  const inflowsMetaEnd = applyExcelJsMetadataBlock(wsInflows, 3, meta, inflowCols);

  const credits = data.transactions.filter((t) => t.type === 'CREDIT');

  // 3. KPI Strip
  const inflowKpiRow = inflowsMetaEnd;
  applyExcelJsKpiStrip(
    wsInflows,
    inflowKpiRow,
    [
      { label: 'Inflow Transactions', value: credits.length },
      {
        label: 'Total Inflow Amount',
        value: `₹${(data.summary.totalCreditPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    inflowCols
  );

  // 4. Table Headers
  const inflowHeaderRow = inflowKpiRow + 1;
  const inflowColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Description', width: 40, align: 'left' },
    { header: 'Credit Amount (INR)', width: 24, align: 'right' },
    { header: 'Reference Note', width: 28, align: 'left' },
  ];
  applyExcelJsTableHeader(wsInflows, inflowHeaderRow, inflowColumns);

  const inflowDataStart = inflowHeaderRow + 1;
  let currentInflowRow = inflowDataStart;
  const inflowAligns: Array<'left' | 'center' | 'right'> = ['center', 'left', 'right', 'left'];

  if (credits.length === 0) {
    applyExcelJsEmptyState(wsInflows, currentInflowRow, 'No cash inflows recorded for this month.', inflowCols);
    currentInflowRow++;

    const totalRow = wsInflows.getRow(currentInflowRow);
    totalRow.getCell(1).value = 'TOTAL INFLOWS';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = 0;
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(4).value = '';
    applyExcelJsGrandTotalRow(totalRow, inflowAligns);
    currentInflowRow++;
  } else {
    let cIdx = 0;
    for (const t of credits) {
      const row = wsInflows.getRow(currentInflowRow);
      row.values = [
        t.date,
        escapeExcelFormula(t.description),
        t.amountPaise / 100,
        escapeExcelFormula(t.referenceNote || '—'),
      ];

      row.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
      applyExcelJsDataRow(row, cIdx % 2 === 1, inflowAligns);
      currentInflowRow++;
      cIdx++;
    }

    const endRow = currentInflowRow - 1;
    const totalRow = wsInflows.getRow(currentInflowRow);
    totalRow.getCell(1).value = 'TOTAL INFLOWS';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = {
      formula: `SUM(C${inflowDataStart}:C${endRow})`,
      result: data.summary.totalCreditPaise / 100,
    };
    totalRow.getCell(3).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(4).value = '';

    applyExcelJsGrandTotalRow(totalRow, inflowAligns);
  }

  configureExcelJsWorksheet(wsInflows, {
    orientation: 'portrait',
    freezeRow: inflowHeaderRow,
    autoFilterRange: credits.length > 0 ? `A${inflowHeaderRow}:D${currentInflowRow - 1}` : undefined,
    repeatHeaderRow: inflowHeaderRow,
    reportTitle: 'Cash Inflows',
  });

  // --------------------------------------------------------------------------
  // SHEET 3: Cash Outflows (Debits)
  // --------------------------------------------------------------------------
  const wsOutflows = wb.addWorksheet('Cash Outflows');
  const outflowCols = 5;

  // 1. Title Banner
  applyExcelJsTitleBanner(wsOutflows, 'Monthly Cash Outflows (Debits)', sharedSubtitle, outflowCols);

  // 2. Metadata Block
  const outflowsMetaEnd = applyExcelJsMetadataBlock(wsOutflows, 3, meta, outflowCols);

  const debits = data.transactions.filter((t) => t.type === 'DEBIT');

  // 3. KPI Strip
  const outflowKpiRow = outflowsMetaEnd;
  applyExcelJsKpiStrip(
    wsOutflows,
    outflowKpiRow,
    [
      { label: 'Outflow Transactions', value: debits.length },
      {
        label: 'Material / Supplies',
        value: `₹${(data.summary.suppliesDebitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Special Tasks',
        value: `₹${(data.summary.specialWorkerTaskDebitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
      {
        label: 'Total Outflows',
        value: `₹${(data.summary.totalDebitPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      },
    ],
    outflowCols
  );

  // 4. Table Headers
  const outflowHeaderRow = outflowKpiRow + 1;
  const outflowColumns: Array<{ header: string; width: number; align: 'left' | 'center' | 'right' }> = [
    { header: 'Date', width: 14, align: 'center' },
    { header: 'Debit Category', width: 24, align: 'left' },
    { header: 'Description', width: 38, align: 'left' },
    { header: 'Debit Amount (INR)', width: 24, align: 'right' },
    { header: 'Reference Note', width: 28, align: 'left' },
  ];
  applyExcelJsTableHeader(wsOutflows, outflowHeaderRow, outflowColumns);

  const outflowDataStart = outflowHeaderRow + 1;
  let currentOutflowRow = outflowDataStart;
  const outflowAligns: Array<'left' | 'center' | 'right'> = ['center', 'left', 'left', 'right', 'left'];

  if (debits.length === 0) {
    applyExcelJsEmptyState(wsOutflows, currentOutflowRow, 'No cash outflows recorded for this month.', outflowCols);
    currentOutflowRow++;

    const totalRow = wsOutflows.getRow(currentOutflowRow);
    totalRow.getCell(1).value = 'TOTAL OUTFLOWS';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = 0;
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(5).value = '';
    applyExcelJsGrandTotalRow(totalRow, outflowAligns);
    currentOutflowRow++;
  } else {
    let dIdx = 0;
    for (const t of debits) {
      const catLabel = t.debitCategory === 'SPECIAL_WORKER_TASK' ? 'Special Worker/Task' : t.debitCategory || 'Supplies';
      const row = wsOutflows.getRow(currentOutflowRow);

      row.values = [
        t.date,
        catLabel,
        escapeExcelFormula(t.description),
        t.amountPaise / 100,
        escapeExcelFormula(t.referenceNote || '—'),
      ];

      row.getCell(4).numFmt = EXCEL_FORMATS.CURRENCY;
      applyExcelJsDataRow(row, dIdx % 2 === 1, outflowAligns);
      currentOutflowRow++;
      dIdx++;
    }

    const endRow = currentOutflowRow - 1;
    const totalRow = wsOutflows.getRow(currentOutflowRow);
    totalRow.getCell(1).value = 'TOTAL OUTFLOWS';
    totalRow.getCell(2).value = '';
    totalRow.getCell(3).value = '';
    totalRow.getCell(4).value = {
      formula: `SUM(D${outflowDataStart}:D${endRow})`,
      result: data.summary.totalDebitPaise / 100,
    };
    totalRow.getCell(4).numFmt = EXCEL_FORMATS.CURRENCY;
    totalRow.getCell(5).value = '';

    applyExcelJsGrandTotalRow(totalRow, outflowAligns);
  }

  configureExcelJsWorksheet(wsOutflows, {
    orientation: 'landscape',
    freezeRow: outflowHeaderRow,
    autoFilterRange: debits.length > 0 ? `A${outflowHeaderRow}:E${currentOutflowRow - 1}` : undefined,
    repeatHeaderRow: outflowHeaderRow,
    reportTitle: 'Cash Outflows',
  });

  return await writeExcelJsWorkbookToBuffer(wb);
}
