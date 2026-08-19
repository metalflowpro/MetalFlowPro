// ─────────────────────────────────────────────────────────────────────────────
// Optimisation P80 multi-objectifs — Phase 2.
//
// Le module usine (plantP80) choisit UN objectif à la fois. Ici on traite
// plusieurs objectifs conflictuels simultanément (récupération, débit, énergie,
// oz/jour, valeur nette) via :
//   • le front de PARETO (P80 non dominés — aucun autre n'est meilleur partout) ;
//   • un score composite par scalarisation pondérée sur objectifs normalisés.
// Rien en dur : directions et poids sont des données passées par l'appelant.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export type ObjectiveDirection = 'max' | 'min';

export interface ObjectiveSpec<K extends string> {
  key: K;
  direction: ObjectiveDirection;
  /** Poids relatif dans le score composite (défaut 1). */
  weight?: number;
}

/** Poids par défaut d'un arbitrage équilibré — éditables par l'utilisateur. */
export const MULTI_OBJECTIVE_WEIGHTS = {
  recovery: 1,
  throughput: 1,
  ozPerDay: 1,
  netValue: 1,
  energy: 1,
} as const;

export interface ParetoResult<T> {
  /** Éléments non dominés (front de Pareto). */
  front: T[];
  /** Indique pour chaque élément d'entrée s'il est Pareto-optimal. */
  isOptimal: boolean[];
}

/** a domine b si a est ≥ b sur tous les objectifs et > sur au moins un. */
function dominates<K extends string>(
  a: Record<K, number>, b: Record<K, number>, specs: ObjectiveSpec<K>[],
): boolean {
  let strictlyBetter = false;
  for (const s of specs) {
    const av = a[s.key], bv = b[s.key];
    const aBetter = s.direction === 'max' ? av > bv : av < bv;
    const aWorse = s.direction === 'max' ? av < bv : av > bv;
    if (aWorse) return false;
    if (aBetter) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Front de Pareto sur une liste d'éléments décrits par leurs objectifs. */
export function paretoFront<T, K extends string>(
  items: T[], objectives: (t: T) => Record<K, number>, specs: ObjectiveSpec<K>[],
): ParetoResult<T> {
  const vecs = items.map(objectives);
  const isOptimal = items.map((_, i) =>
    !vecs.some((other, j) => j !== i && dominates(other, vecs[i], specs)));
  return { front: items.filter((_, i) => isOptimal[i]), isOptimal };
}

export interface RankedItem<T> { item: T; score: number; }

/**
 * Score composite [0..1] par scalarisation pondérée sur objectifs normalisés
 * min-max (max → plus haut = mieux ; min → inversé). Renvoie les éléments triés
 * du meilleur au moins bon ; le premier est la recommandation multi-objectifs.
 */
export function weightedRanking<T, K extends string>(
  items: T[], objectives: (t: T) => Record<K, number>, specs: ObjectiveSpec<K>[],
): RankedItem<T>[] {
  if (items.length === 0) return [];
  const vecs = items.map(objectives);
  const norm: Record<string, (v: number) => number> = {};
  for (const s of specs) {
    const vals = vecs.map(v => v[s.key]);
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
    norm[s.key] = span > 0
      ? (v: number) => { const t = (v - min) / span; return s.direction === 'max' ? t : 1 - t; }
      : () => 0.5; // objectif constant → neutre
  }
  const totalWeight = specs.reduce((a, s) => a + (s.weight ?? 1), 0) || 1;
  const ranked = items.map((item, i) => {
    const v = vecs[i];
    const score = specs.reduce((acc, s) => acc + (s.weight ?? 1) * norm[s.key](v[s.key]), 0) / totalWeight;
    return { item, score };
  });
  return ranked.sort((a, b) => b.score - a.score);
}
