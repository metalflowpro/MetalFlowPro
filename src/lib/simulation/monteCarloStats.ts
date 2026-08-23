// ─────────────────────────────────────────────────────────────────────────────
// Statistiques détaillées + interprétation d'une distribution Monte-Carlo — PUR.
//
// Transforme la sortie brute d'un tirage (`MonteCarloResult.values`) en un jeu de
// statistiques complet (moments, quantiles fins, intervalle interquartile,
// probabilités de dépassement) ET en une INTERPRÉTATION lisible, spécifique à la
// nature de la sortie (à maximiser vs à minimiser, monétaire, récupération…).
//
// Sans dépendance UI : le formatage des nombres est injecté (`fmt`) pour que le
// module reste testable et réutilisable (rapport, export).
// ─────────────────────────────────────────────────────────────────────────────

import type { MonteCarloResult } from './monteCarlo';
import type { MCOutputDef } from './monteCarloModel';

export interface ExtendedStats {
  n: number;
  mean: number;
  std: number;
  cv: number;          // écart-type / |moyenne|
  skewness: number;    // asymétrie (Fisher)
  min: number;
  max: number;
  p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number;
  iqr: number;         // P75 − P25
}

/** Quantile avec interpolation linéaire sur un tableau TRIÉ croissant. */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/** Statistiques complètes d'un échantillon (moments + quantiles fins). */
export function extendedStats(values: number[]): ExtendedStats {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: 0, std: 0, cv: 0, skewness: 0, min: 0, max: 0, p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, iqr: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? std / Math.abs(mean) : 0;
  // Asymétrie de Fisher (0 si σ nul ou n < 3).
  let skewness = 0;
  if (std > 0 && n >= 3) {
    skewness = values.reduce((a, b) => a + ((b - mean) / std) ** 3, 0) / n;
  }
  const p = (q: number) => quantileSorted(sorted, q);
  const p25 = p(25), p75 = p(75);
  return {
    n, mean, std, cv, skewness,
    min: sorted[0], max: sorted[n - 1],
    p5: p(5), p10: p(10), p25, p50: p(50), p75, p90: p(90), p95: p(95),
    iqr: p75 - p25,
  };
}

/** Fraction des tirages strictement sous un seuil. */
export function probBelow(values: number[], threshold: number): number {
  if (values.length === 0) return 0;
  let c = 0;
  for (const v of values) if (v < threshold) c++;
  return c / values.length;
}

/** Fraction des tirages au moins égaux à un seuil. */
export function probAtLeast(values: number[], threshold: number): number {
  return 1 - probBelow(values, threshold);
}

/** Points (x, F(x)) de la fonction de répartition empirique, ré-échantillonnés. */
export function cdfPoints(values: number[], maxPoints = 120): { x: number; p: number }[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(n / maxPoints));
  const pts: { x: number; p: number }[] = [];
  for (let i = 0; i < n; i += step) pts.push({ x: sorted[i], p: (i + 1) / n });
  if (pts[pts.length - 1]?.x !== sorted[n - 1]) pts.push({ x: sorted[n - 1], p: 1 });
  return pts;
}

// ─── Interprétation ───────────────────────────────────────────────────────────

export type InterpTone = 'good' | 'warn' | 'bad' | 'info';
export interface Interpretation { tone: InterpTone; text: string }

/** Qualifie l'incertitude à partir du coefficient de variation. */
export function cvBand(cv: number): { label: string; tone: InterpTone } {
  const pct = cv * 100;
  if (pct < 10) return { label: 'faible', tone: 'good' };
  if (pct < 25) return { label: 'modérée', tone: 'info' };
  if (pct < 50) return { label: 'élevée', tone: 'warn' };
  return { label: 'très élevée', tone: 'bad' };
}

export interface InterpretContext {
  /** Formateur de valeur (unités/monnaie) fourni par l'appelant. */
  fmt: (v: number) => string;
  /** Sensibilité de tête (variable la plus influente) et son libellé lisible. */
  topDriver?: { label: string; correlation: number } | null;
  /** Seuil optionnel dont on veut la probabilité de dépassement. */
  target?: number | null;
}

/**
 * Produit une interprétation lisible et spécifique à la sortie : tendance
 * centrale, dispersion, asymétrie, risque baissier/haussier (selon qu'on maximise
 * ou minimise), levier dominant, et probabilité d'atteindre un seuil.
 */
export function interpretOutput(
  def: MCOutputDef,
  result: MonteCarloResult,
  stats: ExtendedStats,
  ctx: InterpretContext,
): Interpretation[] {
  const out: Interpretation[] = [];
  const f = ctx.fmt;
  const u = def.unit === '%' ? ' %' : def.unit ? ` ${def.unit}` : '';
  const maximize = def.direction === 'maximize';
  const isCurrency = !!def.currency;

  // 1. Tendance centrale.
  out.push({
    tone: 'info',
    text: `Valeur médiane (P50) ${f(stats.p50)}${u}, moyenne ${f(stats.mean)}${u}. Un scénario sur deux fait mieux que la médiane.`,
  });

  // 2. Dispersion.
  const band = cvBand(stats.cv);
  out.push({
    tone: band.tone,
    text: `80 % des tirages tombent entre ${f(stats.p10)} et ${f(stats.p90)}${u} (P10–P90). Coefficient de variation ${(stats.cv * 100).toFixed(0)} % → incertitude ${band.label}.`,
  });

  // 3. Asymétrie.
  if (stats.skewness > 0.4) {
    out.push({ tone: 'info', text: `Distribution étalée vers le haut (asymétrie +${stats.skewness.toFixed(2)}) : quelques scénarios nettement favorables tirent la moyenne au-dessus de la médiane.` });
  } else if (stats.skewness < -0.4) {
    out.push({ tone: 'warn', text: `Queue basse marquée (asymétrie ${stats.skewness.toFixed(2)}) : le risque vient de scénarios défavorables peu fréquents mais sévères.` });
  } else {
    out.push({ tone: 'info', text: `Distribution quasi symétrique (asymétrie ${stats.skewness.toFixed(2)}) — moyenne et médiane proches.` });
  }

  // 4. Risque, orienté par le sens de l'objectif.
  if (maximize && isCurrency) {
    const pLoss = probBelow(result.values, 0);
    if (pLoss > 0.001) {
      out.push({
        tone: pLoss > 0.1 ? 'bad' : 'warn',
        text: `Probabilité que ${def.label.toLowerCase()} soit négatif : ${(pLoss * 100).toFixed(1)} %. Le pire décile descend à ${f(stats.p10)}${u}.`,
      });
    } else {
      out.push({ tone: 'good', text: `${def.label} reste positif sur la quasi-totalité des tirages ; le pire décile vaut encore ${f(stats.p10)}${u}.` });
    }
  } else if (maximize) {
    out.push({ tone: 'warn', text: `Risque baissier : 10 % de chances de descendre sous ${f(stats.p10)}${u} (P10), à retenir comme cas conservateur.` });
  } else {
    out.push({ tone: 'warn', text: `Risque haussier : 10 % de chances de dépasser ${f(stats.p90)}${u} (P90) — le cas défavorable à budgéter.` });
  }

  // 5. Levier dominant (sensibilité).
  if (ctx.topDriver && Math.abs(ctx.topDriver.correlation) > 0.05) {
    const dir = ctx.topDriver.correlation >= 0 ? 'dans le même sens' : 'en sens inverse';
    out.push({
      tone: 'info',
      text: `Principal levier : « ${ctx.topDriver.label} » (corrélation de rang ${ctx.topDriver.correlation >= 0 ? '+' : ''}${ctx.topDriver.correlation.toFixed(2)}, ${dir}). Réduire son incertitude resserre le plus le résultat.`,
    });
  }

  // 6. Probabilité d'atteindre un seuil.
  if (ctx.target != null && Number.isFinite(ctx.target)) {
    const pReach = maximize ? probAtLeast(result.values, ctx.target) : probBelow(result.values, ctx.target);
    const verb = maximize ? `atteindre au moins ${f(ctx.target)}${u}` : `rester sous ${f(ctx.target)}${u}`;
    out.push({
      tone: pReach >= 0.8 ? 'good' : pReach >= 0.5 ? 'info' : 'warn',
      text: `Probabilité de ${verb} : ${(pReach * 100).toFixed(1)} %.`,
    });
  }

  return out;
}
