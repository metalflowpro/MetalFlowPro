// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — « Exemple : usine complète » (design de référence SCALABLE)
//
// Gabarit illustratif d'une usine aurifère complète (concassage → HPGR → broyage
// → flottation → circuit concentré rebroyage/lixiviation/détox). Il sert de point
// de départ riche quand l'utilisateur clique « Exemple : usine complète ».
//
// ⚠️ RIEN N'EST FIGÉ À UN PROJET : le design est décrit à un débit d'alimentation
// de RÉFÉRENCE (`REFERENCE_FEED_TPH`) et TOUTES les capacités/tampons sont mis à
// l'échelle par `target_tph / REFERENCE_FEED_TPH` au chargement. Un projet à
// 250 t/h obtient donc une usine proportionnée à 250 t/h, pas les chiffres de
// l'exemple. Toutes les valeurs vivent dans cette couche config et restent
// éditables ensuite dans l'UI.
//
// Les ratios (p. ex. ligne concentré ≈ 6 % du débit d'alimentation, via un
// rendement massique de 10 % en flottation) sont, eux, des invariants de
// conception : ils survivent à la mise à l'échelle.
// ─────────────────────────────────────────────────────────────────────────────

import { PLANT_OPT_CURRENCY, PLANT_OPT_RUN_DEFAULTS } from './config';
import { makePlantOptId } from './projectModel';
import type {
  Area, Buffer, CommonCause, FailureMode, FeedScenario, PlantModel, Stream,
} from './types';

/** Débit d'alimentation de référence du design d'exemple (t/h). */
export const REFERENCE_FEED_TPH = 1861;

interface ExampleAreaDesign {
  key: string;
  name: string;
  type?: string;
  /** Capacité de conception (t/h, min/mode/max) AU DÉBIT DE RÉFÉRENCE. */
  cap: [number, number, number];
  opexPerTonne: number;
  /** Position canvas (px). */
  x: number;
  y: number;
  hardnessSensitive?: boolean;
  baseRecovery?: number;
  gradeSensitivity?: number;
  /** Rendement massique du flux SORTANT de cette aire (défaut 1). */
  massYield?: number;
  /** MTTR de conception (heures) et forme Weibull du TTF. */
  mttrHours: number;
  ttfShape: number;
  /** Tampon en aval (capacité de conference en tonnes, au débit de référence). */
  bufferTonnes?: number;
}

/**
 * Design de référence : 8 aires. Les capacités de la ligne concentré (rebroyage,
 * lixiviation, détox) sont petites en valeur absolue car elles ne traitent que le
 * concentré (≈ 10 % de la masse) — le moteur les ramène en base équivalente-
 * alimentation via le rendement massique.
 */
const EXAMPLE_AREAS: ExampleAreaDesign[] = [
  { key: 'crush1', name: 'Concassage primaire',   type: 'crushing',  cap: [1582, 1861, 2140], opexPerTonne: 0.9, x: 40,  y: 60,  hardnessSensitive: true,  mttrHours: 8,  ttfShape: 1.3, bufferTonnes: 605 },
  { key: 'crush2', name: 'Concassage secondaire', type: 'crushing',  cap: [1582, 1861, 2140], opexPerTonne: 1.1, x: 240, y: 60,  hardnessSensitive: true,  mttrHours: 8,  ttfShape: 1.3, bufferTonnes: 25590 },
  { key: 'hpgr',   name: 'HPGR',                  type: 'hpgr',      cap: [1483, 1745, 2007], opexPerTonne: 1.3, x: 440, y: 60,  hardnessSensitive: true,  mttrHours: 10, ttfShape: 1.3, bufferTonnes: 1268 },
  { key: 'mill',   name: 'Broyage (Ball Mill)',   type: 'grinding',  cap: [1290, 1517, 1745], opexPerTonne: 5.0, x: 640, y: 60,  hardnessSensitive: true,  mttrHours: 12, ttfShape: 1.2, bufferTonnes: 1517 },
  { key: 'flot',   name: 'Flottation',            type: 'flotation', cap: [1290, 1517, 1745], opexPerTonne: 2.4, x: 840, y: 60,  baseRecovery: 0.91, gradeSensitivity: 0.05, massYield: 0.1, mttrHours: 10, ttfShape: 1.4, bufferTonnes: 234 },
  { key: 'regr',   name: 'Rebroyage',             type: 'regrind',   cap: [54, 106, 169],     opexPerTonne: 3.5, x: 640, y: 220, hardnessSensitive: true,  mttrHours: 10, ttfShape: 1.5, bufferTonnes: 106 },
  { key: 'leach',  name: 'Lixiviation / CIP',     type: 'leaching',  cap: [54, 106, 169],     opexPerTonne: 6.0, x: 440, y: 220, baseRecovery: 0.98, gradeSensitivity: 0.05, mttrHours: 10, ttfShape: 1.5, bufferTonnes: 106 },
  { key: 'detox',  name: 'Détox cyanure',         type: 'leaching',  cap: [54, 106, 169],     opexPerTonne: 1.5, x: 240, y: 220, mttrHours: 8, ttfShape: 1.5 },
];

/** Cause commune de référence : coupure électrique frappant les grosses aires. */
const EXAMPLE_COMMON_CAUSE = {
  name: 'Coupure électrique',
  beta: 0.1,
  intervalHours: 2000,
  durationHours: 3,
  areaKeys: ['crush1', 'crush2', 'hpgr', 'mill', 'flot', 'regr', 'leach', 'detox'],
};

/** MTBF (h) pour une disponibilité cible et un MTTR donné : MTBF = MTTR·A/(1−A). */
function mtbf(avail: number, mttr: number): number {
  const a = Math.min(0.9999, Math.max(0.0001, avail));
  return (mttr * a) / (1 - a);
}
/** Échelle Weibull donnant une moyenne `mean` pour la forme `shape`. */
function weibullScale(mean: number, shape: number): number {
  const g = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  const gamma = (z: number): number => {
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1; let a = g[0];
    for (let i = 1; i < 9; i++) a += g[i] / (z + i);
    const t = z + 7 + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
  };
  return mean / gamma(1 + 1 / shape);
}

export interface ExampleOptions {
  /** Débit d'alimentation cible du projet (t/h) — met le design à l'échelle. */
  targetTph: number;
  /** Disponibilité usine cible (fraction) — calibre les MTBF par aire. */
  availabilityFraction: number;
  /** Horizon (heures). */
  horizonHours?: number;
}

/**
 * Construit l'usine complète d'exemple mise à l'échelle du projet. Chaque capacité
 * et tampon est multiplié par `targetTph / REFERENCE_FEED_TPH`; les MTBF sont
 * calibrés pour approcher la disponibilité usine cible sur la chaîne série.
 */
export function buildExamplePlant(opts: ExampleOptions): PlantModel {
  const scale = (opts.targetTph > 0 ? opts.targetTph : REFERENCE_FEED_TPH) / REFERENCE_FEED_TPH;
  const perAreaAvail = Math.pow(
    Math.min(0.999, Math.max(0.01, opts.availabilityFraction)),
    1 / EXAMPLE_AREAS.length,
  );

  const idByKey = new Map<string, string>();
  const areas: Area[] = [];
  const failureModes: FailureMode[] = [];
  const streams: Stream[] = [];
  const buffers: Buffer[] = [];

  EXAMPLE_AREAS.forEach((d, i) => {
    const id = makePlantOptId(`area-${d.key}`);
    idByKey.set(d.key, id);
    areas.push({
      id,
      name: d.name,
      type: d.type,
      processOrder: i,
      opexPerTonne: d.opexPerTonne,
      capacityDist: {
        kind: 'triangular',
        params: { min: d.cap[0] * scale, mode: d.cap[1] * scale, max: d.cap[2] * scale },
      },
      x: d.x,
      y: d.y,
      hardnessSensitive: d.hardnessSensitive || undefined,
      baseRecovery: d.baseRecovery,
      gradeSensitivity: d.gradeSensitivity,
    });
    failureModes.push({
      id: makePlantOptId(`fm-${d.key}`),
      areaId: id,
      residualCapacity: 0,
      ttfDist: { kind: 'weibull', params: { shape: d.ttfShape, scale: weibullScale(mtbf(perAreaAvail, d.mttrHours), d.ttfShape) } },
      ttrDist: { kind: 'lognormal', params: { mu: Math.log(d.mttrHours) - 0.125, sigma: 0.5 } },
    });
  });

  // Flux séquentiels + tampons.
  EXAMPLE_AREAS.forEach((d, i) => {
    if (i === 0) return;
    const src = EXAMPLE_AREAS[i - 1];
    streams.push({
      id: makePlantOptId('stream'),
      sourceAreaId: idByKey.get(src.key)!,
      targetAreaId: idByKey.get(d.key)!,
      massYield: src.massYield ?? 1,
    });
    if (src.bufferTonnes) {
      buffers.push({
        id: makePlantOptId('buffer'),
        upstreamAreaId: idByKey.get(src.key)!,
        downstreamAreaId: idByKey.get(d.key)!,
        capacityTonnes: src.bufferTonnes * scale,
        initialLevel: (src.bufferTonnes * scale) / 2,
      });
    }
  });

  const commonCauses: CommonCause[] = [{
    id: makePlantOptId('cc'),
    areaIds: EXAMPLE_COMMON_CAUSE.areaKeys.map(k => idByKey.get(k)!).filter(Boolean),
    beta: EXAMPLE_COMMON_CAUSE.beta,
    ttfDist: { kind: 'exponential', params: { rate: 1 / EXAMPLE_COMMON_CAUSE.intervalHours } },
    ttrDist: { kind: 'lognormal', params: { mu: Math.log(EXAMPLE_COMMON_CAUSE.durationHours), sigma: 0.5 } },
  }];

  const feedScenario: FeedScenario = {
    id: makePlantOptId('feed'),
    hardnessDist: { kind: 'lognormal', params: { mu: Math.log(100), sigma: 0.15 } },
    hardnessRef: 100,
    hardnessToCapacity: 0.3,
    gradeDist: { kind: 'normal', params: { mean: 1, sd: 0.1 } },
    gradeRef: 1,
  };

  return {
    id: makePlantOptId('plant-example'),
    horizonHours: opts.horizonHours ?? PLANT_OPT_RUN_DEFAULTS.horizonHours!,
    currency: PLANT_OPT_CURRENCY,
    areas,
    streams,
    buffers,
    failureModes,
    plannedStops: [],
    commonCauses,
    feedScenario,
  };
}
