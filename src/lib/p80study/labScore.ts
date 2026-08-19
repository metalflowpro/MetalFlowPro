// ─────────────────────────────────────────────────────────────────────────────
// Score P80 laboratoire — module d'étude P80.
//
// Spec §5 : score configurable
//   S_lab = w_R·R − w_C·C_réactifs − w_E·E − w_F·F
// où R = récupération (%), C = consommation de réactifs, E = énergie de broyage,
// F = effet négatif des fines. Les POIDS sont définis par l'utilisateur.
//
// La spec insiste : la recommandation doit montrer POURQUOI un P80 est retenu,
// pas seulement le score → `scoreP80Candidate` renvoie la contribution de chaque
// terme, et les métriques brutes sont d'abord NORMALISÉES sur l'ensemble des
// candidats pour que des poids « lisibles » (tous ~1) restent comparables entre
// grandeurs d'unités différentes.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Poids par défaut du score labo. Éditables par le métallurgiste dans l'UI — ce
 * ne sont pas des lois : ils encodent l'arbitrage relatif du site entre gagner
 * de la récupération et payer réactifs/énergie/pénalité de fines. Groupés et
 * documentés ici plutôt qu'en dur dans la page.
 *
 * Convention : R est un bénéfice (poids positif), les trois autres sont des coûts
 * (soustraits). La récupération domine par défaut car sa valeur économique éclipse
 * généralement le kWh et le kg de réactif marginaux.
 */
export interface LabScoreWeights {
  recovery: number;
  reagent: number;
  energy: number;
  fines: number;
}

export const LAB_SCORE_WEIGHTS: LabScoreWeights = {
  recovery: 1.0,
  reagent: 0.3,
  energy: 0.3,
  fines: 0.2,
};

export interface P80Candidate {
  p80Um: number;
  /** Récupération (%). */
  recoveryPct: number;
  /** Consommation de réactifs (kg/t p.ex.). */
  reagent: number;
  /** Énergie de broyage (kWh/t). */
  energyKwhT: number;
  /**
   * Effet négatif des fines (indice ≥ 0 ; plus haut = pire). Quand il n'est pas
   * mesuré, l'appelant peut le dériver d'une pénalité au-delà d'un seuil de finesse
   * (voir DEFAULT_OVERGRIND dans p80Optimization) — ce module n'en impose aucun.
   */
  finesPenalty: number;
}

export interface ScoredCandidate extends P80Candidate {
  score: number;
  /** Contribution (déjà signée) de chaque terme au score total — explicabilité. */
  contributions: { recovery: number; reagent: number; energy: number; fines: number };
}

export interface LabScoreResult {
  scored: ScoredCandidate[];
  /** Candidat au score maximal — le P80 labo recommandé. */
  best: ScoredCandidate | null;
  weights: LabScoreWeights;
}

/** Min-max sur une clé numérique ; renvoie une fonction de normalisation [0,1]. */
function normaliser(values: number[]): (v: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  // Tout égal (un seul candidat, ou métrique constante) → contribution neutre 0,
  // pour ne pas fabriquer un écart artificiel.
  if (!(span > 0)) return () => 0;
  return (v: number) => (v - min) / span;
}

/**
 * Note chaque candidat P80 par le score pondéré, sur des métriques normalisées
 * min-max entre candidats. Le meilleur score = P80 labo recommandé.
 */
export function scoreLabP80(
  candidates: P80Candidate[],
  weights: LabScoreWeights = LAB_SCORE_WEIGHTS,
): LabScoreResult {
  if (candidates.length === 0) return { scored: [], best: null, weights };

  const nRec = normaliser(candidates.map(c => c.recoveryPct));
  const nRea = normaliser(candidates.map(c => c.reagent));
  const nEne = normaliser(candidates.map(c => c.energyKwhT));
  const nFin = normaliser(candidates.map(c => c.finesPenalty));

  const scored: ScoredCandidate[] = candidates.map(c => {
    const contributions = {
      recovery: weights.recovery * nRec(c.recoveryPct),
      reagent: -weights.reagent * nRea(c.reagent),
      energy: -weights.energy * nEne(c.energyKwhT),
      fines: -weights.fines * nFin(c.finesPenalty),
    };
    const score =
      contributions.recovery + contributions.reagent + contributions.energy + contributions.fines;
    return { ...c, score, contributions };
  });

  const best = scored.reduce((b, c) => (c.score > b.score ? c : b), scored[0]);
  return { scored, best, weights };
}
