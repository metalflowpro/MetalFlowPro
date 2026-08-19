import { describe, it, expect } from 'vitest';
import { paretoFront, weightedRanking, type ObjectiveSpec } from './multiObjective';

interface P { p80: number; recovery: number; throughput: number; }
const specs: ObjectiveSpec<'recovery' | 'throughput'>[] = [
  { key: 'recovery', direction: 'max' },
  { key: 'throughput', direction: 'max' },
];
const obj = (p: P) => ({ recovery: p.recovery, throughput: p.throughput });

// Trade-off: finer P80 → higher recovery, lower throughput.
const items: P[] = [
  { p80: 150, recovery: 84, throughput: 100 },
  { p80: 106, recovery: 88, throughput: 95 },
  { p80: 75, recovery: 91, throughput: 88 },
  { p80: 90, recovery: 86, throughput: 90 }, // dominated by 106 (worse on both)
];

describe('paretoFront', () => {
  it('excludes dominated points and keeps the trade-off frontier', () => {
    const { front, isOptimal } = paretoFront(items, obj, specs);
    const p80s = front.map(f => f.p80).sort((a, b) => a - b);
    expect(p80s).toEqual([75, 106, 150]);
    expect(isOptimal[3]).toBe(false); // the 90 µm point is dominated
  });

  it('all points are optimal when none dominates another', () => {
    const anti: P[] = [
      { p80: 1, recovery: 90, throughput: 80 },
      { p80: 2, recovery: 80, throughput: 90 },
    ];
    expect(paretoFront(anti, obj, specs).front.length).toBe(2);
  });
});

describe('weightedRanking', () => {
  it('weighting recovery heavily picks the finest grind', () => {
    const ranked = weightedRanking(items, obj,
      [{ key: 'recovery', direction: 'max', weight: 3 }, { key: 'throughput', direction: 'max', weight: 0 }]);
    expect(ranked[0].item.p80).toBe(75);
  });

  it('weighting throughput heavily picks the coarsest grind', () => {
    const ranked = weightedRanking(items, obj,
      [{ key: 'recovery', direction: 'max', weight: 0 }, { key: 'throughput', direction: 'max', weight: 3 }]);
    expect(ranked[0].item.p80).toBe(150);
  });

  it('scores lie in [0,1] and are sorted descending', () => {
    const ranked = weightedRanking(items, obj, specs);
    for (const r of ranked) { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(1); }
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
  });
});
