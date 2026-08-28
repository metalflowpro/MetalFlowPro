// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Amorçage du modèle depuis le PROJET ACTIF
//
// Le module ne part JAMAIS d'une usine « démo » aux valeurs figées : il dérive un
// modèle de départ des paramètres réels du projet (source unique) — débit nominal,
// disponibilité cible, récupération, devise — et d'un GABARIT de chaîne macro
// (config, surchargeable). Tout nombre absolu (t/h, MTBF) trace donc vers
// `project.target_tph` / `project.availability_pct` / `project.recovery_pct`, et
// l'ingénieur ajuste ensuite chaque aire dans l'éditeur.
//
// C'est le point de cohérence avec le reste de MetalFlow Pro : modifier le débit
// ou la disponibilité du projet (modale Paramètres) change le modèle proposé ici.
// ─────────────────────────────────────────────────────────────────────────────

import { HOURS_PER_YEAR } from '../config/constants';
import type { Project } from '../../types';
import { PLANT_OPT_CURRENCY, PLANT_OPT_RUN_DEFAULTS } from './config';
import type { Area, FailureMode, PlantModel, Stream } from './types';

/**
 * Gabarit de la chaîne macro d'une usine aurifère (concassage → broyage → CIL),
 * exprimé en FACTEURS RELATIFS au débit nominal du projet — aucun t/h absolu.
 *
 *  - `capacityMarginVsTarget` : capacité mode de l'aire = débit projet × ce facteur
 *    (une aire à 1,05 est plus « juste » donc candidate goulot ; le concassage,
 *    conventionnellement surdimensionné, est à 1,4).
 *  - `capacitySpread` : demi-étendue de la loi triangulaire (fraction du mode).
 *  - `opexPerTonne` : coût variable de screening par tonne (devise projet) — repli
 *    documenté tant que l'OPEX détaillé (module Économie) n'est pas relié.
 *  - `mttrHours` : temps de réparation moyen d'un arrêt (heures) ; le MTBF est
 *    ensuite CALCULÉ pour atteindre la disponibilité cible du projet.
 *  - `ttfShape` : forme Weibull du temps de bon fonctionnement (>1 = usure).
 */
export const PLANT_OPT_TEMPLATE = {
  areas: [
    { key: 'crushing',  name: 'Concassage', type: 'crushing',  capacityMarginVsTarget: 1.40, capacitySpread: 0.06, opexPerTonne: 1.2, mttrHours: 8,  ttfShape: 1.3, hardnessSensitive: false, carriesRecovery: false },
    { key: 'grinding',  name: 'Broyage',    type: 'grinding',  capacityMarginVsTarget: 1.05, capacitySpread: 0.08, opexPerTonne: 4.5, mttrHours: 12, ttfShape: 1.2, hardnessSensitive: true,  carriesRecovery: false },
    { key: 'leaching',  name: 'Lixiviation / CIL', type: 'leaching', capacityMarginVsTarget: 1.15, capacitySpread: 0.05, opexPerTonne: 3.5, mttrHours: 10, ttfShape: 1.5, hardnessSensitive: false, carriesRecovery: true },
  ],
  /** Sensibilité capacité↔dureté appliquée aux aires marquées « hardnessSensitive ». */
  hardnessToCapacity: 0.3,
  /** Coefficient de variation de la dureté d'alimentation (loi lognormale). */
  hardnessCv: 0.15,
  /** Disposition initiale des aires sur le canvas. */
  canvasStartX: 60,
  canvasStepX: 200,
  canvasY: 120,
} as const;

let idCounter = 0;
/** Identifiant court, stable au sein d'une session (préfixe lisible + compteur). */
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${idCounter}`;
}

/**
 * MTBF (heures) requis pour qu'une aire de MTTR donné atteigne la disponibilité
 * `avail` : A = MTBF / (MTBF + MTTR) ⟹ MTBF = MTTR × A / (1 − A).
 */
function mtbfForAvailability(avail: number, mttr: number): number {
  const a = Math.min(0.9999, Math.max(0.0001, avail));
  return (mttr * a) / (1 - a);
}

/** Échelle Weibull donnant une moyenne `mean` pour une forme `shape` : λ = mean / Γ(1+1/k). */
function weibullScaleForMean(mean: number, shape: number): number {
  // Γ(1+1/k) ≈ import évité ici pour rester léger : approché via la relation exacte
  // dans distributions.gammaFn au moment du build ; on stocke shape+scale bruts.
  // On calcule scale = mean / Γ(1+1/shape).
  const z = 1 + 1 / shape;
  // Approximation de Lanczos (identique à distributions.gammaFn, dupliquée localement
  // pour éviter un cycle d'import ; testée par parité dans engine.test).
  const g = [
    0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  const gamma = (zz: number): number => {
    if (zz < 0.5) return Math.PI / (Math.sin(Math.PI * zz) * gamma(1 - zz));
    zz -= 1;
    let a = g[0];
    for (let i = 1; i < 9; i++) a += g[i] / (zz + i);
    const t = zz + 7 + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, zz + 0.5) * Math.exp(-t) * a;
  };
  return mean / gamma(z);
}

export interface BuildOptions {
  /** Horizon (heures) — typiquement les heures/an résolues du projet. */
  horizonHours?: number;
}

/**
 * Construit un `PlantModel` de départ pour un projet. Les capacités sont centrées
 * sur `project.target_tph`, chaque aire est calibrée pour que la disponibilité de
 * l'usine série atteigne `project.availability_pct`, et la récupération du projet
 * est portée par l'aire de lixiviation.
 */
export function buildModelFromProject(project: Project, opts: BuildOptions = {}): PlantModel {
  const target = project.target_tph > 0 ? project.target_tph : 1;
  const plantAvail = (project.availability_pct > 0 ? project.availability_pct : 100) / 100;
  const recoveryFraction = (project.recovery_pct > 0 ? project.recovery_pct : 100) / 100;
  const tpl = PLANT_OPT_TEMPLATE;
  const k = tpl.areas.length;
  // Disponibilité par aire pour qu'un montage série de k aires atteigne la cible.
  const perAreaAvail = Math.pow(plantAvail, 1 / k);

  const areas: Area[] = [];
  const failureModes: FailureMode[] = [];
  const streams: Stream[] = [];

  tpl.areas.forEach((a, i) => {
    const areaId = makeId(`area-${a.key}`);
    const mode = target * a.capacityMarginVsTarget;
    const spread = mode * a.capacitySpread;
    areas.push({
      id: areaId,
      name: a.name,
      type: a.type,
      processOrder: i,
      opexPerTonne: a.opexPerTonne,
      capacityDist: {
        kind: 'triangular',
        params: { min: mode - spread, mode, max: mode + spread },
      },
      x: tpl.canvasStartX + i * tpl.canvasStepX,
      y: tpl.canvasY,
      hardnessSensitive: a.hardnessSensitive || undefined,
      baseRecovery: a.carriesRecovery ? recoveryFraction : undefined,
    });

    const mtbf = mtbfForAvailability(perAreaAvail, a.mttrHours);
    failureModes.push({
      id: makeId(`fm-${a.key}`),
      areaId,
      residualCapacity: 0,
      ttfDist: { kind: 'weibull', params: { shape: a.ttfShape, scale: weibullScaleForMean(mtbf, a.ttfShape) } },
      // TTR lognormale de moyenne ≈ MTTR : μ = ln(MTTR) − σ²/2, σ config modérée.
      ttrDist: { kind: 'lognormal', params: { mu: Math.log(a.mttrHours) - 0.5 * 0.5 * 0.5, sigma: 0.5 } },
    });

    if (i > 0) {
      streams.push({
        id: makeId('stream'),
        sourceAreaId: areas[i - 1].id,
        targetAreaId: areaId,
        massYield: 1,
      });
    }
  });

  return {
    id: makeId('plant'),
    horizonHours: opts.horizonHours ?? PLANT_OPT_RUN_DEFAULTS.horizonHours ?? HOURS_PER_YEAR,
    currency: PLANT_OPT_CURRENCY,
    areas,
    streams,
    buffers: [],
    failureModes,
    plannedStops: [],
    commonCauses: [],
    feedScenario: {
      id: makeId('feed'),
      // Dureté lognormale centrée sur une référence 100 (échelle relative).
      hardnessDist: { kind: 'lognormal', params: { mu: Math.log(100), sigma: tpl.hardnessCv } },
      hardnessRef: 100,
      hardnessToCapacity: tpl.hardnessToCapacity,
    },
  };
}

/** Nouvelle aire créée à la main (loi de capacité triangulaire de repli config). */
export function makeNewArea(model: PlantModel): { area: Area; stream?: Stream } {
  const orders = model.areas.map(a => a.processOrder);
  const nextOrder = orders.length ? Math.max(...orders) + 1 : 0;
  const sorted = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);
  const last = sorted.length ? sorted[sorted.length - 1] : undefined;
  const id = makeId('area');
  const x = Math.min((last?.x ?? PLANT_OPT_TEMPLATE.canvasStartX + (nextOrder - 1) * PLANT_OPT_TEMPLATE.canvasStepX) + PLANT_OPT_TEMPLATE.canvasStepX, 860);
  const area: Area = {
    id,
    name: `Aire ${model.areas.length + 1}`,
    processOrder: nextOrder,
    opexPerTonne: 1,
    capacityDist: { kind: 'triangular', params: { min: 900, mode: 1000, max: 1100 } },
    x,
    y: last?.y ?? PLANT_OPT_TEMPLATE.canvasY,
  };
  const stream = last ? { id: makeId('stream'), sourceAreaId: last.id, targetAreaId: id, massYield: 1 } : undefined;
  return { area, stream };
}

export { makeId as makePlantOptId };
