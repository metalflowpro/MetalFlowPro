// ─────────────────────────────────────────────────────────────────────────────
// COURBE DE RÉCUPÉRATION AUDITÉE — module PUR.
//
// ── Pourquoi ────────────────────────────────────────────────────────────────
// Un PFS ou une FS ne publie pas « une » récupération : il publie une COURBE en
// fonction de la TENEUR D'ALIMENTATION, ajustée sur la composition des étages
// unitaires, puis certifiée par une personne qualifiée. Exemple (Spanish
// Mountain PFS 2021, §13.5.5) :
//
//     Récupération Au (%) = 10,189 × ln(teneur g/t) + 91,686
//
// Tant qu'un projet n'a pas de rapport publié, l'application COMPOSE les étages
// (routeEstimation.ts). Dès qu'il en a un, reconstituer le chiffre par
// composition est au mieux approximatif, au pire contradictoire avec le document
// de référence. Ce module permet d'épingler la courbe auditée : le projet
// affiche alors EXACTEMENT le chiffre certifié.
//
// ── Rien en dur ─────────────────────────────────────────────────────────────
// Les coefficients sont PROPRES À CHAQUE PROJET et vivent dans les surcharges de
// `project_met_constants`. Aucun coefficient de gisement n'est écrit dans le
// code : l'application doit servir plusieurs projets, chacun avec ses données.
//
// Aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paramètres de la courbe auditée. Neutres par défaut : `enabled = 0` ⇒ le
 * moteur de composition d'étages reste seul maître, comportement inchangé pour
 * tout projet qui n'a rien configuré.
 */
export const RECOVERY_CURVE = {
  /** 1 = la courbe auditée prime sur la composition d'étages ; 0 = désactivée. */
  enabled: 0,
  /** Coefficient du logarithme népérien de la teneur (pts par unité de ln g/t). */
  lnCoefficientPct: 0,
  /** Constante additive (%). */
  constantPct: 0,
  /** Borne basse de validité de l'ajustement (g/t) — hors plage, on extrapole pas. */
  minGradeGt: 0.1,
  /** Borne haute de validité (g/t). */
  maxGradeGt: 5,
  /** Plancher de récupération admis (%). */
  floorPct: 0,
  /** Plafond de récupération admis (%). */
  capPct: 99,
} as const;

/** Version modifiable — base des surcharges de projet. */
export type RecoveryCurveParams = { -readonly [K in keyof typeof RECOVERY_CURVE]: number };

export interface RecoveryCurveResult {
  /** Récupération globale (%) donnée par la courbe auditée. */
  recoveryPct: number;
  /** Teneur effectivement utilisée (g/t) après bornage à la plage de validité. */
  gradeUsedGt: number;
  /** Vrai si la teneur du projet sortait de la plage d'ajustement. */
  clamped: boolean;
  /** Formule lisible, pour l'affichage et la traçabilité 43-101. */
  basis: string;
}

const f = (v: number, d = 3) => v.toFixed(d);

/** La courbe est-elle activée ET exploitable ? */
export function isCurveEnabled(p: RecoveryCurveParams): boolean {
  return p.enabled === 1 && (p.lnCoefficientPct !== 0 || p.constantPct !== 0);
}

/**
 * Récupération globale (%) à la teneur donnée, selon la courbe auditée.
 *
 * Renvoie `null` si la courbe n'est pas configurée, ou si la teneur n'est pas
 * exploitable — l'appelant retombe alors sur la composition d'étages. On
 * n'invente jamais de récupération à partir d'une courbe vide.
 *
 * Hors de la plage d'ajustement, la teneur est BORNÉE plutôt qu'extrapolée : un
 * logarithme extrapolé loin de ses points d'appui n'a aucune valeur prédictive,
 * et le signaler (`clamped`) vaut mieux qu'un chiffre faussement précis.
 */
export function recoveryFromCurve(
  gradeGt: number,
  params: RecoveryCurveParams,
): RecoveryCurveResult | null {
  if (!isCurveEnabled(params)) return null;
  if (!Number.isFinite(gradeGt) || gradeGt <= 0) return null;

  const lo = Math.max(1e-6, params.minGradeGt);
  const hi = Math.max(lo, params.maxGradeGt);
  const gradeUsedGt = Math.min(hi, Math.max(lo, gradeGt));
  const clamped = gradeUsedGt !== gradeGt;

  const raw = params.lnCoefficientPct * Math.log(gradeUsedGt) + params.constantPct;
  if (!Number.isFinite(raw)) return null;
  const recoveryPct = Math.min(params.capPct, Math.max(params.floorPct, raw));

  const sign = params.constantPct >= 0 ? '+' : '−';
  const basis =
    `Courbe auditée : R = ${f(params.lnCoefficientPct)} × ln(teneur) ${sign} ${f(Math.abs(params.constantPct))} ` +
    `→ ${recoveryPct.toFixed(1)} % à ${f(gradeUsedGt, 2)} g/t` +
    (clamped ? ` (teneur ${f(gradeGt, 2)} g/t hors plage d'ajustement ${f(lo, 2)}–${f(hi, 2)} g/t, bornée)` : '');

  return { recoveryPct, gradeUsedGt, clamped, basis };
}
