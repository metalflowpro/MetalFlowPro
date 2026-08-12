import { describe, it, expect } from 'vitest';
import { eliminateGrossErrorsSerial } from './grossError';
import { reconcile, type ReconNode, type ReconStream } from './wls';

// Splitter : feed → conc + tail.
const SPLIT_NODES: ReconNode[] = [
  { id: 'sep', label: 'Séparateur', inputs: ['feed'], outputs: ['conc', 'tail'] },
];

// Chaîne série : feed → a → b → prod. Un biais sur `prod` (non corroboré par un
// autre nœud) est LOCALISABLE, contrairement au splitter à une seule redondance
// où les scores standardisés de tous les flux d'un même nœud sont identiques.
const SERIES_NODES: ReconNode[] = [
  { id: 'n1', label: 'Broyage',    inputs: ['feed'], outputs: ['a'] },
  { id: 'n2', label: 'Flottation', inputs: ['a'],    outputs: ['b'] },
  { id: 'n3', label: 'Lixiviation', inputs: ['b'],   outputs: ['prod'] },
];
function seriesStreams(prod: number, pct = 2): ReconStream[] {
  return [
    { id: 'feed', label: 'Alimentation', measured: 100, precisionPct: pct },
    { id: 'a',    label: 'Broyé',        measured: 100, precisionPct: pct },
    { id: 'b',    label: 'Flotté',       measured: 100, precisionPct: pct },
    { id: 'prod', label: 'Produit',      measured: prod, precisionPct: pct },
  ];
}

describe('eliminateGrossErrorsSerial — assainissement', () => {
  it('ne retire rien quand aucune erreur grossière', () => {
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 5 },
      { id: 'conc', measured: 60, precisionPct: 5 },
      { id: 'tail', measured: 39, precisionPct: 5 },
    ];
    const r = eliminateGrossErrorsSerial(SPLIT_NODES, streams);
    expect(r.initialGrossError).toBe(false);
    expect(r.eliminated).toHaveLength(0);
    expect(r.cleared).toBe(true);
  });

  it('localise et retire le capteur biaisé, puis assainit le circuit', () => {
    // prod lit 80 au lieu de 100 : biais grossier sur un flux non corroboré.
    const r = eliminateGrossErrorsSerial(SERIES_NODES, seriesStreams(80));
    expect(r.initialGrossError).toBe(true);
    expect(r.eliminated.length).toBeGreaterThanOrEqual(1);
    expect(r.eliminated[0].id).toBe('prod');
    expect(r.cleared).toBe(true);
    expect(r.result.globalTest.gerossError).toBe(false);
  });

  it('enregistre γ avant retrait et le score du suspect', () => {
    const r = eliminateGrossErrorsSerial(SERIES_NODES, seriesStreams(80));
    const first = r.eliminated[0];
    expect(first.gammaBefore).toBeGreaterThan(first.thresholdBefore);
    expect(first.score).toBeGreaterThan(0);
  });

  it('ne retire jamais une mesure de référence figée', () => {
    // tail figé et biaisé : la procédure ne doit pas l'éliminer (référence).
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 2 },
      { id: 'conc', measured: 60,  precisionPct: 2 },
      { id: 'tail', measured: 20,  precisionPct: 2, fixed: true },
    ];
    const r = eliminateGrossErrorsSerial(SPLIT_NODES, streams);
    expect(r.eliminated.some(e => e.id === 'tail')).toBe(false);
  });

  it('respecte maxEliminations', () => {
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 2 },
      { id: 'conc', measured: 60,  precisionPct: 2 },
      { id: 'tail', measured: 20,  precisionPct: 2 },
    ];
    const r = eliminateGrossErrorsSerial(SPLIT_NODES, streams, { maxEliminations: 0 });
    expect(r.eliminated).toHaveLength(0);
    // aucune élimination autorisée → reste en erreur grossière
    expect(r.cleared).toBe(false);
  });
});

describe('eliminateGrossErrorsSerial — cohérence avec reconcile', () => {
  it('boucle chaque nœud et fait flotter la mesure éliminée', () => {
    const r = eliminateGrossErrorsSerial(SERIES_NODES, seriesStreams(80));
    const val = (id: string) => r.result.streams.find(s => s.id === id)!.reconciled;
    // chaque nœud série boucle après assainissement
    expect(val('feed')).toBeCloseTo(val('a'), 1);
    expect(val('a')).toBeCloseTo(val('b'), 1);
    expect(val('b')).toBeCloseTo(val('prod'), 1);
    // prod (dé-pondéré) a flotté de 80 vers ~100 pour boucler
    expect(val('prod')).toBeGreaterThan(95);
  });

  it('un réseau propre donne la même réconciliation que reconcile direct', () => {
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 5 },
      { id: 'conc', measured: 60, precisionPct: 5 },
      { id: 'tail', measured: 39, precisionPct: 5 },
    ];
    const serial = eliminateGrossErrorsSerial(SPLIT_NODES, streams);
    const direct = reconcile(SPLIT_NODES, streams);
    for (const d of direct.streams) {
      const s = serial.result.streams.find(x => x.id === d.id)!;
      expect(s.reconciled).toBeCloseTo(d.reconciled, 4);
    }
  });
});

describe('eliminateGrossErrorsSerial — robustesse', () => {
  it('réseau vide : non faisable, aucune élimination', () => {
    const r = eliminateGrossErrorsSerial([], []);
    expect(r.cleared).toBe(false);
    expect(r.eliminated).toHaveLength(0);
  });

  it('ne produit jamais de NaN', () => {
    const streams: ReconStream[] = [
      { id: 'feed', measured: 100, precisionPct: 2 },
      { id: 'conc', measured: 60, precisionPct: 2 },
      { id: 'tail', measured: 20, precisionPct: 2 },
    ];
    const r = eliminateGrossErrorsSerial(SPLIT_NODES, streams);
    for (const s of r.result.streams) expect(Number.isFinite(s.reconciled)).toBe(true);
    expect(Number.isFinite(r.result.globalTest.statistic)).toBe(true);
  });
});
