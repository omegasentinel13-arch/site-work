import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { BaseExcelMetadata } from './types';
import { textCell } from './formatters';
import { EXCEL_THEME } from './theme';
import { EXCEL_STYLES } from './styles';
import { escapeExcelFormula } from './security';

// ============================================================================
// SHEETJS COMPATIBILITY LAYER (PRESERVED FOR EXISTING UNMIGRATED GENERATORS)
// ============================================================================

/**
 * Creates standard 4-row corporate metadata block for SheetJS worksheets.
 * Preserved for backwards compatibility with unmigrated report generators.
 */
export function createMetadataRows(meta: BaseExcelMetadata): (XLSX.CellObject | string | number)[][] {
  const rows: (XLSX.CellObject | string | number)[][] = [
    [textCell(`AB CONSTRUCTIONS & INTERIORS — ${meta.reportTitle.toUpperCase()}`)],
    [textCell('Site:'), textCell(meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName)],
  ];

  if (meta.periodLabel) {
    rows.push([textCell('Period:'), textCell(meta.periodLabel)]);
  }

  const generated = meta.generatedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  rows.push([textCell('Generated:'), textCell(generated)]);

  if (meta.filtersSummary) {
    rows.push([textCell('Filters:'), textCell(meta.filtersSummary)]);
  }

  rows.push([]); // blank separator row
  return rows;
}

/**
 * Sets explicit column widths, frozen panes, and autofilters on a SheetJS worksheet.
 */
export function applySheetConfig(
  ws: XLSX.WorkSheet,
  options?: {
    colWidths?: number[];
    freezeRow?: number;
    autoFilterRange?: string;
  }
): void {
  if (options?.colWidths) {
    ws['!cols'] = options.colWidths.map((wch) => ({ wch }));
  }

  if (options?.freezeRow && options.freezeRow > 0) {
    ws['!freeze'] = {
      xSplit: 0,
      ySplit: options.freezeRow,
      topLeftCell: `A${options.freezeRow + 1}`,
      activePane: 'bottomLeft',
      state: 'frozen',
    };
  }

  if (options?.autoFilterRange) {
    ws['!autofilter'] = { ref: options.autoFilterRange };
  }
}

/**
 * Serializes a SheetJS workbook directly into a Node.js binary Buffer.
 */
export function writeWorkbookToBuffer(wb: XLSX.WorkBook): Buffer {
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ============================================================================
// ENTERPRISE EXCELJS FOUNDATION PRIMITIVES
// ============================================================================

/**
 * Creates a configured ExcelJS Workbook with enterprise metadata.
 */
export function createExcelJsWorkbook(creator = 'SITE WORK Enterprise System'): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.lastModifiedBy = creator;
  wb.created = new Date();
  wb.modified = new Date();
  return wb;
}

/**
 * Serializes an ExcelJS workbook into a standard Node.js Buffer.
 */
export async function writeExcelJsWorkbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Converts column index (1-indexed) to letter (e.g., 1 -> A, 8 -> H).
 */
export function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

/**
 * Applies professional 2-row merged corporate brand title banner.
 * Row 1: Company & Report Title (Slate 900, white bold 14pt).
 * Row 2: Subtitle with Site & Generated date (Slate 800, 9.5pt).
 */
export function applyExcelJsTitleBanner(
  ws: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  colSpan: number
): void {
  const lastCol = getColumnLetter(colSpan);

  // Row 1: Main Title Banner
  const titleRow = ws.getRow(1);
  titleRow.height = EXCEL_THEME.rowHeights.title;
  ws.mergeCells(`A1:${lastCol}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `AB CONSTRUCTIONS & INTERIORS — ${title.toUpperCase()}`;
  titleCell.font = EXCEL_THEME.fonts.title;
  titleCell.fill = EXCEL_STYLES.fills.primaryTitle;
  titleCell.alignment = EXCEL_STYLES.alignments.titleBanner;

  // Row 2: Subtitle Info Bar
  const subRow = ws.getRow(2);
  subRow.height = EXCEL_THEME.rowHeights.subtitle;
  ws.mergeCells(`A2:${lastCol}2`);
  const subCell = ws.getCell('A2');
  subCell.value = subtitle;
  subCell.font = EXCEL_THEME.fonts.subtitle;
  subCell.fill = EXCEL_STYLES.fills.subtitle;
  subCell.alignment = EXCEL_STYLES.alignments.titleBanner;
}

/**
 * Applies a 2-column key/value metadata card block with Slate 50 background and subtle borders.
 */
export function applyExcelJsMetadataBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  meta: BaseExcelMetadata,
  colSpan: number
): number {
  let currentRow = startRow;
  const items: Array<[string, string]> = [
    ['Site:', meta.siteCode ? `${meta.siteName} (${meta.siteCode})` : meta.siteName],
  ];

  if (meta.periodLabel) {
    items.push(['Period:', meta.periodLabel]);
  }

  const generated = meta.generatedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  items.push(['Generated:', generated]);

  if (meta.filtersSummary) {
    items.push(['Filters:', meta.filtersSummary]);
  }

  for (const [label, value] of items) {
    const row = ws.getRow(currentRow);
    row.height = EXCEL_THEME.rowHeights.meta;

    const lblCell = row.getCell(1);
    lblCell.value = label;
    lblCell.font = EXCEL_THEME.fonts.metaLabel;
    lblCell.alignment = EXCEL_STYLES.alignments.leftCenter;

    const valCell = row.getCell(2);
    valCell.value = String(escapeExcelFormula(value));
    valCell.font = EXCEL_THEME.fonts.metaValue;
    valCell.alignment = EXCEL_STYLES.alignments.leftCenter;

    currentRow++;
  }

  // Row spacing buffer
  const bufferRow = ws.getRow(currentRow);
  bufferRow.height = 8;
  currentRow++;

  return currentRow;
}

/**
 * Applies an executive KPI strip with highlighted metrics.
 */
export function applyExcelJsKpiStrip(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  kpiItems: Array<{ label: string; value: string | number }>,
  colSpan: number
): void {
  const row = ws.getRow(rowNum);
  row.height = EXCEL_THEME.rowHeights.kpi;
  const lastCol = getColumnLetter(colSpan);
  ws.mergeCells(`A${rowNum}:${lastCol}${rowNum}`);

  const kpiText = kpiItems.map((k) => `${k.label}: ${k.value}`).join('   |   ');
  const cell = ws.getCell(`A${rowNum}`);
  cell.value = kpiText;
  cell.font = EXCEL_THEME.fonts.kpiValue;
  cell.fill = EXCEL_STYLES.fills.kpiCard;
  cell.alignment = EXCEL_STYLES.alignments.centerCenter;
  cell.border = EXCEL_STYLES.borders.cardBox;
}

/**
 * Applies table header formatting with Slate 900 fill, white bold text, and column widths.
 */
export function applyExcelJsTableHeader(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  columns: Array<{ header: string; width: number; align?: 'left' | 'center' | 'right' }>
): void {
  const row = ws.getRow(rowNum);
  row.height = EXCEL_THEME.rowHeights.tableHeader;

  columns.forEach((col, idx) => {
    const colIdx = idx + 1;
    const cell = row.getCell(colIdx);
    cell.value = col.header;
    cell.font = EXCEL_THEME.fonts.tableHeader;
    cell.fill = EXCEL_STYLES.fills.tableHeader;
    cell.border = EXCEL_STYLES.borders.headerCell;

    const alignH = col.align || 'left';
    cell.alignment = { horizontal: alignH, vertical: 'middle', wrapText: true };

    // Set explicit column width
    ws.getColumn(colIdx).width = col.width;
  });
}

/**
 * Formats a data row with height, subtle borders, optional alternating zebra fill, and alignments.
 */
export function applyExcelJsDataRow(
  row: ExcelJS.Row,
  isAlt: boolean,
  alignments: Array<'left' | 'center' | 'right'>
): void {
  row.height = EXCEL_THEME.rowHeights.data;

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = EXCEL_THEME.fonts.dataRegular;
    cell.border = EXCEL_STYLES.borders.dataCell;

    if (isAlt) {
      cell.fill = EXCEL_STYLES.fills.zebra;
    }

    const alignH = alignments[colNumber - 1] || 'left';
    cell.alignment = { horizontal: alignH, vertical: 'middle' };
  });
}

/**
 * Applies subtotal row formatting with Slate 100 fill, top/bottom thin border, and bold font.
 */
export function applyExcelJsSubtotalRow(
  row: ExcelJS.Row,
  alignments?: Array<'left' | 'center' | 'right'>
): void {
  row.height = EXCEL_THEME.rowHeights.subtotal;

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = EXCEL_THEME.fonts.dataBold;
    cell.fill = EXCEL_STYLES.fills.subtotal;
    cell.border = EXCEL_STYLES.borders.subtotalRow;

    if (alignments && alignments[colNumber - 1]) {
      cell.alignment = { horizontal: alignments[colNumber - 1], vertical: 'middle' };
    }
  });
}

/**
 * Applies grand total row formatting with Slate 200 fill, bold font, and double bottom accounting border.
 */
export function applyExcelJsGrandTotalRow(
  row: ExcelJS.Row,
  alignments?: Array<'left' | 'center' | 'right'>
): void {
  row.height = EXCEL_THEME.rowHeights.total;

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = EXCEL_THEME.fonts.total;
    cell.fill = EXCEL_STYLES.fills.grandTotal;
    cell.border = EXCEL_STYLES.borders.grandTotalRow;

    if (alignments && alignments[colNumber - 1]) {
      cell.alignment = { horizontal: alignments[colNumber - 1], vertical: 'middle' };
    }
  });
}

/**
 * Renders a clean, bordered empty-state card when a report has zero data records.
 */
export function applyExcelJsEmptyState(
  ws: ExcelJS.Worksheet,
  startRow: number,
  message: string,
  colSpan: number
): void {
  const row = ws.getRow(startRow);
  row.height = EXCEL_THEME.rowHeights.emptyCard;
  const lastCol = getColumnLetter(colSpan);
  ws.mergeCells(`A${startRow}:${lastCol}${startRow}`);

  const cell = ws.getCell(`A${startRow}`);
  cell.value = message;
  cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } };
  cell.fill = EXCEL_STYLES.fills.emptyCard;
  cell.alignment = EXCEL_STYLES.alignments.centerCenter;
  cell.border = EXCEL_STYLES.borders.cardBox;
}

/**
 * Configures worksheet view, freeze panes, autofilter, gridlines, and print setup.
 */
export function configureExcelJsWorksheet(
  ws: ExcelJS.Worksheet,
  options: {
    orientation?: 'portrait' | 'landscape';
    freezeRow?: number;
    freezeCol?: number;
    autoFilterRange?: string;
    repeatHeaderRow?: number;
    reportTitle?: string;
  }
): void {
  // 1. Gridlines and Freeze Panes
  const topColLetter = options.freezeCol ? getColumnLetter(options.freezeCol + 1) : 'A';
  const topRowNumber = options.freezeRow ? options.freezeRow + 1 : 1;
  const topLeftCell = `${topColLetter}${topRowNumber}`;

  ws.views = [
    {
      showGridLines: true,
      state: options.freezeRow || options.freezeCol ? 'frozen' : 'normal',
      ySplit: options.freezeRow || 0,
      xSplit: options.freezeCol || 0,
      topLeftCell,
    },
  ];

  // 2. AutoFilter
  if (options.autoFilterRange) {
    ws.autoFilter = options.autoFilterRange;
  }

  // 3. Page Setup (A4, Fit to Width, Orientation)
  ws.pageSetup = {
    paperSize: EXCEL_THEME.pageSetup.paperSize,
    orientation: options.orientation || 'portrait',
    fitToPage: true,
    fitToWidth: EXCEL_THEME.pageSetup.fitToWidth,
    fitToHeight: EXCEL_THEME.pageSetup.fitToHeight,
    margins: EXCEL_THEME.pageSetup.margins,
    showGridLines: true,
  };

  // 4. Repeating Header Row for Print
  if (options.repeatHeaderRow && options.repeatHeaderRow > 0) {
    ws.pageSetup.printTitlesRow = `${options.repeatHeaderRow}:${options.repeatHeaderRow}`;
  }

  // 5. Header and Footer
  const title = options.reportTitle || 'SITE WORK Report';
  ws.headerFooter = {
    oddHeader: `&L&B${title}&R&D`,
    oddFooter: '&LConfidential — AB Constructions & Interiors&RPage &P of &N',
  };
}
