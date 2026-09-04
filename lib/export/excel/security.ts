import { sanitizeReportFilename, buildContentDispositionHeader } from '../pdf/filename';

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escapes user-controlled text values against CSV / Excel Formula Injection (DDE).
 * If a string begins with =, +, -, @, TAB, or CR, it is safely prefixed with a single quote.
 * Genuine numeric values (such as negative numbers -5000) are untouched and remain numeric.
 */
export function escapeExcelFormula<T = unknown>(value: T): T {
  if (typeof value !== 'string') {
    return value;
  }

  // Check if string starts with any formula trigger character
  if (value.length > 0 && FORMULA_TRIGGERS.some((char) => value.startsWith(char))) {
    return `'${value}` as unknown as T;
  }

  return value;
}

/**
 * Generates safe .xlsx filenames defending against traversal, CRLF, Windows devices, and control characters.
 */
export function sanitizeExcelFilename(rawBase: string, suffix: string): string {
  return sanitizeReportFilename(rawBase, suffix, 'xlsx');
}

/**
 * Re-exports the RFC 5987 / RFC 6266 Content-Disposition header builder.
 */
export { buildContentDispositionHeader };
