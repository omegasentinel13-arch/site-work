/**
 * Domain Money Engine (Integer Paise Representation)
 * 1 INR = 100 Paise
 * All stored and calculated monetary values are strictly in integer Paise.
 */

/**
 * Converts a Rupee value (number or string representation) into integer Paise.
 * Prevents floating point errors by parsing strings or fixed-precision arithmetic.
 */
export function toPaise(rupees: number | string): number {
  if (typeof rupees === 'string') {
    const cleaned = rupees.replace(/[^0-9.-]/g, '').trim();
    if (!cleaned) return 0;
    const parts = cleaned.split('.');
    const integerPart = parseInt(parts[0] || '0', 10);
    let decimalPart = parts[1] || '00';
    if (decimalPart.length === 1) decimalPart += '0';
    decimalPart = decimalPart.slice(0, 2);
    const sign = integerPart < 0 || cleaned.startsWith('-') ? -1 : 1;
    return (Math.abs(integerPart) * 100 + parseInt(decimalPart, 10)) * sign;
  }

  if (isNaN(rupees) || !isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

/**
 * Converts integer Paise into Rupee floating number (for display/input purposes only).
 */
export function toRupees(paise: number): number {
  if (!paise || isNaN(paise)) return 0;
  return paise / 100;
}

/**
 * Formats integer Paise into standard Indian Rupee notation (e.g. ₹1,400, ₹10,00,000).
 */
export function formatINR(paise: number, includeSymbol = true): string {
  if (paise === undefined || paise === null || isNaN(paise)) {
    return includeSymbol ? '₹0' : '0';
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(paise);
  const rupees = Math.floor(absPaise / 100);
  const fractional = absPaise % 100;

  const rupeesStr = rupees.toString();
  let lastThree = rupeesStr.substring(rupeesStr.length - 3);
  const otherNumbers = rupeesStr.substring(0, rupeesStr.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedRupees = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;

  const formattedValue = fractional > 0 
    ? `${formattedRupees}.${fractional.toString().padStart(2, '0')}`
    : formattedRupees;

  const prefix = isNegative ? '-' : '';
  const symbol = includeSymbol ? '₹' : '';

  return `${prefix}${symbol}${formattedValue}`;
}

/**
 * Safely calculates half-day rate in integer paise.
 * Rounding rule: Math.round(rateInPaise / 2)
 */
export function calculateHalfDayRate(rateInPaise: number): number {
  return Math.round(rateInPaise / 2);
}
