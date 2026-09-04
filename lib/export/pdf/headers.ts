import { jsPDF } from 'jspdf';
import { BaseReportMetadata, PageOrientation } from './types';
import { PDF_THEME, getPageDimensions } from './theme';

/**
 * Draws executive document header on Page 1.
 * Returns the Y coordinate for subsequent table or card content.
 */
export function drawDocumentHeader(
  doc: jsPDF,
  meta: BaseReportMetadata,
  orientation: PageOrientation
): number {
  const dims = getPageDimensions(orientation);
  const leftX = PDF_THEME.margins.left;
  const rightX = dims.width - PDF_THEME.margins.right;

  // 1. Company Brand & Document Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...PDF_THEME.colors.primary);
  doc.text('AB CONSTRUCTIONS & INTERIORS', leftX, 14);

  doc.setFontSize(11);
  doc.setTextColor(...PDF_THEME.colors.accent);
  const titleText = meta.reportTitle.toUpperCase();
  doc.text(titleText, leftX, 20);

  // 2. Metadata details
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_THEME.colors.textMuted);

  const siteDisplay = meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName;
  doc.text(`Site: ${siteDisplay}`, leftX, 26);
  doc.text(`Period: ${meta.periodLabel}`, leftX, 31);

  const genTime = meta.generatedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  doc.text(`Generated: ${genTime}`, rightX, 26, { align: 'right' });

  if (meta.filtersSummary) {
    doc.text(`Filter: ${meta.filtersSummary}`, rightX, 31, { align: 'right' });
  }

  // 3. Subtle horizontal separator line
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.setLineWidth(0.3);
  doc.line(leftX, 35, rightX, 35);

  return 40;
}

/**
 * Draws compact running header on Page 2 and subsequent pages.
 */
export function drawRunningHeader(
  doc: jsPDF,
  meta: BaseReportMetadata,
  orientation: PageOrientation
): void {
  const dims = getPageDimensions(orientation);
  const leftX = PDF_THEME.margins.left;
  const rightX = dims.width - PDF_THEME.margins.right;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PDF_THEME.colors.primaryLight);

  const headerLeft = `${meta.siteName} — ${meta.reportTitle}`;
  doc.text(headerLeft, leftX, 12);

  if (meta.periodLabel) {
    doc.text(meta.periodLabel, rightX, 12, { align: 'right' });
  }

  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.setLineWidth(0.2);
  doc.line(leftX, 15, rightX, 15);
}
