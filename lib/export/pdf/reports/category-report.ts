import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { AttendanceDbRecord } from '../../../db/repositories/attendance-repo';

export interface CategoryReportData {
  categoryName: string;
  records: AttendanceDbRecord[];
}

/**
 * Generates Category Breakdown PDF Report (A4 Portrait).
 */
export function generateCategoryReportPDF(
  meta: BaseReportMetadata,
  data: CategoryReportData
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'portrait');

  const totalFull = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkerDays = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const activeDays = new Set(data.records.map((r) => r.date)).size;
  const avgDaily = activeDays > 0 ? (totalWorkerDays / activeDays).toFixed(1) : '0';

  // Category Header Box
  const boxHeight = 16;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text(`Workforce Category: ${data.categoryName}`, PDF_THEME.margins.left + 4, startY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.textMuted);
  const statsLine = `Active Days: ${activeDays}   |   Avg Daily Headcount: ${avgDaily}   |   Total Worker-Days: ${totalWorkerDays}   |   Total Category Labour: ${formatPDFCurrency(totalCostPaise)}`;
  doc.text(statsLine, PDF_THEME.margins.left + 4, startY + 11.5);

  // Empty check
  if (data.records.length === 0) {
    renderEmptyState(
      doc,
      startY + boxHeight + 4,
      'Selected category had zero deployment in this period.',
      'portrait'
    );
    applyDocumentFooters(doc, meta, 'portrait');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // 1. Role Rollup inside this category
  const roleRollup = new Map<string, { name: string; full: number; half: number; workerDays: number; costPaise: number }>();
  for (const r of data.records) {
    if (!roleRollup.has(r.role_id)) {
      roleRollup.set(r.role_id, { name: r.role_name || 'Role', full: 0, half: 0, workerDays: 0, costPaise: 0 });
    }
    const role = roleRollup.get(r.role_id)!;
    role.full += r.full_day_count;
    role.half += r.half_day_count;
    role.workerDays += r.worker_days;
    role.costPaise += r.total_cost_paise;
  }

  const roleRows: RowInput[] = Array.from(roleRollup.values()).map((r) => {
    const pct = totalWorkerDays > 0 ? ((r.workerDays / totalWorkerDays) * 100).toFixed(1) : '0';
    return [
      r.name,
      { content: String(r.full), styles: { halign: 'center' } },
      { content: String(r.half), styles: { halign: 'center' } },
      { content: String(r.workerDays), styles: { halign: 'center', fontStyle: 'bold' } },
      { content: `${pct}%`, styles: { halign: 'center' } },
      { content: formatPDFCurrency(r.costPaise), styles: { halign: 'right', fontStyle: 'bold' } },
    ];
  });

  roleRows.push([
    { content: 'CATEGORY TOTAL', styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalFull), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalHalf), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalWorkerDays), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: '100%', styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(totalCostPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
  ]);

  const tableOptions = getBaseTableOptions(doc, meta, 'portrait', startY + boxHeight + 4);
  autoTable(doc, {
    ...tableOptions,
    head: [['Role Name', 'Full Day', 'Half Day', 'Worker-Days', '% Share', 'Total Cost']],
    body: roleRows,
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 24, halign: 'center' },
      2: { cellWidth: 24, halign: 'center' },
      3: { cellWidth: 26, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 32, halign: 'right' },
    },
  });

  // 2. Daily Log for category
  const finalY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text('Daily Category Deployment Log', PDF_THEME.margins.left, finalY);

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
  const dailyRows: RowInput[] = sortedDates.map((dateStr) => {
    const d = dayMap.get(dateStr)!;
    const dateObj = new Date(dateStr);
    const dayLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' });
    return [
      dateStr,
      dayLabel,
      { content: String(d.workers), styles: { halign: 'center' } },
      { content: String(d.workerDays), styles: { halign: 'center', fontStyle: 'bold' } },
      { content: formatPDFCurrency(d.costPaise), styles: { halign: 'right' } },
    ];
  });

  const dailyOptions = getBaseTableOptions(doc, meta, 'portrait', finalY + 3);
  autoTable(doc, {
    ...dailyOptions,
    head: [['Date (ISO)', 'Day', 'Workers Deployed', 'Worker-Days', 'Daily Cost']],
    body: dailyRows,
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 46 },
      2: { cellWidth: 32, halign: 'center' },
      3: { cellWidth: 32, halign: 'center' },
      4: { cellWidth: 36, halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'portrait');
  return Buffer.from(doc.output('arraybuffer'));
}
