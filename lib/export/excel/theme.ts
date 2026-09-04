/**
 * Central Enterprise Design Tokens for SITE WORK Excel Subsystem.
 * Provides unified color palettes, typography specs, row heights, and page setup rules.
 */

export const EXCEL_THEME = {
  colors: {
    primary: '0F172A', // Slate 900 (corporate navy)
    primaryLight: '1E293B', // Slate 800
    accent: 'F59E0B', // Amber 500 (construction accent)
    accentLight: 'FEF3C7', // Amber 100
    zebra: 'F8FAFC', // Slate 50 (alternating row)
    subhead: 'F1F5F9', // Slate 100 (category / subtotal row)
    total: 'E2E8F0', // Slate 200 (grand total row)
    border: 'CBD5E1', // Slate 300 (structural borders)
    borderLight: 'E2E8F0', // Slate 200 (cell interior gridlines)
    textMain: '0F172A', // Slate 900
    textMuted: '64748B', // Slate 500
    textInverted: 'FFFFFF', // Pure White
    creditGreen: '166534', // Emerald 800
    creditGreenBg: 'DCFCE7', // Emerald 100
    debitRed: '991B1B', // Rose 800
    debitRedBg: 'FEE2E2', // Rose 100
  },
  fonts: {
    family: 'Calibri',
    title: { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } },
    subtitle: { name: 'Calibri', size: 9.5, bold: false, color: { argb: 'FFCBD5E1' } },
    metaLabel: { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF64748B' } },
    metaValue: { name: 'Calibri', size: 9, bold: false, color: { argb: 'FF0F172A' } },
    kpiLabel: { name: 'Calibri', size: 8, bold: true, color: { argb: 'FF64748B' } },
    kpiValue: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF0F172A' } },
    tableHeader: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } },
    categoryBanner: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF1E293B' } },
    dataRegular: { name: 'Calibri', size: 10, bold: false, color: { argb: 'FF0F172A' } },
    dataBold: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } },
    total: { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } },
  },
  rowHeights: {
    title: 34,
    subtitle: 18,
    meta: 22,
    kpi: 26,
    categoryBanner: 22,
    tableHeader: 28,
    data: 21,
    subtotal: 22,
    total: 26,
    emptyCard: 28,
  },
  pageSetup: {
    paperSize: 9, // A4
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.5,
      right: 0.5,
      top: 0.75,
      bottom: 0.75,
      header: 0.3,
      footer: 0.3,
    },
  },
} as const;
