import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { AttendanceDbRecord } from '../../../db/repositories/attendance-repo';
import { FinancialSummary } from '../../../domain/finance-engine';

export interface SitePerformanceData {
  siteName: string;
  siteLocation?: string | null;
  attendanceRecords: AttendanceDbRecord[];
  financialSummary: FinancialSummary;
}

/**
 * Generates Executive Site Performance Report PDF (A4 Portrait).
 */
export function generateSitePerformancePDF(
  meta: BaseReportMetadata,
  data: SitePerformanceData
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'portrait');

  const totalWorkerDays = data.attendanceRecords.reduce((sum, r) => sum + r.worker_days, 0);
  const totalLabourCostPaise = data.attendanceRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const totalWorkers = data.attendanceRecords.reduce((sum, r) => sum + r.total_workers, 0);
  const activeDays = new Set(data.attendanceRecords.map((r) => r.date)).size;
  const avgDaily = activeDays > 0 ? (totalWorkerDays / activeDays).toFixed(1) : '0';

  const fin = data.financialSummary;
  const totalProjectExpenditurePaise = totalLabourCostPaise + fin.totalDebitPaise;

  // Empty check
  if (data.attendanceRecords.length === 0 && fin.transactionCount === 0) {
    renderEmptyState(
      doc,
      startY + 4,
      'No operational or financial data recorded for this period.',
      'portrait'
    );
    applyDocumentFooters(doc, meta, 'portrait');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // 1. Executive Metric Summary Cards (2 rows)
  const boxHeight = 22;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const c1X = PDF_THEME.margins.left + 4;
  const c2X = PDF_THEME.margins.left + 65;
  const c3X = PDF_THEME.margins.left + 125;

  doc.text('OPERATIONAL WORKFORCE', c1X, startY + 5);
  doc.text('FINANCIAL CASH FLOW', c2X, startY + 5);
  doc.text('TOTAL EXPENDITURE', c3X, startY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_THEME.colors.textMuted);

  doc.text(`Recorded W-Days: ${totalWorkerDays}`, c1X, startY + 10);
  doc.text(`Active Working Days: ${activeDays}`, c1X, startY + 14.5);
  doc.text(`Labour Cost: ${formatPDFCurrency(totalLabourCostPaise)}`, c1X, startY + 19);

  doc.text(`Credits Received: ${formatPDFCurrency(fin.totalCreditPaise)}`, c2X, startY + 10);
  doc.text(`Site Debits: ${formatPDFCurrency(fin.totalDebitPaise)}`, c2X, startY + 14.5);
  doc.text(`Closing Cash: ${formatPDFCurrency(fin.closingBalancePaise)}`, c2X, startY + 19);

  doc.text(`Total Period Outlay:`, c3X, startY + 10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PDF_THEME.colors.accent);
  doc.text(`${formatPDFCurrency(totalProjectExpenditurePaise)}`, c3X, startY + 15);

  // 2. Section A: Workforce Rollup Table
  const tableY = startY + boxHeight + 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text('1. Operational Workforce Deployment', PDF_THEME.margins.left, tableY);

  const workforceRows: RowInput[] = [
    ['Total Recorded Manpower (Headcount)', String(totalWorkers)],
    ['Total Computed Worker-Days', String(totalWorkerDays)],
    ['Active Site Operating Days', String(activeDays)],
    ['Average Daily Workforce Headcount', `${avgDaily} workers/day`],
    [
      { content: 'Total Operational Labour Cost', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(totalLabourCostPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ],
  ];

  const workforceOptions = getBaseTableOptions(doc, meta, 'portrait', tableY + 2.5);
  autoTable(doc, {
    ...workforceOptions,
    head: [['Operational Metric', 'Recorded Value']],
    body: workforceRows,
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 62, halign: 'right' },
    },
  });

  // 3. Section B: Financial Summary Statement
  const finTableY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text('2. Financial Cash Statement & Fund Movements', PDF_THEME.margins.left, finTableY);

  const finRows: RowInput[] = [
    ['Opening Cash Balance Brought Forward', formatPDFCurrency(fin.openingBalancePaise)],
    ['Total Credits Received (+)', formatPDFCurrency(fin.totalCreditPaise)],
    ['Material & Supplies Outflows (-)', formatPDFCurrency(fin.suppliesDebitPaise)],
    ['Special Tasks & Contractors Outflows (-)', formatPDFCurrency(fin.specialWorkerTaskDebitPaise)],
    [
      { content: 'Total Site Debits (-)', styles: { fontStyle: 'bold' } },
      { content: formatPDFCurrency(fin.totalDebitPaise), styles: { fontStyle: 'bold', halign: 'right' } },
    ],
    ['Net Cash Flow', formatPDFCurrency(fin.netCashFlowPaise)],
    [
      { content: 'Closing Site Cash Balance', styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow } },
      { content: formatPDFCurrency(fin.closingBalancePaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
    ],
  ];

  const finOptions = getBaseTableOptions(doc, meta, 'portrait', finTableY + 2.5);
  autoTable(doc, {
    ...finOptions,
    head: [['Statement Line Item', 'Amount (INR)']],
    body: finRows,
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 62, halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'portrait');
  return Buffer.from(doc.output('arraybuffer'));
}
