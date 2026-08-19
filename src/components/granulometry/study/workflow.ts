// Workflow de statuts de l'étude P80 (spec §8) : ordre, libellés, et progression.
// Source unique consommée par le stepper et les garde-fous de la page.

import type { StudyStatus } from '../../../lib/db/p80Study';

export interface WorkflowStep {
  status: StudyStatus;
  label: string;
  /** Libellé court de l'onglet/étape. */
  short: string;
}

/** Les 6 sous-modules alignés sur la chaîne de statuts de la spec. */
export const WORKFLOW_STEPS: WorkflowStep[] = [
  { status: 'draft',                   label: 'Configuration du projet',        short: 'Configuration' },
  { status: 'samples_selected',        label: 'Sélection des échantillons',     short: 'Échantillons' },
  { status: 'plan_approved',           label: "Plan d'essais",                   short: "Plan d'essais" },
  { status: 'results_imported',        label: 'Résultats & calculs',            short: 'Résultats' },
  { status: 'computed',                label: 'Optimisation P80',               short: 'Optimisation' },
  { status: 'recommendation_approved', label: 'Rapport & approbation',          short: 'Rapport' },
];

/** Rang d'un statut dans la chaîne (pour comparer l'avancement). */
export function statusRank(status: StudyStatus): number {
  const order: StudyStatus[] = [
    'draft', 'samples_selected', 'plan_approved', 'results_imported',
    'qc', 'computed', 'reviewed', 'recommendation_approved', 'published',
  ];
  const i = order.indexOf(status);
  return i < 0 ? 0 : i;
}

/** true si l'étude a atteint (ou dépassé) le statut d'une étape donnée. */
export function hasReached(current: StudyStatus, target: StudyStatus): boolean {
  return statusRank(current) >= statusRank(target);
}
