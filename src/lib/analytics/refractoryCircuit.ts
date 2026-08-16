// ─────────────────────────────────────────────────────────────────────────────
// Choix du circuit de PRÉTRAITEMENT OXYDANT d'un minerai réfractaire.
//
// ⚠️ POX, BIOX, grillage et Albion ne sont PAS interchangeables. L'application
// les traitait comme un seul procédé derrière une unique « libération par
// oxydation » — or c'est l'arbitrage le plus structurant en CAPEX d'un projet
// réfractaire, et les critères qui les départagent sont opposés :
//
//   • POX (oxydation sous pression, autoclave)
//       Le plus efficace, le plus cher. A besoin d'assez de SOUFRE pour être
//       autotherme ; ruiné par les CARBONATES qui consomment l'acide.
//       Ne détruit PAS le carbone organique.
//   • BIOX (bio-oxydation bactérienne)
//       CAPEX modéré, cinétique lente (grandes cuves). Excellente tolérance à
//       l'ARSENIC, qu'il fixe en scorodite stable. Bornée en température et en
//       teneur en sulfures. Ne détruit PAS le carbone organique.
//   • GRILLAGE (roasting)
//       LE SEUL à détruire le CARBONE ORGANIQUE préempteur — argument décisif
//       sur minerai carboné, où POX et BIOX laisseraient le preg-robbing intact.
//       Contrepartie : gestion des rejets gazeux (As₂O₃, SO₂).
//   • ALBION (broyage ultrafin + oxydation atmosphérique)
//       CAPEX le plus bas, libération partielle. Pertinent à petit tonnage ou
//       sur réfractarité modérée.
//
// La récupération d'une route réfractaire se décompose donc :
//     R = R_flottation × libération_du_circuit × R_cyanuration(concentré oxydé)
// et le choix du circuit se fait sur la CHIMIE du minerai, pas sur un défaut.
//
// ⚠️ Barème et rendements PROPRES AU MINERAI — à recaler sur les essais du
// projet. Tout est surchargeable via `project_met_constants` : l'application
// sert plusieurs projets, chacun avec ses données.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export type RefractoryCircuitId = 'POX' | 'BIOX' | 'ROASTING' | 'ALBION';

/**
 * Caractéristiques de chaque circuit oxydant.
 *
 * `destroysOrganicCarbon` est LE différenciateur qualitatif : sur un minerai
 * préempteur, un circuit qui ne détruit pas le carbone natif laisse l'or dissous
 * se faire recapter, quelle que soit la qualité de son oxydation des sulfures.
 */
export const REFRACTORY_CIRCUITS: Record<RefractoryCircuitId, {
  id: RefractoryCircuitId;
  label: string;
  name: string;
  /** Part de l'or verrouillé dans les sulfures effectivement libérée. */
  sulphideLiberation: number;
  /** Gain de lixiviabilité du concentré oxydé (pts). */
  postOxidationLeachBonusPts: number;
  /** Le procédé détruit-il le carbone organique préempteur ? */
  destroysOrganicCarbon: boolean;
  capex: 'low' | 'medium' | 'high';
  opex: 'low' | 'medium' | 'high';
}> = {
  POX: {
    id: 'POX', label: 'POX', name: 'Oxydation sous pression (autoclave)',
    sulphideLiberation: 0.98, postOxidationLeachBonusPts: 10,
    destroysOrganicCarbon: false, capex: 'high', opex: 'high',
  },
  BIOX: {
    id: 'BIOX', label: 'BIOX', name: 'Bio-oxydation bactérienne',
    sulphideLiberation: 0.95, postOxidationLeachBonusPts: 8,
    destroysOrganicCarbon: false, capex: 'medium', opex: 'medium',
  },
  ROASTING: {
    id: 'ROASTING', label: 'Grillage', name: 'Grillage (roasting)',
    sulphideLiberation: 0.94, postOxidationLeachBonusPts: 8,
    destroysOrganicCarbon: true, capex: 'high', opex: 'medium',
  },
  ALBION: {
    id: 'ALBION', label: 'Albion', name: 'Procédé Albion (broyage ultrafin + oxydation atmosphérique)',
    sulphideLiberation: 0.90, postOxidationLeachBonusPts: 6,
    destroysOrganicCarbon: false, capex: 'medium', opex: 'medium',
  },
};

/** Version modifiable des rendements de circuit — base des surcharges de projet. */
export type RefractoryCircuitEfficiencies = {
  poxLiberation: number;
  bioxLiberation: number;
  roastingLiberation: number;
  albionLiberation: number;
};

export const REFRACTORY_CIRCUIT_EFFICIENCIES: RefractoryCircuitEfficiencies = {
  poxLiberation: REFRACTORY_CIRCUITS.POX.sulphideLiberation,
  bioxLiberation: REFRACTORY_CIRCUITS.BIOX.sulphideLiberation,
  roastingLiberation: REFRACTORY_CIRCUITS.ROASTING.sulphideLiberation,
  albionLiberation: REFRACTORY_CIRCUITS.ALBION.sulphideLiberation,
};

/** Libération effective d'un circuit, surcharges de projet appliquées. */
export function circuitLiberation(
  id: RefractoryCircuitId,
  eff: RefractoryCircuitEfficiencies = REFRACTORY_CIRCUIT_EFFICIENCIES,
): number {
  switch (id) {
    case 'POX': return eff.poxLiberation;
    case 'BIOX': return eff.bioxLiberation;
    case 'ROASTING': return eff.roastingLiberation;
    case 'ALBION': return eff.albionLiberation;
  }
}

/**
 * Seuils de décision entre circuits oxydants.
 *
 * ⚠️ Barème d'exploitation propre au minerai — à revoir par le métallurgiste.
 */
export const REFRACTORY_DECISION_THRESHOLDS = {
  /** Sulfures (%) au-delà desquels une route oxydante se justifie. */
  refractoryPct: 2,
  /** Soufre (%) minimal pour qu'un autoclave fonctionne en AUTOTHERME. */
  poxAutothermalSulphidePct: 2.5,
  /** Sulfures (%) au-delà desquels le BIOX peine (chaleur, cinétique). */
  bioxMaxSulphidePct: 8,
  /** Carbone organique (%) au-delà duquel le preg-robbing impose le grillage. */
  organicCarbonPct: 0.5,
  /** Arsenic (%) au-delà duquel la fixation en scorodite (BIOX) prime. */
  arsenicPct: 0.5,
  /** Carbonate (%) au-delà duquel la consommation d'acide ruine le POX. */
  carbonatePct: 3,
  /** Débit (t/h) en deçà duquel un procédé à CAPEX modéré est préféré. */
  smallScaleTph: 300,
} as const;

export type RefractoryDecisionThresholds = { -readonly [K in keyof typeof REFRACTORY_DECISION_THRESHOLDS]: number };

/** Entrées du choix — toutes issues d'essais déjà présents dans l'application. */
export interface RefractoryDecisionInputs {
  sulphidePct: number | null;
  organicCarbonPct: number | null;
  /** Arsenic (%) — null si non analysé : le critère est alors ignoré. */
  arsenicPct: number | null;
  /** Carbonate (%) — null si non analysé. */
  carbonatePct: number | null;
  /** Débit usine (t/h) — pèse sur l'arbitrage d'échelle. */
  throughputTph: number | null;
}

export interface RefractoryDecision {
  recommendation: RefractoryCircuitId;
  reasons: string[];
  warnings: string[];
  scores: Record<RefractoryCircuitId, number>;
}

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

/**
 * Recommande le circuit oxydant à partir de la chimie du minerai.
 *
 * Le CARBONE ORGANIQUE tranche en faveur du GRILLAGE : c'est le seul procédé qui
 * le détruit. Sans lui, l'or dissous serait recapté par le carbone natif quelle
 * que soit la qualité de l'oxydation des sulfures — POX et BIOX oxydent les
 * sulfures, pas le carbone.
 */
export function recommendRefractoryCircuit(
  inp: RefractoryDecisionInputs,
  thresholds: RefractoryDecisionThresholds = { ...REFRACTORY_DECISION_THRESHOLDS },
): RefractoryDecision {
  const T = thresholds;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const scores: Record<RefractoryCircuitId, number> = { POX: 0, BIOX: 0, ROASTING: 0, ALBION: 0 };

  // ── Carbone organique : le critère qui domine tous les autres ─────────────
  if (inp.organicCarbonPct !== null && inp.organicCarbonPct > T.organicCarbonPct) {
    scores.ROASTING += 5;
    warnings.push(
      `Corg ${f2(inp.organicCarbonPct)} % > ${T.organicCarbonPct} % — minerai préempteur. ` +
      `Seul le GRILLAGE détruit le carbone organique ; POX et BIOX oxydent les sulfures mais ` +
      `laisseraient le preg-robbing intact.`,
    );
  } else {
    scores.POX += 1;
    scores.BIOX += 1;
  }

  // ── Soufre : combustible de l'autoclave, mais limite du biologique ────────
  if (inp.sulphidePct !== null) {
    if (inp.sulphidePct >= T.poxAutothermalSulphidePct) {
      scores.POX += 3;
      reasons.push(`S ${f1(inp.sulphidePct)} % ≥ ${T.poxAutothermalSulphidePct} % — assez de soufre pour un autoclave AUTOTHERME (pas d'appoint de chaleur).`);
    } else {
      scores.POX -= 2;
      scores.ALBION += 2;
      reasons.push(`S ${f1(inp.sulphidePct)} % insuffisant pour un POX autotherme — l'appoint thermique dégrade son économie.`);
    }
    if (inp.sulphidePct > T.bioxMaxSulphidePct) {
      scores.BIOX -= 3;
      warnings.push(`S ${f1(inp.sulphidePct)} % > ${T.bioxMaxSulphidePct} % — dissipation thermique et cinétique difficiles en BIOX.`);
    } else {
      scores.BIOX += 1;
    }
  }

  // ── Arsenic : les voies humides le FIXENT, le grillage le VOLATILISE ──────
  // POX et BIOX précipitent tous deux l'arsenic en scorodite stockable — le POX
  // en produit même la forme la plus stable, à haute température. Le vrai
  // discriminant n'est donc pas « BIOX contre POX » mais « voie humide contre
  // grillage », qui envoie l'arsenic en As₂O₃ dans les gaz.
  if (inp.arsenicPct !== null && inp.arsenicPct > T.arsenicPct) {
    scores.POX += 1;
    scores.BIOX += 1;
    scores.ROASTING -= 4;
    warnings.push(
      `As ${f2(inp.arsenicPct)} % > ${T.arsenicPct} % — les voies humides (POX, BIOX) fixent l'arsenic ` +
      `en scorodite stockable ; le grillage le volatilise en As₂O₃ et impose un traitement des gaz.`,
    );
  }

  // ── Carbonate : consommateur d'acide, rédhibitoire pour le POX ────────────
  if (inp.carbonatePct !== null && inp.carbonatePct > T.carbonatePct) {
    scores.POX -= 4;
    scores.ROASTING += 1;
    warnings.push(`Carbonate ${f1(inp.carbonatePct)} % > ${T.carbonatePct} % — consommation d'acide qui ruine l'économie d'un autoclave.`);
  }

  // ── Échelle : un autoclave ne se justifie qu'à gros tonnage ───────────────
  if (inp.throughputTph !== null && inp.throughputTph < T.smallScaleTph) {
    scores.ALBION += 2;
    scores.BIOX += 1;
    scores.POX -= 2;
    reasons.push(`Débit ${f1(inp.throughputTph)} t/h < ${T.smallScaleTph} t/h — un autoclave est difficile à amortir à cette échelle.`);
  } else if (inp.throughputTph !== null) {
    scores.POX += 1;
  }

  const recommendation = (Object.keys(scores) as RefractoryCircuitId[])
    .reduce((best, id) => (scores[id] > scores[best] ? id : best), 'POX');

  reasons.push(`Circuit ${REFRACTORY_CIRCUITS[recommendation].name} retenu (score ${scores[recommendation]}).`);
  return { recommendation, reasons, warnings, scores };
}
