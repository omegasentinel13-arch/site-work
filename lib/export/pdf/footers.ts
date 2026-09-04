import { jsPDF } from 'jspdf';
import { BaseReportMetadata, PageOrientation } from './types';
import { PDF_THEME, getPageDimensions } from './theme';

/**
 * Iterates through all document pages and applies a standardized running footer
 * with accurate two-pass total page numbering ("Page X of Y").
 */
export function applyDocumentFooters(
  doc: jsPDF,
  meta: BaseReportMetadata,
  orientation: PageOrientation
): void {
  const dims = getPageDimensions(orientation);
  const leftX = PDF_THEME.margins.left;
  const rightX = dims.width - PDF_THEME.margins.right;
  const lineY = dims.height - 14;
  const textY = dims.height - 9;

  const totalPages = doc.getNumberOfPages();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Footer divider line
    doc.setDrawColor(...PDF_THEME.colors.border);
    doc.setLineWidth(0.2);
    doc.line(leftX, lineY, rightX, lineY);

    // Footer labels
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_THEME.colors.textMuted);

    doc.text('SITE WORK — System Generated Document', leftX, textY);
    doc.text(`Page ${i} of ${totalPages}`, rightX, textY, { align: 'right' });
  }
}
