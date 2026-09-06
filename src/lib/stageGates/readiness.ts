export type ReadinessStatus = 'ready' | 'attention' | 'blocked';

export interface GateReadinessInput {
  checklistPct: number;
  moduleCounts: Record<string, number>;
  requiredModules: string[];
  resourceQuality: 'pass' | 'warn' | 'fail' | 'unknown';
  criticalOpenRisks: number;
}

export interface GateReadiness {
  score: number;
  status: ReadinessStatus;
  moduleCoveragePct: number;
  blockers: string[];
  actions: string[];
}

/** Calculates an explainable, non-authoritative readiness signal for a gate. */
export function assessGateReadiness(input: GateReadinessInput): GateReadiness {
  const checklistPct = Math.max(0, Math.min(100, input.checklistPct));
  const moduleCoveragePct = input.requiredModules.length === 0 ? 100 : Math.round(
    (input.requiredModules.filter(module => (input.moduleCounts[module] ?? 0) > 0).length / input.requiredModules.length) * 100,
  );
  const qualityScore = input.resourceQuality === 'pass' ? 100 : input.resourceQuality === 'warn' ? 60 : input.resourceQuality === 'fail' ? 0 : 50;
  const riskScore = input.criticalOpenRisks === 0 ? 100 : Math.max(0, 100 - input.criticalOpenRisks * 25);
  const score = Math.round(checklistPct * 0.6 + moduleCoveragePct * 0.25 + qualityScore * 0.1 + riskScore * 0.05);

  const blockers: string[] = [];
  const actions: string[] = [];
  if (checklistPct < 100) actions.push(`Compléter la checklist (${100 - checklistPct}% restant)`);
  if (moduleCoveragePct < 100) actions.push(`Alimenter les modules requis (${100 - moduleCoveragePct}% manquant)`);
  if (input.resourceQuality === 'fail') blockers.push('Quality Gate ressource en échec');
  if (input.resourceQuality === 'warn') actions.push('Résoudre les alertes de qualité ressource');
  if (input.criticalOpenRisks > 0) blockers.push(`${input.criticalOpenRisks} risque(s) critique(s) ouvert(s)`);
  if (score < 50) actions.push('Organiser une revue de décision avant le passage de porte');

  const status: ReadinessStatus = blockers.length > 0 ? 'blocked' : score >= 80 ? 'ready' : 'attention';
  return { score, status, moduleCoveragePct, blockers, actions };
}

