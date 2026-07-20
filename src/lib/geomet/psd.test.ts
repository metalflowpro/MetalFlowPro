import { describe, it, expect } from 'vitest';
import {
  p80FromPsd, passingCurveFromRetained,
  speedEfficiency, specificPowerKwT, appliedEnergyKwhT,
  grindProductP80, timeToReachP80, grindRecommendations,
  GRIND_REFERENCE,
} from './psd';
import { bondEnergy } from './p80';

describe('p80FromPsd', () => {
  it('returns the sieve on an exact 80 % passing hit', () => {
    expect(p80FromPsd([
      { sieve: 75, passing: 60 }, { sieve: 106, passing: 80 }, { sieve: 150, passing: 95 },
    ])).toBe(106);
  });

  it('interpolates log-linearly between bracketing sieves', () => {
    const p80 = p80FromPsd([
      { sieve: 75, passing: 70 }, { sieve: 150, passing: 90 },
    ])!;
    // Halfway in passing → geometric mean in size: √(75·150) ≈ 106.07
    expect(p80).toBeGreaterThan(105);
    expect(p80).toBeLessThan(107);
  });

  it('is order-insensitive', () => {
    const a = p80FromPsd([{ sieve: 150, passing: 90 }, { sieve: 75, passing: 70 }])!;
    const b = p80FromPsd([{ sieve: 75, passing: 70 }, { sieve: 150, passing: 90 }])!;
    expect(a).toBeCloseTo(b, 10);
  });

  it('returns null when 80 % passing is outside the measured range', () => {
    expect(p80FromPsd([{ sieve: 75, passing: 85 }, { sieve: 150, passing: 98 }])).toBeNull();
    expect(p80FromPsd([{ sieve: 75, passing: 30 }, { sieve: 150, passing: 60 }])).toBeNull();
  });

  it('returns null with fewer than 2 valid points', () => {
    expect(p80FromPsd([{ sieve: 75, passing: 80 }])).toBeNull();
    expect(p80FromPsd([])).toBeNull();
  });
});

describe('passingCurveFromRetained', () => {
  it('accumulates retained coarse→fine and returns passing fine→coarse', () => {
    const curve = passingCurveFromRetained([
      { sieve: 212, pct: 10 }, { sieve: 150, pct: 15 }, { sieve: 75, pct: 25 },
    ]);
    // 212: 100−10=90 · 150: 100−25=75 · 75: 100−50=50
    expect(curve).toEqual([
      { sieve: 75, passing: 50 }, { sieve: 150, passing: 75 }, { sieve: 212, passing: 90 },
    ]);
  });

  it('treats null retained as 0 and clamps to [0,100]', () => {
    const curve = passingCurveFromRetained([{ sieve: 212, pct: null }, { sieve: 75, pct: 120 }]);
    expect(curve[1].passing).toBe(100);
    expect(curve[0].passing).toBe(0);
  });
});

describe('lab grind model', () => {
  const BWI = 15, F80 = 12000;

  it('speed efficiency peaks at the reference speed', () => {
    const atRef = speedEfficiency(GRIND_REFERENCE.SPEED_PCT);
    expect(atRef).toBe(1);
    expect(speedEfficiency(55)).toBeLessThan(atRef);
    expect(speedEfficiency(95)).toBeLessThan(atRef);
  });

  it('power draw scales with ball charge and caps above the shoulder', () => {
    const p35 = specificPowerKwT(35, 75);
    expect(p35).toBeCloseTo(GRIND_REFERENCE.POWER_KW_T, 6);
    expect(specificPowerKwT(20, 75)).toBeLessThan(p35);
    // Beyond 45 % the charge is clamped — no extra useful power
    expect(specificPowerKwT(60, 75)).toBeCloseTo(specificPowerKwT(45, 75), 10);
  });

  it('longer grind → finer product (monotone)', () => {
    const p30 = grindProductP80(BWI, F80, { speedPctCritical: 75, ballChargePct: 35, timeMin: 30 })!;
    const p60 = grindProductP80(BWI, F80, { speedPctCritical: 75, ballChargePct: 35, timeMin: 60 })!;
    const p90 = grindProductP80(BWI, F80, { speedPctCritical: 75, ballChargePct: 35, timeMin: 90 })!;
    expect(p60).toBeLessThan(p30);
    expect(p90).toBeLessThan(p60);
  });

  it('zero grind time returns the feed size', () => {
    expect(grindProductP80(BWI, F80, { speedPctCritical: 75, ballChargePct: 35, timeMin: 0 })).toBe(F80);
  });

  it('product P80 inverts Bond exactly: E(applied) = bondEnergy(feed → product)', () => {
    const params = { speedPctCritical: 75, ballChargePct: 35, timeMin: 60 };
    const p80 = grindProductP80(BWI, F80, params)!;
    expect(bondEnergy(BWI, F80, p80)).toBeCloseTo(appliedEnergyKwhT(params), 6);
  });

  it('timeToReachP80 round-trips with grindProductP80', () => {
    const t = timeToReachP80(BWI, F80, 75, 75, 35)!;
    const p80 = grindProductP80(BWI, F80, { speedPctCritical: 75, ballChargePct: 35, timeMin: t })!;
    expect(p80).toBeCloseTo(75, 4);
  });

  it('timeToReachP80 rejects a target coarser than the feed', () => {
    expect(timeToReachP80(BWI, F80, 15000, 75, 35)).toBeNull();
  });
});

describe('grindRecommendations', () => {
  const BWI = 15, F80 = 12000;

  it('flags speed and charge outside the efficient windows', () => {
    const recs = grindRecommendations(BWI, F80, 75, { speedPctCritical: 55, ballChargePct: 20, timeMin: 45 });
    const texts = recs.map(r => r.text).join(' | ');
    expect(texts).toContain('Vitesse');
    expect(texts).toContain('Charge de boulets');
  });

  it('recommends longer grinding when predicted P80 is coarser than the optimum', () => {
    const recs = grindRecommendations(BWI, F80, 75, { speedPctCritical: 75, ballChargePct: 35, timeMin: 20 });
    expect(recs.some(r => r.text.includes('prolonger'))).toBe(true);
  });

  it('flags over-grinding when predicted P80 is finer than the optimum', () => {
    const recs = grindRecommendations(BWI, F80, 150, { speedPctCritical: 75, ballChargePct: 35, timeMin: 120 });
    expect(recs.some(r => r.text.includes('sur-broyage'))).toBe(true);
  });

  it('reports no time adjustment when settings already hit the optimum', () => {
    const t = timeToReachP80(BWI, F80, 75, 75, 35)!;
    const recs = grindRecommendations(BWI, F80, 75, { speedPctCritical: 75, ballChargePct: 35, timeMin: t });
    expect(recs.some(r => r.text.includes('aucun ajustement'))).toBe(true);
  });
});
