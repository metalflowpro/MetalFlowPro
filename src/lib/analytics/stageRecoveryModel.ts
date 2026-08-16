// ─────────────────────────────────────────────────────────────────────────────
// MODÈLES DE RÉCUPÉRATION PAR ÉTAGE, AJUSTÉS SUR LES ESSAIS DU PROJET.
//
// ── Pourquoi ce module existe ───────────────────────────────────────────────
// Un rapport technique NI 43-101 ne pose pas des constantes : pour CHAQUE étage
// unitaire il AJUSTE un modèle sur les essais du projet, puis compose les
// étages. Spanish Mountain PFS 2021 (§13.5) :
//
//     flottation   R = 91,02 × (1 − e^(−6,42 × teneur))      ← saturante
//     lixiviation  R = 4,4152 × ln(teneur) + 83,872          ← logarithmique
//     globale      R = 10,189 × ln(teneur) + 91,686
//
// Tant que l'application compose des MOYENNES scalaires avec des facteurs de
// dératage génériques, elle produit une estimation de cadrage, jamais un chiffre
// défendable devant une personne qualifiée. Ce module lui donne la méthode du
// rapport : ajuster, mesurer la qualité de l'ajustement, borner sa validité.
//
// ── Rien en dur ─────────────────────────────────────────────────────────────
// Aucun coefficient de gisement n'est écrit ici. Les coefficients SORTENT des
// essais de chaque projet. Les seuls réglages sont les paramètres de l'ajusteur
// lui-même (effectif minimal, plage de recherche), eux aussi surchargeables.
//
// ── Ce que le module refuse de faire ────────────────────────────────────────
// Il ne renvoie JAMAIS un modèle qu'il ne peut pas soutenir : trop peu de
// points, teneurs toutes identiques, ajustement dégénéré → `null`, et
// l'appelant retombe sur la composition d'étages. Un R² faible est RAPPORTÉ, pas
// masqué : c'est au métallurgiste de décider s'il adopte la régression.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/** Réglages de l'ajusteur — surchargeables par projet, aucun n'est un coefficient de gisement. */
export const STAGE_FIT_SETTINGS = {
  /** Effectif minimal d'essais pour qu'un ajustement soit tenté. */
  minPoints: 4,
  /** R² en deçà duquel l'ajustement est signalé comme peu soutenu. */
  weakFitRSquared: 0.5,
  /** Borne basse de la constante de vitesse cherchée (modèle saturant). */
  rateSearchMin: 0.05,
  /** Borne haute de la constante de vitesse cherchée (modèle saturant). */
  rateSearchMax: 50,
  /** Nombre de pas de la recherche sur la constante de vitesse. */
  rateSearchSteps: 400,
  /** Passes de raffinement autour du meilleur pas. */
  rateRefinePasses: 4,
} as const;

export type StageFitSettings = { -readonly [K in keyof typeof STAGE_FIT_SETTINGS]: number };

/** Forme fonctionnelle d'un modèle d'étage. */
export type StageModelForm =
  /** R = a × (1 − e^(−b·x)) — monte puis SATURE. Typique d'une flottation. */
  | 'saturating'
  /** R = a × ln(x) + b — croissance lente sans plateau. Typique d'une lixiviation. */
  | 'logarithmic';

/** Un point d'essai : une teneur d'alimentation et la récupération mesurée. */
export interface StagePoint {
  /** Teneur d'alimentation de l'étage (g/t) — strictement positive. */
  gradeGt: number;
  /** Récupération mesurée (%). */
  recoveryPct: number;
}

export interface StageModel {
  form: StageModelForm;
  /** Coefficient a — asymptote (saturant) ou pente du log (logarithmique). */
  a: number;
  /** Coefficient b — constante de vitesse (saturant) ou ordonnée (logarithmique). */
  b: number;
  /** Nombre d'essais retenus. */
  n: number;
  /** Coefficient de détermination sur les essais retenus. */
  rSquared: number;
  /** Écart type des résidus (pts de récupération). */
  rmsePts: number;
  /** Plage de teneurs couverte par les essais — hors d'elle, on extrapole. */
  minGradeGt: number;
  maxGradeGt: number;
  /** Vrai quand R² est sous le seuil : le modèle est faiblement soutenu. */
  weak: boolean;
  /** Formule lisible, pour le rapport et la traçabilité 43-101. */
  equation: string;
}

const f = (v: number, d = 4) => Number.isFinite(v) ? v.toFixed(d) : '—';

/** Ne garde que les points exploitables : teneur > 0, récupération finie. */
function usablePoints(points: StagePoint[]): StagePoint[] {
  return points.filter(p =>
    Number.isFinite(p.gradeGt) && p.gradeGt > 0 &&
    Number.isFinite(p.recoveryPct) && p.recoveryPct >= 0 && p.recoveryPct <= 100);
}

/** Qualité d'ajustement commune aux deux formes. */
function goodness(ys: number[], preds: number[]): { rSquared: number; rmsePts: number } {
  const n = ys.length;
  const mean = ys.reduce((s, v) => s + v, 0) / n;
  const sse = ys.reduce((s, y, i) => s + (y - preds[i]) ** 2, 0);
  const sst = ys.reduce((s, y) => s + (y - mean) ** 2, 0);
  return {
    rSquared: sst > 0 ? Math.max(0, 1 - sse / sst) : 0,
    rmsePts: Math.sqrt(sse / n),
  };
}

/**
 * Ajuste R = a × ln(x) + b par moindres carrés ordinaires sur (ln x, R).
 * Linéaire après changement de variable — solution fermée, pas d'itération.
 */
function fitLogarithmic(pts: StagePoint[]): { a: number; b: number } | null {
  const zs = pts.map(p => Math.log(p.gradeGt));
  const ys = pts.map(p => p.recoveryPct);
  const zBar = zs.reduce((s, v) => s + v, 0) / zs.length;
  const yBar = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < zs.length; i++) {
    num += (zs[i] - zBar) * (ys[i] - yBar);
    den += (zs[i] - zBar) ** 2;
  }
  if (den <= 0) return null;            // toutes les teneurs identiques
  const a = num / den;
  return { a, b: yBar - a * zBar };
}

/**
 * Ajuste R = a × (1 − e^(−b·x)) par MOINDRES CARRÉS SÉPARABLES.
 *
 * Le modèle est non linéaire en b mais LINÉAIRE en a : à b fixé, l'asymptote
 * optimale est a = Σ(y·u)/Σ(u²) avec u = 1−e^(−b·x). On ne cherche donc que sur
 * b — balayage puis raffinements successifs autour du meilleur pas. Robuste et
 * sans dérivée, là où une descente de gradient divergerait sur peu de points.
 */
function fitSaturating(pts: StagePoint[], S: StageFitSettings): { a: number; b: number } | null {
  const xs = pts.map(p => p.gradeGt);
  const ys = pts.map(p => p.recoveryPct);

  const aFor = (b: number): { a: number; sse: number } | null => {
    let num = 0, den = 0;
    const us = xs.map(x => 1 - Math.exp(-b * x));
    for (let i = 0; i < us.length; i++) { num += ys[i] * us[i]; den += us[i] ** 2; }
    if (!(den > 0)) return null;
    const a = num / den;
    const sse = ys.reduce((s, y, i) => s + (y - a * us[i]) ** 2, 0);
    return Number.isFinite(a) && Number.isFinite(sse) ? { a, sse } : null;
  };

  let lo = Math.max(1e-6, S.rateSearchMin);
  let hi = Math.max(lo * 1.001, S.rateSearchMax);
  let best: { a: number; b: number; sse: number } | null = null;

  const steps = Math.max(8, Math.round(S.rateSearchSteps));
  for (let pass = 0; pass <= Math.max(0, Math.round(S.rateRefinePasses)); pass++) {
    // Balayage GÉOMÉTRIQUE : une constante de vitesse s'étale sur des ordres de
    // grandeur, un pas linéaire gaspillerait la résolution dans les grands b.
    const ratio = Math.pow(hi / lo, 1 / steps);
    let localBest: { a: number; b: number; sse: number } | null = null;
    for (let i = 0; i <= steps; i++) {
      const b = lo * Math.pow(ratio, i);
      const r = aFor(b);
      if (r && (!localBest || r.sse < localBest.sse)) localBest = { a: r.a, b, sse: r.sse };
    }
    if (!localBest) return null;
    if (!best || localBest.sse < best.sse) best = localBest;
    // Resserre la fenêtre d'un pas de part et d'autre du meilleur b.
    lo = Math.max(1e-6, best.b / ratio);
    hi = best.b * ratio;
  }

  return best ? { a: best.a, b: best.b } : null;
}

/** Prédit la récupération (%) d'un modèle à une teneur donnée, sans bornage. */
export function predictStage(model: Pick<StageModel, 'form' | 'a' | 'b'>, gradeGt: number): number {
  return model.form === 'saturating'
    ? model.a * (1 - Math.exp(-model.b * gradeGt))
    : model.a * Math.log(gradeGt) + model.b;
}

/**
 * Ajuste le modèle d'un étage sur les essais du projet.
 *
 * Renvoie `null` quand les essais ne soutiennent aucun ajustement — effectif
 * insuffisant, teneurs toutes identiques, régression dégénérée. On ne fabrique
 * jamais un modèle depuis deux points : ce serait une droite parfaite sans
 * aucune valeur prédictive.
 */
export function fitStageModel(
  points: StagePoint[],
  form: StageModelForm,
  settings: StageFitSettings = { ...STAGE_FIT_SETTINGS },
): StageModel | null {
  const pts = usablePoints(points);
  if (pts.length < Math.max(3, settings.minPoints)) return null;

  const grades = pts.map(p => p.gradeGt);
  const minGradeGt = Math.min(...grades);
  const maxGradeGt = Math.max(...grades);
  if (minGradeGt === maxGradeGt) return null;   // aucune variation : rien à ajuster

  const coef = form === 'saturating' ? fitSaturating(pts, settings) : fitLogarithmic(pts);
  if (!coef || !Number.isFinite(coef.a) || !Number.isFinite(coef.b)) return null;

  const ys = pts.map(p => p.recoveryPct);
  const preds = pts.map(p => predictStage({ form, ...coef }, p.gradeGt));
  if (preds.some(v => !Number.isFinite(v))) return null;
  const { rSquared, rmsePts } = goodness(ys, preds);

  const equation = form === 'saturating'
    ? `R = ${f(coef.a, 2)} × (1 − e^(−${f(coef.b, 2)} × teneur))`
    : `R = ${f(coef.a, 4)} × ln(teneur) ${coef.b >= 0 ? '+' : '−'} ${f(Math.abs(coef.b), 4)}`;

  return {
    form, a: coef.a, b: coef.b,
    n: pts.length, rSquared, rmsePts,
    minGradeGt, maxGradeGt,
    weak: rSquared < settings.weakFitRSquared,
    equation,
  };
}

export interface StagePrediction {
  recoveryPct: number;
  /** Teneur utilisée après bornage à la plage des essais. */
  gradeUsedGt: number;
  /** Vrai si la teneur demandée sortait de la plage couverte par les essais. */
  extrapolated: boolean;
}

/**
 * Récupération prédite à une teneur, BORNÉE à la plage des essais et à [0, 100].
 *
 * Hors de la plage couverte, on borne au lieu d'extrapoler — une saturante ou un
 * logarithme extrapolés loin de leurs points d'appui n'ont aucune valeur — et on
 * le signale plutôt que de rendre un chiffre faussement précis.
 */
export function predictStageRecovery(model: StageModel, gradeGt: number): StagePrediction | null {
  if (!Number.isFinite(gradeGt) || gradeGt <= 0) return null;
  const gradeUsedGt = Math.min(model.maxGradeGt, Math.max(model.minGradeGt, gradeGt));
  const raw = predictStage(model, gradeUsedGt);
  if (!Number.isFinite(raw)) return null;
  return {
    recoveryPct: Math.min(100, Math.max(0, raw)),
    gradeUsedGt,
    extrapolated: gradeUsedGt !== gradeGt,
  };
}
