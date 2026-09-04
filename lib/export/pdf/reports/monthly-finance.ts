import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { FinancialSummary } from '../../../domain/finance-engine';
import { FinanceExportTransaction } from './financial-ledger';

/**
 * Generates Monthly Financial Statement & Running Ledger PDF Report (A4 Landscape).
 */
export function generateMonthlyFinancialPDF(
  meta: BaseReportMetadata,
  summary: FinancialSummary,
  transactions: FinanceExportTransaction[]
): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'landscape');

  // Executive Cash Flow KPI Box
  const boxHeight = 14;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.landscape.usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const col1X = PDF_THEME.margins.left + 4;
  const col2X = PDF_THEME.margins.left + 72;
  const col3X = PDF_THEME.margins.left + 140;
  const col4X = PDF_THEME.margins.left + 208;

  doc.text(`Opening Balance: ${formatPDFCurrency(summary.openingBalancePaise)}`, col1X, startY + 5.5);
  doc.text(`Total Credits (+): ${formatPDFCurrency(summary.totalCreditPaise)}`, col2X, startY + 5.5);
  doc.text(`Total Debits (-): ${formatPDFCurrency(summary.totalDebitPaise)}`, col3X, startY + 5.5);
  doc.text(`Closing Cash Balance: ${formatPDFCurrency(summary.closingBalancePaise)}`, col4X, startY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_THEME.colors.textMuted);
  doc.text(`Net Cash Flow: ${formatPDFCurrency(summary.netCashFlowPaise)}`, col1X, startY + 10.5);
  doc.text(`Material / Supplies: ${formatPDFCurrency(summary.suppliesDebitPaise)}`, col2X, startY + 10.5);
  doc.text(`Special Worker/Task: ${formatPDFCurrency(summary.specialWorkerTaskDebitPaise)}`, col3X, startY + 10.5);
  doc.text(`Activity Count: ${summary.transactionCount} entries`, col4X, startY + 10.5);

  // Empty check
  if (transactions.length === 0) {
    renderEmptyState(
      doc,
      startY + boxHeight + 4,
      'No cash movements recorded for this month.',
      'landscape'
    );
    applyDocumentFooters(doc, meta, 'landscape');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // Sort chronologically ascending to calculate running balance
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  let runningBalance = summary.openingBalancePaise;
  const tableRows: RowInput[] = [];

  // Opening Balance Row
  tableRows.push([
    meta.periodLabel.split(' ')[0] || '—',
    { content: 'OPENING', styles: { halign: 'center', fontStyle: 'bold' } },
    '—',
    'Opening Cash Position Brought Forward',
    '—',
    '—',
    { content: formatPDFCurrency(runningBalance), styles: { halign: 'right', fontStyle: 'bold' } },
  ]);

  for (const t of sorted) {
    if (t.type === 'CREDIT') {
      runningBalance += t.amountPaise;
    } else {
      runningBalance -= t.amountPaise;
    }

    tableRows.push([
      t.date,
      { content: t.type, styles: { halign: 'center', fontStyle: 'bold', textColor: t.type === 'CREDIT' ? [16, 185, 129] : [239, 68, 68] } },
      t.debitCategory === 'SPECIAL_WORKER_TASK' ? 'Special Task' : (t.debitCategory || '—'),
      t.description,
      { content: t.type === 'CREDIT' ? formatPDFCurrency(t.amountPaise) : '—', styles: { halign: 'right' } },
      { content: t.type === 'DEBIT' ? formatPDFCurrency(t.amountPaise) : '—', styles: { halign: 'right' } },
      { content: formatPDFCurrency(runningBalance), styles: { halign: 'right', fontStyle: 'bold' } },
    ]);
  }

  // Closing Balance Row
  tableRows.push([
    { content: 'PERIOD TOTALS', colSpan: 4, styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(summary.totalCreditPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(summary.totalDebitPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(summary.closingBalancePaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
  ]);

  const tableOptions = getBaseTableOptions(doc, meta, 'landscape', startY + boxHeight + 4);
  autoTable(doc, {
    ...tableOptions,
    head: [['Date', 'Type', 'Category', 'Description / Reference', 'Inflow (+)', 'Outflow (-)', 'Running Balance']],
    body: tableRows,
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 22, halign: 'center' },
      2: { cellWidth: 32 },
      3: { cellWidth: 95 },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
      6: { cellWidth: 34, halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'landscape');
  return Buffer.from(doc.output('arraybuffer'));
}
