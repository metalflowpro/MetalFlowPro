export interface SensitivityInput {
  name: string;
  correlation: number;
}

export interface TornadoDriver {
  label: string;
  low: number;
  high: number;
  correlation: number;
}

/**
 * Converts Monte Carlo rank correlations into a compact decision aid.
 * The span is deliberately expressed as a relative range around the median:
 * this visual ranks drivers, it does not claim a causal financial forecast.
 */
export function buildSensitivityTornado(
  sensitivity: SensitivityInput[] | undefined,
  base: number,
  span: number,
  labels: Record<string, string>,
  limit = 5,
): TornadoDriver[] {
  if (!sensitivity?.length || !Number.isFinite(base) || !Number.isFinite(span) || span <= 0) return [];

  return sensitivity
    .filter(item => Number.isFinite(item.correlation))
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, limit)
    .map(item => {
      const halfSpan = Math.abs(item.correlation) * span;
      return {
        label: labels[item.name] ?? item.name,
        low: base - halfSpan,
        high: base + halfSpan,
        correlation: item.correlation,
      };
    });
}

