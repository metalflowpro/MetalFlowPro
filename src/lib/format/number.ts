// ─────────────────────────────────────────────────────────────────────────────
// Decimal display formatting — the app-wide rule for digits after the comma.
//
// Rules (in priority order):
//   1. Truncate (do NOT round) to at most 2 decimals: 123.45678 → 123,45.
//   2. Strip trailing zeros: 12.50 → 12,5, 10.990 → 10,99.
//   3. Whole numbers show as integers: 12.00 → 12, 0.00 → 0, 5 → 5.
//   4. Output uses a comma as the decimal separator (French convention).
//
// Truncation is deliberate and specified — rounding 123.45678 would give 123.46.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a number to the app's decimal rule: truncate to ≤2 decimals, drop
 * trailing zeros, comma separator. Returns '' for non-finite input.
 *
 * @param value   number or numeric string ("12,50" or "12.50" both accepted)
 * @param maxDecimals  cap on decimals (default 2); never rounds, only truncates
 */
export function formatDecimal(value: number | string | null | undefined, maxDecimals = 2): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return '';

  const neg = n < 0;
  const abs = Math.abs(n);

  // String-based truncation avoids float artefacts: Math.trunc(10.99 * 100) is
  // 1098, not 1099, because 10.99 * 100 === 1098.9999999999998. toFixed with a
  // few guard digits, then cut, is exact for the magnitudes this app displays.
  const guard = abs.toFixed(maxDecimals + 4);           // e.g. "10.990000"
  const dot = guard.indexOf('.');
  let intPart = dot === -1 ? guard : guard.slice(0, dot);
  const decPart = dot === -1 ? '' : guard.slice(dot + 1, dot + 1 + maxDecimals);

  let decTrimmed = decPart.replace(/0+$/, '');           // drop trailing zeros
  // A negative that truncates to zero (e.g. -0.004 → "0") must not show "-0".
  const isZero = /^0*$/.test(intPart) && decTrimmed === '';
  if (isZero) { intPart = '0'; decTrimmed = ''; }

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
