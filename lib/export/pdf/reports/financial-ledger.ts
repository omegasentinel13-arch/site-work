import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { FinancialSummary } from '../../../domain/finance-engine';

export interface FinanceExportTransaction {
  date: string;
  type: string;
  debitCategory?: string | null;
  description: string;
  amountPaise: number;
}

/**
 * Generates Financial Transactions Ledger PDF Report (A4 Portrait).
 */
export function generateFinancialPDF(
  meta: BaseReportMetadata,
  summary: FinancialSummary,
  transactions: FinanceExportTransaction[]
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'portrait');

  // Financial Stats Summary Box
  const boxHeight = 18;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const col1X = PDF_THEME.margins.left + 4;
  const col2X = PDF_THEME.margins.left + 65;
  const col3X = PDF_THEME.margins.left + 125;

  doc.text(`Opening Balance: ${formatPDFCurrency(summary.openingBalancePaise)}`, col1X, startY + 5);
  doc.text(`Total Credits: ${formatPDFCurrency(summary.totalCreditPaise)}`, col2X, startY + 5);
  doc.text(`Net Cash Flow: ${formatPDFCurrency(summary.netCashFlowPaise)}`, col3X, startY + 5);

  doc.text(`Supplies Debits: ${formatPDFCurrency(summary.suppliesDebitPaise)}`, col1X, startY + 10.5);
  doc.text(`Special Tasks: ${formatPDFCurrency(summary.specialWorkerTaskDebitPaise)}`, col2X, startY + 10.5);
  doc.text(`Total Debits: ${formatPDFCurrency(summary.totalDebitPaise)}`, col3X, startY + 10.5);

  doc.text(`Closing Cash Balance: ${formatPDFCurrency(summary.closingBalancePaise)}`, col1X, startY + 15.5);
  doc.text(`Transaction Count: ${summary.transactionCount}`, col2X, startY + 15.5);

  // Empty check
  if (transactions.length === 0) {
    renderEmptyState(
      doc,
      startY + boxHeight + 4,
      'No financial transactions recorded for this period.',
      'portrait'
    );
    applyDocumentFooters(doc, meta, 'portrait');
    return Buffer.from(doc.output('arraybuffer'));
  }

  const tableRows: RowInput[] = transactions.map((t) => [
    t.date,
    { content: t.type, styles: { halign: 'center', fontStyle: 'bold', textColor: t.type === 'CREDIT' ? [16, 185, 129] : [239, 68, 68] } },
    t.debitCategory === 'SPECIAL_WORKER_TASK' ? 'Special Task' : (t.debitCategory || '—'),
    t.description,
    { content: t.type === 'CREDIT' ? formatPDFCurrency(t.amountPaise) : '—', styles: { halign: 'right' } },
    { content: t.type === 'DEBIT' ? formatPDFCurrency(t.amountPaise) : '—', styles: { halign: 'right' } },
  ]);

  // Grand Total row
  tableRows.push([
    { content: 'TOTALS', colSpan: 4, styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(summary.totalCreditPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(summary.totalDebitPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
  ]);

  const tableOptions = getBaseTableOptions(doc, meta, 'portrait', startY + boxHeight + 4);
  autoTable(doc, {
    ...tableOptions,
    head: [['Date', 'Type', 'Category', 'Description', 'Credit (+)', 'Debit (-)']],
    body: tableRows,
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 26 },
      3: { cellWidth: 56 },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'portrait');
  return Buffer.from(doc.output('arraybuffer'));
}
