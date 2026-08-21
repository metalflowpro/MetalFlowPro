// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation modèle ↔ usine (SCADA/DCS) — module PUR (aucun React/DB).
//
// Phase 7 du CdC : confronter les valeurs SIMULÉES aux mesures USINE (historian,
// SCADA/DCS) pour quantifier l'écart, signaler les dérives et noter l'accord
// global. Ce n'est pas de la réconciliation de données complète (pas d'ajustement
// sous contrainte de bilan global) : c'est la comparaison tag-à-tag qu'un
// métallurgiste fait pour valider un modèle contre le terrain, plus la fermeture
// de bilan de masse quand les débits entrée/sortie sont fournis.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconTag {
  name: string;
  /** Valeur prédite par le simulateur. */
  simulated: number;
  /** Valeur mesurée à l'usine. */
  measured: number;
  /** Poids relatif dans le score (défaut 1). */
  weight?: number;
  unit?: string;
}

export interface ReconTagResult extends ReconTag {
  /** Écart absolu mesuré − simulé. */
  biasAbs: number;
  /** Écart relatif (%) rapporté à la mesure. */
  biasPct: number;
  withinTolerance: boolean;
}

export interface ReconciliationResult {
  tags: ReconTagResult[];
  /** Biais relatif absolu moyen pondéré (%). */
  overallBiasPct: number;
  /** Note d'accord 0–100 (100 = accord parfait). */
  score: number;
  withinToleranceCount: number;
  /** Fermeture du bilan de masse (fraction) quand massIn/massOut fournis, sinon null. */
  massBalanceClosureError: number | null;
}

export const RECON_CONFIG = {
  /** Tolérance par défaut sur l'écart relatif d'un tag (%). */
  defaultTolerancePct: 5,
} as const;

/**
 * Réconcilie une liste de tags (simulé vs mesuré). Calcule pour chacun l'écart
 * relatif et le drapeau de tolérance, puis un biais moyen pondéré et une note
 * d'accord. Fournir `massIn`/`massOut` pour évaluer la fermeture du bilan.
 */
export function reconcile(
  tags: ReconTag[],
  opts: { tolerancePct?: number; massIn?: number; massOut?: number } = {},
): ReconciliationResult {
  const tol = opts.tolerancePct ?? RECON_CONFIG.defaultTolerancePct;
  const results: ReconTagResult[] = tags.map(t => {
    const biasAbs = t.measured - t.simulated;
    const denom = Math.abs(t.measured) > 1e-9 ? Math.abs(t.measured) : Math.max(Math.abs(t.simulated), 1e-9);
    const biasPct = (biasAbs / denom) * 100;
    return { ...t, biasAbs, biasPct, withinTolerance: Math.abs(biasPct) <= tol };
  });

  const totalWeight = results.reduce((a, r) => a + (r.weight ?? 1), 0);
  const overallBiasPct = totalWeight > 0
    ? results.reduce((a, r) => a + Math.abs(r.biasPct) * (r.weight ?? 1), 0) / totalWeight
    : 0;
  const score = Math.max(0, Math.min(100, 100 - overallBiasPct));
  const withinToleranceCount = results.filter(r => r.withinTolerance).length;

  let massBalanceClosureError: number | null = null;
  if (opts.massIn != null && opts.massOut != null && Math.abs(opts.massIn) > 1e-9) {
    massBalanceClosureError = Math.abs(opts.massIn - opts.massOut) / Math.abs(opts.massIn);
  }

  return { tags: results, overallBiasPct, score, withinToleranceCount, massBalanceClosureError };
}
