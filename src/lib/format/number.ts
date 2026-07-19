// ─────────────────────────────────────────────────────────────────────────────
// Decimal display formatting — the app-wide rule for digits after the comma.
//
// Rules:
//   1. Round to `maxDecimals` decimals (default 2): 123.456 → 123,46.
//   2. Strip trailing zeros: 12.50 → 12,5, 10.990 → 10,99.
//   3. Whole numbers show as integers: 12.00 → 12, 0.00 → 0, 5 → 5.
//   4. Output uses a comma as the decimal separator (French convention).
//
// Each call site passes the precision it needs — grades and CO₂ factors keep 3–4
// decimals; most figures use 2.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a number to the app's decimal rule: round to `maxDecimals` decimals,
 * drop trailing zeros, comma separator. Returns '' for non-finite input.
 *
 * @param value   number or numeric string ("12,50" or "12.50" both accepted)
 * @param maxDecimals  decimals to round to (default 2)
 */
export function formatDecimal(value: number | string | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return '';

  const neg = n < 0;
  // toFixed rounds half-away-from-zero at the requested precision — the standard
  // display rounding. Operate on the magnitude so the sign is handled explicitly
  // (avoids "-0" when a tiny negative rounds to zero).
  const fixed = Math.abs(n).toFixed(maxDecimals);        // e.g. "123.46", "12.50"
  const dot = fixed.indexOf('.');
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const decTrimmed = dot === -1 ? '' : fixed.slice(dot + 1).replace(/0+$/, '');

  const isZero = /^0*$/.test(intPart) && decTrimmed === '';
  const body = decTrimmed ? `${intPart},${decTrimmed}` : intPart;
  return neg && !isZero ? `-${body}` : body;
}

/** French thousands separator: narrow no-break space (U+202F). */
export const GROUP_SEP = '\u202f';

/**
 * Like formatDecimal but with grouped thousands (e.g. 1 234 567,8) using a
 * narrow no-break space, per French convention. For large display figures.
 */
export function formatDecimalGrouped(value: number | string | null | undefined, maxDecimals = 2): string {
  const s = formatDecimal(value, maxDecimals);
  if (s === '') return '';
  const neg = s.startsWith('-');
  const unsigned = neg ? s.slice(1) : s;
  const [int, dec] = unsigned.split(',');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEP);
  return (neg ? '-' : '') + (dec ? `${grouped},${dec}` : grouped);
}
