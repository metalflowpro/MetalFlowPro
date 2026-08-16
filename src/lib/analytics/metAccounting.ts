// ─────────────────────────────────────────────────────────────────────────────
// COMPTABILITÉ MÉTALLURGIQUE — module PUR.
//
// Réf. 911 Metallurgist, « Metallurgical Accounting Formulas » :
//   https://www.911metallurgist.com/blog/metallurgical-accounting-formulas/
//
// ── Pourquoi ce module ──────────────────────────────────────────────────────
// Partout ailleurs, l'application prend les récupérations d'étage POUR ACQUISES
// (le laboratoire annonce « récup. flottation 86,5 % » et on la croit). Ici on
// les CALCULE à partir de ce qui est réellement mesuré : les TITRES et les
// TONNAGES. C'est la seule façon de vérifier qu'un essai est cohérent, et la
// référence à utiliser pour toute récupération de séparateur dans MetalFlow Pro.
//
// ── Le bilan à deux produits ────────────────────────────────────────────────
// Un séparateur (flottation, Knelson, DMS, tri optique…) scinde une
// alimentation F en un CONCENTRÉ C et un REJET T. Trois titres suffisent :
//
//     f = titre de l'alimentation      c = titre du concentré
//     t = titre du rejet
//
//   Ratio de concentration      K = F/C = (c − t)/(f − t)
//   Tirage massique (mass pull) C/F = 100/K = 100(f − t)/(c − t)   [%]
//   RÉCUPÉRATION                R = 100·c(f − t) / [f(c − t)]      [%]
//   Ratio d'enrichissement      c/f
//
// L'identité R = 100·c/(K·f) permet de recouper le calcul par un autre chemin.
//
// ── Ce que le module ne fait PAS ────────────────────────────────────────────
// Il ne combine pas les étages entre eux : l'enchaînement des étages relève du
// catalogue de routes (routeEstimation.ts), qui distingue lixiviation sur
// RÉSIDUS (addition) et sur CONCENTRÉ (multiplication).
//
// Aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/** Titres d'un bilan à deux produits, dans une unité HOMOGÈNE (g/t, %, ppm…). */
export interface TwoProductAssays {
  /** f — titre de l'alimentation. */
  feed: number;
  /** c — titre du concentré. */
  concentrate: number;
  /** t — titre du rejet. */
  tailings: number;
}

/** Bilan complet d'un séparateur, ou `null` si les titres ne le permettent pas. */
export interface TwoProductBalance {
  /** K = F/C — combien de tonnes d'alimentation par tonne de concentré. */
  concentrationRatio: number;
  /** 100·C/F — part de la masse partant au concentré (%). */
  massPullPct: number;
  /** R — part du métal partant au concentré (%). C'est LA récupération. */
  recoveryPct: number;
  /** c/f — de combien le séparateur enrichit le métal. */
  enrichmentRatio: number;
}

/**
 * Un bilan n'a de sens que si le séparateur SÉPARE : le concentré doit être
 * plus riche que le rejet, et l'alimentation comprise entre les deux. Hors de
 * ces bornes, les formules renvoient des valeurs aberrantes (récupérations
 * négatives ou > 100 %) qu'il vaut mieux refuser que propager.
 */
export function isSeparable(a: TwoProductAssays): boolean {
  const { feed: f, concentrate: c, tailings: t } = a;
  if (![f, c, t].every(Number.isFinite)) return false;
  if (f <= 0 || c <= 0) return false;
  if (t < 0) return false;
  if (c <= t) return false;          // pas d'enrichissement → pas de séparation
  return f > t && f < c;             // l'alimentation est encadrée par ses produits
}

/**
 * Bilan à deux produits complet à partir des seuls titres.
 * Renvoie `null` quand les titres ne décrivent pas une séparation réelle —
 * jamais un chiffre forcé dans [0, 100] qui masquerait un essai incohérent.
 */
export function twoProductBalance(a: TwoProductAssays): TwoProductBalance | null {
  if (!isSeparable(a)) return null;
  const { feed: f, concentrate: c, tailings: t } = a;

  const concentrationRatio = (c - t) / (f - t);          // K
  const massPullPct = 100 / concentrationRatio;          // 100·C/F
  const recoveryPct = (100 * c * (f - t)) / (f * (c - t));
  const enrichmentRatio = c / f;

  return { concentrationRatio, massPullPct, recoveryPct, enrichmentRatio };
}

/**
 * Récupération à partir des TONNAGES et titres, quand les masses sont connues
 * (essai en laboratoire pesé, ou bilan d'usine) :  R = 100·C·c / (F·f).
 * Chemin indépendant de `twoProductBalance` — sert à recouper.
 */
export function recoveryFromMasses(
  feedMass: number, feedAssay: number,
  concMass: number, concAssay: number,
): number | null {
  const metalIn = feedMass * feedAssay;
  if (!Number.isFinite(metalIn) || metalIn <= 0) return null;
  const r = (100 * concMass * concAssay) / metalIn;
  return Number.isFinite(r) ? r : null;
}

// ═══ Réconciliation d'un essai ═══════════════════════════════════════════════

/** Écart admis (pts) entre récupération annoncée et récupération recalculée. */
export const RECONCILIATION_TOLERANCE_PTS = 2;

export interface Reconciliation {
  /** Récupération recalculée depuis les titres (%). */
  computedPct: number;
  /** Récupération telle qu'annoncée par le laboratoire (%), si fournie. */
  reportedPct: number | null;
  /** Écart signé annoncé − recalculé (pts). */
  deltaPts: number | null;
  /** Tirage massique recalculé (%). */
  computedMassPullPct: number;
  /** Tirage massique annoncé (%), si fourni. */
  reportedMassPullPct: number | null;
  /** Vrai si tout écart fourni tient dans la tolérance. */
  consistent: boolean;
  /** Anomalies lisibles par un métallurgiste. */
  warnings: string[];
}

/**
 * Recoupe un essai de séparation : ce que le laboratoire ANNONCE contre ce que
 * ses propres titres IMPLIQUENT. Un écart révèle une erreur de saisie, un titre
 * manquant ou un bilan non bouclé — à voir avant de fonder une route dessus.
 */
export function reconcileSeparationTest(
  a: TwoProductAssays,
  reported: { recoveryPct?: number | null; massPullPct?: number | null } = {},
  tolerancePts: number = RECONCILIATION_TOLERANCE_PTS,
): Reconciliation | null {
  const bal = twoProductBalance(a);
  if (!bal) return null;

  const warnings: string[] = [];
  const rep = typeof reported.recoveryPct === 'number' && Number.isFinite(reported.recoveryPct)
    ? reported.recoveryPct : null;
  const repPull = typeof reported.massPullPct === 'number' && Number.isFinite(reported.massPullPct)
    ? reported.massPullPct : null;

  const deltaPts = rep != null ? +(rep - bal.recoveryPct).toFixed(2) : null;
  if (deltaPts != null && Math.abs(deltaPts) > tolerancePts) {
    warnings.push(
      `Récupération annoncée ${rep!.toFixed(1)} % contre ${bal.recoveryPct.toFixed(1)} % ` +
      `impliquée par les titres (f ${a.feed}, c ${a.concentrate}, t ${a.tailings}) — écart ${deltaPts > 0 ? '+' : ''}${deltaPts} pts.`,
    );
  }

  if (repPull != null && Math.abs(repPull - bal.massPullPct) > tolerancePts) {
    warnings.push(
      `Tirage massique annoncé ${repPull.toFixed(1)} % contre ${bal.massPullPct.toFixed(1)} % ` +
      `impliqué par les titres (K = ${bal.concentrationRatio.toFixed(1)}).`,
    );
  }

  return {
    computedPct: bal.recoveryPct,
    reportedPct: rep,
    deltaPts,
    computedMassPullPct: bal.massPullPct,
    reportedMassPullPct: repPull,
    consistent: warnings.length === 0,
    warnings,
  };
}

// ═══ Bilan à trois produits (bi-métallique) ══════════════════════════════════

/** Titres d'un métal sur les quatre courants d'une séparation à deux concentrés. */
export interface ThreeProductMetal {
  /** Titre de l'alimentation. */
  feed: number;
  /** Titre du concentré n° 1. */
  conc1: number;
  /** Titre du concentré n° 2. */
  conc2: number;
  /** Titre du rejet final. */
  tailings: number;
}

export interface ThreeProductBalance {
  /** C₁/F — part massique du concentré n° 1 (fraction). */
  conc1Fraction: number;
  /** C₂/F — part massique du concentré n° 2 (fraction). */
  conc2Fraction: number;
  /** Récupération du métal A au concentré n° 1 (%). */
  metalARecoveryC1Pct: number;
  /** Récupération du métal B au concentré n° 2 (%). */
  metalBRecoveryC2Pct: number;
}

/**
 * Bilan à trois produits : une alimentation, DEUX concentrés, un rejet.
 * Le partage massique se résout avec les titres de DEUX métaux (d'où le
 * « bi-métallique ») — un seul métal ne suffit pas à lever l'indétermination.
 *
 * Indispensable dès qu'un projet devient multi-métal (Au + Cu, Pb/Zn…) : le
 * bilan à deux produits ne sait pas répartir la masse entre deux concentrés.
 */
export function threeProductBalance(
  metalA: ThreeProductMetal,
  metalB: ThreeProductMetal,
): ThreeProductBalance | null {
  const a = metalA, b = metalB;
  const all = [a.feed, a.conc1, a.conc2, a.tailings, b.feed, b.conc1, b.conc2, b.tailings];
  if (!all.every(Number.isFinite)) return null;
  if (a.feed <= 0 || b.feed <= 0) return null;

  // Écarts au rejet — les formules ne travaillent que sur des différences.
  const a1 = a.conc1 - a.tailings, a2 = a.conc2 - a.tailings, af = a.feed - a.tailings;
  const b1 = b.conc1 - b.tailings, b2 = b.conc2 - b.tailings, bf = b.feed - b.tailings;

  const det = a1 * b2 - b1 * a2;
  if (det === 0 || !Number.isFinite(det)) return null;   // système indéterminé

  const conc1Fraction = (af * b2 - bf * a2) / det;
  const conc2Fraction = (bf * a1 - af * b1) / det;

  // Un partage massique hors [0, 1] signe des titres incohérents.
  if (![conc1Fraction, conc2Fraction].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  if (conc1Fraction + conc2Fraction > 1) return null;

  return {
    conc1Fraction,
    conc2Fraction,
    metalARecoveryC1Pct: (100 * conc1Fraction * a.conc1) / a.feed,
    metalBRecoveryC2Pct: (100 * conc2Fraction * b.conc2) / b.feed,
  };
}

export interface ThreeProductReconciliation {
  balance: ThreeProductBalance;
  /** Écarts signés annoncé − recalculé (pts), `null` si rien n'est annoncé. */
  deltaARecoveryPts: number | null;
  deltaBRecoveryPts: number | null;
  deltaConc1MassPts: number | null;
  deltaConc2MassPts: number | null;
  consistent: boolean;
  warnings: string[];
}

/**
 * Recoupe un essai à DEUX concentrés : ce que le laboratoire annonce contre ce
 * que ses propres titres impliquent — même discipline que la réconciliation à
 * deux produits, étendue au circuit différentiel.
 *
 * Renvoie `null` quand les titres ne permettent aucun bilan (système
 * indéterminé, partage massique non physique) : c'est en soi le signal d'un
 * essai à revoir, et cela vaut mieux qu'un chiffre inventé.
 */
export function reconcileThreeProductTest(
  metalA: ThreeProductMetal,
  metalB: ThreeProductMetal,
  reported: {
    aRecoveryPct?: number | null; bRecoveryPct?: number | null;
    conc1MassPct?: number | null; conc2MassPct?: number | null;
  } = {},
  tolerancePts: number = RECONCILIATION_TOLERANCE_PTS,
): ThreeProductReconciliation | null {
  const balance = threeProductBalance(metalA, metalB);
  if (!balance) return null;

  const warnings: string[] = [];
  const num = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const check = (
    label: string, reportedVal: number | null, computed: number, unit: string,
  ): number | null => {
    if (reportedVal === null) return null;
    const delta = +(reportedVal - computed).toFixed(2);
    if (Math.abs(delta) > tolerancePts) {
      warnings.push(
        `${label} annoncé ${reportedVal.toFixed(1)} ${unit} contre ${computed.toFixed(1)} ${unit} ` +
        `impliqué par les titres — écart ${delta > 0 ? '+' : ''}${delta} pts.`,
      );
    }
    return delta;
  };

  const deltaARecoveryPts = check('Récupération A au concentré 1',
    num(reported.aRecoveryPct), balance.metalARecoveryC1Pct, '%');
  const deltaBRecoveryPts = check('Récupération B au concentré 2',
    num(reported.bRecoveryPct), balance.metalBRecoveryC2Pct, '%');
  const deltaConc1MassPts = check('Tirage massique du concentré 1',
    num(reported.conc1MassPct), balance.conc1Fraction * 100, '%');
  const deltaConc2MassPts = check('Tirage massique du concentré 2',
    num(reported.conc2MassPct), balance.conc2Fraction * 100, '%');

  return {
    balance,
    deltaARecoveryPts, deltaBRecoveryPts, deltaConc1MassPts, deltaConc2MassPts,
    consistent: warnings.length === 0,
    warnings,
  };
}
