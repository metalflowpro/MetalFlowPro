// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Monte Carlo stochastic simulation engine
//
// Replaces the fake static histogram in MassBalance and the naive uniform-random
// Monte Carlo in GeoMet with a proper uncertainty engine that:
//   - samples from distributions fitted to actual LIMS testwork data
//   - supports lognormal (grades), triangular (recovery), normal (BWi), and
//     empirical (bootstrap from raw samples) distributions
//   - computes P10/P50/P90, mean, std, CV, and histogram bins
//   - runs sensitivity (Spearman rank correlation) to rank input contributions
//
// Used by: MassBalance (stream uncertainty), GeoMet (LOM variability),
// Economics (NPV-at-risk), Risks (quantitative).
// ─────────────────────────────────────────────────────────────────────────────

import { normalQuantile } from '../ml/distributions';

/** A single stochastic input distribution. */
export type Distribution =
  | { kind: 'normal'; mean: number; std: number; min?: number; max?: number }
  | { kind: 'lognormal'; meanLog: number; stdLog: number; min?: number; max?: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  | { kind: 'uniform'; min: number; max: number }
  // PERT (Beta-PERT) — estimation d'expert bornée [min, max] centrée sur un mode.
  // λ (défaut 4) contrôle le poids du mode : plus λ est grand, plus la masse se
  // concentre autour du mode. Sert typiquement à une récupération ou un prix dont
  // on connaît un plancher, un plafond et une valeur la plus probable.
  | { kind: 'pert'; min: number; mode: number; max: number; lambda?: number }
  | { kind: 'empirical'; samples: number[] };

/** Box-Muller transform for standard normal samples. */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Clamp helper. */
function clamp(x: number, min?: number, max?: number): number {
  let r = x;
  if (min != null && r < min) r = min;
  if (max != null && r > max) r = max;
  return r;
}

/** PERT default weight on the mode (Vose's classic value). */
export const PERT_DEFAULT_LAMBDA = 4;

/** Marsaglia–Tsang gamma sampler (shape a > 0, scale 1). */
function gammaSample(a: number): number {
  if (a < 1) {
    const u = Math.random();
    return gammaSample(1 + a) * Math.pow(u === 0 ? Number.MIN_VALUE : u, 1 / a);
  }
  const d = a - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(α, β) sample via two gamma draws. */
function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  const s = x + y;
  return s === 0 ? 0.5 : x / s;
}

/** Beta-PERT shape parameters (α, β) for min/mode/max and weight λ. */
export function pertShape(min: number, mode: number, max: number, lambda = PERT_DEFAULT_LAMBDA): { alpha: number; beta: number } {
  const range = max - min;
  if (range <= 0) return { alpha: 1, beta: 1 };
  const alpha = 1 + (lambda * (mode - min)) / range;
  const beta = 1 + (lambda * (max - mode)) / range;
  return { alpha, beta };
}

/** Draw a single sample from a distribution. */
export function sample(dist: Distribution): number {
  switch (dist.kind) {
    case 'normal': {
      const v = dist.mean + dist.std * gaussian();
      return clamp(v, dist.min, dist.max);
    }
    case 'lognormal': {
      const z = gaussian();
      const v = Math.exp(dist.meanLog + dist.stdLog * z);
      return clamp(v, dist.min, dist.max);
    }
    case 'triangular': {
      const { min: a, mode: b, max: c } = dist;
      const u = Math.random();
      const f = (b - a) / (c - a);
      if (u < f) return a + Math.sqrt(u * (c - a) * (b - a));
      return c - Math.sqrt((1 - u) * (c - a) * (c - b));
    }
    case 'uniform':
      return dist.min + Math.random() * (dist.max - dist.min);
    case 'pert': {
      const { min: a, mode: m, max: c } = dist;
      if (c <= a) return a;
      const { alpha, beta } = pertShape(a, m, c, dist.lambda);
      return a + betaSample(alpha, beta) * (c - a);
    }
    case 'empirical': {
      if (dist.samples.length === 0) return NaN;
      const idx = Math.floor(Math.random() * dist.samples.length);
      return dist.samples[idx];
    }
  }
}

/** Fit a normal distribution to raw samples. */
export function fitNormal(data: number[]): Distribution {
  const n = data.length;
  if (n === 0) return { kind: 'normal', mean: 0, std: 0 };
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const variance = data.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { kind: 'normal', mean, std: Math.sqrt(variance) };
}

/** Fit a lognormal distribution to raw samples (ln-transform then normal fit). */
export function fitLognormal(data: number[]): Distribution {
  const positive = data.filter(d => d > 0);
  if (positive.length === 0) return { kind: 'normal', mean: 0, std: 0 };
  const logs = positive.map(d => Math.log(d));
  const n = logs.length;
  const meanLog = logs.reduce((a, b) => a + b, 0) / n;
  const variance = logs.reduce((a, b) => a + (b - meanLog) ** 2, 0) / n;
  return { kind: 'lognormal', meanLog, stdLog: Math.sqrt(variance) };
}

/** Fit a triangular distribution from min/mode/max of raw samples. */
export function fitTriangular(data: number[]): Distribution {
  if (data.length === 0) return { kind: 'triangular', min: 0, mode: 0, max: 0 };
  const sorted = [...data].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  return { kind: 'triangular', min, mode: median, max };
}

/** Use raw samples directly (bootstrap resampling). */
export function fitEmpirical(data: number[]): Distribution {
  return { kind: 'empirical', samples: [...data] };
}

export interface MonteCarloResult {
  /** Number of valid iterations run. */
  iterations: number;
  /** Mean of output distribution. */
  mean: number;
  /** Standard deviation. */
  std: number;
  /** Coefficient of variation (std/mean), or 0 if mean is 0. */
  cv: number;
  /** 10th percentile. */
  p10: number;
  /** 50th percentile (median). */
  p50: number;
  /** 90th percentile. */
  p90: number;
  /** 5th percentile (for VaR-style metrics). */
  p5: number;
  /** 95th percentile. */
  p95: number;
  /** Minimum observed. */
  min: number;
  /** Maximum observed. */
  max: number;
  /** Histogram bin counts. */
  histogram: number[];
  /** Histogram bin edges (length = histogram.length + 1). */
  binEdges: number[];
  /** All raw output values (for downstream analysis / scatter). */
  values: number[];
  /** Spearman rank correlation per input (sensitivity analysis). */
  sensitivity?: { name: string; correlation: number }[];
}

/**
 * Run a Monte Carlo simulation.
 *
 * @param inputs Named input distributions.
 * @param model   Function that takes one draw from each input and returns the
 *                output value (e.g. NPV, recovery, annual ounces).
 * @param iterations Number of iterations (default 5000).
 * @param bins     Histogram bin count (default 25).
 */
export function runMonteCarlo(
  inputs: { name: string; dist: Distribution }[],
  model: (draws: Record<string, number>) => number,
  iterations = 5000,
  bins = 25,
): MonteCarloResult {
  const values: number[] = [];
  const inputDraws: Record<string, number[]> = {};

  for (const inp of inputs) inputDraws[inp.name] = [];

  for (let i = 0; i < iterations; i++) {
    const draws: Record<string, number> = {};
    for (const inp of inputs) draws[inp.name] = sample(inp.dist);

    const out = model(draws);
    if (!Number.isFinite(out)) continue;

    values.push(out);
    for (const inp of inputs) inputDraws[inp.name].push(draws[inp.name]);
  }

  const valid = values.length;
  if (valid === 0) {
    return {
      iterations: 0, mean: 0, std: 0, cv: 0,
      p5: 0, p10: 0, p50: 0, p90: 0, p95: 0,
      min: 0, max: 0, histogram: [], binEdges: [], values: [],
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / valid;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / valid;
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? std / Math.abs(mean) : 0;

  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

  // Histogram
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min || 1;
  const binWidth = range / bins;
  const histogram = new Array(bins).fill(0);
  const binEdges = new Array(bins + 1).fill(0).map((_, i) => min + i * binWidth);

  for (const v of values) {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    histogram[idx]++;
  }

  // Spearman rank correlation for sensitivity
  const sensitivity = inputs.map(inp => {
    const r = spearmanCorrelation(inputDraws[inp.name], values);
    return { name: inp.name, correlation: r };
  }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    iterations: valid,
    mean,
    std,
    cv,
    p5: pct(5),
    p10: pct(10),
    p50: pct(50),
    p90: pct(90),
    p95: pct(95),
    min,
    max,
    histogram,
    binEdges,
    values,
    sensitivity,
  };
}

/** Spearman rank correlation between two arrays. */
function spearmanCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  const rank = (arr: number[]): number[] => {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
      i = j + 1;
    }
    return ranks;
  };

  const rx = rank(x);
  const ry = rank(y);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Format a Monte Carlo result as a concise summary string. */
export function summarizeMC(r: MonteCarloResult, unit = ''): string {
  if (r.iterations === 0) return 'N/A';
  const fmt = (n: number) => n >= 1000 ? n.toFixed(0) : n.toFixed(1);
  return `P10 ${fmt(r.p10)}${unit} · P50 ${fmt(r.p50)}${unit} · P90 ${fmt(r.p90)}${unit} · CV ${(r.cv * 100).toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Corrélation entre variables — copule gaussienne
//
// Les tirages indépendants de `sample()` ignorent qu'une teneur élevée va souvent
// de pair avec une meilleure récupération, ou qu'un débit et une teneur sont liés
// par la géologie. La copule gaussienne réintroduit cette dépendance SANS toucher
// aux lois marginales : on tire des normales corrélées (Cholesky d'une matrice de
// corrélation), on les passe en uniformes par Φ, puis on inverse chaque marginale
// par sa fonction quantile. Les histogrammes de chaque variable restent donc
// exactement ceux demandés ; seule leur dépendance conjointe change.
// ─────────────────────────────────────────────────────────────────────────────

/** Standard normal CDF Φ(z) via a rational erf approximation (A&S 7.1.26). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Regularized incomplete beta I_x(a,b) — Lentz continued fraction (Numerical Recipes). */
function betacf(x: number, a: number, b: number): number {
  const fpmin = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** ln Γ(x) — Stirling series after shifting x above 10 for accuracy. */
function logGamma(x: number): number {
  let z = x;
  let shift = 0;
  while (z < 10) { shift += Math.log(z); z += 1; }
  const inv = 1 / z;
  // Stirling asymptotic series: 1/(12z) − 1/(360z³) + 1/(1260z⁵) − 1/(1680z⁷).
  const series = inv / 12 - (inv * inv * inv) / 360 + (inv ** 5) / 1260 - (inv ** 7) / 1680;
  return (z - 0.5) * Math.log(z) - z + 0.5 * Math.log(2 * Math.PI) + series - shift;
}

/** Regularized incomplete beta function I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Inverse of the regularized incomplete beta — bisection on I_x(a,b) = p. */
function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (regularizedIncompleteBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Inverse CDF (quantile) of a distribution at probability p ∈ (0,1). This is the
 * marginal-inversion step of the Gaussian copula — one per input variable.
 */
export function quantile(dist: Distribution, p: number): number {
  const pp = Math.min(1 - 1e-9, Math.max(1e-9, p));
  switch (dist.kind) {
    case 'normal':
      return clamp(dist.mean + dist.std * normalQuantile(pp), dist.min, dist.max);
    case 'lognormal':
      return clamp(Math.exp(dist.meanLog + dist.stdLog * normalQuantile(pp)), dist.min, dist.max);
    case 'uniform':
      return dist.min + pp * (dist.max - dist.min);
    case 'triangular': {
      const { min: a, mode: m, max: c } = dist;
      if (c <= a) return a;
      const fm = (m - a) / (c - a);
      return pp < fm
        ? a + Math.sqrt(pp * (c - a) * (m - a))
        : c - Math.sqrt((1 - pp) * (c - a) * (c - m));
    }
    case 'pert': {
      const { min: a, mode: m, max: c } = dist;
      if (c <= a) return a;
      const { alpha, beta } = pertShape(a, m, c, dist.lambda);
      return a + betaQuantile(pp, alpha, beta) * (c - a);
    }
    case 'empirical': {
      const s = [...dist.samples].sort((x, y) => x - y);
      if (s.length === 0) return NaN;
      return s[Math.min(s.length - 1, Math.floor(pp * s.length))];
    }
  }
}

/** A correlation between two named inputs, coefficient ρ ∈ [−1, 1]. */
export interface Correlation { a: string; b: string; rho: number }

/** Cholesky decomposition A = L·Lᵀ; null when A is not positive-definite. */
function cholesky(A: number[][]): number[][] | null {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

export interface MonteCarloModelResult {
  /** Number of valid (all-finite) iterations. */
  iterations: number;
  /** One full distribution per output key. */
  outputs: Record<string, MonteCarloResult>;
  /** False when the requested correlation matrix was not positive-definite and
   *  independent sampling was used instead (the UI warns the user). */
  correlationsApplied: boolean;
}

/**
 * Run a correlated Monte Carlo over a VECTOR model: every iteration draws all
 * inputs jointly (Gaussian copula) and evaluates every output from the SAME draw,
 * so cross-output relationships (e.g. revenue vs OPEX) stay consistent. Returns a
 * `MonteCarloResult` (percentiles, histogram, Spearman sensitivity) per output.
 */
export function runMonteCarloModel(
  inputs: { name: string; dist: Distribution }[],
  correlations: Correlation[],
  model: (draws: Record<string, number>) => Record<string, number>,
  outputKeys: string[],
  iterations = 10000,
  bins = 30,
): MonteCarloModelResult {
  const n = inputs.length;
  const idx = new Map(inputs.map((inp, i) => [inp.name, i]));

  // Build the correlation matrix (identity + user coefficients, symmetric).
  const R: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (const c of correlations) {
    const i = idx.get(c.a);
    const j = idx.get(c.b);
    if (i == null || j == null || i === j) continue;
    const rho = Math.max(-0.999, Math.min(0.999, c.rho));
    R[i][j] = rho;
    R[j][i] = rho;
  }
  const L = n > 0 ? cholesky(R) : [];
  const correlationsApplied = L != null && correlations.length > 0;
  // Fallback to independent sampling (identity) when the matrix is inconsistent.
  const chol = L ?? R.map((_, i) => R.map((__, j) => (i === j ? 1 : 0)));

  const outValues: Record<string, number[]> = {};
  for (const k of outputKeys) outValues[k] = [];
  const inputDraws: Record<string, number[]> = {};
  for (const inp of inputs) inputDraws[inp.name] = [];

  for (let it = 0; it < iterations; it++) {
    // Correlated standard normals y = L·z, then uniforms u = Φ(y).
    const z = new Array(n);
    for (let i = 0; i < n; i++) z[i] = gaussian();
    const draws: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      let y = 0;
      for (let k = 0; k <= i; k++) y += chol[i][k] * z[k];
      const u = normalCdf(y);
      draws[inputs[i].name] = quantile(inputs[i].dist, u);
    }

    const out = model(draws);
    let ok = true;
    for (const k of outputKeys) if (!Number.isFinite(out[k])) { ok = false; break; }
    if (!ok) continue;

    for (const k of outputKeys) outValues[k].push(out[k]);
    for (const inp of inputs) inputDraws[inp.name].push(draws[inp.name]);
  }

  const outputs: Record<string, MonteCarloResult> = {};
  for (const k of outputKeys) {
    outputs[k] = summarizeValues(outValues[k], bins, inputs.map(inp => ({ name: inp.name, draws: inputDraws[inp.name] })));
  }
  const iters = outputKeys.length > 0 ? outValues[outputKeys[0]].length : 0;
  return { iterations: iters, outputs, correlationsApplied };
}

/** Turn a raw value array into a MonteCarloResult (percentiles, histogram, sensitivity). */
function summarizeValues(
  values: number[],
  bins: number,
  inputDraws: { name: string; draws: number[] }[],
): MonteCarloResult {
  const valid = values.length;
  if (valid === 0) {
    return { iterations: 0, mean: 0, std: 0, cv: 0, p5: 0, p10: 0, p50: 0, p90: 0, p95: 0, min: 0, max: 0, histogram: [], binEdges: [], values: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / valid;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / valid;
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? std / Math.abs(mean) : 0;
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = max - min || 1;
  const binWidth = range / bins;
  const histogram = new Array(bins).fill(0);
  const binEdges = new Array(bins + 1).fill(0).map((_, i) => min + i * binWidth);
  for (const v of values) {
    let i = Math.floor((v - min) / binWidth);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    histogram[i]++;
  }
  const sensitivity = inputDraws
    .map(inp => ({ name: inp.name, correlation: spearmanCorrelation(inp.draws, values) }))
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return { iterations: valid, mean, std, cv, p5: pct(5), p10: pct(10), p50: pct(50), p90: pct(90), p95: pct(95), min, max, histogram, binEdges, values, sensitivity };
}
