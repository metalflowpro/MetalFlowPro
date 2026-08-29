// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Optimisation des tampons & back-test sur historique
//
//  • optimizeBuffer : balaie la capacité d'un tampon entre deux aires et trace la
//    courbe capacité → débit P50, puis repère le « genou » (capacité recommandée
//    au-delà de laquelle le gain marginal devient négligeable). Sans stockage,
//    ajouter du tampon n'aide qu'un temps : le genou situe le juste
//    dimensionnement.
//  • backtest : confronte la distribution de débit SIMULÉE aux débits RÉELS
//    (GMAO/historian) par l'écart de Kolmogorov–Smirnov — un KS faible valide le
//    modèle.
//
// Tous les réglages (nombre de points, itérations réduites, seuil du genou) sont
// paramétrés depuis la config, jamais codés en dur.
// ─────────────────────────────────────────────────────────────────────────────

import { PLANT_OPT_OPTIMIZE_DEFAULTS } from './config';
import { percentile } from './distributions';
import { runSimulationSync } from './engine';
import type { Buffer, PlantModel, SimConfig } from './types';

export interface BufferSweepPoint {
  capacityTonnes: number;
  throughputP50: number;
}

export interface BufferOptimizationResult {
  streamId: string;
  upstreamAreaId: string;
  downstreamAreaId: string;
  points: BufferSweepPoint[];
  /** Capacité au genou (recommandée) et débit P50 associé. */
  kneeCapacityTonnes: number;
  kneeThroughputP50: number;
  /** Débit P50 au plateau (capacité maximale balayée). */
  plateauThroughputP50: number;
}

/** Valeur centrale d'une loi de capacité (t/h) pour dimensionner le balayage. */
function centralCapacity(params: Record<string, number | number[]>): number {
  const v = params.mode ?? params.mean ?? params.value ?? params.max ?? 0;
  return typeof v === 'number' ? v : 0;
}

/** Remplace/insère un tampon entre deux aires (immuable). */
function withBuffer(model: PlantModel, upstreamAreaId: string, downstreamAreaId: string, capacityTonnes: number): PlantModel {
  const others = (model.buffers ?? []).filter(b => !(b.upstreamAreaId === upstreamAreaId && b.downstreamAreaId === downstreamAreaId));
  if (capacityTonnes <= 0) return { ...model, buffers: others };
  const buf: Buffer = {
    id: `sweep-${upstreamAreaId}-${downstreamAreaId}`,
    upstreamAreaId,
    downstreamAreaId,
    capacityTonnes,
    initialLevel: capacityTonnes / 2,
  };
  return { ...model, buffers: [...others, buf] };
}

/**
 * Balaie la capacité du tampon d'un flux et localise le genou de la courbe
 * capacité → débit. Le genou = première capacité atteignant `kneeGainFraction`
 * du gain total (P50_plateau − P50_zéro).
 */
export function optimizeBuffer(model: PlantModel, config: SimConfig, streamId: string): BufferOptimizationResult | null {
  const stream = model.streams.find(s => s.id === streamId);
  if (!stream) return null;
  const cfg: SimConfig = { ...config, iterations: PLANT_OPT_OPTIMIZE_DEFAULTS.SWEEP_ITERATIONS };

  const downstream = model.areas.find(a => a.id === stream.targetAreaId);
  const dsCap = downstream ? centralCapacity(downstream.capacityDist.params) : 0;
  // Capacité max balayée : fraction config de la capacité horaire aval (tonnes).
  const maxCap = Math.max(1, dsCap * PLANT_OPT_OPTIMIZE_DEFAULTS.SWEEP_MAX_CAP_HOURS);
  const n = PLANT_OPT_OPTIMIZE_DEFAULTS.SWEEP_POINTS;

  const points: BufferSweepPoint[] = [];
  for (let i = 0; i < n; i++) {
    const capacity = (maxCap * i) / (n - 1);
    const variant = withBuffer(model, stream.sourceAreaId, stream.targetAreaId, capacity);
    const r = runSimulationSync(variant, cfg);
    points.push({ capacityTonnes: capacity, throughputP50: r.throughputP50 });
  }

  const p50Zero = points[0].throughputP50;
  const p50Plateau = points[points.length - 1].throughputP50;
  const totalGain = p50Plateau - p50Zero;
  let kneeIdx = points.length - 1;
  if (totalGain > 1e-6) {
    const target = p50Zero + PLANT_OPT_OPTIMIZE_DEFAULTS.KNEE_GAIN_FRACTION * totalGain;
    kneeIdx = points.findIndex(p => p.throughputP50 >= target);
    if (kneeIdx < 0) kneeIdx = points.length - 1;
  } else {
    kneeIdx = 0; // aucun gain : le tampon n'aide pas, recommander 0.
  }

  return {
    streamId,
    upstreamAreaId: stream.sourceAreaId,
    downstreamAreaId: stream.targetAreaId,
    points,
    kneeCapacityTonnes: points[kneeIdx].capacityTonnes,
    kneeThroughputP50: points[kneeIdx].throughputP50,
    plateauThroughputP50: p50Plateau,
  };
}

export interface BacktestResult {
  n: number;
  ks: number;
  histMean: number;
  simMean: number;
  histP50: number;
  simP50: number;
  /** Verdict qualitatif dérivé des seuils config. */
  verdict: 'bon' | 'acceptable' | 'faible';
}

/** CDF empirique évaluée en x sur un tableau trié. */
function ecdf(sortedAsc: number[], x: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

/**
 * Back-test : compare la distribution de débit simulée aux débits historiques
 * réels par l'écart de Kolmogorov–Smirnov (max |CDF_sim − CDF_hist|).
 */
export function backtest(model: PlantModel, config: SimConfig, historical: number[]): BacktestResult | null {
  const hist = historical.filter(Number.isFinite).sort((a, b) => a - b);
  if (hist.length < PLANT_OPT_OPTIMIZE_DEFAULTS.BACKTEST_MIN_POINTS) return null;

  const result = runSimulationSync(model, config);
  const sim = [...result.throughputSamples].sort((a, b) => a - b);

  // KS sur l'union des points d'appui des deux échantillons.
  let ks = 0;
  for (const x of hist) ks = Math.max(ks, Math.abs(ecdf(sim, x) - ecdf(hist, x)));
  for (const x of sim) ks = Math.max(ks, Math.abs(ecdf(sim, x) - ecdf(hist, x)));

  const histMean = hist.reduce((a, b) => a + b, 0) / hist.length;
  const simMean = sim.reduce((a, b) => a + b, 0) / sim.length;
  const th = PLANT_OPT_OPTIMIZE_DEFAULTS.BACKTEST_KS_THRESHOLDS;
  const verdict = ks < th.good ? 'bon' : ks < th.acceptable ? 'acceptable' : 'faible';

  return {
    n: hist.length,
    ks,
    histMean,
    simMean,
    histP50: percentile(hist, 0.5),
    simP50: result.throughputP50,
    verdict,
  };
}
