// ─────────────────────────────────────────────────────────────────────────────
// Choix du circuit d'ADSORPTION : CIL ou CIP.
//
// ⚠️ Distinction essentielle, longtemps confondue dans l'application :
//
//   • Un essai de laboratoire est une LIXIVIATION (bouteille agitée) : il mesure
//     combien d'or se DISSOUT, et en combien de temps. Ce n'est ni un essai CIL
//     ni un essai CIP.
//   • CIL et CIP sont deux façons de RÉCUPÉRER l'or dissous sur charbon actif :
//       – CIL (Carbon-in-Leach) : le charbon est présent PENDANT la lixiviation ;
//       – CIP (Carbon-in-Pulp)  : le charbon vient APRÈS la lixiviation.
//
// La récupération d'un circuit se décompose donc en trois facteurs distincts :
//     R = R_lixiviation(48 h) × transfert_usine × efficacité_adsorption
//
// et le choix CIL/CIP se fait sur des critères d'exploitation (carbone organique,
// consommation de cyanure, teneur de tête, sulfures) — pas sur l'essai lui-même.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export type AdsorptionCircuitId = 'CIL' | 'CIP';

/**
 * Caractéristiques des deux circuits d'adsorption.
 *
 * ⚠️ `pregRobbingMitigation` est le VRAI différenciateur métallurgique entre les
 * deux : sur un minerai carboné, le carbone natif du minerai capte l'or dissous
 * (preg-robbing). En CIL, le charbon actif ajouté est présent pendant la
 * lixiviation et CONCURRENCE ce carbone natif — il en récupère une bonne part.
 * En CIP, l'or reste en solution toute la durée de la lixiviation, exposé au
 * carbone natif sans compétiteur : la perte est subie en totalité.
 * (Marsden & House, « The Chemistry of Gold Extraction » ; Adams, « Gold Ore
 * Processing » — le CIL est la réponse conventionnelle au preg-robbing.)
 *
 * Valeurs à recaler sur les essais du projet (essais CIL/CIP comparatifs,
 * essais de preg-robbing avec et sans charbon).
 */
export const ADSORPTION_CIRCUITS: Record<AdsorptionCircuitId, {
  id: AdsorptionCircuitId;
  label: string;
  name: string;
  /** Part de l'or DISSOUS effectivement captée par le circuit à charbon. */
  adsorptionEfficiency: number;
  /** Part de la perte par preg-robbing que le circuit évite (0 = subie en entier). */
  pregRobbingMitigation: number;
  capex: 'low' | 'medium' | 'high';
  opex: 'low' | 'medium' | 'high';
}> = {
  CIL: {
    id: 'CIL', label: 'CIL', name: 'Carbon-in-Leach',
    adsorptionEfficiency: 0.99,
    pregRobbingMitigation: 0.7,
    capex: 'medium', opex: 'medium',
  },
  CIP: {
    id: 'CIP', label: 'CIP', name: 'Carbon-in-Pulp',
    adsorptionEfficiency: 0.99,
    pregRobbingMitigation: 0,
    capex: 'medium', opex: 'medium',
  },
};

/**
 * Seuils de décision CIL vs CIP.
 *
 * ⚠️ Barème d'exploitation propre au site — à revoir par le métallurgiste.
 */
export const ADSORPTION_DECISION_THRESHOLDS = {
  /** Carbone organique (%) au-delà duquel le preg-robbing devient déterminant. */
  organicCarbonPct: 0.2,
  /** Consommation de cyanure (kg/t) au-delà de laquelle les pertes en solution pèsent. */
  nacnKgT: 2.5,
  /** Teneur de tête (g/t) au-delà de laquelle l'inventaire d'or en circuit compte. */
  auFeedGt: 5,
  /** Sulfures (%) au-delà desquels l'encrassement du charbon devient un sujet. */
  sulphidePct: 1.5,
} as const;

/** Version modifiable (nombres) des seuils — base des surcharges par projet. */
export type AdsorptionDecisionThresholds = { -readonly [K in keyof typeof ADSORPTION_DECISION_THRESHOLDS]: number };

/** Entrées du choix — toutes issues d'essais déjà présents dans l'application. */
export interface AdsorptionDecisionInputs {
  organicCarbonPct: number | null;
  nacnKgT: number | null;
  auFeedGt: number | null;
  sulphidePct: number | null;
}

export interface AdsorptionDecision {
  recommendation: AdsorptionCircuitId;
  reasons: string[];
  warnings: string[];
  scores: { CIL: number; CIP: number };
}

/**
 * Recommande CIL ou CIP à partir des facteurs d'exploitation disponibles.
 *
 * Le preg-robbing tranche en faveur du CIL : c'est le seul des deux circuits qui
 * oppose un charbon actif au carbone natif du minerai pendant la lixiviation.
 * Les autres critères (cyanure, teneur, sulfures) pèsent en faveur du CIP, où le
 * charbon est isolé de la lixiviation et donc plus simple à gérer.
 */
export function recommendAdsorptionCircuit(
  inp: AdsorptionDecisionInputs,
  thresholds: AdsorptionDecisionThresholds = ADSORPTION_DECISION_THRESHOLDS,
): AdsorptionDecision {
  const T = thresholds;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let cil = 0, cip = 0;

  if (inp.organicCarbonPct !== null && inp.organicCarbonPct > T.organicCarbonPct) {
    cil += 3;
    warnings.push(
      `Corg ${inp.organicCarbonPct.toFixed(2)} % > ${T.organicCarbonPct} % — minerai préempteur (preg-robbing). ` +
      `Le CIL met le charbon actif en compétition avec le carbone natif pendant la lixiviation ; le CIP laisse l'or en solution sans compétiteur.`,
    );
  } else {
    cip += 1;
    reasons.push('Corg faible — pas de preg-robbing ; le CIP reste envisageable, charbon isolé de la lixiviation.');
  }

  if (inp.nacnKgT !== null && inp.nacnKgT > T.nacnKgT) {
    cip += 2;
    reasons.push(`NaCN ${inp.nacnKgT.toFixed(1)} kg/t (élevé) — le CIP limite l'attrition du charbon et les pertes de cyanure.`);
  } else {
    cil += 1;
  }

  if (inp.auFeedGt !== null && inp.auFeedGt > T.auFeedGt) {
    cip += 1;
    reasons.push(`Teneur de tête ${inp.auFeedGt.toFixed(1)} g/t (élevée) — le CIP réduit l'inventaire d'or immobilisé en cuve.`);
  } else {
    cil += 2;
    reasons.push('Teneur de tête modérée — CIL suffisant, une cuverie de moins à construire.');
  }

  if (inp.sulphidePct !== null && inp.sulphidePct > T.sulphidePct) {
    cip += 1;
    warnings.push(`S sulfure ${inp.sulphidePct.toFixed(2)} % — risque d'encrassement du charbon ; le CIP facilite sa régénération.`);
  }

  const recommendation: AdsorptionCircuitId = cil >= cip ? 'CIL' : 'CIP';
  reasons.push(
    recommendation === 'CIL'
      ? 'Circuit CIL retenu — adsorption pendant la lixiviation, montage le plus simple.'
      : 'Circuit CIP retenu — adsorption séparée, meilleure maîtrise du charbon actif.',
  );

  return { recommendation, reasons, warnings, scores: { CIL: cil, CIP: cip } };
}
