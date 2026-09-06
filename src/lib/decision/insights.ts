import type { Page } from '../../types';

export type InsightSeverity = 'critical' | 'warning' | 'opportunity' | 'info';

export interface DecisionInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  action: string;
  page: Page;
}

export interface DecisionInsightInput {
  readinessPct: number;
  aiscUsdOz: number | null;
  goldPriceUsdOz: number;
  effectiveRecoveryPct: number;
  missingParams: string[];
  moduleCounts: Record<string, number>;
  domainImputedCount: number;
  recoveryNotAlignedOn48h: string | null;
  routeDowngrade: boolean;
  bestGainPts: number | null;
}

const ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  info: 3,
};

/**
 * Builds short, explainable recommendations from already computed project
 * metrics. This deliberately contains no AI or hidden scoring: every insight
 * is reproducible from the dashboard values and can be cited in a report.
 */
export function buildDecisionInsights(input: DecisionInsightInput): DecisionInsight[] {
  const insights: DecisionInsight[] = [];
  const add = (insight: DecisionInsight) => insights.push(insight);

  if (input.aiscUsdOz != null && input.aiscUsdOz >= input.goldPriceUsdOz) {
    add({
      id: 'economics-aisc-above-price', severity: 'critical',
      title: 'AISC supérieur au prix de l’or',
      detail: `L’AISC estimé (${Math.round(input.aiscUsdOz)} $/oz) dépasse le prix de référence (${Math.round(input.goldPriceUsdOz)} $/oz).`,
      action: 'Revoir le modèle économique', page: 'economics',
    });
  } else if (input.aiscUsdOz != null && input.aiscUsdOz >= input.goldPriceUsdOz * 0.8) {
    add({
      id: 'economics-aisc-close-to-price', severity: 'warning',
      title: 'Marge économique fragile',
      detail: `L’AISC consomme ${Math.round((input.aiscUsdOz / input.goldPriceUsdOz) * 100)} % du prix de l’or.`,
      action: 'Lancer une sensibilité', page: 'economics',
    });
  }

  if (input.effectiveRecoveryPct < 70) {
    add({
      id: 'metallurgy-low-recovery', severity: 'warning',
      title: 'Récupération métallurgique faible',
      detail: `La récupération effective est de ${input.effectiveRecoveryPct.toFixed(1)} %. Identifiez les domaines ou étapes qui détruisent la valeur.`,
      action: 'Analyser la géométallurgie', page: 'geomet',
    });
  }

  if (input.recoveryNotAlignedOn48h) {
    add({
      id: 'metallurgy-duration-gap', severity: 'warning',
      title: 'Test de lixiviation non aligné',
      detail: `La récupération repose sur ${input.recoveryNotAlignedOn48h} au lieu de la durée finale de conception (48 h).`,
      action: 'Compléter les essais LIMS', page: 'lims',
    });
  }

  if (input.routeDowngrade) {
    add({
      id: 'metallurgy-route-downgrade', severity: 'info',
      title: 'Route procédé dégradée par les données disponibles',
      detail: 'La route active ne bénéficie pas de la meilleure couverture d’essais actuellement disponible.',
      action: 'Comparer les routes', page: 'analytics',
    });
  }

  if (input.domainImputedCount > 0) {
    add({
      id: 'geomet-imputed-domains', severity: 'warning',
      title: 'Domaines géométallurgiques imputés',
      detail: `${input.domainImputedCount} domaine(s) utilisent une récupération de repli faute d’essais rattachés.`,
      action: 'Caractériser les domaines', page: 'geomet',
    });
  }

  if (input.missingParams.length > 0) {
    add({
      id: 'project-missing-parameters', severity: 'warning',
      title: 'Hypothèses de projet incomplètes',
      detail: `${input.missingParams.length} paramètre(s) bloquent une lecture complète : ${input.missingParams.join(', ')}.`,
      action: 'Configurer les hypothèses', page: 'criteria',
    });
  }

  const missingData = [
    ['lims', 'LIMS / essais', 'lims'],
    ['blockmodel', 'Block Model', 'blockmodel'],
    ['flowsheet', 'flowsheet', 'flowsheet'],
    ['economics', 'économie', 'economics'],
  ].filter(([id]) => (input.moduleCounts[id] ?? 0) === 0);
  if (missingData.length > 0 && input.readinessPct < 85) {
    const [id, label, page] = missingData[0];
    add({
      id: `pipeline-missing-${id}`, severity: input.readinessPct < 30 ? 'critical' : 'info',
      title: `Pipeline incomplet : ${label}`,
      detail: `Le module ${label} ne contient pas encore de données pour alimenter les calculs aval.`,
      action: `Ouvrir ${label}`, page: page as Page,
    });
  }

  if (input.bestGainPts != null && input.bestGainPts >= 2) {
    add({
      id: 'metallurgy-route-opportunity', severity: 'opportunity',
      title: 'Opportunité de récupération détectée',
      detail: `Une route soutenue par les essais présente un potentiel de +${input.bestGainPts.toFixed(1)} points de récupération.`,
      action: 'Évaluer la route candidate', page: 'analytics',
    });
  }

  if (input.readinessPct >= 85 && insights.length === 0) {
    add({
      id: 'project-ready-for-review', severity: 'info',
      title: 'Projet prêt pour une revue technique',
      detail: 'Les données principales sont présentes et aucun signal critique n’a été détecté par le tableau de bord.',
      action: 'Ouvrir les Stage-Gates', page: 'stagegates',
    });
  }

  return insights.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
