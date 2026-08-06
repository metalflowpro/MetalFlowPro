import { describe, it, expect } from 'vitest';
import { summaryStats, capOutliers, declusterWeights, weightedMean, type SamplePoint } from './statistics';
import { experimentalVariogram, fitVariogramModel, modelSemivariance, shapeFunction } from './variogram';
import { krigeBlock, selectNeighbours } from './kriging';
import { idwBlock } from './idw';
import { classifyBlock, isMeasuredOrIndicated } from './classification';
import { crossValidate, gradeTonnage } from './validation';
import { estimateGrid } from './estimate';
import { buildSamplePoints, boundsOf, buildGrid, type HoleData } from './pipeline';

// ─── statistics ─────────────────────────────────────────────────────────────

describe('statistics', () => {
  it('summaryStats : moyenne, médiane, CV', () => {
    const s = summaryStats([1, 2, 3, 4]);
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(2.5, 9);
    expect(s.median).toBeCloseTo(2.5, 9);
    expect(s.cv).toBeCloseTo(s.stdev / s.mean, 9);
  });

  it('capOutliers écrête les valeurs fortes (percentile)', () => {
    const capped = capOutliers([1, 1, 1, 1, 100], { method: 'percentile', threshold: 0.8 });
    expect(Math.max(...capped)).toBeLessThan(100);
  });

  it('declusterWeights réduit le poids d’un cluster sur-échantillonné', () => {
    // 3 points serrés (même cellule) + 1 isolé → le point isolé doit peser plus.
    const pts: SamplePoint[] = [
      { x: 0, y: 0, z: 0, value: 10 },
      { x: 1, y: 1, z: 0, value: 10 },
      { x: 2, y: 2, z: 0, value: 10 },
      { x: 100, y: 100, z: 0, value: 1 },
    ];
    const w = declusterWeights(pts, { x: 10, y: 10, z: 10 });
    expect(w[3]).toBeGreaterThan(w[0]); // isolé > membre du cluster
    // moyenne déclusterée < moyenne brute (le cluster haut est dégonflé)
    const wm = weightedMean(pts.map(p => p.value), w);
    const raw = pts.reduce((s, p) => s + p.value, 0) / pts.length;
    expect(wm).toBeLessThan(raw);
  });
});

// ─── variogram ──────────────────────────────────────────────────────────────

describe('variogram', () => {
  it('shapeFunction sphérique : 0 à h=0, 1 au-delà de la portée', () => {
    expect(shapeFunction('spherical', 0, 100)).toBeCloseTo(0, 9);
    expect(shapeFunction('spherical', 150, 100)).toBeCloseTo(1, 9);
  });

  it('modelSemivariance : nugget à h→0+, tend vers le palier au loin', () => {
    const m = { type: 'spherical' as const, nugget: 0.2, sill: 1, range: 100 };
    expect(modelSemivariance(m, 0)).toBe(0);
    expect(modelSemivariance(m, 1e-6)).toBeGreaterThanOrEqual(0.2);
    expect(modelSemivariance(m, 500)).toBeCloseTo(1, 6);
  });

  it('fit retrouve une portée plausible sur un variogramme sphérique synthétique', () => {
    const truth = { type: 'spherical' as const, nugget: 0.1, sill: 1.0, range: 80 };
    const pts = Array.from({ length: 12 }, (_, k) => {
      const lag = (k + 1) * 12;
      return { lag, semivariance: modelSemivariance(truth, lag), pairs: 100 };
    });
    const fit = fitVariogramModel(pts, 'spherical');
    expect(fit.sill).toBeCloseTo(1.0, 1);
    expect(fit.nugget).toBeLessThan(0.3);
    expect(fit.range).toBeGreaterThan(50);
    expect(fit.range).toBeLessThan(130);
  });

  it('experimentalVariogram : croît avec la distance sur un champ structuré', () => {
    // champ linéaire en x → semivariance croissante avec le lag
    const samples: SamplePoint[] = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 0, z: 0, value: i * 10 }));
    const vg = experimentalVariogram(samples, { lagDistance: 15, nLags: 6 });
    expect(vg.length).toBeGreaterThan(2);
    expect(vg[vg.length - 1].semivariance).toBeGreaterThan(vg[0].semivariance);
  });
});

// ─── kriging / idw ──────────────────────────────────────────────────────────

const MODEL = { type: 'spherical' as const, nugget: 0, sill: 1, range: 100 };

describe('kriging', () => {
  it('krigeage exact sur un point d’échantillon (variance ≈ 0)', () => {
    const samples: SamplePoint[] = [
      { x: 0, y: 0, z: 0, value: 5 },
      { x: 50, y: 0, z: 0, value: 8 },
      { x: 0, y: 50, z: 0, value: 3 },
    ];
    const r = krigeBlock(samples[0], samples, MODEL);
    expect(r.value).toBeCloseTo(5, 4);
    expect(r.krigingVariance ?? 1).toBeLessThan(1e-3);
  });

  it('la variance de krigeage croît avec l’éloignement des données', () => {
    const samples: SamplePoint[] = [
      { x: 0, y: 0, z: 0, value: 5 },
      { x: 20, y: 0, z: 0, value: 6 },
    ];
    const near = krigeBlock({ x: 10, y: 0, z: 0 }, samples, MODEL);
    const far = krigeBlock({ x: 10, y: 80, z: 0 }, samples, MODEL);
    expect(far.krigingVariance!).toBeGreaterThan(near.krigingVariance!);
  });

  it('selectNeighbours : rayon + tri par distance + troncature', () => {
    const samples: SamplePoint[] = [
      { x: 5, y: 0, z: 0, value: 1 },
      { x: 1, y: 0, z: 0, value: 2 },
      { x: 200, y: 0, z: 0, value: 3 }, // hors rayon
    ];
    const sel = selectNeighbours({ x: 0, y: 0, z: 0 }, samples, { radius: 50, maxSamples: 5 });
    expect(sel.map(s => s.value)).toEqual([2, 1]); // le plus proche d’abord, l’éloigné exclu
  });
});

describe('idw', () => {
  it('IDW exact quand un voisin coïncide avec le bloc', () => {
    const samples: SamplePoint[] = [{ x: 0, y: 0, z: 0, value: 7 }, { x: 10, y: 0, z: 0, value: 1 }];
    expect(idwBlock({ x: 0, y: 0, z: 0 }, samples).value).toBeCloseTo(7, 9);
  });

  it('IDW puissance élevée ≈ plus proche voisin', () => {
    const samples: SamplePoint[] = [{ x: 1, y: 0, z: 0, value: 10 }, { x: 9, y: 0, z: 0, value: 0 }];
    const r = idwBlock({ x: 0, y: 0, z: 0 }, samples, 30);
    expect(r.value).toBeGreaterThan(9.9); // dominé par le voisin à x=1
  });
});

// ─── classification ─────────────────────────────────────────────────────────

describe('classification CIM', () => {
  it('bloc bien contraint → Mesuré', () => {
    expect(classifyBlock({ avgDistance: 30, nSamples: 20, nHoles: 4 })).toBe('Mesuré');
  });
  it('éloignement/rareté → dégrade Mesuré → Indiqué → Inféré → null', () => {
    expect(classifyBlock({ avgDistance: 80, nSamples: 8, nHoles: 2 })).toBe('Indiqué');
    expect(classifyBlock({ avgDistance: 150, nSamples: 2, nHoles: 1 })).toBe('Inféré');
    expect(classifyBlock({ avgDistance: 500, nSamples: 1, nHoles: 1 })).toBeNull();
  });
  it('isMeasuredOrIndicated exclut l’Inféré (base des réserves)', () => {
    expect(isMeasuredOrIndicated('Mesuré')).toBe(true);
    expect(isMeasuredOrIndicated('Indiqué')).toBe(true);
    expect(isMeasuredOrIndicated('Inféré')).toBe(false);
    expect(isMeasuredOrIndicated(null)).toBe(false);
  });

  it('honore des seuils resserrés par le QP plutôt que les défauts', () => {
    // Le même bloc est Mesuré aux seuils par défaut, mais seulement Indiqué si le
    // QP resserre la distance Mesuré — les seuils doivent être paramétrables, pas figés.
    const ev = { avgDistance: 30, nSamples: 20, nHoles: 4 };
    expect(classifyBlock(ev)).toBe('Mesuré');
    expect(classifyBlock(ev, {
      measured:  { maxDistance: 20,  minSamples: 12, minHoles: 3 },
      indicated: { maxDistance: 100, minSamples: 6,  minHoles: 2 },
      inferred:  { maxDistance: 200 },
    })).toBe('Indiqué');
  });
});

// ─── validation ───────────────────────────────────────────────────────────

describe('validation', () => {
  it('grade-tonnage : tonnage décroît, teneur moyenne croît avec le cut-off', () => {
    const blocks = [
      { grade: 0.1, tonnes: 100 },
      { grade: 0.3, tonnes: 100 },
      { grade: 0.6, tonnes: 100 },
    ];
    const gt = gradeTonnage(blocks, [0, 0.2, 0.5]);
    expect(gt[0].tonnes).toBeGreaterThan(gt[1].tonnes);
    expect(gt[2].tonnes).toBeLessThan(gt[1].tonnes);
    expect(gt[2].meanGrade).toBeGreaterThan(gt[0].meanGrade);
    // métal contenu décroît avec le cut-off
    expect(gt[0].metal).toBeGreaterThan(gt[2].metal);
  });

  it('validation croisée : faible biais sur un champ lisse', () => {
    const samples: SamplePoint[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      samples.push({ x: i * 20, y: j * 20, z: 0, value: 5 + 0.01 * (i + j) });
    }
    const cv = crossValidate(samples, MODEL, { radius: 60, maxSamples: 8, minSamples: 2 });
    expect(cv.n).toBeGreaterThan(0);
    expect(Math.abs(cv.meanError)).toBeLessThan(0.5); // quasi non biaisé
  });
});

// ─── orchestrateur ─────────────────────────────────────────────────────────

describe('estimateGrid', () => {
  const samples: SamplePoint[] = [
    { x: 0, y: 0, z: 0, value: 1.0, holeId: 'H1' },
    { x: 30, y: 0, z: 0, value: 1.2, holeId: 'H2' },
    { x: 0, y: 30, z: 0, value: 0.8, holeId: 'H3' },
    { x: 30, y: 30, z: 0, value: 1.1, holeId: 'H4' },
  ];

  it('krigeage exige un modèle de variogramme', () => {
    expect(() => estimateGrid([{ x: 15, y: 15, z: 0 }], samples, { method: 'kriging', search: { radius: 60, maxSamples: 8 } }))
      .toThrow(/variogramme/);
  });

  it('estime un bloc central, compte les trous distincts et classe', () => {
    const [cell] = estimateGrid(
      [{ x: 15, y: 15, z: 0 }],
      samples,
      { method: 'kriging', model: MODEL, search: { radius: 60, maxSamples: 8 } },
    );
    expect(cell.value).not.toBeNull();
    expect(cell.value!).toBeGreaterThan(0.7);
    expect(cell.value!).toBeLessThan(1.3);
    expect(cell.nHoles).toBe(4);
    expect(cell.class).not.toBeNull();
  });

  it('bloc hors de portée des données → non estimé et non classé', () => {
    const [cell] = estimateGrid(
      [{ x: 5000, y: 5000, z: 0 }],
      samples,
      { method: 'kriging', model: MODEL, search: { radius: 60, maxSamples: 8 } },
    );
    expect(cell.value).toBeNull();
    expect(cell.class).toBeNull();
  });
});

// ─── pipeline ────────────────────────────────────────────────────────────────

describe('pipeline forages → composites 3D', () => {
  const holes: HoleData[] = [
    {
      collar: { holeId: 'H1', x: 100, y: 200, z: 500 },
      surveys: [{ depth: 0, azimuth: 0, dip: -90 }, { depth: 20, azimuth: 0, dip: -90 }],
      samples: [
        { from: 0, to: 2, value: 1.0 },
        { from: 2, to: 4, value: 2.0 },
        { from: 4, to: 6, value: 3.0 },
      ],
    },
  ];

  it('projette les composites au bon XYZ (trou vertical → descend en Z)', () => {
    const pts = buildSamplePoints(holes, 2);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toMatchObject({ x: 100, y: 200, holeId: 'H1' });
    expect(pts[0].z).toBeCloseTo(499, 6); // milieu de [0-2] → 1 m sous le collier
    expect(pts[0].value).toBeCloseTo(1.0, 9);
  });

  it('boundsOf + buildGrid couvrent l’emprise et bornent le nombre de blocs', () => {
    const pts = buildSamplePoints(holes, 2);
    const b = boundsOf(pts)!;
    expect(b.minZ).toBeLessThan(b.maxZ);
    const grid = buildGrid(b, { x: 10, y: 10, z: 5 });
    expect(grid.length).toBeGreaterThan(0);
    expect(() => buildGrid({ minX: 0, maxX: 1000, minY: 0, maxY: 1000, minZ: 0, maxZ: 1000 }, { x: 1, y: 1, z: 1 }, 1000))
      .toThrow(/trop fine/);
  });
});
