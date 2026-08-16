import { describe, it, expect } from 'vitest';
import { blendDomainRecovery, groupByDomain, aggregateBlocksByDomain, type DomainRecoveryInput } from './domainRecovery';

/** Gisement à trois domaines, teneurs et réponses métallurgiques contrastées. */
const GISEMENT: DomainRecoveryInput[] = [
  { domain: 'Oxyde',      tonnes: 10_000_000, gradeGt: 0.60, recoveryPct: 92 },
  { domain: 'Transition', tonnes:  5_000_000, gradeGt: 0.90, recoveryPct: 80 },
  { domain: 'Sulfure',    tonnes: 15_000_000, gradeGt: 1.40, recoveryPct: 62 },
];

describe('pondération par le MÉTAL CONTENU, pas par le tonnage', () => {
  it('applique R = Σ(t×g×R) / Σ(t×g)', () => {
    const r = blendDomainRecovery(GISEMENT)!;
    const num = GISEMENT.reduce((s, d) => s + d.tonnes * d.gradeGt * d.recoveryPct!, 0);
    const den = GISEMENT.reduce((s, d) => s + d.tonnes * d.gradeGt, 0);
    expect(r.recoveryPct).toBeCloseTo(num / den, 8);
  });

  it('DIFFÈRE de la pondération par tonnage dès que les teneurs diffèrent', () => {
    // L'erreur classique : un domaine pauvre mais volumineux tirerait la moyenne
    // alors qu'il apporte peu de métal. Ici le sulfure, riche, doit peser plus.
    const r = blendDomainRecovery(GISEMENT)!;
    expect(r.recoveryPct).not.toBeCloseTo(r.tonnageWeightedPct, 1);
    expect(r.recoveryPct).toBeLessThan(r.tonnageWeightedPct);
  });

  it('les deux pondérations COÏNCIDENT quand les teneurs sont égales', () => {
    const memeTeneur = GISEMENT.map(d => ({ ...d, gradeGt: 1.0 }));
    const r = blendDomainRecovery(memeTeneur)!;
    expect(r.recoveryPct).toBeCloseTo(r.tonnageWeightedPct, 8);
  });

  it('le domaine le plus riche en métal domine le résultat', () => {
    const r = blendDomainRecovery(GISEMENT)!;
    expect(r.byDomain[0].domain).toBe('sulphide');
    expect(r.byDomain[0].metalSharePct).toBeGreaterThan(50);
  });

  it('la récupération globale reste encadrée par les récupérations de domaine', () => {
    const r = blendDomainRecovery(GISEMENT)!;
    const recs = GISEMENT.map(d => d.recoveryPct!);
    expect(r.recoveryPct).toBeGreaterThanOrEqual(Math.min(...recs));
    expect(r.recoveryPct).toBeLessThanOrEqual(Math.max(...recs));
  });

  it('conserve le métal : Σ récupéré = R × Σ alimenté', () => {
    const r = blendDomainRecovery(GISEMENT)!;
    const recovered = r.byDomain.reduce((s, c) => s + c.metalRecovered, 0);
    expect(recovered).toBeCloseTo(r.totalMetalIn * r.recoveryPct / 100, 3);
  });

  it('les parts de métal somment à 100 %', () => {
    const r = blendDomainRecovery(GISEMENT)!;
    expect(r.byDomain.reduce((s, c) => s + c.metalSharePct, 0)).toBeCloseTo(100, 8);
  });
});

describe('domaines sans essais — imputés et SIGNALÉS', () => {
  const avecTrou: DomainRecoveryInput[] = [
    ...GISEMENT,
    { domain: 'Sulfure profond', tonnes: 3_000_000, gradeGt: 1.8, recoveryPct: null },
  ];

  it('utilise le repli et liste le domaine imputé', () => {
    const r = blendDomainRecovery(avecTrou, 70)!;
    expect(r.imputedDomains).toContain('sulfureprofond');
    expect(r.byDomain.find(c => c.domain === 'sulfureprofond')!.recoveryPct).toBe(70);
    expect(r.byDomain.find(c => c.domain === 'sulfureprofond')!.imputed).toBe(true);
    expect(r.basis).toMatch(/récupération imputée/);
  });

  it('sans repli, le domaine sans essais est ÉCARTÉ, pas mis à zéro', () => {
    // Le compter à zéro écraserait la récupération globale ; l'écarter la laisse
    // représentative des domaines réellement caractérisés.
    const r = blendDomainRecovery(avecTrou, null)!;
    expect(r.byDomain.some(c => c.domain === 'sulfureprofond')).toBe(false);
    expect(r.recoveryPct).toBeCloseTo(blendDomainRecovery(GISEMENT)!.recoveryPct, 8);
  });

  it('un domaine imputé ne se compte qu\'une fois même répété', () => {
    const r = blendDomainRecovery([
      ...GISEMENT,
      { domain: 'Sulfure profond', tonnes: 1e6, gradeGt: 1.5, recoveryPct: null },
      { domain: 'sulfure profond', tonnes: 1e6, gradeGt: 1.5, recoveryPct: null },
    ], 70)!;
    expect(r.imputedDomains.filter(d => d === 'sulfureprofond')).toHaveLength(1);
  });
});

describe('canonicalisation et robustesse', () => {
  it('fond les orthographes d\'un même domaine sur une clé unique', () => {
    const r = blendDomainRecovery([
      { domain: 'Sulfure',   tonnes: 1e6, gradeGt: 1, recoveryPct: 60 },
      { domain: 'sulphide',  tonnes: 1e6, gradeGt: 1, recoveryPct: 60 },
      { domain: 'Sulphides', tonnes: 1e6, gradeGt: 1, recoveryPct: 60 },
    ])!;
    expect(new Set(r.byDomain.map(c => c.domain))).toEqual(new Set(['sulphide']));
  });

  it('écarte les domaines sans tonnage ou sans teneur', () => {
    const r = blendDomainRecovery([
      ...GISEMENT,
      { domain: 'Vide',   tonnes: 0,    gradeGt: 1.2, recoveryPct: 80 },
      { domain: 'Stérile', tonnes: 1e6, gradeGt: 0,   recoveryPct: 80 },
    ])!;
    expect(r.byDomain.some(c => ['vide', 'sterile'].includes(c.domain))).toBe(false);
    expect(r.recoveryPct).toBeCloseTo(blendDomainRecovery(GISEMENT)!.recoveryPct, 8);
  });

  it('borne toute récupération de domaine à [0, 100]', () => {
    const r = blendDomainRecovery([
      { domain: 'A', tonnes: 1e6, gradeGt: 1, recoveryPct: 150 },
      { domain: 'B', tonnes: 1e6, gradeGt: 1, recoveryPct: -20 },
    ])!;
    expect(r.byDomain.find(c => c.domain === 'a')!.recoveryPct).toBe(100);
    expect(r.byDomain.find(c => c.domain === 'b')!.recoveryPct).toBe(0);
    expect(r.recoveryPct).toBeCloseTo(50, 6);
  });

  it('un seul domaine rend exactement sa récupération', () => {
    const r = blendDomainRecovery([{ domain: 'Oxyde', tonnes: 5e6, gradeGt: 0.8, recoveryPct: 91 }])!;
    expect(r.recoveryPct).toBeCloseTo(91, 8);
    expect(r.tonnageWeightedPct).toBeCloseTo(91, 8);
  });

  it('sans domaine exploitable, renvoie null plutôt qu\'un zéro trompeur', () => {
    expect(blendDomainRecovery([])).toBeNull();
    expect(blendDomainRecovery([{ domain: 'A', tonnes: 0, gradeGt: 0, recoveryPct: 90 }])).toBeNull();
    expect(blendDomainRecovery([{ domain: 'A', tonnes: 1e6, gradeGt: 1, recoveryPct: null }], null)).toBeNull();
  });

  it('encaisse des valeurs non finies', () => {
    const r = blendDomainRecovery([
      ...GISEMENT,
      { domain: 'NaN', tonnes: NaN, gradeGt: 1, recoveryPct: 80 },
      { domain: 'Inf', tonnes: 1e6, gradeGt: Infinity, recoveryPct: 80 },
    ]);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.recoveryPct)).toBe(true);
  });

  it('expose une base de calcul traçable', () => {
    const r = blendDomainRecovery(GISEMENT)!;
    expect(r.basis).toMatch(/MÉTAL CONTENU/);
    expect(r.basis).toMatch(/Σ\(t×g×R\)/);
    expect(r.basis).toMatch(/3 domaine/);
  });
});

describe('agrégation du modèle de blocs par domaine', () => {
  const blocs = [
    { rockType: 'Oxyde',   gradeGt: 0.5, density: 2.6, volumeM3: 1000 },
    { rockType: 'Oxyde',   gradeGt: 0.9, density: 2.6, volumeM3: 1000 },
    { rockType: 'oxide',   gradeGt: 0.7, density: 2.6, volumeM3: 1000 },
    { rockType: 'Sulfure', gradeGt: 1.5, density: 2.9, volumeM3: 1000 },
  ];

  it('somme le tonnage par domaine canonique', () => {
    const a = aggregateBlocksByDomain(blocs);
    expect(a.find(d => d.domain === 'oxide')!.tonnes).toBeCloseTo(3 * 2.6 * 1000, 6);
    expect(a.find(d => d.domain === 'sulphide')!.tonnes).toBeCloseTo(2.9 * 1000, 6);
  });

  it('pondère la teneur par le TONNAGE, pas par le nombre de blocs', () => {
    const a = aggregateBlocksByDomain(blocs);
    expect(a.find(d => d.domain === 'oxide')!.gradeGt).toBeCloseTo((0.5 + 0.9 + 0.7) / 3, 8);
  });

  it('des densités inégales déplacent la moyenne de teneur', () => {
    // Deux blocs de même volume mais densités différentes : le plus lourd pèse
    // davantage. Une moyenne arithmétique donnerait 1,0.
    const a = aggregateBlocksByDomain([
      { rockType: 'A', gradeGt: 0.5, density: 1, volumeM3: 1000 },
      { rockType: 'A', gradeGt: 1.5, density: 3, volumeM3: 1000 },
    ]);
    expect(a[0].gradeGt).toBeCloseTo((0.5 * 1 + 1.5 * 3) / 4, 8);
    expect(a[0].gradeGt).not.toBeCloseTo(1.0, 2);
  });

  it('écarte les blocs sans masse ni teneur exploitables', () => {
    const a = aggregateBlocksByDomain([
      ...blocs,
      { rockType: 'Vide', gradeGt: 1, density: 0, volumeM3: 1000 },
      { rockType: 'Nul',  gradeGt: 0, density: 2.6, volumeM3: 1000 },
      { rockType: 'NaN',  gradeGt: NaN, density: 2.6, volumeM3: 1000 },
      { rockType: 'Null', gradeGt: null, density: null, volumeM3: null },
    ]);
    expect(a.some(d => ['vide', 'nul', 'nan', 'null'].includes(d.domain))).toBe(false);
  });

  it('s\'enchaîne directement dans le mélange par domaine', () => {
    const recs: Record<string, number> = { oxide: 92, sulphide: 62 };
    const r = blendDomainRecovery(
      aggregateBlocksByDomain(blocs).map(d => ({ ...d, recoveryPct: recs[d.domain] ?? null })),
    )!;
    expect(r.byDomain).toHaveLength(2);
    expect(r.recoveryPct).toBeGreaterThan(62);
    expect(r.recoveryPct).toBeLessThan(92);
  });

  it('modèle vide → aucun domaine', () => {
    expect(aggregateBlocksByDomain([])).toHaveLength(0);
  });
});

describe('regroupement des essais par domaine', () => {
  const essais = [
    { dom: 'Oxyde', rec: 92 }, { dom: 'oxide', rec: 90 },
    { dom: 'Sulfure', rec: 60 }, { dom: 'Sulphide', rec: 63 }, { dom: null, rec: 75 },
  ];

  it('fond les synonymes sur une clé unique', () => {
    const g = groupByDomain(essais, e => e.dom);
    expect(g.get('oxide')).toHaveLength(2);
    expect(g.get('sulphide')).toHaveLength(2);
  });

  it('un domaine absent tombe dans « non classifié » plutôt que d\'être perdu', () => {
    const g = groupByDomain(essais, e => e.dom);
    expect(g.get('nonclassifie')).toHaveLength(1);
  });

  it('aucun essai n\'est perdu au regroupement', () => {
    const g = groupByDomain(essais, e => e.dom);
    expect([...g.values()].reduce((s, v) => s + v.length, 0)).toBe(essais.length);
  });

  it('liste vide → carte vide', () => {
    expect(groupByDomain([], () => null).size).toBe(0);
  });
});
