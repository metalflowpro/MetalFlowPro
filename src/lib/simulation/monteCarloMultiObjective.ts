// ─────────────────────────────────────────────────────────────────────────────
// Monte-Carlo multi-objectifs — module PUR (aucun React/DB).
//
// Phase 7 du CdC : combiner l'incertitude (Monte-Carlo) et le compromis
// multi-objectifs (front de Pareto), tous deux déjà présents dans le module.
// Pour chaque scénario, on propage l'incertitude des entrées à travers CHAQUE
// objectif (distribution de récupération, d'énergie, d'oz/j…), puis on construit
// deux fronts de Pareto :
//   • MÉDIAN — sur la valeur P50 de chaque objectif (le cas central) ;
//   • ROBUSTE — sur la valeur conservatrice (P10 si on maximise, P90 si on
//     minimise) : ce qu'on obtient « au pire » 9 fois sur 10, pour une décision
//     averse au risque.
//
// Réutilise `runMonteCarlo` et `buildParetoFront` — aucune nouvelle mathématique.
// ─────────────────────────────────────────────────────────────────────────────

import { runMonteCarlo, type Distribution, type MonteCarloResult } from './monteCarlo';
import { buildParetoFront, type ObjectiveSpec, type Candidate, type ParetoResult } from './pareto';

export interface MCObjective extends ObjectiveSpec {
  /** Modèle : d'un tirage des entrées → valeur de l'objectif pour ce scénario. */
  model: (draws: Record<string, number>) => number;
}

export interface MCScenario {
  id: string;
  label: string;
  /** Distributions d'entrée incertaines propres au scénario. */
  inputs: { name: string; dist: Distribution }[];
}

export interface MCScenarioResult {
  id: string;
  label: string;
  /** Distribution complète par objectif. */
  objectives: Record<string, MonteCarloResult>;
  /** Médiane (P50) par objectif — base du front médian. */
  medians: Record<string, number>;
  /** Valeur robuste par objectif (P10 si maximize, P90 si minimize). */
  robust: Record<string, number>;
}

export interface MCMultiObjectiveResult {
  scenarios: MCScenarioResult[];
  /** Front de Pareto sur les médianes (cas central). */
  paretoMedian: ParetoResult;
  /** Front de Pareto sur les valeurs robustes (aversion au risque). */
  paretoRobust: ParetoResult;
}

export const MC_MULTIOBJ_CONFIG = {
  defaultIterations: 2000,
} as const;

/** Valeur conservatrice d'un objectif selon sa direction. */
function robustValue(mc: MonteCarloResult, direction: ObjectiveSpec['direction']): number {
  // On maximise → on se protège du bas de la distribution (P10) ; on minimise →
  // on se protège du haut (P90).
  return direction === 'maximize' ? mc.p10 : mc.p90;
}

/**
 * Propage l'incertitude à travers chaque objectif de chaque scénario, puis
 * construit les fronts médian et robuste. Les objectifs sans modèle exploitable
 * sont ignorés par `buildParetoFront` (qui ne garde que les objectifs présents).
 */
export function runMultiObjectiveMC(
  scenarios: MCScenario[],
  objectives: MCObjective[],
  iterations: number = MC_MULTIOBJ_CONFIG.defaultIterations,
): MCMultiObjectiveResult {
  const specs: ObjectiveSpec[] = objectives.map(o => ({ key: o.key, label: o.label, unit: o.unit, direction: o.direction }));

  const results: MCScenarioResult[] = scenarios.map(sc => {
    const objResults: Record<string, MonteCarloResult> = {};
    const medians: Record<string, number> = {};
    const robust: Record<string, number> = {};
    for (const obj of objectives) {
      const mc = runMonteCarlo(sc.inputs, obj.model, iterations);
      objResults[obj.key] = mc;
      medians[obj.key] = mc.p50;
      robust[obj.key] = robustValue(mc, obj.direction);
    }
    return { id: sc.id, label: sc.label, objectives: objResults, medians, robust };
  });

  const medianCandidates: Candidate[] = results.map(r => ({ id: r.id, label: r.label, objectives: r.medians }));
  const robustCandidates: Candidate[] = results.map(r => ({ id: r.id, label: r.label, objectives: r.robust }));

  return {
    scenarios: results,
    paretoMedian: buildParetoFront(medianCandidates, specs),
    paretoRobust: buildParetoFront(robustCandidates, specs),
  };
}
