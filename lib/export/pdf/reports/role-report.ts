import { jsPDF } from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { BaseReportMetadata } from '../types';
import { drawDocumentHeader } from '../headers';
import { applyDocumentFooters } from '../footers';
import { getBaseTableOptions, renderEmptyState } from '../tables';
import { PDF_THEME, formatPDFCurrency } from '../theme';
import { AttendanceDbRecord } from '../../../db/repositories/attendance-repo';

export interface RoleReportData {
  roleName: string;
  categoryName: string;
  records: AttendanceDbRecord[];
  isAllRoles?: boolean;
  roleNames?: string[];
  isMultiRole?: boolean;
}

/**
 * Generates Role Specific Breakdown PDF Report (A4 Portrait).
 */
export function generateRoleReportPDF(
  meta: BaseReportMetadata,
  data: RoleReportData
): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const startY = drawDocumentHeader(doc, meta, 'portrait');
  const isAll = !!data.isAllRoles;
  const isMulti = !!data.isMultiRole || (Array.isArray(data.roleNames) && data.roleNames.length > 1);

  const totalFull = data.records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = data.records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkerDays = data.records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = data.records.reduce((sum, r) => sum + r.total_cost_paise, 0);
  const activeDays = data.records.length;
  const avgDaily = activeDays > 0 ? (totalWorkerDays / activeDays).toFixed(1) : '0';

  // Role Header & KPI Box
  const boxHeight = 16;
  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.roundedRect(PDF_THEME.margins.left, startY, PDF_THEME.page.portrait.usableWidth, boxHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.colors.primary);
  const headerTitle = isAll
    ? 'All Workforce Roles & Deployment'
    : isMulti && data.roleNames && data.roleNames.length > 0
    ? `Roles: ${data.roleNames.join(', ')}`
    : `Role: ${data.roleName}   (Category: ${data.categoryName})`;
  doc.text(headerTitle, PDF_THEME.margins.left + 4, startY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.textMuted);
  const statsLine = `Active Days: ${activeDays}   |   Avg Daily Headcount: ${avgDaily}   |   Total Worker-Days: ${totalWorkerDays}   |   Total Wages: ${formatPDFCurrency(totalCostPaise)}`;
  doc.text(statsLine, PDF_THEME.margins.left + 4, startY + 11.5);

  // Empty check
  if (data.records.length === 0) {
    renderEmptyState(
      doc,
      startY + boxHeight + 4,
      isAll ? 'No workforce deployment recorded for this period.' : 'Selected role(s) had zero deployment days in this period.',
      'portrait'
    );
    applyDocumentFooters(doc, meta, 'portrait');
    return Buffer.from(doc.output('arraybuffer'));
  }

  // Sort chronological, then by role name
  const sorted = [...data.records].sort((a, b) => {
    const dComp = a.date.localeCompare(b.date);
    if (dComp !== 0) return dComp;
    return (a.role_name || '').localeCompare(b.role_name || '');
  });

  const tableRows: RowInput[] = sorted.map((r) => {
    const d = new Date(r.date);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const col2 = (isAll || isMulti) ? `${r.role_name || 'Role'} (${r.category_name || 'General'})` : dayName;
    return [
      r.date,
      col2,
      { content: String(r.full_day_count), styles: { halign: 'center' } },
      { content: String(r.half_day_count), styles: { halign: 'center' } },
      { content: String(r.worker_days), styles: { halign: 'center', fontStyle: 'bold' } },
      { content: formatPDFCurrency(r.total_cost_paise), styles: { halign: 'right', fontStyle: 'bold' } },
    ];
  });

  // Grand Total
  tableRows.push([
    { content: 'PERIOD TOTALS', colSpan: 2, styles: { fontStyle: 'bold', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalFull), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalHalf), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: String(totalWorkerDays), styles: { fontStyle: 'bold', halign: 'center', fillColor: PDF_THEME.colors.totalRow } },
    { content: formatPDFCurrency(totalCostPaise), styles: { fontStyle: 'bold', halign: 'right', fillColor: PDF_THEME.colors.totalRow } },
  ]);

  const tableOptions = getBaseTableOptions(doc, meta, 'portrait', startY + boxHeight + 4);
  autoTable(doc, {
    ...tableOptions,
    head: [[
      'Date (ISO)',
      (isAll || isMulti) ? 'Role & Category' : 'Day',
      'Full Day',
      'Half Day',
      'Worker-Days',
      'Wages Paid',
    ]],
    body: tableRows,
    columnStyles: (isAll || isMulti)
      ? {
          0: { cellWidth: 26 },
          1: { cellWidth: 56 },
          2: { cellWidth: 25, halign: 'center' },
          3: { cellWidth: 25, halign: 'center' },
          4: { cellWidth: 25, halign: 'center' },
          5: { cellWidth: 25, halign: 'right' },
        }
      : {
          0: { cellWidth: 32 },
          1: { cellWidth: 46 },
          2: { cellWidth: 26, halign: 'center' },
          3: { cellWidth: 26, halign: 'center' },
          4: { cellWidth: 26, halign: 'center' },
          5: { cellWidth: 26, halign: 'right' },
        },
  });

  applyDocumentFooters(doc, meta, 'portrait');
  return Buffer.from(doc.output('arraybuffer'));
}
