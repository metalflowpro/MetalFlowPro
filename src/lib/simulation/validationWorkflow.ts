// ─────────────────────────────────────────────────────────────────────────────
// Workflow de validation & versions — module PUR (aucun React/DB).
//
// Encode la machine à états du §11 et les règles critiques associées. Les états
// et rôles correspondent aux CHECK de la migration sim_flowsheet_versions /
// sim_validations. Séparé de l'UI pour être testable et réutilisable.
// ─────────────────────────────────────────────────────────────────────────────

export const WORKFLOW_STATES = [
  'draft', 'configured', 'ready', 'simulated', 'review', 'validated', 'approved', 'archived',
] as const;
export type WorkflowState = typeof WORKFLOW_STATES[number];

export const STATE_LABEL: Record<WorkflowState, string> = {
  draft: 'Brouillon',
  configured: 'Configuré',
  ready: 'Prêt pour simulation',
  simulated: 'Simulé',
  review: 'À revoir',
  validated: 'Validé par métallurgiste',
  approved: 'Approuvé pour étude',
  archived: 'Archivé',
};

/** Ordre d'avancement pour l'affichage d'une frise. */
export function stateIndex(s: WorkflowState): number {
  return WORKFLOW_STATES.indexOf(s);
}

// ─── Rôles (§11) ──────────────────────────────────────────────────────────────

export type Role =
  | 'project_admin' | 'process_engineer' | 'metallurgist'
  | 'equipment_engineer' | 'study_lead' | 'reader';

export const ROLE_LABEL: Record<Role, string> = {
  project_admin: 'Administrateur projet',
  process_engineer: 'Ingénieur procédé',
  metallurgist: 'Métallurgiste',
  equipment_engineer: 'Ingénieur équipements',
  study_lead: 'Responsable étude',
  reader: 'Lecteur',
};

export interface Transition {
  to: WorkflowState;
  label: string;
  /** Rôles autorisés à effectuer la transition. */
  roles: Role[];
  decision?: 'approve' | 'reject' | 'comment';
}

/**
 * Transitions autorisées depuis chaque état. Le retour « À revoir » ramène en
 * brouillon (rework). Un flowsheet APPROUVÉ ne se modifie pas directement : on
 * en crée une nouvelle VERSION (hors machine à états) — voir requiresNewVersion.
 */
export const TRANSITIONS: Record<WorkflowState, Transition[]> = {
  draft: [{ to: 'configured', label: 'Marquer configuré', roles: ['process_engineer', 'project_admin'] }],
  configured: [
    { to: 'ready', label: 'Prêt pour simulation', roles: ['process_engineer', 'project_admin'] },
    { to: 'draft', label: 'Repasser en brouillon', roles: ['process_engineer', 'project_admin'] },
  ],
  ready: [{ to: 'simulated', label: 'Marquer simulé', roles: ['process_engineer', 'project_admin'] }],
  simulated: [{ to: 'review', label: 'Envoyer en revue', roles: ['process_engineer', 'project_admin'] }],
  review: [
    { to: 'validated', label: 'Valider (métallurgiste)', roles: ['metallurgist', 'project_admin'], decision: 'approve' },
    { to: 'draft', label: 'Renvoyer à revoir', roles: ['metallurgist', 'process_engineer', 'project_admin'], decision: 'reject' },
  ],
  validated: [
    { to: 'approved', label: 'Approuver pour étude', roles: ['study_lead', 'project_admin'], decision: 'approve' },
    { to: 'review', label: 'Rouvrir la revue', roles: ['metallurgist', 'project_admin'] },
  ],
  approved: [{ to: 'archived', label: 'Archiver', roles: ['project_admin'] }],
  archived: [],
};

/** Transitions possibles depuis `state` pour un `role` donné. */
export function allowedTransitions(state: WorkflowState, role: Role): Transition[] {
  return TRANSITIONS[state].filter(t => t.roles.includes(role));
}

/** Une transition from→to est-elle permise pour ce rôle ? */
export function canTransition(from: WorkflowState, to: WorkflowState, role: Role): boolean {
  return allowedTransitions(from, role).some(t => t.to === to);
}

/** Un état approuvé/archivé ne se modifie pas : toute modif crée une nouvelle version. */
export function requiresNewVersion(state: WorkflowState): boolean {
  return state === 'approved' || state === 'archived';
}

// ─── Règles critiques (§11) ───────────────────────────────────────────────────

/**
 * Une simulation ne peut pas être PUBLIÉE (passer en validé/approuvé) si le bilan
 * de masse ou le bilan Au n'est pas fermé dans les tolérances. `closureError` et
 * `tolerance` sont des fractions (ex. 0,002 = 0,2 %).
 */
export function canPublish(opts: {
  massClosureError: number;
  goldClosureError: number;
  tolerance: number;
}): { ok: boolean; reason?: string } {
  if (opts.massClosureError > opts.tolerance) {
    return { ok: false, reason: `Bilan de masse non fermé (${(opts.massClosureError * 100).toFixed(2)} % > ${(opts.tolerance * 100).toFixed(2)} %).` };
  }
  if (opts.goldClosureError > opts.tolerance) {
    return { ok: false, reason: `Bilan Au non fermé (${(opts.goldClosureError * 100).toFixed(2)} % > ${(opts.tolerance * 100).toFixed(2)} %).` };
  }
  return { ok: true };
}

/** Les transitions « publiantes » (celles qui requièrent des bilans fermés). */
export function isPublishingTransition(to: WorkflowState): boolean {
  return to === 'validated' || to === 'approved';
}
