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
// CircuitAI (recovery confidence), Economics (NPV-at-risk), Risks (quantitative).
// ─────────────────────────────────────────────────────────────────────────────

/** A single stochastic input distribution. */
export type Distribution =
  | { kind: 'normal'; mean: number; std: number; min?: number; max?: number }
  | { kind: 'lognormal'; meanLog: number; stdLog: number; min?: number; max?: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  | { kind: 'uniform'; min: number; max: number }
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
