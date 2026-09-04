import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { AttendanceDbRecord } from '../../../db/repositories/attendance-repo';

export interface MonthlyAttendanceData {
  records: AttendanceDbRecord[];
  monthLabel: string;
  startDate: string;
  endDate: string;
}

/**
 * Generates Comprehensive Monthly Attendance PDF Report (A4 Landscape).
 */
export function generateMonthlyAttendancePDF(
  meta: BaseReportMetadata,
  data: MonthlyAttendanceData
): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'landscape');

  const totalWorkers = data.records.reduce((sum, r) => sum + r.total_workers, 0);
  const totalFullDays = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalfDays = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkerDays = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);

  // Group by unique active days
  const activeDaysSet = new Set(data.records.map((r) => r.date));
  const activeDaysCount = activeDaysSet.size;
  const avgHeadcount = activeDaysCount > 0 ? (totalWorkerDays / activeDaysCount).toFixed(1) : '0';

  // KPI Overview Box
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.landscape.usableWidth, 12, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const kpiText = `Month: ${data.monthLabel}   |   Active Days: ${activeDaysCount}   |   Avg Daily Headcount: ${avgHeadcount}   |   Worker-Days: ${totalWorkerDays}   |   Total Labour: ${formatPDFCurrency(totalCostPaise)}`;
  doc.text(kpiText, PDF_THEME.page.landscape.width / 2, startY + 7.5, { align: 'center' });

  // Empty check
  if (data.records.length === 0 || totalWorkerDays === 0) {
    renderEmptyState(
      doc,
      startY + 16,
      'No workforce attendance recorded for this month.',
      'landscape'
    );
    applyDocumentFooters(doc, meta, 'landscape');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // 1. Category Rollup Summary
  const catRollup = new Map<string, { name: string; workerDays: number; costPaise: number }>();
  for (const r of data.records) {
    const cId = r.category_id || 'other';
    if (!catRollup.has(cId)) {
      catRollup.set(cId, { name: r.category_name || 'General', workerDays: 0, costPaise: 0 });
    }
    const cat = catRollup.get(cId)!;
    cat.workerDays += r.worker_days;
    cat.costPaise += r.total_cost_paise;
  }

  const catRows: RowInput[] = Array.from(catRollup.values()).map((c) => {
    const pct = totalWorkerDays > 0 ? ((c.workerDays / totalWorkerDays) * 100).toFixed(1) : '0';
    return [
      c.name,
      { content: String(c.workerDays), styles: { halign: 'center' } },
      { content: `${pct}%`, styles: { halign: 'center' } },
      { content: formatPDFCurrency(c.costPaise), styles: { halign: 'right', fontStyle: 'bold' } },
    ];
  });

  // Grand total category row
  catRows.push([
    { content: 'TOTAL WORKFORCE', styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalWorkerDays), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: '100%', styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(totalCostPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
  ]);

  const catTableOptions = getBaseTableOptions(doc, meta, 'landscape', startY + 16);
  autoTable(doc, {
    ...catTableOptions,
    head: [['Workforce Category', 'Worker-Days', '% Share', 'Labour Expenditure']],
    body: catRows,
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'right' },
    },
  });

  // 2. Daily Progression Log
  const finalY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text('Daily Deployment Progression Log', PDF_THEME.margins.left, finalY);

  // Group by date
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
      { content: String(d.workerDays), styles: { halign: 'center' } },
      { content: formatPDFCurrency(d.costPaise), styles: { halign: 'right' } },
    ];
  });

  const dailyTableOptions = getBaseTableOptions(doc, meta, 'landscape', finalY + 3);
  autoTable(doc, {
    ...dailyTableOptions,
    head: [['Date (ISO)', 'Day', 'Total Headcount', 'Recorded Worker-Days', 'Daily Labour Cost']],
    body: dailyRows,
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'left' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'landscape');
  return Buffer.from(doc.output('arraybuffer'));
}
