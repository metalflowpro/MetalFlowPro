import { describe, expect, it } from 'vitest';
import { assessGateReadiness } from './readiness';

describe('assessGateReadiness', () => {
  it('marks a complete, evidenced gate ready', () => {
    const result = assessGateReadiness({ checklistPct: 100, moduleCounts: { lims: 10, economics: 3 }, requiredModules: ['lims', 'economics'], resourceQuality: 'pass', criticalOpenRisks: 0 });
    expect(result.status).toBe('ready');
    expect(result.score).toBe(100);
    expect(result.blockers).toEqual([]);
  });

  it('blocks a gate on critical quality or risk signals', () => {
    const result = assessGateReadiness({ checklistPct: 90, moduleCounts: { lims: 1 }, requiredModules: ['lims', 'resource'], resourceQuality: 'fail', criticalOpenRisks: 1 });
    expect(result.status).toBe('blocked');
    expect(result.blockers).toEqual(['Quality Gate ressource en échec', '1 risque(s) critique(s) ouvert(s)']);
  });

  it('keeps the score bounded and proposes actions for missing evidence', () => {
    const result = assessGateReadiness({ checklistPct: -10, moduleCounts: {}, requiredModules: ['lims'], resourceQuality: 'unknown', criticalOpenRisks: 0 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.actions.length).toBeGreaterThan(0);
  });
});

