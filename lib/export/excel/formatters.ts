import * as XLSX from 'xlsx';
import { toRupees } from '../../domain/money';
import { escapeExcelFormula } from './security';

export const EXCEL_FORMATS = {
  CURRENCY: '"Rs." #,##0.00',
  INTEGER: '#,##0',
  DECIMAL: '#,##0.00',
  PERCENT: '0.0%',
  DATE: 'yyyy-mm-dd',
};

/**
 * Creates a formatted numeric cell in SheetJS.
 */
export function numCell(value: number, format = EXCEL_FORMATS.DECIMAL): XLSX.CellObject {
  return {
    t: 'n',
    v: value,
    z: format,
  };
}

/**
 * Creates a formatted Indian Currency cell (Rupees) in SheetJS.
 */
export function currencyCell(paise: number): XLSX.CellObject {
  return {
    t: 'n',
    v: toRupees(paise),
    z: EXCEL_FORMATS.CURRENCY,
  };
}

/**
 * Creates a formatted formula cell with a precomputed fallback value.
 */
export function formulaCell(formula: string, precomputedValue: number, format = EXCEL_FORMATS.CURRENCY): XLSX.CellObject {
  return {
    t: 'n',
    f: formula,
    v: precomputedValue,
    z: format,
  };
}

/**
 * Creates an escaped text cell defending against formula injection.
 */
export function textCell(value: unknown): XLSX.CellObject {
  const clean = escapeExcelFormula(value ?? '');
  return {
    t: 's',
    v: String(clean),
  };
}
