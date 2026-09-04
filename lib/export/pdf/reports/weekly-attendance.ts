import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { AttendanceDbRecord } from '../../../db/repositories/attendance-repo';

export interface WeeklyMatrixData {
  records: AttendanceDbRecord[];
  startDate: string;
  endDate: string;
}

/**
 * Generates Weekly Attendance Matrix PDF Report (A4 Landscape).
 */
export function generateWeeklyAttendancePDF(
  meta: BaseReportMetadata,
  data: WeeklyMatrixData
): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'landscape');

  // Compute 7 days of the week
  const weekDays: { dateStr: string; label: string; dayName: string }[] = [];
  const start = new Date(data.startDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const label = `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
    weekDays.push({ dateStr, label, dayName });
  }

  // Aggregate by Category -> Role
  const catMap = new Map<
    string,
    {
      name: string;
      roles: Map<
        string,
        {
          name: string;
          days: Map<string, { workerDays: number; costPaise: number }>;
          totalWorkerDays: number;
          totalCostPaise: number;
        }
      >;
      totalWorkerDays: number;
      totalCostPaise: number;
    }
  >();

  let grandTotalWorkerDays = 0;
  let grandTotalCostPaise = 0;

  for (const r of data.records) {
    const cId = r.category_id || 'other';
    if (!catMap.has(cId)) {
      catMap.set(cId, {
        name: r.category_name || 'General',
        roles: new Map(),
        totalWorkerDays: 0,
        totalCostPaise: 0,
      });
    }
    const cat = catMap.get(cId)!;

    if (!cat.roles.has(r.role_id)) {
      cat.roles.set(r.role_id, {
        name: r.role_name || 'Unknown Role',
        days: new Map(),
        totalWorkerDays: 0,
        totalCostPaise: 0,
      });
    }
    const role = cat.roles.get(r.role_id)!;

    role.days.set(r.date, {
      workerDays: r.worker_days,
      costPaise: r.total_cost_paise,
    });
    role.totalWorkerDays += r.worker_days;
    role.totalCostPaise += r.total_cost_paise;

    cat.totalWorkerDays += r.worker_days;
    cat.totalCostPaise += r.total_cost_paise;

    grandTotalWorkerDays += r.worker_days;
    grandTotalCostPaise += r.total_cost_paise;
  }

  // KPI Summary Box
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.landscape.usableWidth, 12, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.primary);

  const kpiText = `Weekly Range: ${data.startDate} to ${data.endDate}   |   Total Recorded Worker-Days: ${grandTotalWorkerDays}   |   Weekly Workforce Labour Cost: ${formatPDFCurrency(grandTotalCostPaise)}`;
  doc.text(kpiText, PDF_THEME.page.landscape.width / 2, startY + 7.5, { align: 'center' });

  // Empty check
  if (data.records.length === 0 || grandTotalWorkerDays === 0) {
    renderEmptyState(
      doc,
      startY + 16,
      'No attendance records recorded for this week.',
      'landscape'
    );
    applyDocumentFooters(doc, meta, 'landscape');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // Build rows
  const tableRows: RowInput[] = [];

  for (const [, cat] of catMap) {
    tableRows.push([
      {
        content: cat.name.toUpperCase(),
        colSpan: 10,
        styles: {
          fontStyle: 'bold',
          fillColor: PDF_THEME.colors.tableSubhead,
          textColor: PDF_THEME.colors.primary,
        },
      },
    ]);

    for (const [, role] of cat.roles) {
      const row: RowInput = [role.name];
      for (const wd of weekDays) {
        const d = role.days.get(wd.dateStr);
        row.push({
          content: d && d.workerDays > 0 ? String(d.workerDays) : '—',
          styles: { halign: 'center', textColor: d && d.workerDays > 0 ? [15, 23, 42] : [150, 150, 150] },
        });
      }
      row.push({ content: String(role.totalWorkerDays), styles: { halign: 'center', fontStyle: 'bold' } });
      row.push({ content: formatPDFCurrency(role.totalCostPaise), styles: { halign: 'right', fontStyle: 'bold' } });
      tableRows.push(row);
    }

    // Category subtotal
    tableRows.push([
      { content: `Subtotal — ${cat.name}`, colSpan: 8, styles: { fontStyle: 'bold', fillColor: [250, 250, 250] } },
      { content: String(cat.totalWorkerDays), styles: { fontStyle: 'bold', halign: 'center', fillColor: [250, 250, 250] } },
      { content: formatPDFCurrency(cat.totalCostPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: [250, 250, 250] } },
    ]);
  }

  // Grand Total
  tableRows.push([
    {
      content: 'GRAND TOTAL',
      colSpan: 8,
      styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow, textColor: PDF_THEME.colors.primary },
    },
    {
      content: String(grandTotalWorkerDays),
      styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow, textColor: PDF_THEME.colors.primary },
    },
    {
      content: formatPDFCurrency(grandTotalCostPaise),
      styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow, textColor: PDF_THEME.colors.primary },
    },
  ]);

  const headers = ['Category / Role', ...weekDays.map((w) => `${w.dayName}\n${w.label}`), 'Total W-Days', 'Weekly Cost'];

  const tableOptions = getBaseTableOptions(doc, meta, 'landscape', startY + 16);
  autoTable(doc, {
    ...tableOptions,
    head: [headers],
    body: tableRows,
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center' },
      5: { halign: 'center' },
      6: { halign: 'center' },
      7: { halign: 'center' },
      8: { halign: 'center' },
      9: { halign: 'right' },
    },
  });

  applyDocumentFooters(doc, meta, 'landscape');
  return Buffer.from(doc.output('arraybuffer'));
}
