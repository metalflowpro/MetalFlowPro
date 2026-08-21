import { describe, it, expect } from 'vitest';
import {
  SOURCE_TIER_PRIORITY, sourceTierRank, provenanceForTier, sourced,
  effectiveProvenance, resolveSourced, isValidatedTier, isAssumedTier,
  dataCoverage, qualityFromTiers, qualityFromSourced,
  type SourceTier,
} from './provenance';

describe('hiérarchie de source', () => {
  it('classe les 6 niveaux du plus fiable au moins fiable', () => {
    expect(SOURCE_TIER_PRIORITY[0]).toBe('lims_approved');
    expect(SOURCE_TIER_PRIORITY[SOURCE_TIER_PRIORITY.length - 1]).toBe('user_assumption');
    expect(SOURCE_TIER_PRIORITY).toHaveLength(6);
  });

  it('LIMS approuvé prime sur tout le reste', () => {
    for (const t of SOURCE_TIER_PRIORITY.slice(1)) {
      expect(sourceTierRank('lims_approved')).toBeLessThan(sourceTierRank(t));
    }
  });

  it('un critère de conception prime sur un défaut de template, qui prime sur une hypothèse', () => {
    expect(sourceTierRank('design_criteria')).toBeLessThan(sourceTierRank('template_default'));
    expect(sourceTierRank('template_default')).toBeLessThan(sourceTierRank('user_assumption'));
  });
});

describe('provenanceForTier', () => {
  it('mappe les essais validés sur « mesuré »', () => {
    expect(provenanceForTier('lims_approved')).toBe('measured');
    expect(provenanceForTier('pilot_validated')).toBe('measured');
    expect(provenanceForTier('testwork_validated')).toBe('measured');
  });
  it('mappe critère → estimé, template → défaut, hypothèse → hypothèse', () => {
    expect(provenanceForTier('design_criteria')).toBe('estimated');
    expect(provenanceForTier('template_default')).toBe('default');
    expect(provenanceForTier('user_assumption')).toBe('user_assumption');
  });
});

describe('sourced / effectiveProvenance', () => {
  it('déduit la provenance du tier quand elle est absente', () => {
    const s = sourced(1.85, 'lims_approved', { note: 'moyenne 12 essais' });
    expect(effectiveProvenance(s)).toBe('measured');
    expect(s.note).toBe('moyenne 12 essais');
  });
  it('respecte une provenance explicite « calculated » sur une valeur dérivée', () => {
    const s = sourced(96.1, 'lims_approved', { provenance: 'calculated' });
    expect(effectiveProvenance(s)).toBe('calculated');
  });
});

describe('resolveSourced — applique la priorité', () => {
  it('retient le candidat au tier le plus fiable présent, quel que soit l’ordre', () => {
    const r = resolveSourced<number>([
      sourced(100, 'user_assumption'),
      sourced(88, 'lims_approved'),
      sourced(90, 'design_criteria'),
    ]);
    expect(r?.value).toBe(88);
    expect(r?.tier).toBe('lims_approved');
  });

  it('saute les candidats à valeur absente et retombe sur le suivant', () => {
    const r = resolveSourced<number>([
      sourced(null, 'lims_approved'),
      sourced(undefined, 'testwork_validated'),
      sourced(90, 'design_criteria'),
    ]);
    expect(r?.value).toBe(90);
    expect(r?.tier).toBe('design_criteria');
  });

  it('rejette NaN comme valeur numérique absente', () => {
    const r = resolveSourced<number>([
      sourced(NaN, 'lims_approved'),
      sourced(42, 'user_assumption'),
    ]);
    expect(r?.value).toBe(42);
  });

  it('renvoie null quand aucun candidat n’a de valeur', () => {
    expect(resolveSourced<number>([sourced(null, 'lims_approved'), null, undefined])).toBeNull();
  });
});

describe('classification des tiers', () => {
  it('sépare validés et hypothétiques ; le critère de conception n’est ni l’un ni l’autre', () => {
    expect(isValidatedTier('lims_approved')).toBe(true);
    expect(isAssumedTier('user_assumption')).toBe(true);
    expect(isValidatedTier('design_criteria')).toBe(false);
    expect(isAssumedTier('design_criteria')).toBe(false);
  });
});

describe('dataCoverage — % données vs hypothèses', () => {
  it('compte le critère de conception comme donnée, pas comme hypothèse', () => {
    const tiers: SourceTier[] = ['lims_approved', 'design_criteria', 'template_default', 'user_assumption'];
    const { dataPct, assumptionPct } = dataCoverage(tiers);
    // 2 hypothétiques sur 4 → 50 % d’hypothèses, 50 % de données.
    expect(assumptionPct).toBe(50);
    expect(dataPct).toBe(50);
  });
  it('renvoie 0/0 sur un ensemble vide', () => {
    expect(dataCoverage([])).toEqual({ dataPct: 0, assumptionPct: 0, n: 0 });
  });
});

describe('qualityFromTiers — couleur d’incertitude', () => {
  it('gris quand aucun champ contributif', () => {
    expect(qualityFromTiers([])).toBe('grey');
  });
  it('vert quand ≥ 80 % de champs validés', () => {
    const tiers: SourceTier[] = ['lims_approved', 'lims_approved', 'testwork_validated', 'pilot_validated', 'design_criteria'];
    expect(qualityFromTiers(tiers)).toBe('green');
  });
  it('rouge quand la majorité est hypothétique', () => {
    const tiers: SourceTier[] = ['user_assumption', 'template_default', 'user_assumption', 'lims_approved'];
    expect(qualityFromTiers(tiers)).toBe('red');
  });
  it('orange entre les deux (estimé/partiel)', () => {
    const tiers: SourceTier[] = ['lims_approved', 'design_criteria', 'design_criteria', 'template_default'];
    expect(qualityFromTiers(tiers)).toBe('amber');
  });
  it('qualityFromSourced dérive la couleur des valeurs tracées', () => {
    expect(qualityFromSourced([sourced(1, 'lims_approved'), sourced(2, 'user_assumption')])).toBe('amber');
  });
});
