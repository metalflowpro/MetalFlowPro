// ─────────────────────────────────────────────────────────────────────────────
// Provenance & hiérarchie des sources de données — module PUR (aucun React/DB).
//
// Le cahier des charges de Flowsheet Simulation Pro impose que CHAQUE champ
// consommé par une simulation soit traçable : d'où vient la valeur, et à quel
// point on peut s'y fier. Deux axes distincts, à ne jamais confondre :
//
//   1. Le NIVEAU DE SOURCE (`SourceTier`) — la hiérarchie de priorité qui tranche
//      QUELLE valeur retenir quand plusieurs sources renseignent le même champ
//      (§3 « Règle de priorité des données »). Un essai LIMS approuvé prime sur
//      un critère de conception, qui prime sur une valeur par défaut de template,
//      qui prime sur une hypothèse manuelle.
//
//   2. La PROVENANCE AFFICHÉE (`Provenance`) — ce que la valeur EST une fois
//      retenue (§3 « Chaque résultat affiché doit indiquer sa source ») : mesurée,
//      calculée, estimée, valeur par défaut, ou hypothèse utilisateur.
//
// De ces deux axes découle la COULEUR DE QUALITÉ (§9 « Affichage des
// incertitudes ») : vert (données validées), orange (partiellement estimé),
// rouge (majoritairement hypothétique), gris (calcul indisponible).
//
// Rien n'est en dur ici : ce fichier ne porte que la LOGIQUE de traçabilité, pas
// de valeurs métier. Il est réutilisé par le connecteur de données projet, le
// générateur de flowsheet et l'affichage des résultats.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Niveaux de source, du plus fiable au moins fiable — §3 « Règle de priorité ».
 * L'ordre de déclaration EST la priorité : voir {@link SOURCE_TIER_PRIORITY}.
 */
export type SourceTier =
  | 'lims_approved'       // 1. Donnée LIMS approuvée
  | 'pilot_validated'     // 2. Donnée pilote / usine validée
  | 'testwork_validated'  // 3. Donnée de test métallurgique validée
  | 'design_criteria'     // 4. Critère de conception approuvé
  | 'template_default'    // 5. Valeur par défaut issue du template
  | 'user_assumption';    // 6. Hypothèse manuelle saisie par l'utilisateur

/** Priorité décroissante : l'index 0 est la source la plus fiable. */
export const SOURCE_TIER_PRIORITY: readonly SourceTier[] = [
  'lims_approved',
  'pilot_validated',
  'testwork_validated',
  'design_criteria',
  'template_default',
  'user_assumption',
] as const;

/** Rang de priorité (0 = plus fiable). Un tier inconnu est traité comme le moins fiable. */
export function sourceTierRank(tier: SourceTier): number {
  const i = SOURCE_TIER_PRIORITY.indexOf(tier);
  return i === -1 ? SOURCE_TIER_PRIORITY.length : i;
}

/** Libellé court FR d'un niveau de source, pour l'infobulle de traçabilité. */
export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  lims_approved: 'LIMS approuvé',
  pilot_validated: 'Pilote / usine validé',
  testwork_validated: 'Essai métallurgique validé',
  design_criteria: 'Critère de conception',
  template_default: 'Valeur par défaut (template)',
  user_assumption: 'Hypothèse utilisateur',
};

/**
 * Provenance AFFICHÉE d'une valeur — §3. Distincte du niveau de source : une
 * valeur peut être MESURÉE (venue d'un essai) ou CALCULÉE (dérivée par le
 * moteur), quel que soit le niveau de source de ses entrées.
 */
export type Provenance =
  | 'measured'         // Mesuré — lu directement d'un essai / d'une donnée usine
  | 'calculated'       // Calculé — dérivé par le moteur à partir d'autres champs
  | 'estimated'        // Estimé — critère de conception / corrélation
  | 'default'          // Valeur par défaut — issue du template, non spécifique au projet
  | 'user_assumption'; // Hypothèse utilisateur — saisie manuelle

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  measured: 'Mesuré',
  calculated: 'Calculé',
  estimated: 'Estimé',
  default: 'Valeur par défaut',
  user_assumption: 'Hypothèse utilisateur',
};

/**
 * Provenance par DÉFAUT d'une valeur BRUTE selon son niveau de source. Les
 * valeurs dérivées par le moteur portent 'calculated' quelle que soit la source
 * de leurs entrées — ce mapping ne concerne que les entrées brutes.
 */
export function provenanceForTier(tier: SourceTier): Provenance {
  switch (tier) {
    case 'lims_approved':
    case 'pilot_validated':
    case 'testwork_validated':
      return 'measured';
    case 'design_criteria':
      return 'estimated';
    case 'template_default':
      return 'default';
    case 'user_assumption':
      return 'user_assumption';
  }
}

/**
 * Une valeur accompagnée de sa traçabilité. `provenance` est optionnel : s'il
 * est absent, il se déduit du tier via {@link provenanceForTier} (utile pour les
 * valeurs dérivées qui posent explicitement 'calculated').
 */
export interface Sourced<T> {
  value: T;
  tier: SourceTier;
  provenance?: Provenance;
  /** D'où vient précisément la valeur — nom de l'essai, du critère, etc. */
  note?: string;
}

/** Construit une valeur tracée ; provenance déduite du tier si non fournie. */
export function sourced<T>(
  value: T,
  tier: SourceTier,
  opts?: { provenance?: Provenance; note?: string },
): Sourced<T> {
  return {
    value,
    tier,
    provenance: opts?.provenance ?? provenanceForTier(tier),
    note: opts?.note,
  };
}

/** Provenance effective d'une valeur tracée (explicite ou déduite du tier). */
export function effectiveProvenance<T>(s: Sourced<T>): Provenance {
  return s.provenance ?? provenanceForTier(s.tier);
}

/**
 * Résout un champ à partir de plusieurs candidats en appliquant la hiérarchie
 * de priorité : retient le candidat au tier le plus fiable dont la valeur est
 * PRÉSENTE (non `null`/`undefined`, et non `NaN` pour les nombres). Les candidats
 * peuvent être fournis dans n'importe quel ordre. Renvoie `null` si aucun
 * candidat n'a de valeur exploitable.
 */
export function resolveSourced<T>(
  candidates: Array<Sourced<T | null | undefined> | null | undefined>,
): Sourced<T> | null {
  let best: Sourced<T> | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const v = c.value;
    if (v === null || v === undefined) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    if (best === null || sourceTierRank(c.tier) < sourceTierRank(best.tier)) {
      best = { value: v as T, tier: c.tier, provenance: c.provenance, note: c.note };
    }
  }
  return best;
}

// ─── Qualité / incertitude ──────────────────────────────────────────────────

/**
 * Niveau de qualité d'un résultat affiché — §9.
 * - `green` : fondé sur des données validées
 * - `amber` : partiellement estimé
 * - `red`   : majoritairement hypothétique
 * - `grey`  : calcul non disponible
 */
export type QualityLevel = 'green' | 'amber' | 'red' | 'grey';

export const QUALITY_LABEL: Record<QualityLevel, string> = {
  green: 'Données validées',
  amber: 'Partiellement estimé',
  red: 'Majoritairement hypothétique',
  grey: 'Calcul non disponible',
};

/** Classe un niveau de source comme « validé » (données mesurées/approuvées). */
export function isValidatedTier(tier: SourceTier): boolean {
  return tier === 'lims_approved' || tier === 'pilot_validated'
    || tier === 'testwork_validated';
}

/** Classe un niveau de source comme « hypothétique » (défaut/hypothèse). */
export function isAssumedTier(tier: SourceTier): boolean {
  return tier === 'template_default' || tier === 'user_assumption';
}

/** Seuils de la couleur de qualité — fractions de champs par catégorie de source. */
export const QUALITY_THRESHOLDS = {
  /** Part MINIMALE de champs validés pour afficher le vert. */
  greenValidatedShare: 0.8,
  /** Part de champs hypothétiques AU-DELÀ de laquelle on passe au rouge. */
  redAssumedShare: 0.5,
} as const;

/**
 * Répartition données/hypothèses d'un ensemble de champs contributifs — alimente
 * l'annonce « Données utilisées : 80 % / Hypothèses : 20 % » du générateur (§6).
 * `criteria` (critère de conception) compte comme donnée, pas comme hypothèse.
 */
export function dataCoverage(tiers: readonly SourceTier[]): {
  dataPct: number;
  assumptionPct: number;
  n: number;
} {
  const n = tiers.length;
  if (n === 0) return { dataPct: 0, assumptionPct: 0, n: 0 };
  const assumed = tiers.filter(isAssumedTier).length;
  const assumptionPct = (assumed / n) * 100;
  return { dataPct: 100 - assumptionPct, assumptionPct, n };
}

/**
 * Couleur de qualité d'un résultat à partir des niveaux de source de ses champs
 * contributifs. Sans champ contributif → gris (rien à évaluer). Sinon :
 * majorité hypothétique → rouge ; forte part validée → vert ; entre les deux →
 * orange.
 */
export function qualityFromTiers(
  tiers: readonly SourceTier[],
  thresholds: { greenValidatedShare: number; redAssumedShare: number } = QUALITY_THRESHOLDS,
): QualityLevel {
  if (tiers.length === 0) return 'grey';
  const n = tiers.length;
  const validatedShare = tiers.filter(isValidatedTier).length / n;
  const assumedShare = tiers.filter(isAssumedTier).length / n;
  if (assumedShare > thresholds.redAssumedShare) return 'red';
  if (validatedShare >= thresholds.greenValidatedShare) return 'green';
  return 'amber';
}

/** Couleur de qualité à partir de valeurs tracées (raccourci de {@link qualityFromTiers}). */
export function qualityFromSourced(values: ReadonlyArray<Sourced<unknown>>): QualityLevel {
  return qualityFromTiers(values.map(v => v.tier));
}
