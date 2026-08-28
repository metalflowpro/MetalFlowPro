// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Moteur de simulation RAM/DES
//
// Simulation Monte-Carlo à événements discrets du débit d'une usine. Chaque
// ITÉRATION tire une capacité nominale par aire, fait courir les horloges de
// panne (TTF/TTR) et les arrêts planifiés sur l'horizon, propage la matière le
// long de la chaîne (rendements massiques, tampons) et relève le débit, le goulot
// et la disponibilité. On agrège N itérations en percentiles P10/P50/P90, en
// probabilité de goulot par aire et en sensibilités (tornado).
//
// Astuce « base équivalente-alimentation » : les capacités et tampons sont
// divisés par le rendement massique cumulé en amont, de sorte que tout se compte
// en tonnes d'alimentation équivalentes et que le débit final EST le débit
// d'alimentation de l'usine (t/h).
// ─────────────────────────────────────────────────────────────────────────────

import { PLANT_OPT_MODEL_DEFAULTS } from './config';
import { Rng, buildDistribution, percentile, type Distribution } from './distributions';
import type {
  Area, IterationResult, PlantModel, SensitivityEntry, SimConfig, SimResult,
} from './types';

const D = PLANT_OPT_MODEL_DEFAULTS;

/** Horloge alternant marche (TTF) / panne (TTR), avec capacité résiduelle en panne. */
class FailureClock {
  down = false;
  private timer: number;
  constructor(
    private ttf: Distribution,
    private ttr: Distribution,
    readonly residual: number,
    private rng: Rng,
  ) {
    this.timer = Math.max(1e-9, ttf.sample(rng));
  }
  advance(dt: number): void {
    this.timer -= dt;
    let guard = 0;
    // Plusieurs transitions peuvent tomber dans un même pas de temps (pannes courtes).
    while (this.timer <= 0 && guard < 1000) {
      guard += 1;
      this.down = !this.down;
      const next = this.down ? this.ttr.sample(this.rng) : this.ttf.sample(this.rng);
      this.timer += Math.max(1e-9, next);
    }
  }
}

/** État d'exécution d'une aire : capacité nominale tirée + horloges de panne. */
class AreaState {
  nominalCapacity: number;
  private clocks: FailureClock[];
  private availSum = 0;
  private availSteps = 0;
  constructor(readonly area: Area, model: PlantModel, rng: Rng) {
    this.nominalCapacity = Math.max(0, buildDistribution(area.capacityDist).sample(rng));
    this.clocks = model.failureModes
      .filter(fm => fm.areaId === area.id)
      .map(fm => new FailureClock(
        buildDistribution(fm.ttfDist),
        buildDistribution(fm.ttrDist),
        fm.residualCapacity ?? 0,
        rng,
      ));
  }
  advanceClocks(dt: number): void {
    for (const c of this.clocks) c.advance(dt);
  }
  /** Facteur de disponibilité instantané : capacité résiduelle la plus basse des pannes actives. */
  availabilityFactor(): number {
    let f = 1;
    for (const c of this.clocks) if (c.down) f = Math.min(f, c.residual);
    return f;
  }
  recordAvailable(v: number): void {
    this.availSum += v;
    this.availSteps += 1;
  }
  meanAvailableCapacity(): number {
    return this.availSteps ? this.availSum / this.availSteps : 0;
  }
}

/** État d'une cause commune : une horloge unique abattant plusieurs aires. */
class CommonCauseState {
  readonly areaIds: Set<string>;
  private clock: FailureClock;
  constructor(cc: { areaIds: string[]; ttfDist: PlantModel['commonCauses'][number]['ttfDist']; ttrDist: PlantModel['commonCauses'][number]['ttrDist'] }, rng: Rng) {
    this.areaIds = new Set(cc.areaIds);
    this.clock = new FailureClock(buildDistribution(cc.ttfDist), buildDistribution(cc.ttrDist), 0, rng);
  }
  advance(dt: number): void { this.clock.advance(dt); }
  get down(): boolean { return this.clock.down; }
}

/** Un arrêt planifié est-il actif à l'instant `time` pour l'aire `areaId` ? */
function isPlannedStopActive(
  stop: PlantModel['plannedStops'][number],
  areaId: string,
  time: number,
): boolean {
  if (!stop.areaIds.includes(areaId)) return false;
  const offset = stop.firstOffsetHours ?? 0;
  if (time < offset) return false;
  return (time - offset) % stop.intervalHours < stop.durationHours;
}

/** Fait tourner UNE itération de l'horizon et renvoie ses métriques. */
export function runIteration(model: PlantModel, rng: Rng, config: SimConfig): IterationResult {
  const horizon = config.horizonHours ?? model.horizonHours;
  const step = config.timeStepHours;
  const warmup = config.warmupHours;

  const areas = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);
  const w = areas.length;
  const states = areas.map(a => new AreaState(a, model, rng));
  const commonCauses = (model.commonCauses ?? []).map(cc => new CommonCauseState(cc, rng));
  const feed = model.feedScenario;

  // ── Effet de la dureté sur la capacité nominale ──────────────────────────────
  if (feed?.hardnessDist) {
    const dist = buildDistribution(feed.hardnessDist);
    const ref = feed.hardnessRef ?? dist.mean() ?? 1;
    const sampled = dist.sample(rng);
    const rel = ref !== 0 ? sampled / ref - 1 : 0;
    for (let i = 0; i < w; i++) {
      const a = areas[i];
      const sens = a.hardnessSensitive
        ? (feed.hardnessToCapacity ?? 0)
        : (a.hardnessSensitivity ?? 0);
      if (sens !== 0) {
        const factor = Math.max(
          D.HARDNESS_CAPACITY_MIN_FACTOR,
          Math.min(D.HARDNESS_CAPACITY_MAX_FACTOR, 1 - sens * rel),
        );
        states[i].nominalCapacity *= factor;
      }
    }
  }

  // ── Effet de la teneur sur la récupération globale ───────────────────────────
  let recovery = 1;
  if (areas.some(a => a.baseRecovery !== undefined || a.gradeSensitivity)) {
    let gradeRel = 0;
    if (feed?.gradeDist) {
      const gd = buildDistribution(feed.gradeDist);
      const gref = feed.gradeRef ?? gd.mean() ?? 1;
      const g = gd.sample(rng);
      gradeRel = gref !== 0 ? g / gref - 1 : 0;
    }
    for (const a of areas) {
      recovery *= Math.max(0, Math.min(1, (a.baseRecovery ?? 1) * (1 + (a.gradeSensitivity ?? 0) * gradeRel)));
    }
  }

  // ── Tampons entre aires successives ──────────────────────────────────────────
  const bufferPresent: (number | null)[] = []; // 1 = tampon présent, null = pas de tampon
  const bufCap: number[] = [];
  const bufLevel: number[] = [];
  for (let i = 0; i < w - 1; i++) {
    const buf = (model.buffers ?? []).find(b => b.upstreamAreaId === areas[i].id);
    if (buf && buf.downstreamAreaId === areas[i + 1].id) {
      bufCap.push(buf.capacityTonnes);
      bufLevel.push(buf.initialLevel ?? 0);
      bufferPresent.push(1);
    } else {
      bufCap.push(0);
      bufLevel.push(0);
      bufferPresent.push(null);
    }
  }

  // ── Rendements massiques → base équivalente-alimentation ─────────────────────
  const yieldPerArea = new Array<number>(w).fill(1);
  areas.forEach((a, i) => {
    const s = model.streams.find(st => st.sourceAreaId === a.id);
    if (s) yieldPerArea[i] = s.massYield ?? 1;
  });
  const cumYield = new Array<number>(w).fill(1);
  for (let i = 1; i < w; i++) cumYield[i] = cumYield[i - 1] * yieldPerArea[i - 1];
  for (let i = 0; i < w; i++) {
    const c = cumYield[i] > 1e-9 ? cumYield[i] : 1e-9;
    states[i].nominalCapacity /= c;
  }
  for (let i = 0; i < w - 1; i++) {
    if (bufferPresent[i] !== null) {
      const c = cumYield[i + 1] > 1e-9 ? cumYield[i + 1] : 1e-9;
      bufCap[i] /= c;
      bufLevel[i] /= c;
    }
  }
  // Tout est désormais en base équivalente-alimentation : plus de rendement dans le flux.
  const flowYield = new Array<number>(w).fill(1);

  // ── Intégration temporelle ───────────────────────────────────────────────────
  let throughputSum = 0;
  let timeAccounted = 0;
  const stepCount = Math.round(horizon / step);

  for (let t = 0; t < stepCount; t++) {
    const now = t * step;
    for (const cc of commonCauses) cc.advance(step);
    for (const s of states) s.advanceClocks(step);

    // Capacité disponible de chaque aire ce pas de temps.
    const avail: number[] = [];
    for (const s of states) {
      let factor = s.availabilityFactor();
      for (const stop of model.plannedStops ?? []) {
        if (isPlannedStopActive(stop, s.area.id, now)) { factor = 0; break; }
      }
      for (const cc of commonCauses) {
        if (cc.down && cc.areaIds.has(s.area.id)) { factor = 0; break; }
      }
      const a = s.nominalCapacity * factor;
      avail.push(a);
      s.recordAvailable(a);
    }

    // Sous-pas d'intégration adaptatifs : plus fins si les tampons sont petits.
    const maxAvail = avail.length ? Math.max(...avail) : 0;
    const positiveBufCaps = bufCap.filter(c => c > 0);
    const minBufCap = positiveBufCaps.length ? Math.min(...positiveBufCaps) : 0;
    let substeps = 1;
    if (minBufCap > 0 && maxAvail > 0) {
      substeps = Math.min(D.MAX_BUFFER_SUBSTEPS, Math.max(1, Math.ceil((step * maxAvail) / (0.5 * minBufCap))));
    }
    const dt = step / substeps;
    let producedThisStep = 0;

    for (let sub = 0; sub < substeps; sub++) {
      const flowOut = new Array<number>(w).fill(0);
      const handoff = new Array<number>(w).fill(0); // remise directe quand pas de tampon
      for (let i = 0; i < w; i++) {
        const capacity = avail[i] * dt;
        const upstreamSupply = i === 0
          ? Infinity
          : (bufferPresent[i - 1] === null ? handoff[i - 1] : bufLevel[i - 1]);
        const downstreamRoom = i === w - 1
          ? Infinity
          : (bufferPresent[i] === null ? avail[i + 1] * dt : bufCap[i] - bufLevel[i]);
        const flow = Math.max(0, Math.min(capacity, upstreamSupply, downstreamRoom));
        flowOut[i] = flow;
        if (i > 0 && bufferPresent[i - 1] !== null) {
          bufLevel[i - 1] = Math.max(0, bufLevel[i - 1] - flow);
        }
        if (i < w - 1) {
          const passed = flow * flowYield[i];
          if (bufferPresent[i] === null) handoff[i] = passed;
          else bufLevel[i] = Math.min(bufCap[i], bufLevel[i] + passed);
        }
      }
      producedThisStep += flowOut[w - 1] * flowYield[w - 1];
    }

    if (now >= warmup) {
      throughputSum += producedThisStep;
      timeAccounted += step;
    }
  }

  const throughput = timeAccounted > 0 ? throughputSum / timeAccounted : 0;

  const nominalCapacity: Record<string, number> = {};
  const meanAvailableCapacity: Record<string, number> = {};
  for (const s of states) {
    nominalCapacity[s.area.id] = s.nominalCapacity;
    meanAvailableCapacity[s.area.id] = s.meanAvailableCapacity();
  }
  const nominals = Object.values(nominalCapacity);
  const minNominalCapacity = nominals.length ? Math.min(...nominals) : 0;

  // Goulot = aire dont la capacité MOYENNE disponible est la plus basse.
  let bottleneckAreaId = '';
  let minMeanAvail = Infinity;
  for (const [id, cap] of Object.entries(meanAvailableCapacity)) {
    if (cap < minMeanAvail) { minMeanAvail = cap; bottleneckAreaId = id; }
  }

  return {
    throughput,
    bottleneckAreaId,
    nominalCapacity,
    meanAvailableCapacity,
    minNominalCapacity,
    availability: Math.min(1, minNominalCapacity > 0 ? throughput / minNominalCapacity : 0),
    recovery,
    recoveredThroughput: throughput * recovery,
  };
}

/** Diagramme tornado : effet sur le débit de la capacité tirée de chaque aire. */
function computeSensitivity(model: PlantModel, results: IterationResult[]): SensitivityEntry[] {
  const n = results.length;
  if (n < D.SENSITIVITY_MIN_ITERATIONS) return [];
  const tail = Math.max(1, Math.floor(n * D.SENSITIVITY_TAIL_FRACTION));
  const entries = model.areas.map(area => {
    const pairs = results
      .map(r => [r.nominalCapacity[area.id] ?? 0, r.throughput] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const low = pairs.slice(0, tail).reduce((s, p) => s + p[1], 0) / tail;
    const high = pairs.slice(-tail).reduce((s, p) => s + p[1], 0) / tail;
    return { driver: area.name, low, high, spread: Math.abs(high - low) };
  });
  entries.sort((a, b) => b.spread - a.spread);
  return entries.map(({ driver, low, high }) => ({ driver, low, high }));
}

/** Agrège les itérations en résultat final (percentiles, goulots, sensibilités). */
export function aggregate(model: PlantModel, results: IterationResult[]): SimResult {
  if (results.length === 0) throw new Error('Aucune itération à agréger');
  const throughputs = results.map(r => r.throughput).sort((a, b) => a - b);
  const n = results.length;
  const mean = throughputs.reduce((a, b) => a + b, 0) / n;

  const bottleneckCounts: Record<string, number> = {};
  for (const area of model.areas) bottleneckCounts[area.id] = 0;
  for (const r of results) {
    if (r.bottleneckAreaId in bottleneckCounts) bottleneckCounts[r.bottleneckAreaId] += 1;
  }
  const bottleneckProbability: Record<string, number> = {};
  for (const [id, count] of Object.entries(bottleneckCounts)) bottleneckProbability[id] = count / n;

  const availability = results.reduce((a, r) => a + r.availability, 0) / n;
  const costPerTonne = model.areas.reduce((a, ar) => a + ar.opexPerTonne, 0);
  const recoveryMean = results.reduce((a, r) => a + r.recovery, 0) / n;
  const recovered = results.map(r => r.recoveredThroughput).sort((a, b) => a - b);

  return {
    throughputP10: percentile(throughputs, 0.1),
    throughputP50: percentile(throughputs, 0.5),
    throughputP90: percentile(throughputs, 0.9),
    throughputMean: mean,
    availability,
    costPerTonne,
    bottleneckProbability,
    sensitivity: computeSensitivity(model, results),
    throughputSamples: throughputs,
    recoveryMean,
    recoveredThroughputP50: percentile(recovered, 0.5),
  };
}

export interface RunOptions {
  model: PlantModel;
  config: SimConfig;
  /** Callback de progression (fraction 0–1) — pour la barre d'avancement UI. */
  onProgress?: (fraction: number) => void;
  /** Itérations entre deux respirations de la boucle d'événements (réactivité UI). */
  batchSize?: number;
}

/** Laisse respirer la boucle d'événements du navigateur entre deux lots. */
function yieldToUi(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/**
 * Exécute la simulation complète (asynchrone, non bloquante). Dérive une graine
 * fille reproductible par itération depuis la graine maître, agrège le tout.
 */
export async function runSimulation(opts: RunOptions): Promise<SimResult> {
  const { model, onProgress, batchSize = 100 } = opts;
  const config: SimConfig = {
    iterations: opts.config.iterations,
    seed: opts.config.seed,
    warmupHours: opts.config.warmupHours,
    timeStepHours: opts.config.timeStepHours,
    horizonHours: opts.config.horizonHours ?? model.horizonHours,
  };
  const master = new Rng(config.seed);
  const results: IterationResult[] = [];
  const total = Math.max(0, Math.floor(config.iterations));
  for (let i = 0; i < total; i++) {
    const rng = new Rng(master.nextUint32());
    results.push(runIteration(model, rng, config));
    if ((i + 1) % batchSize === 0) {
      onProgress?.((i + 1) / total);
      await yieldToUi();
    }
  }
  onProgress?.(1);
  return aggregate(model, results);
}

/** Version synchrone (tests, petits runs) — pas de découpage ni de progression. */
export function runSimulationSync(model: PlantModel, config: SimConfig): SimResult {
  const effective: SimConfig = { ...config, horizonHours: config.horizonHours ?? model.horizonHours };
  const master = new Rng(effective.seed);
  const results: IterationResult[] = [];
  const total = Math.max(0, Math.floor(effective.iterations));
  for (let i = 0; i < total; i++) {
    results.push(runIteration(model, new Rng(master.nextUint32()), effective));
  }
  return aggregate(model, results);
}
