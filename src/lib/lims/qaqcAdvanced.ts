export interface ControlChart { n: number; mean: number; std: number; ucl: number; lcl: number; violations: number[]; status: 'pass' | 'warn' | 'fail' }

export function controlChart(values: number[], sigma = 3): ControlChart {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 3) return { n: clean.length, mean: 0, std: 0, ucl: 0, lcl: 0, violations: [], status: 'warn' };
  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map(value => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  // Robust limits keep one extreme assay from inflating its own control band.
  const std = mad > 0 ? 1.4826 * mad : Math.sqrt(clean.reduce((sum, value) => sum + (value - mean) ** 2, 0) / clean.length);
  const ucl = median + sigma * std;
  const lcl = Math.max(0, median - sigma * std);
  const violations = clean.map((value, index) => value > ucl || value < lcl ? index : -1).filter(index => index >= 0);
  return { n: clean.length, mean, std, ucl, lcl, violations, status: violations.length > 0 ? 'fail' : std / Math.max(Math.abs(mean), Number.EPSILON) > 0.3 ? 'warn' : 'pass' };
}

export interface DuplicatePrecision { pairs: number; meanRelativeDifferencePct: number | null; status: 'pass' | 'warn' | 'insufficient' }

export function duplicatePrecision(pairs: Array<{ original: number; duplicate: number }>, tolerancePct = 20): DuplicatePrecision {
  const valid = pairs.filter(pair => Number.isFinite(pair.original) && Number.isFinite(pair.duplicate) && pair.original + pair.duplicate > 0);
  if (valid.length === 0) return { pairs: 0, meanRelativeDifferencePct: null, status: 'insufficient' };
  const differences = valid.map(pair => Math.abs(pair.original - pair.duplicate) / ((pair.original + pair.duplicate) / 2) * 100);
  const meanRelativeDifferencePct = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  return { pairs: valid.length, meanRelativeDifferencePct, status: meanRelativeDifferencePct <= tolerancePct ? 'pass' : 'warn' };
}
