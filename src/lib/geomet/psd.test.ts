import { describe, it, expect } from 'vitest';
import {
  p80FromPsd, p80Interpolation, passingCurveFromRetained,
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

  it('ignores missing bands and clamps cumulative passing to [0,100]', () => {
    const curve = passingCurveFromRetained([
      { sieve: 212, pct: null }, { sieve: 150, pct: 10 }, { sieve: 75, pct: 120 },
    ]);
    expect(curve).toEqual([
      { sieve: 75, passing: 0 }, { sieve: 150, passing: 90 },
    ]);
  });

  it('uses each +X LIMS field as a retained band and derives P80 from the shared curve', () => {
    const curve = passingCurveFromRetained([
      { sieve: 500, pct: 4 }, { sieve: 212, pct: 14 }, { sieve: 150, pct: 12 },
      { sieve: 106, pct: 15 }, { sieve: 75, pct: 17 }, { sieve: 53, pct: 12 }, { sieve: 38, pct: 10 },
    ]);
    expect(curve.find(p => p.sieve === 38)!.passing).toBe(16);
    expect(curve.find(p => p.sieve === 212)!.passing).toBe(82);
    expect(curve.find(p => p.sieve === 500)!.passing).toBe(96);
    const p80 = p80FromPsd(curve)!;
    expect(p80).toBeGreaterThan(150);
    expect(p80).toBeLessThan(212);
  });

  it('returns a monotone fine-to-coarse curve for valid retained bands', () => {
    const curve = passingCurveFromRetained([
      { sieve: 500, pct: 5 }, { sieve: 212, pct: 15 }, { sieve: 75, pct: 35 }, { sieve: 38, pct: 25 },
    ]);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].passing).toBeGreaterThanOrEqual(curve[i - 1].passing);
    }
    expect(curve.map(p => p.sieve)).toEqual([38, 75, 212, 500]);
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

describe('p80Interpolation — le cheminement du calcul', () => {
  // Courbe encadrant 80 % entre 106 µm (76 %) et 150 µm (86 %).
  const CURVE = [
    { sieve: 38, passing: 35 }, { sieve: 75, passing: 62 },
    { sieve: 106, passing: 76 }, { sieve: 150, passing: 86 },
    { sieve: 212, passing: 94 },
  ];

  it('donne EXACTEMENT le même P80 que p80FromPsd', () => {
    // Invariant central : l'écran montre le cheminement du chiffre calculé,
    // pas d'un chiffre recalculé autrement.
    expect(p80Interpolation(CURVE).p80Um).toBe(p80FromPsd(CURVE));
  });

  it('restitue les tamis encadrants et la fraction interpolée', () => {
    const r = p80Interpolation(CURVE);
    expect(r.method).toBe('log_interpolation');
    expect(r.lower).toEqual({ sieve: 106, passing: 76 });
    expect(r.upper).toEqual({ sieve: 150, passing: 86 });
    // f = (80 − 76) / (86 − 76) = 0,4
    expect(r.fraction).toBeCloseTo(0.4, 10);
  });

  it('applique bien la formule log-linéaire annoncée', () => {
    const r = p80Interpolation(CURVE);
    const attendu = Math.exp(Math.log(106) + 0.4 * (Math.log(150) - Math.log(106)));
    expect(r.p80Um!).toBeCloseTo(attendu, 10);
    // Le résultat tombe entre les deux tamis encadrants.
    expect(r.p80Um!).toBeGreaterThan(106);
    expect(r.p80Um!).toBeLessThan(150);
  });

  it('interpole en LOG, pas en linéaire', () => {
    // À f = 0,5 l'interpolation log donne la moyenne géométrique, pas
    // l'arithmétique — c'est toute la différence sur une échelle de tamis.
    const c = [{ sieve: 100, passing: 70 }, { sieve: 400, passing: 90 }];
    const r = p80Interpolation(c);
    expect(r.fraction).toBeCloseTo(0.5, 10);
    expect(r.p80Um!).toBeCloseTo(200, 6);   // √(100×400) = 200
    expect(r.p80Um!).not.toBeCloseTo(250, 1); // moyenne arithmétique
  });

  it('signale un tamis tombant pile à 80 % (aucune interpolation)', () => {
    const r = p80Interpolation([{ sieve: 75, passing: 60 }, { sieve: 150, passing: 80 }]);
    expect(r.method).toBe('exact');
    expect(r.p80Um).toBe(150);
    expect(r.lower).toBeNull();
    expect(r.fraction).toBeNull();
  });

  it('distingue « hors plage » de « données insuffisantes »', () => {
    // Tout plus fin que 80 % : le tamis de tête n'est qu'une borne inférieure.
    const tooFine = p80Interpolation([{ sieve: 38, passing: 20 }, { sieve: 75, passing: 45 }]);
    expect(tooFine.method).toBe('out_of_range');
    expect(tooFine.p80Um).toBeNull();

    const tooFew = p80Interpolation([{ sieve: 75, passing: 60 }]);
    expect(tooFew.method).toBe('insufficient_data');
    expect(tooFew.p80Um).toBeNull();
  });

  it('trie et nettoie la courbe avant de raisonner', () => {
    const messy = [
      { sieve: 150, passing: 86 }, { sieve: -5, passing: 10 },
      { sieve: 106, passing: 76 }, { sieve: 38, passing: 35 },
      { sieve: 75, passing: NaN },
    ];
    const r = p80Interpolation(messy);
    expect(r.curve.map(p => p.sieve)).toEqual([38, 106, 150]); // trié, sans invalides
    expect(r.p80Um).toBeCloseTo(p80Interpolation(CURVE).p80Um!, 10);
  });
});
