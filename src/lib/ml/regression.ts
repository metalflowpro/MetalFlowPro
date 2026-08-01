// ─────────────────────────────────────────────────────────────────────────────
// Régression linéaire multivariée — module PUR (vraie intelligence, pas scoring).
//
// Ajuste un modèle ŷ = β₀ + Σ βⱼ·xⱼ par moindres carrés (équations normales),
// avec option de régularisation ridge (L2) pour les variables colinéaires. Sur
// des jeux métallurgiques réels, la récupération n'est pas une fonction fermée
// d'une seule variable : elle dépend conjointement de la teneur, du P80, du BWi,
// des sulfures, de l'argile… Un modèle ajusté sur les données mesurées remplace
// les corrélations déterministes figées, et — surtout — chiffre son incertitude.
//
// Fournit : coefficients, R²/R² ajusté, RMSE, erreur-type résiduelle, et un
// `predict()` renvoyant l'estimation ponctuelle AVEC intervalle de prédiction
// (loi de Student, ν = n − p − 1). Aucune dépendance externe. Entièrement testé.
// ─────────────────────────────────────────────────────────────────────────────

import { transpose, matMul, matVec, solve, inverse, type Matrix } from './linalg';
import { tCritical } from './distributions';

export interface Prediction {
  /** Estimation ponctuelle ŷ. */
  value: number;
  /** Borne basse de l'intervalle de prédiction. */
  lower: number;
  /** Borne haute de l'intervalle de prédiction. */
  upper: number;
  /** Niveau de confiance de l'intervalle (ex. 0.90). */
  confidence: number;
}

export interface RegressionModel {
  /** Ordonnée à l'origine (dans l'espace des variables brutes). */
  intercept: number;
  /** Coefficients par variable (espace brut) — même ordre que les colonnes X. */
  coefficients: number[];
  /** Coefficient de détermination R² (0–1). */
  r2: number;
  /** R² ajusté du nombre de variables (pénalise le sur-ajustement). */
  adjustedR2: number;
  /** Racine de l'erreur quadratique moyenne (unités de y). */
  rmse: number;
  /** Erreur-type résiduelle s = √(SSE / (n − p − 1)). */
  residualStdError: number;
  /** Nombre d'observations utilisées. */
  n: number;
  /** Nombre de variables explicatives. */
  p: number;
  /** Ridge λ effectivement appliqué (0 si OLS pur). */
  ridge: number;
  /** Prédiction ponctuelle + intervalle pour un nouveau vecteur de variables. */
  predict: (x: number[], confidence?: number) => Prediction;
}

export interface FitOptions {
  /**
   * Régularisation ridge (λ ≥ 0) sur les coefficients standardisés. 0 = OLS pur.
   * Si les équations normales sont singulières (colinéarité parfaite), un ridge
   * minimal est appliqué automatiquement et reporté dans `model.ridge`.
   */
  ridge?: number;
  /** Niveau de confiance par défaut des intervalles de prédiction. Défaut 0.90. */
  confidence?: number;
}

function mean(v: number[]): number {
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function std(v: number[], mu: number): number {
  if (v.length < 2) return 0;
  const variance = v.reduce((s, x) => s + (x - mu) ** 2, 0) / (v.length - 1);
  return Math.sqrt(variance);
}

/**
 * Ajuste une régression linéaire multivariée.
 *
 * @param X  matrice n×p des variables explicatives (brutes, sans colonne de 1).
 * @param y  vecteur cible de longueur n.
 *
 * Les variables sont centrées-réduites en interne (stabilité numérique et ridge
 * invariant d'échelle) ; les coefficients renvoyés sont ramenés à l'espace brut.
 * Renvoie `null` si les données sont insuffisantes (n ≤ p + 1) — on ne peut pas
 * estimer l'incertitude résiduelle sans au moins un degré de liberté.
 */
export function fitRegression(X: Matrix, y: number[], options: FitOptions = {}): RegressionModel | null {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n === 0 || p === 0 || y.length !== n) return null;
  if (n < p + 2) return null; // besoin de ν = n − p − 1 ≥ 1 pour l'incertitude
  const defaultConfidence = options.confidence ?? 0.90;

  // Standardisation des colonnes de X (μ, σ). σ = 0 (colonne constante) → σ = 1
  // pour éviter la division ; sa version standardisée reste nulle (contribution
  // portée par l'ordonnée à l'origine).
  const means: number[] = [];
  const stds: number[] = [];
  for (let j = 0; j < p; j++) {
    const col = X.map(row => row[j]);
    const mu = mean(col);
    const sd = std(col, mu) || 1;
    means.push(mu);
    stds.push(sd);
  }

  const standardize = (row: number[]): number[] => row.map((v, j) => (v - means[j]) / stds[j]);

  // Matrice de conception D = [1 | X_std] (n × (p+1)).
  const D: Matrix = X.map(row => [1, ...standardize(row)]);
  const Dt = transpose(D);
  const G = matMul(Dt, D); // (p+1)×(p+1)

  // Ridge : pénalise les coefficients standardisés, jamais l'ordonnée (indice 0).
  let ridge = options.ridge ?? 0;
  const applyRidge = (lambda: number) => {
    const Gr = G.map(r => [...r]);
    for (let i = 1; i < Gr.length; i++) Gr[i][i] += lambda;
    return Gr;
  };

  const Dty = matVec(Dt, y);
  let Greg = ridge > 0 ? applyRidge(ridge) : G;
  let beta = solve(Greg, Dty);

  // Repli automatique : si singulière en OLS, appliquer un ridge minimal.
  if (beta == null) {
    ridge = ridge > 0 ? ridge : 1e-6;
    Greg = applyRidge(ridge);
    beta = solve(Greg, Dty);
    if (beta == null) return null;
  }

  const Ginv = inverse(Greg); // pour la variance des prédictions
  if (Ginv == null) return null;

  // Valeurs ajustées et résidus.
  const fitted = matVec(D, beta);
  const yMean = mean(y);
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    sse += (y[i] - fitted[i]) ** 2;
    sst += (y[i] - yMean) ** 2;
  }
  const dof = n - p - 1;
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const adjustedR2 = 1 - (1 - r2) * (n - 1) / dof;
  const rmse = Math.sqrt(sse / n);
  const residualStdError = Math.sqrt(sse / dof);

  // Coefficients dans l'espace brut : β_raw_j = β_std_j / σ_j ;
  // ordonnée = β_std_0 − Σ β_raw_j · μ_j.
  const coefficients = beta.slice(1).map((b, j) => b / stds[j]);
  const intercept = beta[0] - coefficients.reduce((s, b, j) => s + b * means[j], 0);

  const predict = (x: number[], confidence = defaultConfidence): Prediction => {
    const d0 = [1, ...standardize(x)];
    const value = d0.reduce((s, v, j) => s + v * beta![j], 0);
    // Levier h₀ = d₀ᵀ (DᵀD)⁻¹ d₀ ; erreur-type de prédiction = s·√(1 + h₀).
    const Gd = matVec(Ginv, d0);
    const leverage = d0.reduce((s, v, j) => s + v * Gd[j], 0);
    const sePred = residualStdError * Math.sqrt(1 + Math.max(0, leverage));
    const t = tCritical(confidence, dof);
    const half = t * sePred;
    return { value, lower: value - half, upper: value + half, confidence };
  };

  return {
    intercept, coefficients, r2, adjustedR2, rmse, residualStdError,
    n, p, ridge, predict,
  };
}

/**
 * Qualité qualitative d'un ajustement, pour l'affichage produit.
 * Seuils prudents adaptés aux jeux géométallurgiques (souvent bruités).
 */
export function fitQuality(r2: number): { level: 'strong' | 'moderate' | 'weak'; label: string } {
  if (r2 >= 0.75) return { level: 'strong', label: 'Ajustement solide' };
  if (r2 >= 0.4) return { level: 'moderate', label: 'Ajustement modéré' };
  return { level: 'weak', label: 'Ajustement faible — prudence' };
}
