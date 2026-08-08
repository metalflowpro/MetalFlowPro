import { describe, it, expect } from 'vitest';
import { tornado, spider } from './sensitivity';

interface Model { a: number; b: number; c: number }
// Sortie linéaire : plus le coefficient est grand, plus la variable pèse.
const evaluate = (m: Model) => 2 * m.a + 5 * m.b + 0.5 * m.c;

describe('tornado', () => {
  const base: Model = { a: 10, b: 10, c: 10 };
  const vars = [
    { key: 'a' as const, label: 'A', low: 5, high: 15 },
    { key: 'b' as const, label: 'B', low: 5, high: 15 },
    { key: 'c' as const, label: 'C', low: 5, high: 15 },
  ];

  it('computes the base output', () => {
    expect(tornado(base, vars, evaluate).baseOutput).toBe(75);
  });

  it('orders bars by swing, largest first', () => {
    const { bars } = tornado(base, vars, evaluate);
    expect(bars.map(b => b.label)).toEqual(['B', 'A', 'C']); // 5·10=50, 2·10=20, 0.5·10=5
    expect(bars[0].swing).toBe(50);
    expect(bars[2].swing).toBe(5);
  });

  it('reports deltas relative to base', () => {
    const { bars } = tornado(base, vars, evaluate);
    const a = bars.find(b => b.label === 'A')!;
    expect(a.lowOutput).toBe(65);   // a=5 → 2·5+50+5
    expect(a.highOutput).toBe(85);  // a=15
    expect(a.lowDelta).toBe(-10);
    expect(a.highDelta).toBe(10);
  });

  it('does not mutate the base object', () => {
    const b = { ...base };
    tornado(b, vars, evaluate);
    expect(b).toEqual(base);
  });

  it('handles inverted low/high (negative coefficient) via absolute swing', () => {
    const inv = (m: Model) => -3 * m.a;
    const { bars } = tornado(base, [{ key: 'a', label: 'A', low: 5, high: 15 }], inv);
    expect(bars[0].lowOutput).toBe(-15);
    expect(bars[0].highOutput).toBe(-45);
    expect(bars[0].swing).toBe(30);
  });
});

describe('spider', () => {
  const base: Model = { a: 10, b: 10, c: 10 };
  it('sweeps each variable across relative steps', () => {
    const { steps, lines } = spider(base, [{ key: 'a', label: 'A' }], [-0.1, 0, 0.1], evaluate);
    expect(steps).toEqual([-0.1, 0, 0.1]);
    const a = lines[0];
    // base output 75; a varies ±10% → ±1 in a → ±2 in output
    expect(a.outputs[0]).toBeCloseTo(73, 9);
    expect(a.outputs[1]).toBeCloseTo(75, 9);
    expect(a.outputs[2]).toBeCloseTo(77, 9);
  });
});
