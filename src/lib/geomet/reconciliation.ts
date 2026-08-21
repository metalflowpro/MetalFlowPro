// ─────────────────────────────────────────────────────────────────────────────
// Validation & réconciliation géométallurgique — module PUR.
//
// Boucle prévision → opération → réconciliation (plan §14). On confronte la
// récupération PRÉDITE par domaine à la récupération OBSERVÉE à l'usine (par
// campagne). Un écart ponctuel est du bruit ; un écart systématique (biais
// signé persistant) signale un modèle à recalibrer.
//
// Statistiques standard : écart, biais moyen, MAE, RMSE. Pondération optionnelle
// par le tonnage réconcilié (une campagne de 500 kt pèse plus qu'une de 20 kt).
// Aucune dépendance Supabase/React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import { GEOMET_GOVERNANCE } from '../config/constants';

export type ReconStatus = 'acceptable' | 'review' | 'revise' | 'na';

export interface ReconRow {
  domainName: string;
  /** Récupération prédite par le modèle (%). */
  predicted: number | null;
  /** Récupération observée à l'usine sur la campagne (%). */
  observed: number | null;
  /** Tonnage réconcilié — pondère le biais/RMSE agrégés. */
  tonnage?: number | null;
}

export interface ReconRowResult extends ReconRow {
  /** observed − predicted (points de %). Positif = usine au-dessus du modèle. */
  gap: number | null;
  status: ReconStatus;
}

type GapThresholds = { acceptable: number; review: number };

/**
 * Statut d'une ligne selon l'écart absolu. Au-delà de `review`, le modèle du
 * domaine est jugé à réviser ; entre les deux, à surveiller.
 */
export function reconRowStatus(
  gap: number | null,
  thresholds: GapThresholds = GEOMET_GOVERNANCE.RECON_GAP_PT,
): ReconStatus {
  if (gap == null) return 'na';
  const abs = Math.abs(gap);
  if (abs <= thresholds.acceptable) return 'acceptable';
  if (abs <= thresholds.review) return 'review';
  return 'revise';
}

export function evaluateRows(
  rows: ReconRow[],
  thresholds: GapThresholds = GEOMET_GOVERNANCE.RECON_GAP_PT,
): ReconRowResult[] {
  return rows.map(r => {
    const gap =
      r.predicted != null && r.observed != null ? r.observed - r.predicted : null;
    return { ...r, gap, status: reconRowStatus(gap, thresholds) };
  });
}

export interface ReconSummary {
  /** Nombre de lignes appariées (prédit ET observé présents). */
  n: number;
  /** Biais moyen signé (points), pondéré par le tonnage si disponible. */
  meanBias: number | null;
  /** Erreur absolue moyenne (points). */
  mae: number | null;
  /** Racine de l'erreur quadratique moyenne (points). */
  rmse: number | null;
  /** Pire écart absolu observé et son domaine. */
  worstGap: number | null;
  worstDomain: string | null;
}

/**
 * Agrège les écarts. Le biais est pondéré par le tonnage réconcilié quand il est
 * renseigné sur TOUTES les lignes appariées ; sinon la moyenne est arithmétique
 * (mélanger pondéré et non pondéré fausserait le résultat).
 */
export function reconciliationSummary(rows: ReconRow[]): ReconSummary {
  const paired = evaluateRows(rows).filter(r => r.gap != null);
  const n = paired.length;
  if (n === 0) {
    return { n: 0, meanBias: null, mae: null, rmse: null, worstGap: null, worstDomain: null };
  }

  const useWeights = paired.every(r => (r.tonnage ?? 0) > 0);
  const totalW = useWeights ? paired.reduce((s, r) => s + (r.tonnage ?? 0), 0) : n;
  const w = (r: ReconRowResult) => (useWeights ? (r.tonnage ?? 0) : 1);

  const meanBias = paired.reduce((s, r) => s + (r.gap as number) * w(r), 0) / totalW;
  const mae = paired.reduce((s, r) => s + Math.abs(r.gap as number) * w(r), 0) / totalW;
  const rmse = Math.sqrt(
    paired.reduce((s, r) => s + (r.gap as number) ** 2 * w(r), 0) / totalW,
  );

  let worst = paired[0];
  for (const r of paired) {
    if (Math.abs(r.gap as number) > Math.abs(worst.gap as number)) worst = r;
  }

  return { n, meanBias, mae, rmse, worstGap: worst.gap, worstDomain: worst.domainName };
}

/**
 * Suggestions de correction quand la réconciliation révèle un problème (plan
 * §14). Deux déclencheurs :
 *   • biais systématique agrégé (|biais moyen| > seuil) → recalibration globale ;
 *   • un domaine « à réviser » → actions ciblées sur ce domaine.
 */
export function reconciliationSuggestions(
  rows: ReconRow[],
  systematicBiasPt: number = GEOMET_GOVERNANCE.RECON_SYSTEMATIC_BIAS_PT,
): string[] {
  const results = evaluateRows(rows);
  const summary = reconciliationSummary(rows);
  const out: string[] = [];

  if (summary.meanBias != null && Math.abs(summary.meanBias) >= systematicBiasPt) {
    const dir = summary.meanBias > 0 ? 'sous-estime' : 'surestime';
    out.push(
      `Biais systématique de ${summary.meanBias.toFixed(1)} pt : le modèle ${dir} la récupération usine — recalibrer les coefficients globaux.`,
    );
  }

  for (const r of results) {
    if (r.status === 'revise') {
      out.push(
        `Réviser le modèle du domaine « ${r.domainName} » (écart ${(r.gap as number).toFixed(1)} pt) : ajouter des essais LIMS, vérifier le P80 réel usine, le temps de lixiviation et l'effet du carbone organique.`,
      );
    }
  }

  return out;
}
