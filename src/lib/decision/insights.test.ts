import { describe, expect, it } from 'vitest';
import { buildDecisionInsights } from './insights';

const base = {
  readinessPct: 90,
  aiscUsdOz: 700,
  goldPriceUsdOz: 2000,
  effectiveRecoveryPct: 85,
  missingParams: [],
  moduleCounts: { lims: 4, blockmodel: 4, flowsheet: 4, economics: 4 },
  domainImputedCount: 0,
  recoveryNotAlignedOn48h: null,
  routeDowngrade: false,
  bestGainPts: null,
};

describe('buildDecisionInsights', () => {
  it('prioritizes critical economics before opportunities', () => {
    const result = buildDecisionInsights({ ...base, aiscUsdOz: 2100, bestGainPts: 3 });
    expect(result[0].severity).toBe('critical');
    expect(result.some(i => i.id === 'metallurgy-route-opportunity')).toBe(true);
  });

  it('explains missing and imputed data with actionable destinations', () => {
    const result = buildDecisionInsights({
      ...base,
      readinessPct: 25,
      moduleCounts: { lims: 0, blockmodel: 0, flowsheet: 0, economics: 0 },
      missingParams: ['Lignes CAPEX'],
      domainImputedCount: 2,
    });
    expect(result.find(i => i.id === 'pipeline-missing-lims')?.page).toBe('lims');
    expect(result.find(i => i.id === 'geomet-imputed-domains')?.severity).toBe('warning');
    expect(result.find(i => i.id === 'project-missing-parameters')?.action).toContain('hypothèses');
  });

  it('returns a positive review signal for a complete project', () => {
    const result = buildDecisionInsights(base);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('project-ready-for-review');
  });
});
