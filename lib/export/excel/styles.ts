import type ExcelJS from 'exceljs';
import { EXCEL_THEME } from './theme';

export const EXCEL_STYLES = {
  fills: {
    primaryTitle: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.primary}` },
    } as ExcelJS.FillPattern,
    subtitle: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.primaryLight}` },
    } as ExcelJS.FillPattern,
    tableHeader: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.primary}` },
    } as ExcelJS.FillPattern,
    categoryBanner: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.subhead}` },
    } as ExcelJS.FillPattern,
    zebra: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.zebra}` },
    } as ExcelJS.FillPattern,
    subtotal: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.subhead}` },
    } as ExcelJS.FillPattern,
    grandTotal: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.total}` },
    } as ExcelJS.FillPattern,
    kpiCard: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.subhead}` },
    } as ExcelJS.FillPattern,
    emptyCard: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${EXCEL_THEME.colors.zebra}` },
    } as ExcelJS.FillPattern,
  },
  borders: {
    dataCell: {
      top: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.borderLight}` } },
      bottom: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.borderLight}` } },
      left: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.borderLight}` } },
      right: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.borderLight}` } },
    } as ExcelJS.Borders,
    headerCell: {
      top: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.primary}` } },
      bottom: { style: 'medium', color: { argb: `FF${EXCEL_THEME.colors.primary}` } },
      left: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.primaryLight}` } },
      right: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.primaryLight}` } },
    } as ExcelJS.Borders,
    subtotalRow: {
      top: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.border}` } },
      bottom: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.border}` } },
    } as ExcelJS.Borders,
    grandTotalRow: {
      top: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.primary}` } },
      bottom: { style: 'double', color: { argb: `FF${EXCEL_THEME.colors.primary}` } },
    } as ExcelJS.Borders,
    cardBox: {
      top: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.border}` } },
      bottom: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.border}` } },
      left: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.border}` } },
      right: { style: 'thin', color: { argb: `FF${EXCEL_THEME.colors.border}` } },
    } as ExcelJS.Borders,
  },
  alignments: {
    leftCenter: { horizontal: 'left', vertical: 'middle' } as ExcelJS.Alignment,
    centerCenter: { horizontal: 'center', vertical: 'middle' } as ExcelJS.Alignment,
    rightCenter: { horizontal: 'right', vertical: 'middle' } as ExcelJS.Alignment,
    titleBanner: { horizontal: 'left', vertical: 'middle', indent: 1 } as ExcelJS.Alignment,
  },
};
