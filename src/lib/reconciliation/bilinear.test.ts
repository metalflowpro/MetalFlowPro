import { describe, it, expect } from 'vitest';
import { reconcileBilinear, reconcileBilinearIterative, type BilinearStream, type BilinearMetal } from './bilinear';
import { reconcile, type ReconNode, type ReconStream } from './wls';

// Splitter simple : feed → conc + tail.
const SPLIT_NODES: ReconNode[] = [
  { id: 'sep', label: 'Séparateur', inputs: ['feed'], outputs: ['conc', 'tail'] },
];

const GOLD: BilinearMetal[] = [{ key: 'au', label: 'Or', gradeUnit: 'g/t' }];

/** Splitter tonnage + teneur or (g/t). */
function bilinearSplit(
  t: [number, number, number],
  au: [number, number, number],
  pct = 5,
): BilinearStream[] {
  const [tf, tc, tt] = t;
  const [af, ac, at] = au;
  return [
    { id: 'feed', label: 'Alimentation', tonnage: tf, tonnagePrecisionPct: pct, grades: { au: { value: af, precisionPct: pct } } },
    { id: 'conc', label: 'Concentré',    tonnage: tc, tonnagePrecisionPct: pct, grades: { au: { value: ac, precisionPct: pct } } },
    { id: 'tail', label: 'Rejet',        tonnage: tt, tonnagePrecisionPct: pct, grades: { au: { value: at, precisionPct: pct } } },
  ];
}

describe('reconcileBilinear — cohérence métal = tonnage × teneur', () => {
  it('ferme le bilan métal réconcilié (Σ métal entrée = Σ métal sortie)', () => {
    // Tonnages: 100 = 30 + 68 (déséquilibre 2). Or (g/t): feed 5, conc 12, tail 1.7.
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD });
    expect(r.feasible).toBe(true);
    const au = r.metals[0];
    expect(au.feasible).toBe(true);
    const flow = (id: string) => au.grades.find(g => g.id === id)!.reconciledMetalFlow;
    // bilan métal réconcilié : feed = conc + tail (au produit T̂·â)
    expect(flow('feed')).toBeCloseTo(flow('conc') + flow('tail'), 1);
  });

  it('les teneurs réconciliées sont cohérentes avec les tonnages réconciliés', () => {
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD });
    const au = r.metals[0];
    for (const g of au.grades) {
      // m̂ = T̂ · â, par construction
      expect(g.reconciledMetalFlow).toBeCloseTo(g.reconciledTonnage * g.reconciledGrade, 2);
    }
  });

  it('un bilan tonnage+teneur déjà cohérent n\'est presque pas ajusté', () => {
    // 100 = 30 + 70 ; métal: 100·5 = 30·? + 70·? → conc 12, tail 2 → 500 = 360 + 140 = 500. Exact.
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 70], [5, 12, 2]), metals: GOLD });
    for (const g of r.metals[0].grades) {
      expect(Math.abs(g.gradeAdjustment)).toBeLessThan(0.05);
    }
    expect(r.metals[0].globalTest.grossError).toBe(false);
  });
});

describe('reconcileBilinear — étage tonnage', () => {
  it('réconcilie les tonnages comme la réconciliation linéaire directe', () => {
    const streams = bilinearSplit([100, 30, 68], [5, 12, 1.7]);
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams, metals: GOLD });
    const direct = reconcile(SPLIT_NODES, [
      { id: 'feed', measured: 100, precisionPct: 5 },
      { id: 'conc', measured: 30, precisionPct: 5 },
      { id: 'tail', measured: 68, precisionPct: 5 },
    ] as ReconStream[]);
    for (const s of direct.streams) {
      expect(r.reconciledTonnage[s.id]).toBeCloseTo(s.reconciled, 4);
    }
  });
});

describe('reconcileBilinear — détection d\'erreur grossière sur teneur', () => {
  it('signale une analyse aberrante et la désigne', () => {
    // Tonnages parfaits (100=30+70). Or feed=5, conc=12 → métal in 500, conc 360 → tail devrait titrer 2.
    // On saisit tail=8 (aberrant) avec analyses précises.
    const streams = bilinearSplit([100, 30, 70], [5, 12, 8], 2);
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams, metals: GOLD });
    const au = r.metals[0];
    expect(au.globalTest.grossError).toBe(true);
    expect(au.worstAssay).not.toBeNull();
    expect(au.grades.some(g => g.isSuspect)).toBe(true);
  });

  it('ne touche pas une teneur figée (référence)', () => {
    const streams: BilinearStream[] = [
      { id: 'feed', tonnage: 100, tonnagePrecisionPct: 5, grades: { au: { value: 5, precisionPct: 5 } } },
      { id: 'conc', tonnage: 30, tonnagePrecisionPct: 5, grades: { au: { value: 12, precisionPct: 5 } } },
      { id: 'tail', tonnage: 68, tonnagePrecisionPct: 5, grades: { au: { value: 1.7, precisionPct: 5, fixed: true } } },
    ];
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams, metals: GOLD });
    const tail = r.metals[0].grades.find(g => g.id === 'tail')!;
    expect(Math.abs(tail.gradeAdjustment)).toBeLessThan(0.05);
    expect(tail.isSuspect).toBe(false);
  });
});

describe('reconcileBilinear — multi-métal et flux propres', () => {
  it('réconcilie plusieurs métaux indépendamment sur le même circuit', () => {
    const streams: BilinearStream[] = [
      { id: 'feed', tonnage: 100, tonnagePrecisionPct: 3, grades: { au: { value: 5 }, ag: { value: 20 } } },
      { id: 'conc', tonnage: 30, tonnagePrecisionPct: 5, grades: { au: { value: 12 }, ag: { value: 55 } } },
      { id: 'tail', tonnage: 68, tonnagePrecisionPct: 5, grades: { au: { value: 1.7 }, ag: { value: 4 } } },
    ];
    const metals: BilinearMetal[] = [{ key: 'au', label: 'Or' }, { key: 'ag', label: 'Argent' }];
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams, metals });
    expect(r.metals).toHaveLength(2);
    for (const m of r.metals) {
      expect(m.feasible).toBe(true);
      const flow = (id: string) => m.grades.find(g => g.id === id)!.reconciledMetalFlow;
      expect(flow('feed')).toBeCloseTo(flow('conc') + flow('tail'), 1);
    }
  });

  it('ignore un métal sans aucune teneur renseignée', () => {
    const streams = bilinearSplit([100, 30, 68], [5, 12, 1.7]);
    const metals: BilinearMetal[] = [{ key: 'au', label: 'Or' }, { key: 'cu', label: 'Cuivre' }];
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams, metals });
    expect(r.metals[0].feasible).toBe(true);
    expect(r.metals[1].feasible).toBe(false);
    expect(r.metals[1].grades).toHaveLength(0);
  });
});

describe('reconcileBilinear — robustesse', () => {
  it('renvoie non faisable sur un réseau vide', () => {
    expect(reconcileBilinear({ nodes: [], streams: [], metals: GOLD }).feasible).toBe(false);
  });

  it('ne produit jamais de NaN', () => {
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD });
    for (const g of r.metals[0].grades) {
      expect(Number.isFinite(g.reconciledGrade)).toBe(true);
      expect(Number.isFinite(g.reconciledMetalFlow)).toBe(true);
      expect(Number.isFinite(g.suspicionScore)).toBe(true);
    }
    expect(Number.isFinite(r.metals[0].metalClosurePct)).toBe(true);
  });

  it('gère une teneur nulle sans division par zéro', () => {
    const r = reconcileBilinear({ nodes: SPLIT_NODES, streams: bilinearSplit([100, 100, 0], [5, 5, 0]), metals: GOLD });
    expect(r.metals[0].grades.every(g => Number.isFinite(g.gradeAdjustmentPct))).toBe(true);
  });
});

describe('reconcileBilinearIterative — problème bilinéaire complet', () => {
  it('converge et ferme SIMULTANÉMENT le bilan masse ET le bilan métal', () => {
    // Tonnages en déséquilibre (100 ≠ 30+68) et teneurs bruitées.
    const r = reconcileBilinearIterative(
      { nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD },
    );
    expect(r.feasible).toBe(true);
    expect(r.converged).toBe(true);
    // (a) bilan masse sur tonnages réconciliés
    const T = (id: string) => r.reconciledTonnage[id];
    expect(T('feed')).toBeCloseTo(T('conc') + T('tail'), 1);
    // (b) bilan métal sur débits réconciliés
    const flow = (id: string) => r.metals[0].grades.find(g => g.id === id)!.reconciledMetalFlow;
    expect(flow('feed')).toBeCloseTo(flow('conc') + flow('tail'), 1);
  });

  it('renvoie le nombre d\'itérations et le drapeau de convergence', () => {
    const r = reconcileBilinearIterative(
      { nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD },
      { maxIter: 20, tol: 1e-4 },
    );
    expect(r.iterations).toBeGreaterThanOrEqual(1);
    expect(r.iterations).toBeLessThanOrEqual(20);
    expect(typeof r.converged).toBe('boolean');
  });

  it('conserve la cohérence m̂ = T̂ × â après convergence', () => {
    const r = reconcileBilinearIterative(
      { nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD },
    );
    for (const g of r.metals[0].grades) {
      expect(g.reconciledMetalFlow).toBeCloseTo(g.reconciledTonnage * g.reconciledGrade, 2);
    }
  });

  it('converge en très peu d\'itérations sur un bilan déjà cohérent', () => {
    // 100 = 30 + 70 ; 500 = 360 + 140. Masse et métal déjà exacts.
    const r = reconcileBilinearIterative(
      { nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 70], [5, 12, 2]), metals: GOLD },
    );
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(3);
    for (const g of r.metals[0].grades) expect(Math.abs(g.gradeAdjustment)).toBeLessThan(0.05);
  });

  it('ne produit jamais de NaN et gère le réseau vide', () => {
    expect(reconcileBilinearIterative({ nodes: [], streams: [], metals: GOLD }).feasible).toBe(false);
    const r = reconcileBilinearIterative(
      { nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 12, 1.7]), metals: GOLD },
    );
    for (const g of r.metals[0].grades) {
      expect(Number.isFinite(g.reconciledGrade)).toBe(true);
      expect(Number.isFinite(g.reconciledMetalFlow)).toBe(true);
    }
    for (const id of Object.keys(r.reconciledTonnage)) expect(Number.isFinite(r.reconciledTonnage[id])).toBe(true);
  });

  it('gère des teneurs uniformes (contraintes dépendantes) par repli sur la masse', () => {
    // Teneurs identiques partout → ligne métal ∝ ligne masse (système combiné singulier).
    const r = reconcileBilinearIterative(
      { nodes: SPLIT_NODES, streams: bilinearSplit([100, 30, 68], [5, 5, 5]), metals: GOLD },
    );
    expect(r.feasible).toBe(true);
    const T = (id: string) => r.reconciledTonnage[id];
    expect(T('feed')).toBeCloseTo(T('conc') + T('tail'), 1); // masse fermée malgré le repli
  });
});
