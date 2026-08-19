// Agrégations partagées entre l'étape Optimisation et l'étape Rapport, pour que
// le P80 labo recommandé et sa justification soient calculés d'UNE seule façon.

import { DEFAULT_OVERGRIND } from '../../../lib/geomet/p80Optimization';
import { scoreLabP80, type P80Candidate, type LabScoreWeights, type LabScoreResult } from '../../../lib/p80study/labScore';
import type { P80TestResult } from '../../../lib/db/p80Study';

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Pénalité de fines dérivée du sur-broyage sous le seuil (paramétrable via DEFAULT_OVERGRIND). */
export function finesPenaltyAtP80(p80Um: number): number {
  return Math.max(0, DEFAULT_OVERGRIND.thresholdUm - p80Um) * DEFAULT_OVERGRIND.penaltyPctPerUm;
}

/**
 * Un candidat P80 par P80 cible, agrégeant les résultats conformes/à revoir
 * (jamais les non conformes = extrapolation refusée). Récupération = recalculée
 * par bilan si disponible, sinon rapportée. Énergie/réactifs moyennés.
 */
export function buildLabCandidates(results: P80TestResult[]): P80Candidate[] {
  const usable = results.filter(r => r.qc_status !== 'non_conforme');
  const byTarget = new Map<number, P80TestResult[]>();
  for (const r of usable) {
    const key = r.actual_p80 ?? r.computed_p80 ?? r.target_p80;
    if (key == null) continue;
    const bucket = byTarget.get(key) ?? [];
    bucket.push(r);
    byTarget.set(key, bucket);
  }
  const candidates: P80Candidate[] = [];
  for (const [p80Um, rows] of byTarget) {
    const rec = mean(rows.map(r => r.computed_recovery ?? r.au_recovery ?? NaN).filter(Number.isFinite));
    const reagent = mean(rows.map(r => r.reagent_consumption ?? NaN).filter(Number.isFinite));
    const energy = mean(rows.map(r => r.energy_consumption ?? NaN).filter(Number.isFinite));
    if (!Number.isFinite(rec) || rec <= 0) continue;
    candidates.push({
      p80Um,
      recoveryPct: rec,
      reagent: Number.isFinite(reagent) ? reagent : 0,
      energyKwhT: Number.isFinite(energy) ? energy : 0,
      finesPenalty: finesPenaltyAtP80(p80Um),
    });
  }
  return candidates.sort((a, b) => b.p80Um - a.p80Um);
}

export function scoreLab(results: P80TestResult[], weights?: LabScoreWeights): LabScoreResult {
  return scoreLabP80(buildLabCandidates(results), weights);
}
