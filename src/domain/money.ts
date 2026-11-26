/**
 * Parses a human-entered rupee string (with optional commas and up to 2 decimals)
 * into non-negative integer paise, or returns null if invalid.
 */
export function parseRupeesToPaise(raw: string): number | null {
  const cleaned = String(raw ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const [wholeStr, fracStr = ''] = cleaned.split('.');
  const paise = Number(wholeStr) * 100 + Number(fracStr.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/**
 * Formats integer paise in Indian rupee grouping (`en-IN`), hiding `.00` on whole rupees.
 */
export function formatRupees(paise: number, opts: { signed?: boolean } = {}): string {
  const sign = opts.signed ? (paise < 0 ? '-' : '+') : paise < 0 ? '-' : '';
  const absPaise = Math.abs(paise);
  const rupees = absPaise / 100;
  const hasFraction = absPaise % 100 !== 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
  return `${sign}₹${formatted}`;
}

/**
 * Formats integer paise as a plain decimal rupee string with 2 decimal digits (for inputs & CSV).
 */
export function formatDecimalRupeesPlain(paise: number): string {
  return (paise / 100).toFixed(2);
}
