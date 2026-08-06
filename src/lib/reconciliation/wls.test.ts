import { describe, it, expect } from 'vitest';
import { reconcile, DEFAULT_RECON_CONFIDENCE, type ReconNode, type ReconStream } from './wls';
import { normalQuantile } from '../ml/distributions';

// Nœud de séparation simple : 1 entrée → 2 sorties (splitter).
//   feed → [séparateur] → conc + tail
// Bilan exact : feed = conc + tail.
const SPLIT_NODES: ReconNode[] = [
  { id: 'sep', label: 'Séparateur', inputs: ['feed'], outputs: ['conc', 'tail'] },
];

function splitStreams(feed: number, conc: number, tail: number, pct = 5): ReconStream[] {
  return [
    { id: 'feed', label: 'Alimentation', measured: feed, precisionPct: pct },
    { id: 'conc', label: 'Concentré',    measured: conc, precisionPct: pct },
    { id: 'tail', label: 'Rejet',        measured: tail, precisionPct: pct },
  ];
}

describe('reconcile — conservation de la masse', () => {
  it('rend le bilan exact à chaque nœud après réconciliation', () => {
    // feed=100 mais conc+tail=97 : déséquilibre de 3.
    const r = reconcile(SPLIT_NODES, splitStreams(100, 60, 37));
    expect(r.feasible).toBe(true);
    const feed = r.streams.find(s => s.id === 'feed')!;
    const conc = r.streams.find(s => s.id === 'conc')!;
    const tail = r.streams.find(s => s.id === 'tail')!;
    // le bilan réconcilié boucle : feed = conc + tail (à l'arrondi près)
    expect(feed.reconciled).toBeCloseTo(conc.reconciled + tail.reconciled, 2);
  });

  it('ne touche pas un bilan déjà cohérent', () => {
    const r = reconcile(SPLIT_NODES, splitStreams(100, 60, 40));
    for (const s of r.streams) {
      expect(Math.abs(s.adjustment)).toBeLessThan(1e-3);
    }
    expect(r.globalTest.gerossError).toBe(false);
  });

  it('signale le déséquilibre de nœud AVANT réconciliation', () => {
    const r = reconcile(SPLIT_NODES, splitStreams(100, 60, 37));
    // A·y = feed − conc − tail = 100 − 60 − 37 = 3
    expect(r.nodeImbalance[0].imbalance).toBeCloseTo(3, 4);
  });
});

describe('reconcile — la précision pilote l\'ajustement', () => {
  it('corrige davantage la mesure la moins précise', () => {
    // feed très précis (1 %), tail imprécis (15 %) : l'écart doit se reporter sur tail.
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 1 },
      { id: 'conc', measured: 60,  precisionPct: 5 },
      { id: 'tail', measured: 37,  precisionPct: 15 },
    ];
    const r = reconcile(SPLIT_NODES, streams);
    const feed = r.streams.find(s => s.id === 'feed')!;
    const tail = r.streams.find(s => s.id === 'tail')!;
    // le flux imprécis absorbe le plus gros ajustement absolu
    expect(Math.abs(tail.adjustment)).toBeGreaterThan(Math.abs(feed.adjustment));
  });

  it('ne modifie pas une mesure de référence figée', () => {
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 5 },
      { id: 'conc', measured: 60,  precisionPct: 5 },
      { id: 'tail', measured: 37,  precisionPct: 5, fixed: true },
    ];
    const r = reconcile(SPLIT_NODES, streams);
    const tail = r.streams.find(s => s.id === 'tail')!;
    expect(Math.abs(tail.adjustment)).toBeLessThan(0.05);
    expect(tail.isSuspect).toBe(false);
  });
});

describe('reconcile — détection d\'erreur grossière', () => {
  it('ne lève aucun drapeau sur un petit bruit cohérent avec la précision', () => {
    const r = reconcile(SPLIT_NODES, splitStreams(100, 60, 39, 5));
    expect(r.globalTest.gerossError).toBe(false);
    expect(r.worstSensor).toBeNull();
  });

  it('détecte un biais capteur grossier et le désigne', () => {
    // tail lit 20 alors que la cohérence voudrait ~40 : biais énorme sur un capteur précis.
    const streams: ReconStream[] = [
      { id: 'feed', label: 'Alimentation', measured: 100, precisionPct: 2 },
      { id: 'conc', label: 'Concentré',    measured: 60,  precisionPct: 2 },
      { id: 'tail', label: 'Rejet',        measured: 20,  precisionPct: 2 },
    ];
    const r = reconcile(SPLIT_NODES, streams);
    expect(r.globalTest.gerossError).toBe(true);
    expect(r.worstSensor).not.toBeNull();
    expect(r.streams.some(s => s.isSuspect)).toBe(true);
  });

  it('reproduit à 95 % les seuils littéraux d\'origine (1.96 et 1.6448536)', () => {
    // Régression : les deux seuils étaient deux littéraux indépendants ; ils sont
    // désormais dérivés du seul niveau de confiance et doivent redonner les mêmes
    // valeurs au niveau conventionnel AMIRA P754.
    expect(DEFAULT_RECON_CONFIDENCE).toBe(0.95);
    expect(normalQuantile(1 - (1 - 0.95) / 2)).toBeCloseTo(1.96, 3);      // test par mesure (bilatéral)
    expect(normalQuantile(0.95)).toBeCloseTo(1.6448536, 5);               // test global χ² (unilatéral)
  });

  it('un niveau de confiance plus strict remonte moins de capteurs suspects', () => {
    const streams: ReconStream[] = [
      { id: 'feed', label: 'Alimentation', measured: 100, precisionPct: 2 },
      { id: 'conc', label: 'Concentré',    measured: 60,  precisionPct: 2 },
      { id: 'tail', label: 'Rejet',        measured: 36,  precisionPct: 2 },
    ];
    const at95 = reconcile(SPLIT_NODES, streams, 0.95).streams.filter(s => s.isSuspect).length;
    const at9999 = reconcile(SPLIT_NODES, streams, 0.9999).streams.filter(s => s.isSuspect).length;
    expect(at9999).toBeLessThanOrEqual(at95);
  });
});

describe('reconcile — réseau à plusieurs nœuds', () => {
  // Circuit : feed → broyage → [split] conc/tail, conc → lixiviation → produit/résidu
  const NODES: ReconNode[] = [
    { id: 'grind', label: 'Broyage',      inputs: ['feed'],   outputs: ['ground'] },
    { id: 'split', label: 'Flottation',   inputs: ['ground'], outputs: ['conc', 'rougher_tail'] },
    { id: 'leach', label: 'Lixiviation',  inputs: ['conc'],   outputs: ['loaded', 'leach_tail'] },
  ];

  it('boucle chaque nœud interne du circuit', () => {
    const streams: ReconStream[] = [
      { id: 'feed',         measured: 100, precisionPct: 3 },
      { id: 'ground',       measured: 99,  precisionPct: 3 },
      { id: 'conc',         measured: 30,  precisionPct: 5 },
      { id: 'rougher_tail', measured: 68,  precisionPct: 5 },
      { id: 'loaded',       measured: 2,   precisionPct: 8 },
      { id: 'leach_tail',   measured: 27,  precisionPct: 5 },
    ];
    const r = reconcile(NODES, streams);
    expect(r.feasible).toBe(true);
    const val = (id: string) => r.streams.find(s => s.id === id)!.reconciled;
    expect(val('feed')).toBeCloseTo(val('ground'), 1);
    expect(val('ground')).toBeCloseTo(val('conc') + val('rougher_tail'), 1);
    expect(val('conc')).toBeCloseTo(val('loaded') + val('leach_tail'), 1);
  });

  it('calcule la clôture du circuit entrée/sortie', () => {
    const streams: ReconStream[] = [
      { id: 'feed',         measured: 100, precisionPct: 3 },
      { id: 'ground',       measured: 100, precisionPct: 3 },
      { id: 'conc',         measured: 30,  precisionPct: 5 },
      { id: 'rougher_tail', measured: 70,  precisionPct: 5 },
      { id: 'loaded',       measured: 2,   precisionPct: 8 },
      { id: 'leach_tail',   measured: 28,  precisionPct: 5 },
    ];
    const r = reconcile(NODES, streams);
    // entrées nettes = feed ; sorties nettes = rougher_tail + loaded + leach_tail
    expect(r.closurePct).toBeGreaterThan(95);
    expect(r.closurePct).toBeLessThan(105);
  });
});

describe('reconcile — robustesse', () => {
  it('renvoie un résultat non faisable sur un réseau vide', () => {
    expect(reconcile([], []).feasible).toBe(false);
    expect(reconcile(SPLIT_NODES, []).feasible).toBe(false);
  });

  it('ne produit jamais de NaN', () => {
    const r = reconcile(SPLIT_NODES, splitStreams(100, 60, 37));
    for (const s of r.streams) {
      expect(Number.isFinite(s.reconciled)).toBe(true);
      expect(Number.isFinite(s.adjustment)).toBe(true);
      expect(Number.isFinite(s.suspicionScore)).toBe(true);
    }
    expect(Number.isFinite(r.globalTest.statistic)).toBe(true);
  });

  it('gère une mesure nulle sans division par zéro', () => {
    const r = reconcile(SPLIT_NODES, splitStreams(100, 100, 0));
    expect(r.streams.every(s => Number.isFinite(s.adjustmentPct))).toBe(true);
  });
});
