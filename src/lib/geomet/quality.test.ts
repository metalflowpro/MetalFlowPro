import { describe, it, expect } from 'vitest';
import {
  domainConfidence, variabilityClass, coverageBreakdown, qaChecks,
  type DomainQualityInput, type QaDomainRow,
} from './quality';

const base: DomainQualityInput = {
  sampleCount: 15, hasRecovery: true, hasBwi: true, recoveryMin: 88, recoveryMax: 92,
};

describe('variabilityClass', () => {
  it('sans deux essais ou sans étendue : insuffisamment caractérisé', () => {
    expect(variabilityClass({ ...base, sampleCount: 1 }).klass).toBe('undercharacterized');
    expect(variabilityClass({ ...base, recoveryMin: null }).klass).toBe('undercharacterized');
  });
  it('étendue serrée → stable, large → très variable', () => {
    expect(variabilityClass({ ...base, recoveryMin: 89, recoveryMax: 92 }).klass).toBe('stable');
    expect(variabilityClass({ ...base, recoveryMin: 70, recoveryMax: 90 }).klass).toBe('very_variable');
  });
});

describe('domainConfidence', () => {
  it('domaine sans métallurgie → none', () => {
    expect(domainConfidence({ ...base, hasRecovery: false }).confidence).toBe('none');
    expect(domainConfidence({ ...base, sampleCount: 0 }).confidence).toBe('none');
  });
  it('beaucoup d\'essais + BWi + étendue serrée → high', () => {
    expect(domainConfidence(base).confidence).toBe('high');
  });
  it('peu d\'essais → low, seuil moyen → medium', () => {
    expect(domainConfidence({ ...base, sampleCount: 2 }).confidence).toBe('low');
    expect(domainConfidence({ ...base, sampleCount: 8 }).confidence).toBe('medium');
  });
  it('variabilité excessive plafonne un high à medium', () => {
    const res = domainConfidence({ ...base, recoveryMin: 64, recoveryMax: 88 });
    expect(res.variability).toBe('very_variable');
    expect(res.confidence).toBe('medium');
  });
});

describe('coverageBreakdown', () => {
  it('ventile le tonnage et calcule le % validé (high+medium)', () => {
    const b = coverageBreakdown([
      { tonnage: 78, confidence: 'high' },
      { tonnage: 15, confidence: 'medium' },
      { tonnage: 7, confidence: 'none' },
    ]);
    expect(b.total).toBe(100);
    expect(b.validatedPct).toBeCloseTo(93, 5);
    expect(b.nonePct).toBeCloseTo(7, 5);
  });
  it('tonnage total nul → pourcentages à zéro sans division par zéro', () => {
    const b = coverageBreakdown([{ tonnage: 0, confidence: 'none' }]);
    expect(b.validatedPct).toBe(0);
  });
});

describe('qaChecks', () => {
  const good: QaDomainRow = {
    name: 'Oxydé', gidCode: 'OXY', sampleCount: 12, hasRecovery: true,
    hasBwi: true, hasP80: true, variability: 'stable', tonnage: 8.4e6,
  };
  it('domaine complet ne génère aucune erreur', () => {
    const f = qaChecks([good], new Set(['oxide']), [{ canon: 'oxide', label: 'Oxydé' }]);
    expect(f.filter(x => x.severity === 'error')).toHaveLength(0);
  });
  it('domaine sans essai → erreur ; sans GID → warning', () => {
    const f = qaChecks([{ ...good, gidCode: null, hasRecovery: false, sampleCount: 0 }], new Set(), []);
    expect(f.some(x => x.code === 'no_sample' && x.severity === 'error')).toBe(true);
    expect(f.some(x => x.code === 'gid_missing')).toBe(true);
  });
  it('lithologie BM sans domaine → blocs non couverts', () => {
    const f = qaChecks([good], new Set(['oxide']), [
      { canon: 'oxide', label: 'Oxydé' }, { canon: 'sulphide', label: 'Sulfuré' },
    ]);
    expect(f.some(x => x.code === 'uncovered_blocks' && x.domain === 'Sulfuré')).toBe(true);
  });
  it('trie les erreurs avant les warnings et infos', () => {
    const f = qaChecks(
      [{ ...good, gidCode: null, hasRecovery: false, sampleCount: 0, hasP80: false, hasBwi: false }],
      new Set(), [],
    );
    expect(f[0].severity).toBe('error');
  });
});
