// ─────────────────────────────────────────────────────────────────────────────
// Modèle consommateur de cyanure — module PUR.
//
// La consommation de NaCN pèse souvent ~30 % de l'OPEX d'une usine d'or. Elle est
// dominée par les CYANICIDES — surtout le cuivre soluble, qui complexe le cyanure
// (Cu(CN)₃²⁻/Cu(CN)₄³⁻). Ce module estime la consommation de NaCN par
// stœchiométrie à partir de la chimie du minerai (Cu, ± sulfures réactifs), la
// RÉCONCILIE avec la consommation mesurée, et signale les charges cyanicides.
//
// Aucune dépendance Supabase/React. Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface CyanideInputs {
  /** Cuivre total (%). */
  cuPct?: number | null;
  /** Fraction de Cu soluble au cyanure (0–1). Défaut selon domaine. */
  cuSolubleFraction?: number | null;
  /** Soufre sulfure (%) — consommation secondaire (oxydation). */
  sSulfidePct?: number | null;
  /** Consommation de NaCN mesurée (kg/t) pour réconciliation. */
  measuredNaCnKgT?: number | null;
}

/** Paramètres stœchiométriques ajustables. */
export const CYANIDE_MODEL = {
  /** kg NaCN par kg Cu soluble (~3.5 CN⁻ par Cu, MW 49/63.5). */
  KG_NACN_PER_KG_CU: 2.70,
  /** Consommation de base de la lixiviation (kg/t). */
  BASE_KG_T: 0.35,
  /** Contribution des sulfures réactifs (kg NaCN par % S sulfure). */
  KG_NACN_PER_PCT_S: 0.15,
  /** Fraction soluble de Cu par défaut (sulfure ; oxyde plus élevé). */
  DEFAULT_CU_SOLUBLE_FRACTION: 0.30,
} as const;

/** Version modifiable (nombres) du modèle — base des surcharges par projet. */
export type CyanideModel = { -readonly [K in keyof typeof CYANIDE_MODEL]: number };

export interface CyanideEstimate {
  /** NaCN prédit (kg/t). */
  predictedKgT: number;
  /** Décomposition (kg/t). */
  breakdown: { base: number; copper: number; sulphide: number };
  /** Part du cuivre dans la consommation prédite (0–1). */
  copperShare: number;
  measuredKgT: number | null;
  /** Résidu = mesuré − prédit (kg/t), si mesuré fourni. */
  residualKgT: number | null;
  /** Charge cyanicide : 'faible' | 'moderee' | 'elevee'. */
  cyanicideLoad: 'faible' | 'moderee' | 'elevee';
  message: string;
}

/**
 * Estime la consommation de NaCN. `%` → kg/t : 1 % = 10 kg/t.
 * Cu soluble = Cu total × fraction soluble (dépend de l'oxydation du minerai).
 */
export function estimateCyanide(inp: CyanideInputs, model: CyanideModel = CYANIDE_MODEL): CyanideEstimate {
  const m = model;
  const cuPct = inp.cuPct != null && inp.cuPct > 0 ? inp.cuPct : 0;
  const fSol = inp.cuSolubleFraction != null && inp.cuSolubleFraction >= 0
    ? Math.min(1, inp.cuSolubleFraction) : m.DEFAULT_CU_SOLUBLE_FRACTION;
  const sPct = inp.sSulfidePct != null && inp.sSulfidePct > 0 ? inp.sSulfidePct : 0;

  const cuSolubleKgT = cuPct * 10 * fSol;
  const copper = cuSolubleKgT * m.KG_NACN_PER_KG_CU;
  const sulphide = sPct * m.KG_NACN_PER_PCT_S;
  const base = m.BASE_KG_T;
  const predicted = base + copper + sulphide;
  const copperShare = predicted > 0 ? copper / predicted : 0;

  const measured = inp.measuredNaCnKgT != null && inp.measuredNaCnKgT > 0 ? inp.measuredNaCnKgT : null;
  const residual = measured != null ? measured - predicted : null;

  const load: CyanideEstimate['cyanicideLoad'] =
    predicted >= 2.0 ? 'elevee' : predicted >= 0.9 ? 'moderee' : 'faible';

  let message =
    `NaCN prédit ${predicted.toFixed(2)} kg/t (base ${base.toFixed(2)} + Cu ${copper.toFixed(2)} + sulfures ${sulphide.toFixed(2)}). ` +
    (copperShare > 0.5
      ? `Consommation dominée par le cuivre soluble (${(copperShare * 100).toFixed(0)} %) — envisager SART/récupération du cyanure ou pré-lixiviation acide.`
      : `Charge cyanicide ${load}.`);
  if (residual != null) {
    if (Math.abs(residual) <= 0.4) message += ` Cohérent avec le mesuré (${measured!.toFixed(2)} kg/t).`;
    else if (residual > 0) message += ` Mesuré ${measured!.toFixed(2)} kg/t > prédit : cyanicides supplémentaires non captés (As, Fe réactif, oxydation).`;
    else message += ` Mesuré ${measured!.toFixed(2)} kg/t < prédit : Cu moins soluble qu'estimé — réduire la fraction soluble.`;
  }

  return {
    predictedKgT: +predicted.toFixed(3),
    breakdown: { base: +base.toFixed(3), copper: +copper.toFixed(3), sulphide: +sulphide.toFixed(3) },
    copperShare: +copperShare.toFixed(3),
    measuredKgT: measured != null ? +measured.toFixed(3) : null,
    residualKgT: residual != null ? +residual.toFixed(3) : null,
    cyanicideLoad: load,
    message,
  };
}
