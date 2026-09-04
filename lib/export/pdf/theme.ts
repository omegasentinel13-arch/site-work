import { PageOrientation } from './types';

export const PDF_THEME = {
  colors: {
    primary: [15, 23, 42] as [number, number, number], // Slate 900
    primaryLight: [30, 41, 59] as [number, number, number], // Slate 800
    accent: [245, 158, 11] as [number, number, number], // Amber 500
    accentLight: [254, 243, 199] as [number, number, number], // Amber 100
    textMain: [15, 23, 42] as [number, number, number],
    textMuted: [100, 116, 139] as [number, number, number], // Slate 500
    border: [203, 213, 225] as [number, number, number], // Slate 300
    tableHead: [15, 23, 42] as [number, number, number],
    tableHeadText: [255, 255, 255] as [number, number, number],
    tableSubhead: [241, 245, 249] as [number, number, number], // Slate 100
    tableAltRow: [248, 250, 252] as [number, number, number], // Slate 50
    totalRow: [226, 232, 240] as [number, number, number], // Slate 200
  },
  margins: {
    top: 25,
    bottom: 20,
    left: 14,
    right: 14,
  },
  page: {
    portrait: {
      width: 210,
      height: 297,
      usableWidth: 182, // 210 - 28
    },
    landscape: {
      width: 297,
      height: 210,
      usableWidth: 269, // 297 - 28
    },
  },
};

export function getPageDimensions(orientation: PageOrientation) {
  return orientation === 'landscape' ? PDF_THEME.page.landscape : PDF_THEME.page.portrait;
}

/**
 * Formats currency amounts (in paise) into clean, standard PDF-safe strings (e.g. "Rs. 1,500.00").
 * Avoids Unicode character encodings that interfere with standard PDF font drivers.
 */
export function formatPDFCurrency(amountInPaise: number): string {
  const rupees = amountInPaise / 100;
  return (
    'Rs. ' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

