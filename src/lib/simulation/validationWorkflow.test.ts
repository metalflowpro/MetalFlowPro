import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_STATES, STATE_LABEL, stateIndex, allowedTransitions, canTransition,
  requiresNewVersion, canPublish, isPublishingTransition, TRANSITIONS,
  type WorkflowState,
} from './validationWorkflow';

describe('machine à états', () => {
  it('couvre les 8 états du §11 dans l’ordre', () => {
    expect(WORKFLOW_STATES).toHaveLength(8);
    expect(WORKFLOW_STATES[0]).toBe('draft');
    expect(WORKFLOW_STATES[WORKFLOW_STATES.length - 1]).toBe('archived');
    expect(stateIndex('validated')).toBeLessThan(stateIndex('approved'));
  });

  it('a un libellé pour chaque état', () => {
    for (const s of WORKFLOW_STATES) expect(STATE_LABEL[s].length).toBeGreaterThan(0);
  });

  it('les transitions ne pointent que vers des états valides', () => {
    const valid = new Set<WorkflowState>(WORKFLOW_STATES);
    for (const s of WORKFLOW_STATES)
      for (const t of TRANSITIONS[s]) expect(valid.has(t.to)).toBe(true);
  });

  it('archivé est terminal', () => {
    expect(TRANSITIONS.archived).toHaveLength(0);
  });
});

describe('autorisations par rôle', () => {
  it('seul le métallurgiste (ou l’admin) valide depuis la revue', () => {
    expect(canTransition('review', 'validated', 'metallurgist')).toBe(true);
    expect(canTransition('review', 'validated', 'project_admin')).toBe(true);
    expect(canTransition('review', 'validated', 'process_engineer')).toBe(false);
    expect(canTransition('review', 'validated', 'reader')).toBe(false);
  });

  it('seul le responsable étude (ou l’admin) approuve pour étude', () => {
    expect(canTransition('validated', 'approved', 'study_lead')).toBe(true);
    expect(canTransition('validated', 'approved', 'metallurgist')).toBe(false);
  });

  it('le lecteur ne peut effectuer aucune transition', () => {
    for (const s of WORKFLOW_STATES) expect(allowedTransitions(s, 'reader')).toHaveLength(0);
  });

  it('un ingénieur procédé fait avancer le brouillon', () => {
    expect(canTransition('draft', 'configured', 'process_engineer')).toBe(true);
  });
});

describe('règle : un état approuvé ne se modifie pas directement', () => {
  it('approuvé et archivé exigent une nouvelle version', () => {
    expect(requiresNewVersion('approved')).toBe(true);
    expect(requiresNewVersion('archived')).toBe(true);
    expect(requiresNewVersion('draft')).toBe(false);
  });
});

describe('règle : pas de publication sans bilans fermés (§11)', () => {
  const tol = 0.005;
  it('refuse quand le bilan de masse n’est pas fermé', () => {
    const r = canPublish({ massClosureError: 0.02, goldClosureError: 0, tolerance: tol });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/masse/i);
  });
  it('refuse quand le bilan Au n’est pas fermé', () => {
    const r = canPublish({ massClosureError: 0, goldClosureError: 0.01, tolerance: tol });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Au/);
  });
  it('accepte quand les deux bilans sont dans la tolérance', () => {
    expect(canPublish({ massClosureError: 0.001, goldClosureError: 0.002, tolerance: tol }).ok).toBe(true);
  });
  it('identifie les transitions publiantes', () => {
    expect(isPublishingTransition('validated')).toBe(true);
    expect(isPublishingTransition('approved')).toBe(true);
    expect(isPublishingTransition('review')).toBe(false);
  });
});
