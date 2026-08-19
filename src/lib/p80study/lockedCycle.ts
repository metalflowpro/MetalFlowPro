// ─────────────────────────────────────────────────────────────────────────────
// Locked-cycle test (LCT) — Phase 2.
//
// Un LCT simule un circuit continu en LABO en recyclant les produits
// intermédiaires (middlings) d'un cycle vers le suivant, jusqu'à ce que la
// charge circulante et la récupération se stabilisent. On modélise le régime
// permanent par itération d'un bilan simple par cycle, arrêté quand la
// récupération globale varie sous la tolérance de convergence.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

/** Paramètres de forme du solveur LCT — documentés, éditables (pas en dur). */
export const LOCKED_CYCLE_MODEL = {
  /** Écart de récupération entre deux cycles en deçà duquel on considère convergé (points de %). */
  convergenceTolPct: 0.05,
  /** Nombre maximal de cycles simulés (garde-fou anti-boucle). */
  maxCycles: 30,
} as const;

export interface LockedCycleInputs {
  /** Masse d'alimentation fraîche par cycle. */
  freshFeedMass: number;
  /** Teneur de l'alimentation fraîche (g/t). */
  freshFeedGrade: number;
  /** Récupération d'un seul passage vers le concentré final (%). */
  singlePassRecoveryPct: number;
  /**
   * Fraction de l'or NON récupéré qui repart en middlings recyclés (le reste va
   * au rejet définitif). Représente la charge circulante du circuit.
   */
  recycleFraction: number;
  /** Tolérance de convergence (%) ; défaut LOCKED_CYCLE_MODEL. */
  convergenceTolPct?: number;
  /** Cycles max ; défaut LOCKED_CYCLE_MODEL. */
  maxCycles?: number;
}

export interface LockedCycleResult {
  /** Récupération globale au régime permanent (%). */
  convergedRecoveryPct: number;
  /** Charge circulante au régime permanent (fraction de l'alimentation fraîche). */
  circulatingLoadFraction: number;
  /** Nombre de cycles jusqu'à convergence. */
  cycles: number;
  /** true si la convergence a été atteinte avant maxCycles. */
  converged: boolean;
  /** Série de récupération globale par cycle (%) — pour tracer la convergence. */
  recoverySeriesPct: number[];
}

/**
 * Simule le LCT jusqu'à convergence de la récupération globale.
 *
 * À chaque cycle, l'or traité = or frais + or recyclé (middlings). Une fraction
 * `singlePass` part au concentré ; sur le reste, `recycleFraction` repart en
 * middlings (charge circulante), le solde va au rejet. Au régime permanent, la
 * récupération globale = or au concentré / or frais entrant.
 */
export function solveLockedCycle(inp: LockedCycleInputs): LockedCycleResult {
  const tol = inp.convergenceTolPct ?? LOCKED_CYCLE_MODEL.convergenceTolPct;
  const maxCycles = inp.maxCycles ?? LOCKED_CYCLE_MODEL.maxCycles;
  const sp = Math.max(0, Math.min(100, inp.singlePassRecoveryPct)) / 100;
  const rec = Math.max(0, Math.min(1, inp.recycleFraction));

  const freshGold = inp.freshFeedMass * inp.freshFeedGrade;
  let recycledGold = 0;           // or dans les middlings entrant au cycle courant
  let cumConcGold = 0;            // or cumulé au concentré final
  let cumFreshGold = 0;           // or frais cumulé introduit
  let prevRecovery = 0;
  const recoverySeriesPct: number[] = [];
  let cycles = 0;
  let converged = false;

  for (let i = 0; i < maxCycles; i++) {
    cycles = i + 1;
    const processedGold = freshGold + recycledGold;
    const toConc = processedGold * sp;
    const notRecovered = processedGold - toConc;
    const nextRecycled = notRecovered * rec;      // repart en middlings
    // le solde `notRecovered * (1 - rec)` va au rejet définitif

    cumConcGold += toConc;
    cumFreshGold += freshGold;
    const recovery = cumFreshGold > 0 ? (cumConcGold / cumFreshGold) * 100 : 0;
    recoverySeriesPct.push(recovery);

    if (i > 0 && Math.abs(recovery - prevRecovery) < tol) { converged = true; recycledGold = nextRecycled; break; }
    prevRecovery = recovery;
    recycledGold = nextRecycled;
  }

  return {
    convergedRecoveryPct: recoverySeriesPct[recoverySeriesPct.length - 1] ?? 0,
    circulatingLoadFraction: freshGold > 0 ? recycledGold / freshGold : 0,
    cycles,
    converged,
    recoverySeriesPct,
  };
}
