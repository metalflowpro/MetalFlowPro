// ─────────────────────────────────────────────────────────────────────────────
// INVARIANTS MATHÉMATIQUES DE L'ESTIMATION DE RESSOURCE.
//
// `resource.test.ts` vérifie que chaque fonction s'exécute et donne un résultat
// plausible sur un cas d'école. Ce fichier vérifie les PROPRIÉTÉS que doit
// satisfaire tout estimateur géostatistique — celles dont la violation ne casse
// rien visiblement mais fausse silencieusement tonnage et teneur, c'est-à-dire
// TOUT ce qui suit dans l'application (réserve, plan minier, production, NPV).
//
// Une erreur de récupération se voit sur un tableau de bord. Une erreur de
// krigeage ne se voit jamais.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { summaryStats, capOutliers, declusterWeights, weightedMean, type SamplePoint } from './statistics';
import {
  experimentalVariogram, fitVariogramModel, modelSemivariance, shapeFunction,
  type VariogramModel, type VariogramType,
} from './variogram';
import { krigeBlock, selectNeighbours } from './kriging';
import { idwBlock } from './idw';
import { classifyBlock, DEFAULT_THRESHOLDS } from './classification';
import { crossValidate, gradeTonnage } from './validation';

const MODEL: VariogramModel = { type: 'spherical', nugget: 0.2, sill: 1.4, range: 60 };

/** Générateur déterministe — des tests reproductibles, jamais de hasard. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Nuage d'échantillons reproductible dans un cube de 200 m. */
function cloud(n: number, seed = 42): SamplePoint[] {
  const rnd = lcg(seed);
  return Array.from({ length: n }, () => ({
    x: rnd() * 200, y: rnd() * 200, z: rnd() * 40,
    value: 0.3 + rnd() * 2.5,
  }));
}

// ═══ KRIGEAGE ORDINAIRE — les propriétés qui le définissent ══════════════════

describe('krigeage ordinaire — propriétés définitoires', () => {
  const samples = cloud(14);
  const block = { x: 100, y: 100, z: 20 };
  const neighbours = selectNeighbours(block, samples, { radius: 150, maxSamples: 10 });

  it('les échantillons sélectionnés sont exploitables', () => {
    expect(neighbours.length).toBeGreaterThan(3);
  });

  it('ESTIMATEUR LINÉAIRE : krige(a·v + b) = a·krige(v) + b', () => {
    // Propriété la plus forte du krigeage : les poids ne dépendent QUE de la
    // géométrie. Un changement d'unité ou d'origine doit traverser l'estimateur
    // sans le déformer. Une erreur dans le système linéaire la casse aussitôt.
    const a = 3.5, b = -1.2;
    const base = krigeBlock(block, neighbours, MODEL);
    const scaled = krigeBlock(block, neighbours.map(s => ({ ...s, value: a * s.value + b }), ), MODEL);
    expect(scaled.value!).toBeCloseTo(a * base.value! + b, 8);
  });

  it('SANS BIAIS : la variance de krigeage ne dépend PAS des teneurs', () => {
    // σ²_K est une propriété de la GÉOMÉTRIE seule. Si elle bouge quand les
    // valeurs changent, la classification CIM qui s'y adosse est fausse.
    const v1 = krigeBlock(block, neighbours, MODEL).krigingVariance!;
    const v2 = krigeBlock(block, neighbours.map(s => ({ ...s, value: s.value * 100 + 7 })), MODEL).krigingVariance!;
    expect(v2).toBeCloseTo(v1, 8);
  });

  it('INVARIANT PAR TRANSLATION : déplacer tout le repère ne change rien', () => {
    const d = { x: 5000, y: -3000, z: 250 };
    const moved = krigeBlock(
      { x: block.x + d.x, y: block.y + d.y, z: block.z + d.z },
      neighbours.map(s => ({ ...s, x: s.x + d.x, y: s.y + d.y, z: s.z + d.z })),
      MODEL,
    );
    expect(moved.value!).toBeCloseTo(krigeBlock(block, neighbours, MODEL).value!, 8);
  });

  it('INVARIANT PAR PERMUTATION : l\'ordre des voisins est sans effet', () => {
    const base = krigeBlock(block, neighbours, MODEL);
    const shuffled = krigeBlock(block, [...neighbours].reverse(), MODEL);
    expect(shuffled.value!).toBeCloseTo(base.value!, 8);
    expect(shuffled.krigingVariance!).toBeCloseTo(base.krigingVariance!, 8);
  });

  it('CHAMP CONSTANT : toute estimation vaut la constante (Σw = 1)', () => {
    // Conséquence directe de la contrainte de non-biais. Si les poids ne
    // sommaient pas à 1, un champ homogène donnerait autre chose que sa valeur —
    // le test le plus révélateur d'un système OK mal posé.
    const flat = neighbours.map(s => ({ ...s, value: 4.2 }));
    for (const p of [block, { x: 0, y: 0, z: 0 }, { x: 190, y: 10, z: 35 }]) {
      expect(krigeBlock(p, flat, MODEL).value!).toBeCloseTo(4.2, 8);
    }
  });

  it('la variance de krigeage n\'est jamais négative', () => {
    for (const p of [block, { x: -500, y: -500, z: 0 }, { x: 0, y: 0, z: 0 }]) {
      const r = krigeBlock(p, neighbours, MODEL);
      expect(r.krigingVariance!).toBeGreaterThanOrEqual(0);
    }
  });

  it('exact sur un point de donnée, quel que soit le nombre de voisins', () => {
    for (const target of neighbours.slice(0, 4)) {
      expect(krigeBlock(target, neighbours, MODEL).value!).toBeCloseTo(target.value, 6);
    }
  });

  it('des voisins strictement dupliqués ne font pas diverger l\'estimation', () => {
    // Système singulier attendu : le module doit se replier sur la moyenne
    // plutôt que renvoyer NaN et empoisonner tout le modèle de blocs.
    const dupes = [neighbours[0], { ...neighbours[0] }, { ...neighbours[0] }];
    const r = krigeBlock(block, dupes, MODEL);
    expect(Number.isFinite(r.value!)).toBe(true);
    expect(r.value!).toBeCloseTo(neighbours[0].value, 6);
  });

  it('cas dégénérés : zéro et un voisin', () => {
    expect(krigeBlock(block, [], MODEL).value).toBeNull();
    const one = krigeBlock(block, [neighbours[0]], MODEL);
    expect(one.value).toBe(neighbours[0].value);
    expect(one.nSamples).toBe(1);
  });
});

// ═══ SÉLECTION DE VOISINAGE ══════════════════════════════════════════════════

describe('sélection de voisinage', () => {
  const samples = cloud(40, 7);
  const block = { x: 100, y: 100, z: 20 };

  it('respecte le rayon, le maximum et le minimum', () => {
    const sel = selectNeighbours(block, samples, { radius: 80, maxSamples: 6 });
    expect(sel.length).toBeLessThanOrEqual(6);
    for (const s of sel) expect(Math.hypot(s.x - block.x, s.y - block.y, s.z - block.z)).toBeLessThanOrEqual(80);
  });

  it('rend les voisins par distance croissante', () => {
    const sel = selectNeighbours(block, samples, { radius: 200, maxSamples: 20 });
    const d = sel.map(s => Math.hypot(s.x - block.x, s.y - block.y, s.z - block.z));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
  });

  it('sous le minimum requis, ne renvoie RIEN — un bloc non contraint reste non estimé', () => {
    expect(selectNeighbours(block, samples, { radius: 1, maxSamples: 10, minSamples: 3 })).toHaveLength(0);
  });

  it('élargir le rayon ne peut jamais retirer un voisin déjà retenu', () => {
    const petit = selectNeighbours(block, samples, { radius: 60, maxSamples: 50 });
    const grand = selectNeighbours(block, samples, { radius: 120, maxSamples: 50 });
    expect(grand.length).toBeGreaterThanOrEqual(petit.length);
  });
});

// ═══ IDW — combinaison convexe ═══════════════════════════════════════════════

describe('IDW — reste toujours dans l\'enveloppe des données', () => {
  const samples = cloud(12, 11);
  const block = { x: 100, y: 100, z: 20 };

  it('l\'estimation est bornée par le min et le max des voisins', () => {
    // Différence essentielle avec le krigeage : l'IDW est une combinaison
    // convexe (poids positifs de somme 1), donc jamais hors de l'enveloppe.
    const lo = Math.min(...samples.map(s => s.value));
    const hi = Math.max(...samples.map(s => s.value));
    for (const p of [2, 3, 8]) {
      const v = idwBlock(block, samples, p).value!;
      expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it('champ constant → la constante, quelle que soit la puissance', () => {
    const flat = samples.map(s => ({ ...s, value: 1.75 }));
    for (const p of [1, 2, 5]) expect(idwBlock(block, flat, p).value!).toBeCloseTo(1.75, 9);
  });

  it('invariant par permutation', () => {
    expect(idwBlock(block, [...samples].reverse(), 2).value!)
      .toBeCloseTo(idwBlock(block, samples, 2).value!, 9);
  });
});

// ═══ VARIOGRAMME ═════════════════════════════════════════════════════════════

describe('variogramme — comportement des modèles théoriques', () => {
  const types: VariogramType[] = ['spherical', 'exponential', 'gaussian'];

  it.each(types)('%s : γ(0) = 0, croissant, plafonné au palier', (type) => {
    const m: VariogramModel = { type, nugget: 0.3, sill: 2, range: 50 };
    expect(modelSemivariance(m, 0)).toBe(0);
    let prev = -Infinity;
    for (let h = 1; h <= 400; h += 3) {
      const g = modelSemivariance(m, h);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-12);   // croissance monotone
      expect(g).toBeLessThanOrEqual(m.sill + 1e-9);     // jamais au-dessus du palier
      prev = g;
    }
  });

  it.each(types)('%s : tend vers le palier à grande distance', (type) => {
    const m: VariogramModel = { type, nugget: 0.3, sill: 2, range: 50 };
    expect(modelSemivariance(m, 5000)).toBeCloseTo(m.sill, 6);
  });

  it('le modèle sphérique atteint EXACTEMENT le palier à la portée', () => {
    expect(shapeFunction('spherical', 50, 50)).toBeCloseTo(1, 12);
    expect(shapeFunction('spherical', 49.9, 50)).toBeLessThan(1);
  });

  it('juste au-delà de zéro, la semivariance part de la pépite', () => {
    const m: VariogramModel = { type: 'spherical', nugget: 0.5, sill: 2, range: 50 };
    expect(modelSemivariance(m, 1e-9)).toBeGreaterThanOrEqual(0.5);
  });

  it('portée nulle ou négative ne produit pas de NaN', () => {
    for (const range of [0, -10]) {
      const v = modelSemivariance({ type: 'spherical', nugget: 0.1, sill: 1, range }, 10);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('variogramme expérimental et ajustement', () => {
  it('un champ PUREMENT ALÉATOIRE donne un variogramme plat ≈ la variance', () => {
    // Effet de pépite pur : aucune structure spatiale, γ(h) ≈ σ² partout.
    const rnd = lcg(3);
    const samples: SamplePoint[] = Array.from({ length: 120 }, () => ({
      x: rnd() * 300, y: rnd() * 300, z: 0, value: rnd() * 2,
    }));
    const exp = experimentalVariogram(samples, { lagDistance: 25, nLags: 8 });
    const variance = summaryStats(samples.map(s => s.value)).variance;
    for (const p of exp) expect(p.semivariance).toBeCloseTo(variance, 0);
  });

  it('retrouve les paramètres d\'un modèle sphérique connu', () => {
    // Points expérimentaux générés depuis un modèle : l'ajusteur doit le
    // reconnaître. Même épreuve que pour les modèles de récupération.
    const truth: VariogramModel = { type: 'spherical', nugget: 0.4, sill: 2.0, range: 80 };
    const pts = Array.from({ length: 14 }, (_, i) => {
      const lag = (i + 1) * 10;
      return { lag, semivariance: modelSemivariance(truth, lag), pairs: 200 };
    });
    const fitted = fitVariogramModel(pts, 'spherical');
    expect(fitted.nugget).toBeCloseTo(truth.nugget, 1);
    expect(fitted.sill).toBeCloseTo(truth.sill, 1);
    expect(fitted.range).toBeCloseTo(truth.range, -1);
  });

  it('un modèle ajusté a toujours pépite ≥ 0 et palier ≥ pépite', () => {
    const rnd = lcg(9);
    const pts = Array.from({ length: 10 }, (_, i) => ({
      lag: (i + 1) * 15, semivariance: rnd() * 3, pairs: 50 + i,
    }));
    for (const type of ['spherical', 'exponential', 'gaussian'] as VariogramType[]) {
      const m = fitVariogramModel(pts, type);
      expect(m.nugget).toBeGreaterThanOrEqual(0);
      expect(m.sill).toBeGreaterThanOrEqual(m.nugget - 1e-9);
      expect(m.range).toBeGreaterThan(0);
      expect(Number.isFinite(m.sill)).toBe(true);
    }
  });

  it('trop peu de points : renvoie un modèle exploitable, pas un NaN', () => {
    const m = fitVariogramModel([{ lag: 20, semivariance: 1.2, pairs: 5 }], 'spherical');
    expect(Number.isFinite(m.sill)).toBe(true);
    expect(m.range).toBeGreaterThan(0);
    expect(Number.isFinite(fitVariogramModel([], 'spherical').sill)).toBe(true);
  });

  it('refuse des paramètres de calcul invalides', () => {
    const s = cloud(5);
    expect(() => experimentalVariogram(s, { lagDistance: 0, nLags: 5 })).toThrow();
    expect(() => experimentalVariogram(s, { lagDistance: 10, nLags: 0 })).toThrow();
  });
});

// ═══ STATISTIQUES ET DÉCLUSTERISATION ════════════════════════════════════════

describe('statistiques — écrêtage et déclusterisation', () => {
  it('l\'écrêtage ne relève jamais une valeur et borne bien le maximum', () => {
    const v = [0.1, 0.5, 1, 2, 3, 50];
    const capped = capOutliers(v, { method: 'percentile', threshold: 0.9 });
    expect(capped).toHaveLength(v.length);
    for (let i = 0; i < v.length; i++) expect(capped[i]).toBeLessThanOrEqual(v[i]);
    expect(Math.max(...capped)).toBeLessThan(50);
  });

  it('l\'écrêtage réduit la moyenne mais préserve l\'effectif', () => {
    const v = [1, 1, 1, 1, 100];
    const capped = capOutliers(v, { method: 'percentile', threshold: 0.8 });
    expect(summaryStats(capped).mean).toBeLessThan(summaryStats(v).mean);
    expect(capped).toHaveLength(v.length);
  });

  it('des poids de déclusterisation sont positifs et défini pour chaque point', () => {
    const pts = cloud(30, 5);
    const w = declusterWeights(pts, { x: 50, y: 50, z: 20 });
    expect(w).toHaveLength(pts.length);
    for (const x of w) expect(x).toBeGreaterThan(0);
  });

  it('un échantillon groupé pèse MOINS qu\'un échantillon isolé', () => {
    // Tout l'objet de la déclusterisation : ne pas laisser un amas de forages
    // rapprochés tirer la teneur moyenne du gisement.
    const pts: SamplePoint[] = [
      { x: 0, y: 0, z: 0, value: 1 }, { x: 1, y: 0, z: 0, value: 1 },
      { x: 2, y: 0, z: 0, value: 1 }, { x: 3, y: 0, z: 0, value: 1 },
      { x: 500, y: 500, z: 0, value: 1 },
    ];
    const w = declusterWeights(pts, { x: 50, y: 50, z: 20 });
    expect(w[4]).toBeGreaterThan(w[0]);
  });

  it('la moyenne pondérée est bornée par le min et le max', () => {
    const v = [1, 5, 9];
    const m = weightedMean(v, [0.2, 0.5, 0.3]);
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThanOrEqual(9);
  });
});

// ═══ CLASSIFICATION CIM ══════════════════════════════════════════════════════

describe('classification CIM — monotonie de la confiance', () => {
  const rank = { 'Mesuré': 3, 'Indiqué': 2, 'Inféré': 1 } as const;
  const score = (c: ReturnType<typeof classifyBlock>) => (c ? rank[c] : 0);

  it('rapprocher les données ne peut JAMAIS dégrader la catégorie', () => {
    for (const n of [2, 6, 12, 25]) {
      for (const holes of [1, 2, 3, 5]) {
        let prev = -1;
        // Distances décroissantes ⇒ confiance croissante.
        for (const d of [250, 180, 120, 90, 60, 40, 20]) {
          const s = score(classifyBlock({ avgDistance: d, nSamples: n, nHoles: holes }));
          expect(s, `n=${n} holes=${holes} d=${d}`).toBeGreaterThanOrEqual(prev);
          prev = s;
        }
      }
    }
  });

  it('ajouter des composites ne peut jamais dégrader la catégorie', () => {
    let prev = -1;
    for (const n of [1, 3, 6, 10, 12, 20]) {
      const s = score(classifyBlock({ avgDistance: 45, nSamples: n, nHoles: 3 }));
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('au-delà du rayon inféré, le bloc n\'est PAS classé', () => {
    const d = DEFAULT_THRESHOLDS.inferred.maxDistance + 1;
    expect(classifyBlock({ avgDistance: d, nSamples: 50, nHoles: 9 })).toBeNull();
  });

  it('un bloc sans aucun composite n\'est pas classé', () => {
    expect(classifyBlock({ avgDistance: 10, nSamples: 0, nHoles: 0 })).toBeNull();
  });

  it('les seuils sont paramétrables par projet', () => {
    const strict = {
      measured: { maxDistance: 10, minSamples: 30, minHoles: 8 },
      indicated: { maxDistance: 20, minSamples: 20, minHoles: 5 },
      inferred: { maxDistance: 30 },
    };
    const ev = { avgDistance: 45, nSamples: 12, nHoles: 3 };
    expect(classifyBlock(ev)).not.toBeNull();
    expect(classifyBlock(ev, strict)).toBeNull();
  });
});

// ═══ GRADE-TONNAGE ═══════════════════════════════════════════════════════════

describe('courbe grade-tonnage — monotonies obligatoires', () => {
  const rnd = lcg(21);
  const blocks = Array.from({ length: 300 }, () => ({
    grade: rnd() * 3, tonnes: 10_000 + rnd() * 5_000,
  }));
  const cutoffs = [0, 0.2, 0.4, 0.6, 0.9, 1.2, 1.8, 2.4];
  const curve = gradeTonnage(blocks, cutoffs);

  it('le tonnage DÉCROÎT quand le cut-off monte', () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].tonnes).toBeLessThanOrEqual(curve[i - 1].tonnes);
    }
  });

  it('la teneur moyenne CROÎT quand le cut-off monte', () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].meanGrade).toBeGreaterThanOrEqual(curve[i - 1].meanGrade - 1e-9);
    }
  });

  it('le métal contenu DÉCROÎT quand le cut-off monte', () => {
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].metal).toBeLessThanOrEqual(curve[i - 1].metal + 1e-6);
    }
  });

  it('métal = tonnage × teneur moyenne, à chaque palier', () => {
    for (const p of curve) expect(p.metal).toBeCloseTo(p.tonnes * p.meanGrade, 3);
  });

  it('au cut-off zéro, tout le gisement est compté', () => {
    expect(curve[0].tonnes).toBeCloseTo(blocks.reduce((s, b) => s + b.tonnes, 0), 3);
  });

  it('un cut-off au-dessus de la teneur maximale vide la ressource', () => {
    const [p] = gradeTonnage(blocks, [99]);
    expect(p.tonnes).toBe(0);
    expect(p.meanGrade).toBe(0);
    expect(p.metal).toBe(0);
  });
});

// ═══ VALIDATION CROISÉE ══════════════════════════════════════════════════════

describe('validation croisée — détecte le biais', () => {
  const search = { radius: 150, maxSamples: 10 };

  it('sur un champ CONSTANT, le biais et le RMSE sont nuls', () => {
    const flat = cloud(25, 13).map(s => ({ ...s, value: 2.5 }));
    const cv = crossValidate(flat, MODEL, search);
    expect(cv.n).toBeGreaterThan(10);
    expect(cv.meanError).toBeCloseTo(0, 8);
    expect(cv.rmse).toBeCloseTo(0, 8);
  });

  it('sur un champ structuré, l\'estimation reste corrélée au réel', () => {
    // Teneur en gradient spatial doux : le krigeage doit la suivre.
    const pts = cloud(45, 17).map(s => ({ ...s, value: 0.5 + s.x / 100 }));
    const cv = crossValidate(pts, MODEL, search);
    expect(cv.correlation!).toBeGreaterThan(0.7);
    expect(Math.abs(cv.meanError)).toBeLessThan(cv.rmse + 1e-9);
  });

  it('sans voisin exploitable, rend un résultat neutre plutôt qu\'un NaN', () => {
    const cv = crossValidate(cloud(6, 19), MODEL, { radius: 0.001, maxSamples: 5 });
    expect(cv.n).toBe(0);
    expect(Number.isFinite(cv.rmse)).toBe(true);
    expect(cv.correlation).toBeNull();
  });
});
