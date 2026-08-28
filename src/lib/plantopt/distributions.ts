// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Générateur aléatoire déterministe & lois de probabilité
//
// RNG Mulberry32 réensemençable (reproductibilité : même graine ⇒ même suite) et
// un échantillonneur par famille de loi. Toutes les lois exposent `sample(rng)` et
// `mean()`. `buildDistribution` instancie une loi depuis une `DistributionSpec`
// sérialisable ; `fitDistribution` ajuste une loi sur un jeu de données (avec un
// écart de Kolmogorov–Smirnov comme indice de qualité d'ajustement).
// ─────────────────────────────────────────────────────────────────────────────

import { PLANT_OPT_MODEL_DEFAULTS } from './config';
import type { DistributionKind, DistributionSpec } from './types';

/**
 * RNG Mulberry32 : petit générateur à état 32 bits, rapide et reproductible.
 * Fournit les tirages de base (uniforme, gaussien, expo, Weibull, lognormal,
 * triangulaire, gamma, beta) réutilisés par les lois.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniforme sur [0,1). */
  random(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), 61 | t))) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /** Entier 32 bits non signé (pour dériver des graines filles). */
  nextUint32(): number {
    return Math.floor(0x100000000 * this.random()) >>> 0;
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.random();
  }

  /** Gaussien N(mean, sd) par Box–Muller. */
  gauss(mean: number, sd: number): number {
    let u = 0;
    while (u === 0) u = this.random();
    return mean + sd * (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.random()));
  }

  expovariate(rate: number): number {
    return -Math.log(1 - this.random()) / rate;
  }

  weibullvariate(scale: number, shape: number): number {
    return scale * Math.pow(-Math.log(1 - this.random()), 1 / shape);
  }

  lognormvariate(mu: number, sigma: number): number {
    return Math.exp(this.gauss(mu, sigma));
  }

  /** Triangulaire (low, high, mode) — méthode de la racine carrée inversée. */
  triangular(low: number, high: number, mode: number): number {
    let u = this.random();
    let c = high === low ? 0.5 : (mode - low) / (high - low);
    let lo = low;
    let hi = high;
    if (u > c) {
      u = 1 - u;
      c = 1 - c;
      lo = high;
      hi = low;
    }
    return lo + (hi - lo) * Math.sqrt(u * c);
  }

  /** Gamma(shape, scale) — algorithme de Marsaglia & Tsang. */
  gammavariate(shape: number, scale = 1): number {
    if (shape < 1) {
      const u = this.random();
      return this.gammavariate(shape + 1, scale) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.gauss(0, 1);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.random();
      if (u < 1 - 0.0331 * x * x * x * x || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v * scale;
      }
    }
  }

  betavariate(alpha: number, beta: number): number {
    const g = this.gammavariate(alpha, 1);
    return g <= 0 ? 0 : g / (g + this.gammavariate(beta, 1));
  }

  choice<T>(items: T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  choices<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
}

/** Fonction Gamma (approximation de Lanczos) — pour la moyenne de Weibull. */
export function gammaFn(z: number): number {
  const g = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  z -= 1;
  let a = g[0];
  for (let i = 1; i < 9; i++) a += g[i] / (z + i);
  const t = z + 7 + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}

// ─── Lois ─────────────────────────────────────────────────────────────────────

export interface Distribution {
  sample(rng: Rng): number;
  mean(): number;
}

class ConstantDist implements Distribution {
  constructor(private value: number) {}
  sample(): number { return this.value; }
  mean(): number { return this.value; }
}

class UniformDist implements Distribution {
  constructor(private min: number, private max: number) {}
  sample(rng: Rng): number { return rng.uniform(this.min, this.max); }
  mean(): number { return (this.min + this.max) / 2; }
}

/** Normale tronquée : rejette hors [min,max] (100 essais), sinon écrête. */
class NormalDist implements Distribution {
  constructor(private meanVal: number, private sd: number, private min?: number, private max?: number) {}
  sample(rng: Rng): number {
    let s = this.meanVal;
    for (let i = 0; i < 100; i++) {
      s = rng.gauss(this.meanVal, this.sd);
      if ((this.min === undefined || s >= this.min) && (this.max === undefined || s <= this.max)) return s;
    }
    return Math.min(this.max ?? s, Math.max(this.min ?? s, s));
  }
  mean(): number { return this.meanVal; }
}

class ExponentialDist implements Distribution {
  constructor(private rate: number) {}
  sample(rng: Rng): number { return rng.expovariate(this.rate); }
  mean(): number { return 1 / this.rate; }
}

class WeibullDist implements Distribution {
  constructor(private shape: number, private scale: number) {}
  sample(rng: Rng): number { return rng.weibullvariate(this.scale, this.shape); }
  mean(): number { return this.scale * gammaFn(1 + 1 / this.shape); }
}

class LognormalDist implements Distribution {
  constructor(private mu: number, private sigma: number) {}
  sample(rng: Rng): number { return rng.lognormvariate(this.mu, this.sigma); }
  mean(): number { return Math.exp(this.mu + (this.sigma * this.sigma) / 2); }
}

class TriangularDist implements Distribution {
  constructor(private min: number, private mode: number, private max: number) {}
  sample(rng: Rng): number { return rng.triangular(this.min, this.max, this.mode); }
  mean(): number { return (this.min + this.mode + this.max) / 3; }
}

/** PERT = beta re-paramétrée par (min, mode, max) avec un poids λ sur le mode. */
class PertDist implements Distribution {
  constructor(private min: number, private mode: number, private max: number, private lambda = 4) {}
  private alphaBeta(): [number, number] {
    const range = this.max - this.min;
    if (range <= 0) return [1, 1];
    return [
      1 + (this.lambda * (this.mode - this.min)) / range,
      1 + (this.lambda * (this.max - this.mode)) / range,
    ];
  }
  sample(rng: Rng): number {
    const [a, b] = this.alphaBeta();
    return this.min + rng.betavariate(a, b) * (this.max - this.min);
  }
  mean(): number { return (this.min + this.lambda * this.mode + this.max) / (this.lambda + 2); }
}

/** Empirique : tire uniformément dans l'échantillon fourni. */
class EmpiricalDist implements Distribution {
  constructor(private samples: number[]) {}
  sample(rng: Rng): number { return rng.choice(this.samples); }
  mean(): number { return this.samples.reduce((a, b) => a + b, 0) / this.samples.length; }
}

/** Catégorielle : valeurs pondérées. */
class CategoricalDist implements Distribution {
  constructor(private values: number[], private weights: number[]) {}
  sample(rng: Rng): number { return rng.choices(this.values, this.weights); }
  mean(): number {
    const total = this.weights.reduce((a, b) => a + b, 0);
    return this.values.reduce((acc, v, i) => acc + v * this.weights[i], 0) / total;
  }
}

/** Lit un paramètre numérique en repliant sur `fallback` si absent/non fini. */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Instancie une loi exécutable depuis sa spécification sérialisable. */
export function buildDistribution(spec: DistributionSpec): Distribution {
  const p = spec.params as Record<string, number | number[]>;
  switch (spec.kind) {
    case 'constant':    return new ConstantDist(num(p.value));
    case 'uniform':     return new UniformDist(num(p.min), num(p.max));
    case 'normal':      return new NormalDist(num(p.mean), num(p.sd, 1), p.min !== undefined ? num(p.min) : undefined, p.max !== undefined ? num(p.max) : undefined);
    case 'exponential': return new ExponentialDist(num(p.rate, 1));
    case 'weibull':     return new WeibullDist(num(p.shape, 1), num(p.scale, 1));
    case 'lognormal':   return new LognormalDist(num(p.mu), num(p.sigma, 1));
    case 'triangular':  return new TriangularDist(num(p.min), num(p.mode), num(p.max));
    case 'pert':        return new PertDist(num(p.min), num(p.mode), num(p.max), p.lambda !== undefined ? num(p.lambda, 4) : 4);
    case 'empirical':   return new EmpiricalDist(Array.isArray(p.samples) ? (p.samples as number[]) : []);
    case 'categorical': return new CategoricalDist(
      Array.isArray(p.values) ? (p.values as number[]) : [],
      Array.isArray(p.weights) ? (p.weights as number[]) : [],
    );
    default: throw new Error(`Loi inconnue : ${(spec as DistributionSpec).kind}`);
  }
}

/** Tire `n` échantillons d'une loi avec une graine donnée (prévisualisation). */
export function sampleDistribution(spec: DistributionSpec, n: number, seed: number): number[] {
  const rng = new Rng(seed);
  const dist = buildDistribution(spec);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = dist.sample(rng);
  return out;
}

/** Interpolation de quantile sur un tableau TRIÉ (fraction 0–1). */
export function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sortedAsc.length - 1);
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/** CDF empirique évaluée en x sur un tableau trié. */
function empiricalCdf(sortedAsc: number[], x: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

export interface FitResult {
  spec: DistributionSpec;
  n: number;
  mean: number;
  sd: number;
  /** Écart de Kolmogorov–Smirnov (0 = ajustement parfait). */
  ks: number;
}

/**
 * Ajuste une loi de la famille `kind` sur `data` par méthode des moments (ou MLE
 * simple pour la lognormale), puis mesure la qualité d'ajustement par l'écart KS
 * entre la CDF empirique des données et celle d'un ré-échantillon de la loi.
 */
export function fitDistribution(kind: DistributionKind, data: number[]): FitResult {
  const n = data.length;
  const mean = data.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? data.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0;
  const sd = Math.sqrt(variance);
  const floor = PLANT_OPT_MODEL_DEFAULTS.MIN_FITTED_SD;
  let spec: DistributionSpec;

  switch (kind) {
    case 'normal':
      spec = { kind: 'normal', params: { mean, sd: sd || floor } };
      break;
    case 'exponential':
      spec = { kind: 'exponential', params: { rate: mean > 0 ? 1 / mean : 1 } };
      break;
    case 'lognormal': {
      const logs = data.filter(x => x > 0).map(Math.log);
      if (logs.length === 0) throw new Error('Lognormale : données strictement positives requises');
      const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
      const lv = logs.length > 1 ? logs.reduce((a, b) => a + (b - mu) ** 2, 0) / logs.length : 0;
      spec = { kind: 'lognormal', params: { mu, sigma: Math.sqrt(lv) || floor } };
      break;
    }
    case 'weibull': {
      // Estimation par le coefficient de variation (approximation de Justus).
      const cv = mean > 0 ? sd / mean : 1;
      const shape = cv > 0 ? Math.max(0.1, Math.pow(cv, -1.086)) : 1;
      const scale = mean / gammaFn(1 + 1 / shape);
      spec = { kind: 'weibull', params: { shape, scale } };
      break;
    }
    case 'empirical':
      spec = { kind: 'empirical', params: { samples: [...data] } };
      break;
    default:
      throw new Error(`Ajustement non supporté pour la loi : ${kind}`);
  }

  const sortedData = [...data].sort((a, b) => a - b);
  const resample = sampleDistribution(
    spec,
    Math.max(2000, 4 * n),
    PLANT_OPT_MODEL_DEFAULTS.PREVIEW_SEED,
  ).sort((a, b) => a - b);
  let ks = 0;
  for (const x of resample) {
    ks = Math.max(ks, Math.abs(empiricalCdf(sortedData, x) - empiricalCdf(resample, x)));
  }
  return { spec, n, mean, sd, ks };
}
