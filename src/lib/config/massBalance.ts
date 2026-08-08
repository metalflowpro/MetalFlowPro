// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Paramètres de flux du bilan massique, par GROUPE D'OPÉRATION.
//
// Le bilan massique dérive, pour chaque courant du flowsheet, un débit massique,
// un % solides et une teneur en or, à partir du groupe d'opération de
// l'équipement destinataire (broyage, flottation, CIL, ADR…).
//
// ⚠️ Pourquoi ces valeurs doivent être configurables :
//
//   • Le **% solides** d'un étage est une consigne d'exploitation, pas une
//     constante : il se règle selon la rhéologie de la pulpe (argiles, finesse)
//     et se déplace au fil de la vie de la mine.
//   • Les **ratios massiques** (rendement pondéral de flottation, masse de
//     concentré gravimétrique, ratio liquide/solide d'une PLS ou d'une élution)
//     dépendent entièrement de la minéralogie et de la configuration du circuit.
//   • Les **facteurs d'enrichissement en or** (concentré gravimétrique, éluat,
//     cathode, doré) varient de plusieurs ordres de grandeur selon le procédé.
//   • Les **consommations** d'énergie et de réactifs par groupe dépendent de la
//     dureté du minerai, des cyanicides présents et du pouvoir tampon de la
//     gangue — un minerai cuprifère ou pyrrhotiteux sort de ces plages.
//
// Organisation : groupées PAR GROUPE D'OPÉRATION (la clé utilisée par
// GROUP_LOOKUP dans la page Bilan Massique), pour que réviser le comportement
// de la flottation ne fasse lire que le bloc `Float`.
//
// Module PUR — testable isolément.
// ─────────────────────────────────────────────────────────────────────────────

/** Consommation d'énergie (kWh par tonne traitée) par groupe d'opération. */
export const GROUP_ENERGY_KWH_T: Record<string, number> = {
  Ali: 0, Crush: 2.5, Screen: 0.1, Grind: 17, Regrind: 8, Classif: 0, Grav: 0.5, GravConc: 0.5,
  Float: 3, Thick: 0.3, Filt: 1.5, CIL: 1.2, CIP: 1.2, Leach: 0.8, Heap: 0,
  POX: 18, Neut: 0.5, ADR: 0.2, Elut: 3.5, EW: 4, Smelt: 12, Kiln: 5, MC: 1.5,
  Tails: 0.5, WT: 0.8, PLS: 0, Regrind2: 9,
};

/** Consommation de cyanure (kg NaCN par tonne) par groupe. Absent = pas de cyanure. */
export const GROUP_CN_KG_T: Record<string, number> = {
  CIL: 0.45, CIP: 0.40, Leach: 0.30, Heap: 0.20, POX: 0.50,
};

/** Consommation de chaux (kg CaO par tonne) par groupe. Absent = pas de chaux. */
export const GROUP_LIME_KG_T: Record<string, number> = {
  CIL: 2.5, CIP: 2.2, Leach: 1.8, POX: 12, Neut: 10, Heap: 4,
};

/**
 * Fraction de la SOUSVERSE cyclone soutirée vers le circuit gravité.
 * Bleed Knelson/Falcon typique 15–20 % ; milieu de plage retenu.
 */
export const GRAV_BLEED_OF_UF = 0.18;

/**
 * Rendement du circuit gravité : GRG × efficacité de passe × efficacité ILR.
 * Aligné sur la section 07_GRAVITY des Critères de conception.
 */
export const GRAVITY_PULL = {
  /** Efficacité d'une passe du concentrateur centrifuge. */
  passEfficiency: 0.6,
  /** Efficacité du réacteur de lixiviation intensive (ILR) sur le concentré. */
  ilrEfficiency: 0.95,
  /** Plafond de sécurité du rendement gravité. */
  maxPull: 0.95,
};

/**
 * % solides par défaut de chaque groupe d'opération.
 * 100 = matière sèche, 0 = solution claire.
 */
export const GROUP_SOLIDS_PCT: Record<string, number> = {
  Ali: 100, Crush: 100, Screen: 100, Heap: 100,
  MillSag: 75, MillBall: 72,
  Regrind: 60, RegrindConc: 52,
  Grav: 65, GravConc: 78, Float: 35, Thick: 56, Filt: 72,
  Leach: 50, POX: 48, Neut: 45,
  PLS: 0, ADR: 0, Elut: 0, MC: 0,
  EW: 100, Smelt: 100,
  Tails: 60, WT: 3,
  /** Repli pour tout groupe non listé. */
  Other: 65,
};

/**
 * Ratios massiques : masse du courant = débit d'alimentation × ce facteur.
 * Les groupes dont la masse dérive d'un critère de conception (charge
 * circulante du broyeur, rendement pondéral de flottation) ne figurent pas ici —
 * leur formule vit dans la page et lit le critère.
 */
export const GROUP_MASS_FACTOR: Record<string, number> = {
  /** Le concassage gagne un peu de masse (humidité d'abattage des poussières). */
  Crush: 1.02,
  /** Concentré gravimétrique : quelques millièmes de l'alimentation. */
  GravConc: 0.004,
  /** Gâteau de filtration après déshydratation. */
  Filt: 0.85,
  /** Solution mère de lixiviation : ratio liquide/solide. */
  PLS: 2.8,
  /** Solution en circulation dans le circuit ADR. */
  ADR: 2.4,
  /** Solution Merrill-Crowe. */
  MC: 2.6,
  /** Effluents envoyés au traitement des eaux. */
  WT: 0.5,
};

/**
 * Débits massiques ABSOLUS (t/h) des étages de fin de chaîne, dont la taille ne
 * dépend pas du débit usine mais du contenu en or (colonne d'élution, cellule
 * d'électrolyse, four de fusion).
 */
export const GROUP_ABSOLUTE_MASS_TPH: Record<string, number> = {
  Elut: 0.45,
  EW: 0.020,
  Smelt: 0.017,
};

/**
 * Teneurs en or ABSOLUES (g/t) des produits de fin de chaîne — l'or y est
 * concentré de plusieurs ordres de grandeur par rapport au minerai.
 */
export const GROUP_ABSOLUTE_AU_GT: Record<string, number> = {
  /** Éluat riche. */
  Elut: 480,
  /** Cathode d'électrolyse. */
  EW: 29000,
  /** Doré. */
  Smelt: 34000,
};

/** Facteurs d'enrichissement / de partage de l'or, par groupe. */
export const GROUP_AU_FACTORS = {
  /** Enrichissement du concentré gravimétrique vs l'alimentation. */
  gravConcUpgrade: 20,
  /** Rendement de lixiviation effectif d'un circuit CIL/CIP (fraction du `leachRec`). */
  cilLeachEfficiency: 0.96,
  /** Rendement de lixiviation effectif d'une cuve de lixiviation simple. */
  leachEfficiency: 0.90,
  /** Part de l'or récupéré présente dans la PLS. */
  plsShare: 0.14,
  /** Part de l'or récupéré présente dans la solution ADR. */
  adrShare: 0.13,
  /** Part de l'or récupéré présente dans la solution Merrill-Crowe. */
  mcShare: 0.13,
  /** Enrichissement minimal d'un concentré de flottation. */
  floatMinUpgrade: 2,
  /** Rendement de récupération de l'or en flottation (fraction). */
  floatRecovery: 0.9,
};

/** Rendement pondéral plancher des étages d'oxydation (POX / neutralisation). */
export const OXIDATION_MIN_MASS_PULL = 0.05;
