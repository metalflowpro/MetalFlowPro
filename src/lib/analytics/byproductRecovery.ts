// ─────────────────────────────────────────────────────────────────────────────
// RÉCUPÉRATION DES SOUS-PRODUITS — module PUR.
//
// ── Pourquoi ────────────────────────────────────────────────────────────────
// `project_metals` porte déjà un `recovery_pct` par métal, mais SAISI À LA MAIN :
// rien ne le relie aux essais. Or un sous-produit n'a pas de circuit à lui — il
// suit le métal principal dans le MÊME concentré, la MÊME lixiviation. Sa
// récupération n'est donc pas indépendante : elle se DÉDUIT de celle du métal
// principal.
//
// C'est ainsi que procède un rapport technique. Spanish Mountain PFS 2021,
// §13.5.2 et figure 13-13 :
//
//     Récup. Ag = 0,6897 × Récup. Au − 16,076
//
// L'argent y vaut 38–42 % quand l'or vaut 85–92 %. Ignorer ce sous-produit, comme
// le faisait l'application, revient à jeter une ligne de revenu entière.
//
// ── Ce que le module fait ───────────────────────────────────────────────────
// Il AJUSTE la relation sur les essais appariés du projet (réutilisant
// l'ajusteur de stageRecoveryModel, avec ses métriques de qualité et ses
// garde-fous), puis prédit la récupération du sous-produit à partir de celle du
// métal principal. À défaut d'essais, un ratio configuré par projet sert de
// repli explicite — jamais une valeur devinée.
//
// ── Rien en dur ─────────────────────────────────────────────────────────────
// Aucun coefficient n'est écrit ici : ils sortent des essais de chaque projet,
// ou de sa configuration. Deux gisements donnent deux relations différentes.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import {
  fitStageModel, predictStage,
  STAGE_FIT_SETTINGS, type StageFitSettings, type StageModel, type StagePoint,
} from './stageRecoveryModel';

/** Un essai apparié : les deux métaux mesurés sur le MÊME essai. */
export interface ByproductPoint {
  /** Récupération du métal principal sur cet essai (%). */
  primaryRecoveryPct: number;
  /** Récupération du sous-produit sur le même essai (%). */
  byproductRecoveryPct: number;
}

export interface ByproductModel {
  /** Symbole du métal principal (« Au »). */
  primarySymbol: string;
  /** Symbole du sous-produit (« Ag », « Cu »…). */
  byproductSymbol: string;
  /** Modèle linéaire ajusté : récup. sous-produit = a × récup. principal + b. */
  model: StageModel;
  /** Formule lisible, pour le rapport et la traçabilité 43-101. */
  equation: string;
}

/**
 * Les essais appariés portent des RÉCUPÉRATIONS des deux côtés. L'ajusteur
 * générique attend `{gradeGt, recoveryPct}` : la récupération du métal principal
 * joue ici le rôle de variable explicative. La conversion est explicite pour que
 * personne ne lise « teneur » là où il s'agit d'une récupération.
 */
function toStagePoints(points: ByproductPoint[]): StagePoint[] {
  return points.map(p => ({ gradeGt: p.primaryRecoveryPct, recoveryPct: p.byproductRecoveryPct }));
}

/**
 * Ajuste la relation sous-produit ↔ métal principal sur les essais appariés.
 *
 * Renvoie `null` quand les essais ne la soutiennent pas — effectif insuffisant,
 * récupérations principales toutes identiques, régression dégénérée. On ne
 * fabrique pas une ligne de revenu à partir de deux points.
 */
export function fitByproductRecovery(
  primarySymbol: string,
  byproductSymbol: string,
  points: ByproductPoint[],
  settings: StageFitSettings = { ...STAGE_FIT_SETTINGS },
): ByproductModel | null {
  const model = fitStageModel(toStagePoints(points), 'linear', settings);
  if (!model) return null;
  const sign = model.b >= 0 ? '+' : '−';
  return {
    primarySymbol, byproductSymbol, model,
    equation:
      `Récup. ${byproductSymbol} = ${model.a.toFixed(4)} × Récup. ${primarySymbol} ` +
      `${sign} ${Math.abs(model.b).toFixed(4)}`,
  };
}

export interface ByproductPrediction {
  recoveryPct: number;
  /** Vrai si la récupération principale sortait de la plage des essais. */
  extrapolated: boolean;
  /** D'où vient le chiffre — indispensable dans un rapport. */
  basis: string;
}

/**
 * Récupération du sous-produit déduite de celle du métal principal.
 *
 * Bornée à [0, 100] et à la plage couverte par les essais : une droite ajustée
 * sur des récupérations d'or de 80–95 % n'a rien à dire à 20 %. Une relation à
 * ordonnée négative — cas fréquent, et celui du PFS — donnerait sinon une
 * récupération négative en extrapolant vers le bas.
 */
export function predictByproductRecovery(
  bp: ByproductModel,
  primaryRecoveryPct: number,
): ByproductPrediction | null {
  if (!Number.isFinite(primaryRecoveryPct) || primaryRecoveryPct < 0) return null;
  const m = bp.model;
  const used = Math.min(m.maxGradeGt, Math.max(m.minGradeGt, primaryRecoveryPct));
  const raw = predictStage(m, used);
  if (!Number.isFinite(raw)) return null;
  const recoveryPct = Math.min(100, Math.max(0, raw));
  const extrapolated = used !== primaryRecoveryPct;
  return {
    recoveryPct,
    extrapolated,
    basis:
      `${bp.equation} → ${recoveryPct.toFixed(1)} % à ${used.toFixed(1)} % de récup. ${bp.primarySymbol} ` +
      `(n = ${m.n}, R² = ${m.rSquared.toFixed(3)})` +
      (extrapolated
        ? ` · récup. ${bp.primarySymbol} ${primaryRecoveryPct.toFixed(1)} % hors plage d'ajustement ` +
          `${m.minGradeGt.toFixed(1)}–${m.maxGradeGt.toFixed(1)} %, bornée`
        : ''),
  };
}

/**
 * Repli documenté quand aucun essai apparié n'existe : un RATIO configuré par
 * projet (récup. sous-produit / récup. principal). Explicite et traçable, à la
 * différence d'un chiffre saisi sans justification.
 */
export function byproductFromRatio(
  primarySymbol: string,
  byproductSymbol: string,
  primaryRecoveryPct: number,
  ratio: number,
): ByproductPrediction | null {
  if (!Number.isFinite(primaryRecoveryPct) || !Number.isFinite(ratio) || ratio < 0) return null;
  const recoveryPct = Math.min(100, Math.max(0, primaryRecoveryPct * ratio));
  return {
    recoveryPct,
    extrapolated: false,
    basis:
      `Ratio configuré ${byproductSymbol}/${primarySymbol} = ${ratio.toFixed(3)} ` +
      `→ ${recoveryPct.toFixed(1)} % (aucun essai apparié ; à remplacer par une régression dès que possible)`,
  };
}
