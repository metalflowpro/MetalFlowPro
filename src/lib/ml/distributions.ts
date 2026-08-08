// ─────────────────────────────────────────────────────────────────────────────
// Quantiles des lois normale et de Student — module PUR.
//
// Nécessaires aux intervalles de prédiction d'une régression : la demi-largeur
// vaut t_{1−α/2, ν} · SE(ŷ). Avec peu d'échantillons (ν petit), la loi de Student
// donne des intervalles nettement plus larges que la normale — utiliser z=1.96
// sous-estimerait l'incertitude, ce qui est exactement le défaut qu'un outil de
// faisabilité doit éviter.
//
// Aucune dépendance. Testé contre les tables de référence.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quantile de la loi normale centrée réduite (fonction quantile inverse).
 * Algorithme de Peter Acklam — erreur relative < 1.15e-9 sur tout le domaine.
 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  // Coefficients de l'approximation rationnelle d'Acklam.
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Quantile de la loi de Student à ν degrés de liberté, via développement de
 * Cornish-Fisher à partir du quantile normal z. Précision typique < 1 % pour
 * ν ≥ 3, convergeant vers la normale quand ν → ∞. Suffisant pour des intervalles
 * de prédiction d'ingénierie (l'incertitude sur σ domine de toute façon).
 *
 * Réf. : Abramowitz & Stegun 26.7.5.
 */
export function studentTQuantile(p: number, df: number): number {
  if (df <= 0) return NaN;
  if (!Number.isFinite(df) || df > 1e7) return normalQuantile(p);

  const z = normalQuantile(p);
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  const z9 = z7 * z2;

  const g1 = (z3 + z) / 4;
  const g2 = (5 * z5 + 16 * z3 + 3 * z) / 96;
  const g3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / 384;
  const g4 = (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / 92160;

  return z + g1 / df + g2 / (df * df) + g3 / (df ** 3) + g4 / (df ** 4);
}

/**
 * Valeur critique bilatérale t_{1−α/2, ν} pour un niveau de confiance donné
 * (ex. 0.90 → t au quantile 0.95).
 */
export function tCritical(confidence: number, df: number): number {
  const alpha = 1 - confidence;
  return studentTQuantile(1 - alpha / 2, df);
}
