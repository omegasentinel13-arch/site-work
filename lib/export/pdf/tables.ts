import { jsPDF } from 'jspdf';
import { UserOptions } from 'jspdf-autotable';
import { BaseReportMetadata, PageOrientation } from './types';
import { PDF_THEME, getPageDimensions } from './theme';
import { drawRunningHeader } from './headers';

/**
 * Creates standardized jspdf-autotable base options.
 * Ensures consistent theme, cell padding, margin reservation,
 * repeated headers on page breaks, and running header hooks.
 */
export function getBaseTableOptions(
  doc: jsPDF,
  meta: BaseReportMetadata,
  orientation: PageOrientation,
  startY: number
): UserOptions {
  return {
    startY,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.5,
      textColor: PDF_THEME.colors.textMain,
      lineColor: PDF_THEME.colors.border,
      lineWidth: 0.15,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: PDF_THEME.colors.tableHead,
      textColor: PDF_THEME.colors.tableHeadText,
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: PDF_THEME.colors.tableAltRow,
    },
    margin: {
      top: PDF_THEME.margins.top,
      bottom: PDF_THEME.margins.bottom,
      left: PDF_THEME.margins.left,
      right: PDF_THEME.margins.right,
    },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didDrawPage: (data) => {
      // Draw running header on continuation pages
      if (data.pageNumber > 1) {
        drawRunningHeader(doc, meta, orientation);
      }
    },
  };
}

/**
 * Checks remaining vertical space on the current page.
 * If insufficient space remains for a section heading plus at least one row,
 * forces a page break to prevent orphaned headings.
 */
export function ensureHeadingSpace(
  doc: jsPDF,
  currentY: number,
  orientation: PageOrientation,
  requiredSpaceMm = 35
): number {
  const dims = getPageDimensions(orientation);
  const bottomMargin = PDF_THEME.margins.bottom;
  const availableSpace = dims.height - bottomMargin - currentY;

  if (availableSpace < requiredSpaceMm) {
    doc.addPage();
    return PDF_THEME.margins.top;
  }
  return currentY;
}

/**
 * Renders a clean, professional empty state message box.
 */
export function renderEmptyState(
  doc: jsPDF,
  startY: number,
  message: string,
  orientation: PageOrientation
): void {
  const dims = getPageDimensions(orientation);
  const leftX = PDF_THEME.margins.left;
  const usableWidth = dims.usableWidth;
  const boxHeight = 24;

  doc.setFillColor(...PDF_THEME.colors.tableSubhead);
  doc.setDrawColor(...PDF_THEME.colors.border);
  doc.setLineWidth(0.2);
  doc.roundedRect(leftX, startY, usableWidth, boxHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_THEME.colors.textMuted);
  doc.text(message, dims.width / 2, startY + (boxHeight / 2) + 1.5, { align: 'center' });
}
