import { describe, it, expect } from 'vitest';
import { desurveyHole, pointAtDepth, intervalMidpoint, type Collar, type SurveyStation } from './desurvey';

const COLLAR: Collar = { holeId: 'DH-01', x: 1000, y: 2000, z: 500, maxDepth: 100 };

describe('desurveyHole', () => {
  it('trou vertical : ne bouge qu’en Z (élévation), descend de la profondeur mesurée', () => {
    const surveys: SurveyStation[] = [
      { depth: 0, azimuth: 0, dip: -90 },
      { depth: 100, azimuth: 0, dip: -90 },
    ];
    const trace = desurveyHole(COLLAR, surveys);
    const end = trace[trace.length - 1];
    expect(end.x).toBeCloseTo(1000, 6);
    expect(end.y).toBeCloseTo(2000, 6);
    expect(end.z).toBeCloseTo(400, 6); // 500 - 100
  });

  it('trou à -45° vers l’Est : run horizontal et chute = MD·cos/sin(45°)', () => {
    const surveys: SurveyStation[] = [
      { depth: 0, azimuth: 90, dip: -45 },
      { depth: 100, azimuth: 90, dip: -45 },
    ];
    const trace = desurveyHole(COLLAR, surveys);
    const end = trace[trace.length - 1];
    const run = 100 * Math.cos(Math.PI / 4); // ≈ 70,71
    expect(end.x).toBeCloseTo(1000 + run, 4); // Est = +X
    expect(end.y).toBeCloseTo(2000, 4);
    expect(end.z).toBeCloseTo(500 - run, 4); // chute
  });

  it('prolonge tangentiellement depuis le collier si la 1re station est plus bas', () => {
    const surveys: SurveyStation[] = [{ depth: 50, azimuth: 0, dip: -90 }];
    const trace = desurveyHole(COLLAR, surveys);
    // première station synthétique à MD 0 au collier
    expect(trace[0]).toMatchObject({ md: 0, x: 1000, y: 2000, z: 500 });
    const end = trace[trace.length - 1];
    expect(end.z).toBeCloseTo(450, 6);
  });

  it('lève si le collier a des coordonnées non finies', () => {
    expect(() => desurveyHole({ ...COLLAR, x: NaN }, [])).toThrow(/non finies/);
  });
});

describe('pointAtDepth / intervalMidpoint', () => {
  const trace = desurveyHole(COLLAR, [
    { depth: 0, azimuth: 90, dip: -45 },
    { depth: 100, azimuth: 90, dip: -45 },
  ]);

  it('interpole exactement au milieu d’un trou droit', () => {
    const p = pointAtDepth(trace, 50);
    const run = 50 * Math.cos(Math.PI / 4);
    expect(p.x).toBeCloseTo(1000 + run, 4);
    expect(p.z).toBeCloseTo(500 - run, 4);
  });

  it('borne aux extrémités hors intervalle', () => {
    expect(pointAtDepth(trace, -10)).toMatchObject({ x: 1000, y: 2000, z: 500 });
    const end = pointAtDepth(trace, 999);
    expect(end.z).toBeCloseTo(500 - 100 * Math.cos(Math.PI / 4), 4);
  });

  it('intervalMidpoint renvoie milieu + longueur', () => {
    const m = intervalMidpoint(trace, 40, 60);
    expect(m.length).toBe(20);
    const run = 50 * Math.cos(Math.PI / 4);
    expect(m.x).toBeCloseTo(1000 + run, 4);
  });
});
