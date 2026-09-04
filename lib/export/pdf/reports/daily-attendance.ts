import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { DailySummary } from '../../../domain/attendance-engine';

/**
 * Generates enterprise-grade Daily Attendance PDF Report (A4 Portrait).
 */
export function generateDailyAttendancePDF(
  meta: BaseReportMetadata,
  summary: DailySummary
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'portrait');

  // 1. Executive KPI Summary Box
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, 12, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const kpiText = `Total Workers: ${summary.totalWorkers}   |   Full Day: ${summary.fullDayCount}   |   Half Day: ${summary.halfDayCount}   |   Worker-Days: ${summary.workerDays}   |   Total Labour Cost: ${formatPDFCurrency(summary.totalLabourCostPaise)}`;
  doc.text(kpiText, PDF_THEME.page.portrait.width / 2, startY + 7.5, { align: 'center' });

  // 2. Empty State Check
  if (summary.categories.length === 0 || summary.totalWorkers === 0) {
    renderEmptyState(
      doc,
      startY + 16,
      'No attendance records recorded for this date.',
      'portrait'
    );
    applyDocumentFooters(doc, meta, 'portrait');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // 3. Build Table Rows
  const tableRows: RowInput[] = [];

  for (const cat of summary.categories) {
    // Category Banner Row
    tableRows.push([
      {
        content: cat.categoryName.toUpperCase(),
        colSpan: 6,
        styles: {
          fontStyle: 'bold',
          fillColor: PDF_THEME.colors.tableSubhead,
          textColor: PDF_THEME.colors.primary,
        },
      },
    ]);

    // Role Rows
    for (const r of cat.roles) {
      tableRows.push([
        r.roleName,
        { content: formatPDFCurrency(r.rateInPaise), styles: { halign: 'right' } },
        { content: String(r.fullDayCount), styles: { halign: 'center' } },
        { content: String(r.halfDayCount), styles: { halign: 'center' } },
        { content: String(r.totalWorkers), styles: { halign: 'center' } },
        { content: formatPDFCurrency(r.totalCostPaise), styles: { halign: 'right', fontStyle: 'bold' } },
      ]);
    }

    // Category Subtotal
    tableRows.push([
      {
        content: `Subtotal — ${cat.categoryName}`,
        colSpan: 4,
        styles: { fontStyle: 'bold', fillColor: [250, 250, 250] },
      },
      {
        content: `${cat.totalWorkers} (${cat.workerDays} w-days)`,
        styles: { fontStyle: 'bold', halign: 'center', fillColor: [250, 250, 250] },
      },
      {
        content: formatPDFCurrency(cat.totalCostPaise),
        styles: { fontStyle: 'bold', halign: 'right', fillColor: [250, 250, 250] },
      },
    ]);
  }

  // Grand Total Row
  tableRows.push([
    {
      content: 'GRAND TOTAL',
      colSpan: 4,
      styles: {
        fontStyle: 'bold',
        fillColor: PDF_THEME.colors.totalRow,
        textColor: PDF_THEME.colors.primary,
      },
    },
    {
      content: `${summary.totalWorkers} (${summary.workerDays} w-days)`,
      styles: {
        fontStyle: 'bold',
        halign: 'center',
        fillColor: PDF_THEME.colors.totalRow,
        textColor: PDF_THEME.colors.primary,
      },
    },
    {
      content: formatPDFCurrency(summary.totalLabourCostPaise),
      styles: {
        fontStyle: 'bold',
        halign: 'right',
        fillColor: PDF_THEME.colors.totalRow,
        textColor: PDF_THEME.colors.primary,
      },
    },
  ]);

  const tableOptions = getBaseTableOptions(doc, meta, 'portrait', startY + 16);
  autoTable(doc, {
    ...tableOptions,
    head: [['Role Name', 'Daily Wage', 'Full Day', 'Half Day', 'Workers', 'Total Cost']],
    body: tableRows,
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 28, halign: 'right' },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 25, halign: 'center' },
      5: { cellWidth: 30, halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'portrait');
  return Buffer.from(doc.output('arraybuffer'));
}
