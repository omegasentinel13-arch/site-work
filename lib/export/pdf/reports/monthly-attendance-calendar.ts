import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { AttendanceDbRecord } from '../../../db/repositories/attendance-repo';

export interface MonthlyAttendanceCalendarData {
  records: AttendanceDbRecord[];
  monthLabel: string;
  startDate: string;
  endDate: string;
}

/**
 * Generates Monthly Attendance Calendar View PDF Report (A4 Landscape, 7-Column Mon-Sun Calendar Grid).
 */
export function generateMonthlyAttendanceCalendarPDF(
  meta: BaseReportMetadata,
  data: MonthlyAttendanceCalendarData
): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'landscape');

  const totalWorkers = data.records.reduce((sum, r) => sum + r.total_workers, 0);
  const totalFullDays = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalfDays = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkerDays = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);

  // Group attendance by date
  const dailyMap = new Map<
    string,
    {
      workers: number;
      full: number;
      half: number;
      workerDays: number;
      costPaise: number;
      roleBreakdown: { roleName: string; count: number }[];
    }
  >();

  for (const r of data.records) {
    if (!dailyMap.has(r.date)) {
      dailyMap.set(r.date, {
        workers: 0,
        full: 0,
        half: 0,
        workerDays: 0,
        costPaise: 0,
        roleBreakdown: [],
      });
    }
    const d = dailyMap.get(r.date)!;
    d.workers += r.total_workers;
    d.full += r.full_day_count;
    d.half += r.half_day_count;
    d.workerDays += r.worker_days;
    d.costPaise += r.total_cost_paise;
    d.roleBreakdown.push({
      roleName: r.role_name || 'Worker',
      count: r.total_workers,
    });
  }

  const activeDaysCount = dailyMap.size;
  const avgHeadcount = activeDaysCount > 0 ? (totalWorkerDays / activeDaysCount).toFixed(1) : '0';

  // KPI Overview Box
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.landscape.usableWidth, 12, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const kpiText = `Monthly Attendance Calendar: ${data.monthLabel}   |   Active Deployment Days: ${activeDaysCount}   |   Avg Daily Headcount: ${avgHeadcount}   |   Total Worker-Days: ${totalWorkerDays}   |   Total Labour Cost: ${formatPDFCurrency(totalCostPaise)}`;
  doc.text(kpiText, PDF_THEME.page.landscape.width / 2, startY + 7.5, { align: 'center' });

  // Parse start date for calendar grid derivation
  const [yStr, mStr] = data.startDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);

  const firstDay = new Date(year, month - 1, 1);
  const startingOffset = (firstDay.getDay() + 6) % 7; // 0 for Monday, 6 for Sunday
  const totalDaysInMonth = new Date(year, month, 0).getDate();

  // Build weeks matrix (7 columns: Mon..Sun)
  const weekRows: RowInput[] = [];
  let currentDay = 1;
  const totalSlots = startingOffset + totalDaysInMonth;
  const totalWeeks = Math.ceil(totalSlots / 7);

  for (let w = 0; w < totalWeeks; w++) {
    const weekRow: any[] = [];
    for (let col = 0; col < 7; col++) {
      const slotIndex = w * 7 + col;
      if (slotIndex < startingOffset || currentDay > totalDaysInMonth) {
        weekRow.push({
          content: '',
          styles: { fillColor: [248, 249, 250], textColor: [180, 185, 190] },
        });
      } else {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
        const dayMetrics = dailyMap.get(dateStr);

        let cellText = `DAY ${currentDay}\n`;
        if (dayMetrics && dayMetrics.workerDays > 0) {
          cellText += `${dayMetrics.full}F + ${dayMetrics.half}H (${dayMetrics.workers}w)\n`;
          cellText += `${dayMetrics.workerDays} Day Count\n`;
          cellText += `${formatPDFCurrency(dayMetrics.costPaise)}`;
        } else {
          cellText += '\nNo Attendance\n—';
        }

        weekRow.push({
          content: cellText,
          styles: {
            fillColor: dayMetrics && dayMetrics.workerDays > 0 ? [255, 255, 255] : [250, 250, 252],
            textColor: dayMetrics && dayMetrics.workerDays > 0 ? PDF_THEME.colors.textMain : PDF_THEME.colors.textMuted,
            fontStyle: dayMetrics && dayMetrics.workerDays > 0 ? 'normal' : 'italic',
            halign: 'center',
            valign: 'middle',
          },
        });
        currentDay++;
      }
    }
    weekRows.push(weekRow);
  }

  // Monthly Calendar Grid Table
  const tableOptions = getBaseTableOptions(doc, meta, 'landscape', startY + 16);
  const colWidth = PDF_THEME.page.landscape.usableWidth / 7;

  autoTable(doc, {
    ...tableOptions,
    head: [['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']],
    body: weekRows,
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      minCellHeight: 18,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: PDF_THEME.colors.primary,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: colWidth },
      1: { cellWidth: colWidth },
      2: { cellWidth: colWidth },
      3: { cellWidth: colWidth },
      4: { cellWidth: colWidth },
      5: { cellWidth: colWidth },
      6: { cellWidth: colWidth },
    },
  });

  // Calendar Summary Total Strip at the bottom
  const finalY = (doc as any).lastAutoTable.finalY + 4;
  if (finalY + 16 < PDF_THEME.page.landscape.height - PDF_THEME.margins.bottom) {
    doc.setFillColor(...PDF_THEME.colors.totalRow);
    doc.setDrawColor(...PDF_THEME.colors.border);
    doc.roundedRect(PDF_THEME.margins.left, finalY, PDF_THEME.page.landscape.usableWidth, 10, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.colors.primary);
    const summaryText = `MONTH TOTALS:   Full Days: ${totalFullDays}   |   Half Days: ${totalHalfDays}   |   Total Worker-Days: ${totalWorkerDays}   |   Total Labour Cost: ${formatPDFCurrency(totalCostPaise)}`;
    doc.text(summaryText, PDF_THEME.page.landscape.width / 2, finalY + 6.5, { align: 'center' });
  }

  applyDocumentFooters(doc, meta, 'landscape');
  return Buffer.from(doc.output('arraybuffer'));
}
