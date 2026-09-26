/**
 * Universal Transaction Search Engine
 * AB CONSTRUCTIONS & INTERIORS — SITE WORK
 *
 * Deterministic pipeline:
 * USER INPUT -> TRIM & CLEAN -> TYPE DETECTION -> (DATE | AMOUNT | SIGNED AMOUNT | TEXT) -> MATCH ENGINE
 */

export interface ParsedDateResult {
  kind: 'DATE' | 'INVALID_DATE';
  year?: number;
  month?: number;
  day?: number;
  canonicalDate?: string; // YYYY-MM-DD
}

export interface ParsedTransactionSearch {
  mode: 'TEXT' | 'AMOUNT' | 'DATE' | 'INVALID_DATE';
  direction: 'ANY' | 'CREDIT' | 'DEBIT';
  amountDigits?: string; // Canonical numeric digits string (e.g. "475000", "50")
  amountPrefix?: string; // Backward compatibility alias for amountDigits
  rawAmountQuery?: string;
  canonicalDate?: string; // YYYY-MM-DD
  normalizedText?: string;
}

export interface SearchableTransaction {
  id?: string;
  date: string; // Stored canonical YYYY-MM-DD
  type: 'CREDIT' | 'DEBIT';
  amount_paise: number; // Integer paise
  runningBalancePaise?: number; // Integer paise
  debit_category?: string | null;
  description?: string | null;
  reference_note?: string | null;
  investor_name?: string | null;
  work_category_name?: string | null;
  work_role_name?: string | null;
}

/**
 * Normalizes user search input into canonical numeric digits.
 * Removes presentation formatting:
 * - Currency symbols (₹, Rs, Rs., INR)
 * - Commas (including Indian numbering commas: 4,75,000 -> 475000)
 * - Spaces
 */
export function normalizeSearchAmount(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, '')
    .replace(/[,\s]/g, '')
    .replace(/^(₹|rs\.?|inr)\s*/i, '');
}

/**
 * Normalizes transaction monetary amount in integer paise to canonical rupee digits.
 * Avoids floating-point arithmetic.
 */
export function normalizeTransactionAmount(paise: number): string {
  if (paise === undefined || paise === null || isNaN(paise)) return '0';
  const rupees = Math.floor(Math.abs(paise) / 100);
  return String(rupees);
}

/**
 * Validates leap year according to Gregorian calendar rules.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Deterministic date parser enforcing positional 4-digit year rules and strict calendar validation.
 * Supported formats:
 * - Format A: YYYY-MM-DD (e.g. 2026-09-01)
 * - Format B: YYYY/MM/DD (e.g. 2026/09/01)
 * - Format C: DD-MM-YYYY (e.g. 01-09-2026)
 * - Format D: DD/MM/YYYY (e.g. 01/09/2026)
 *
 * Positional Rule:
 * - If FIRST component has 4 digits: YYYY-MM-DD or YYYY/MM/DD.
 *   Example: 2026-01-09 is 9 January 2026 (NOT 1 September 2026).
 * - If LAST component has 4 digits: DD-MM-YYYY or DD/MM/YYYY.
 *   Example: 01-09-2026 is 1 September 2026; 09-01-2026 is 9 January 2026.
 */
export function parseTransactionSearchDate(input: string): ParsedDateResult {
  if (!input || typeof input !== 'string') {
    return { kind: 'INVALID_DATE' };
  }

  const trimmed = input.trim();
  const dateMatch = trimmed.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})$/);
  if (!dateMatch) {
    return { kind: 'INVALID_DATE' };
  }

  const [, part1, part2, part3] = dateMatch;
  let year: number;
  let month: number;
  let day: number;

  if (part1.length === 4 && (part3.length === 1 || part3.length === 2)) {
    // YYYY-MM-DD or YYYY/MM/DD
    year = parseInt(part1, 10);
    month = parseInt(part2, 10);
    day = parseInt(part3, 10);
  } else if (part3.length === 4 && (part1.length === 1 || part1.length === 2)) {
    // DD-MM-YYYY or DD/MM/YYYY
    day = parseInt(part1, 10);
    month = parseInt(part2, 10);
    year = parseInt(part3, 10);
  } else {
    // Ambiguous or invalid component lengths (e.g. 2-digit years or 3 components of length 2)
    return { kind: 'INVALID_DATE' };
  }

  // Basic numeric range checks
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return { kind: 'INVALID_DATE' };
  }
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return { kind: 'INVALID_DATE' };
  }

  // Days per month validation
  const daysInMonths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = daysInMonths[month - 1];

  if (day > maxDay) {
    return { kind: 'INVALID_DATE' };
  }

  const canonicalDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    kind: 'DATE',
    year,
    month,
    day,
    canonicalDate,
  };
}

/**
 * Universal search query classifier with deterministic priority:
 * 1. Signed Amount (+5000, -₹5,000)
 * 2. Date Query (2026-09-01, 01/09/2026, or invalid date like 31-02-2026)
 * 3. Unsigned Numeric Amount (475000, ₹4,75,000, 50)
 * 4. Text Fallback (cement, Shahil)
 */
export function parseTransactionSearch(input: string): ParsedTransactionSearch {
  if (!input || typeof input !== 'string') {
    return {
      mode: 'TEXT',
      direction: 'ANY',
      normalizedText: '',
    };
  }

  const trimmed = input.trim();
  if (trimmed === '') {
    return {
      mode: 'TEXT',
      direction: 'ANY',
      normalizedText: '',
    };
  }

  // 1. Signed Amount Detection (+ or -)
  if (trimmed.startsWith('+') || trimmed.startsWith('-')) {
    const sign = trimmed[0];
    const remainder = trimmed.slice(1).trim();
    const cleanRemainder = normalizeSearchAmount(remainder);
    const isNumeric = /^\d+(\.\d*)?$/.test(cleanRemainder);

    if (isNumeric && cleanRemainder.length > 0) {
      return {
        mode: 'AMOUNT',
        direction: sign === '+' ? 'CREDIT' : 'DEBIT',
        amountDigits: cleanRemainder,
        amountPrefix: cleanRemainder,
        rawAmountQuery: cleanRemainder,
      };
    }
  }

  // 2. Date Detection (matches format with separators - or /)
  if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(trimmed)) {
    const dateResult = parseTransactionSearchDate(trimmed);
    if (dateResult.kind === 'DATE' && dateResult.canonicalDate) {
      return {
        mode: 'DATE',
        direction: 'ANY',
        canonicalDate: dateResult.canonicalDate,
      };
    }
    // Explicitly recognized as date structure but logically invalid (e.g. 31-02-2026)
    return {
      mode: 'INVALID_DATE',
      direction: 'ANY',
    };
  }

  // 3. Unsigned Numeric Amount Detection
  const cleanUnsigned = normalizeSearchAmount(trimmed);
  const isUnsignedNumeric = /^\d+(\.\d*)?$/.test(cleanUnsigned);
  if (isUnsignedNumeric && cleanUnsigned.length > 0) {
    return {
      mode: 'AMOUNT',
      direction: 'ANY',
      amountDigits: cleanUnsigned,
      amountPrefix: cleanUnsigned,
      rawAmountQuery: cleanUnsigned,
    };
  }

  // 4. Fallback: Text Search
  return {
    mode: 'TEXT',
    direction: 'ANY',
    normalizedText: trimmed.toLowerCase(),
  };
}

/**
 * Checks if target numeric string starts with query prefix.
 * Avoids accidental middle-of-string matching (e.g. "50" does NOT match "1500").
 */
function matchesAmountPrefix(targetDigits: string | null | undefined, queryDigits: string): boolean {
  if (!targetDigits) return false;
  return targetDigits.startsWith(queryDigits);
}

/**
 * Universal Transaction Match Engine.
 * Matches a transaction against parsed search criteria while respecting the active UI Type Filter.
 *
 * @param tx Transaction record containing amounts, dates, and textual metadata.
 * @param parsed Structured search query from parseTransactionSearch.
 * @param activeTypeFilter Current UI Type Filter ('ALL' | 'CREDIT' | 'DEBIT'). Default is 'ALL'.
 */
export function matchTransactionSearch(
  tx: SearchableTransaction,
  parsed: ParsedTransactionSearch,
  activeTypeFilter: 'ALL' | 'CREDIT' | 'DEBIT' = 'ALL'
): boolean {
  // 1. Invalid Date rejects all records
  if (parsed.mode === 'INVALID_DATE') {
    return false;
  }

  // 2. Canonical Date Matching
  if (parsed.mode === 'DATE' && parsed.canonicalDate) {
    return tx.date === parsed.canonicalDate;
  }

  // 3. Numeric Amount Matching
  if (parsed.mode === 'AMOUNT' && parsed.amountDigits) {
    const queryDigits = parsed.amountDigits;

    // Financial Column Projections (in Rupees)
    const isCredit = tx.type === 'CREDIT';
    const isDebit = tx.type === 'DEBIT';

    const creditDigits = isCredit ? normalizeTransactionAmount(tx.amount_paise) : null;
    const debitDigits = isDebit ? normalizeTransactionAmount(tx.amount_paise) : null;
    const balanceDigits = tx.runningBalancePaise !== undefined
      ? normalizeTransactionAmount(tx.runningBalancePaise)
      : null;

    // Signed Search: + (CREDIT only)
    if (parsed.direction === 'CREDIT') {
      if (activeTypeFilter === 'DEBIT') return false; // Filter collision: Type=DEBIT + Search=+5000 -> 0 results
      if (!isCredit) return false;
      return matchesAmountPrefix(creditDigits, queryDigits);
    }

    // Signed Search: - (DEBIT only)
    if (parsed.direction === 'DEBIT') {
      if (activeTypeFilter === 'CREDIT') return false; // Filter collision: Type=CREDIT + Search=-5000 -> 0 results
      if (!isDebit) return false;
      return matchesAmountPrefix(debitDigits, queryDigits);
    }

    // Unsigned Search: Respects Active Type Filter
    if (activeTypeFilter === 'CREDIT') {
      if (!isCredit) return false;
      return matchesAmountPrefix(creditDigits, queryDigits);
    }

    if (activeTypeFilter === 'DEBIT') {
      if (!isDebit) return false;
      return matchesAmountPrefix(debitDigits, queryDigits);
    }

    // activeTypeFilter === 'ALL': Search across Credit, Debit, and Running Balance
    const creditMatches = matchesAmountPrefix(creditDigits, queryDigits);
    const debitMatches = matchesAmountPrefix(debitDigits, queryDigits);
    const balanceMatches = matchesAmountPrefix(balanceDigits, queryDigits);

    return creditMatches || debitMatches || balanceMatches;
  }

  // 4. Normalized Text Matching
  const query = parsed.normalizedText;
  if (!query) return true;

  const matchNote = (tx.reference_note || '').toLowerCase().includes(query);
  const matchDesc = (tx.description || '').toLowerCase().includes(query);
  const matchInv = (tx.investor_name || '').toLowerCase().includes(query);
  const matchCat = (tx.work_category_name || '').toLowerCase().includes(query);
  const matchRole = (tx.work_role_name || '').toLowerCase().includes(query);
  const matchDebitCat = (tx.debit_category || '').toLowerCase().includes(query);

  return matchNote || matchDesc || matchInv || matchCat || matchRole || matchDebitCat;
}
