// ─────────────────────────────────────────────────────────────────────────────
// Optimisation P80 USINE — module d'étude P80 (spec §6).
//
// C'est le seul vrai manque de calcul du module : un modèle DÉBIT-vs-P80. Un
// broyage plus fin peut améliorer la récupération tout en réduisant tellement le
// débit que la production d'or par jour BAISSE — d'où la nécessité de maximiser
// la valeur nette journalière, pas la récupération seule.
//
//   V(P80) = Q(P80)·G·R(P80)·P_Au − Q(P80)·C_traitement
//
// Débit borné par la PUISSANCE du broyeur : Q = P_mill / E_spec(P80). Comme
// l'énergie spécifique E croît quand P80 diminue (Bond × Rowland EF5), Q chute.
//
// Réutilise `plantGrindEnergy` et `recoveryModel` de geomet/p80 — un même P80 est
// valorisé de façon cohérente ici et dans le moteur économique existant.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS } from '../config/constants';
import { plantGrindEnergy, recoveryModel } from '../geomet/p80';

/**
 * Paramètres de forme du modèle usine. Site-spécifiques (dimensionnement du
 * circuit, disponibilité opérationnelle) — documentés ici, éditables, jamais en
 * dur dans la page. Ce ne sont PAS des constantes physiques.
 */
export const PLANT_THROUGHPUT_MODEL = {
  /** Heures d'exploitation effectives par jour (24 h × disponibilité typique). */
  operatingHoursPerDay: 24,
  /** Plafond de débit imposé par le reste du circuit (classification, pompes…),
   *  au-delà duquel la puissance broyeur n'est plus le facteur limitant. */
  maxThroughputTph: Infinity,
} as const;

export interface PlantP80Inputs {
  /** BWi opérationnel (kWh/t). */
  bwi: number;
  /** F80 de l'alimentation broyage usine (µm). */
  f80Um: number;
  /** Puissance installée disponible au broyage (kW) — le budget d'énergie/temps. */
  millPowerKw: number;
  /** Teneur d'alimentation G (g/t). */
  gradeGt: number;
  /** Valeur nette de l'or (USD/oz). */
  goldPriceUsdOz: number;
  /** Coût de traitement C (USD/t) — hors énergie de broyage déjà implicite. */
  treatmentCostUsdT: number;
  /** Plafond de récupération atteignable (%) — récupération globale du projet. */
  recoveryCeilingPct: number;
  /** Or libre (%) pour le modèle de libération ; null → défaut du modèle. */
  auFreePct?: number | null;
  /** Facteur usine/labo (Wio/Wi) ; défaut documenté si absent. */
  plantFactor?: number;
  /** Heures d'exploitation par jour ; défaut PLANT_THROUGHPUT_MODEL. */
  operatingHoursPerDay?: number;
  /** Plafond de débit (tph) ; défaut PLANT_THROUGHPUT_MODEL. */
  maxThroughputTph?: number;
}

export interface PlantP80Point {
  p80Um: number;
  energyKwhT: number;
  /** Débit soutenable à ce P80 (tph), limité par la puissance broyeur. */
  throughputTph: number;
  tonnesPerDay: number;
  recoveryPct: number;
  ozPerDay: number;
  revenueUsdDay: number;
  costUsdDay: number;
  /** Valeur nette journalière V(P80) (USD/jour). */
  netValueUsdDay: number;
}

/** Débit soutenable (tph) à un P80 donné, sous contrainte de puissance broyeur. */
export function throughputAtP80(p80Um: number, inp: PlantP80Inputs): number {
  const energy = plantGrindEnergy(inp.bwi, inp.f80Um, p80Um, inp.plantFactor); // kWh/t
  if (!(energy > 0) || !(inp.millPowerKw > 0)) return 0;
  const cap = inp.maxThroughputTph ?? PLANT_THROUGHPUT_MODEL.maxThroughputTph;
  return Math.min(cap, inp.millPowerKw / energy); // kW / (kWh/t) = t/h
}

/** Valorise un P80 usine : débit, récupération, oz/jour et valeur nette/jour. */
export function evaluatePlantP80(p80Um: number, inp: PlantP80Inputs): PlantP80Point {
  const hoursPerDay = inp.operatingHoursPerDay ?? PLANT_THROUGHPUT_MODEL.operatingHoursPerDay;
  const energyKwhT = plantGrindEnergy(inp.bwi, inp.f80Um, p80Um, inp.plantFactor);
  const throughputTph = throughputAtP80(p80Um, inp);
  const tonnesPerDay = throughputTph * hoursPerDay;
  const recoveryPct = recoveryModel(p80Um, inp.auFreePct ?? null, inp.recoveryCeilingPct);

  // oz/jour = tonnes/jour × teneur(g/t) / (g/oz) × récupération.
  const ozPerDay = (tonnesPerDay * inp.gradeGt / TROY_OZ_GRAMS) * (recoveryPct / 100);
  const revenueUsdDay = ozPerDay * inp.goldPriceUsdOz;
  const costUsdDay = tonnesPerDay * inp.treatmentCostUsdT;

  return {
    p80Um, energyKwhT, throughputTph, tonnesPerDay, recoveryPct,
    ozPerDay, revenueUsdDay, costUsdDay,
    netValueUsdDay: revenueUsdDay - costUsdDay,
  };
}

export type PlantObjective = 'net_value_per_day' | 'oz_per_day';

export interface PlantP80Result {
  points: PlantP80Point[];
  /** P80 optimal selon l'objectif choisi. */
  optimal: PlantP80Point | null;
  objective: PlantObjective;
}

/**
 * Balaye une échelle de P80 et sélectionne l'optimum usine selon l'objectif :
 * valeur nette maximale par jour (défaut) ou onces d'or récupérées par jour.
 * L'échelle est fournie par l'appelant (généralement les P80 cibles de l'étude).
 */
export function optimisePlantP80(
  ladderUm: number[],
  inp: PlantP80Inputs,
  objective: PlantObjective = 'net_value_per_day',
): PlantP80Result {
  const key = objective === 'oz_per_day' ? 'ozPerDay' : 'netValueUsdDay';
  const points = ladderUm
    .filter(p => p > 0)
    .sort((a, b) => b - a)
    .map(p => evaluatePlantP80(p, inp));
  const optimal = points.length
    ? points.reduce((best, pt) => (pt[key] > best[key] ? pt : best), points[0])
    : null;
  return { points, optimal, objective };
}
