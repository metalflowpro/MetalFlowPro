import { describe, it, expect } from 'vitest';
import {
  fitByproductRecovery, predictByproductRecovery, byproductFromRatio,
  type ByproductPoint,
} from './byproductRecovery';
import { fitStageModel, predictStage, STAGE_FIT_SETTINGS } from './stageRecoveryModel';

const S = { ...STAGE_FIT_SETTINGS };

/** Essais appariés générés depuis une relation connue. */
const paired = (auRecs: number[], f: (au: number) => number): ByproductPoint[] =>
  auRecs.map(au => ({ primaryRecoveryPct: au, byproductRecoveryPct: f(au) }));

const AU_RECS = [35, 45, 55, 65, 75, 80, 85, 90, 95, 99];

describe('retrouve la relation Au → Ag publiée du PFS', () => {
  // Spanish Mountain PFS 2021 §13.5.2, figure 13-13 :
  //     Récup. Ag = 0,6897 × Récup. Au − 16,076
  const PFS = (au: number) => 0.6897 * au - 16.076;

  it('ajuste exactement les coefficients du rapport', () => {
    const bp = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, PFS), S)!;
    expect(bp.model.a).toBeCloseTo(0.6897, 4);
    expect(bp.model.b).toBeCloseTo(-16.076, 3);
    expect(bp.model.rSquared).toBeCloseTo(1, 6);
  });

  it('reproduit les 38–42 % d\'argent annoncés pour 85–92 % d\'or', () => {
    const bp = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, PFS), S)!;
    expect(predictByproductRecovery(bp, 85)!.recoveryPct).toBeCloseTo(42.5, 0);
    expect(predictByproductRecovery(bp, 90.8)!.recoveryPct).toBeCloseTo(46.5, 0);
  });

  it('expose une équation lisible et traçable', () => {
    const bp = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, PFS), S)!;
    expect(bp.equation).toMatch(/Récup\. Ag = 0\.6897 × Récup\. Au − 16\.076/);
    expect(predictByproductRecovery(bp, 90)!.basis).toMatch(/R² = 1\.000/);
  });

  it('une ordonnée NÉGATIVE ne produit jamais de récupération négative', () => {
    // Le cas du PFS : à faible récupération d'or, la droite passe sous zéro.
    const bp = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, PFS), S)!;
    for (const au of [0, 5, 15, 23]) {
      const p = predictByproductRecovery(bp, au)!;
      expect(p.recoveryPct).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('bornage et robustesse', () => {
  const PFS = (au: number) => 0.6897 * au - 16.076;
  const bp = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, PFS), S)!;

  it('borne à la plage des essais et le signale', () => {
    expect(predictByproductRecovery(bp, 90)!.extrapolated).toBe(false);
    const bas = predictByproductRecovery(bp, 10)!;
    expect(bas.extrapolated).toBe(true);
    expect(bas.basis).toMatch(/hors plage/);
  });

  it('reste dans [0, 100] sur toute entrée plausible', () => {
    for (const au of [0, 1, 50, 100, 1000]) {
      const p = predictByproductRecovery(bp, au)!;
      expect(p.recoveryPct).toBeGreaterThanOrEqual(0);
      expect(p.recoveryPct).toBeLessThanOrEqual(100);
    }
  });

  it('refuse une récupération principale non exploitable', () => {
    for (const au of [-1, NaN, Infinity]) expect(predictByproductRecovery(bp, au)).toBeNull();
  });

  it('encaisse du bruit sans dériver', () => {
    const bruite = AU_RECS.map((au, i) => ({
      primaryRecoveryPct: au,
      byproductRecoveryPct: PFS(au) + (i % 2 === 0 ? 3 : -3),
    }));
    const m = fitByproductRecovery('Au', 'Ag', bruite, S)!;
    expect(m.model.a).toBeGreaterThan(0.55);
    expect(m.model.a).toBeLessThan(0.85);
  });
});

describe('refuse ce que les essais ne soutiennent pas', () => {
  it('trop peu d\'essais appariés', () => {
    const pts = paired([70, 80, 90], au => 0.7 * au - 16);
    expect(fitByproductRecovery('Au', 'Ag', pts, S)).toBeNull();
  });

  it('récupérations principales toutes identiques — rien à expliquer', () => {
    const pts = paired([80, 80, 80, 80, 80], () => 40);
    expect(fitByproductRecovery('Au', 'Ag', pts, S)).toBeNull();
  });

  it('aucun essai', () => {
    expect(fitByproductRecovery('Au', 'Ag', [], S)).toBeNull();
  });

  it('signale un ajustement faiblement soutenu au lieu de le masquer', () => {
    const pts: ByproductPoint[] = [
      { primaryRecoveryPct: 60, byproductRecoveryPct: 70 },
      { primaryRecoveryPct: 70, byproductRecoveryPct: 20 },
      { primaryRecoveryPct: 80, byproductRecoveryPct: 65 },
      { primaryRecoveryPct: 90, byproductRecoveryPct: 25 },
      { primaryRecoveryPct: 95, byproductRecoveryPct: 68 },
    ];
    const bp = fitByproductRecovery('Au', 'Ag', pts, S)!;
    expect(bp.model.weak).toBe(true);
  });
});

describe('repli par ratio configuré', () => {
  it('applique le ratio et le documente comme un repli', () => {
    const p = byproductFromRatio('Au', 'Ag', 90, 0.45)!;
    expect(p.recoveryPct).toBeCloseTo(40.5, 6);
    expect(p.basis).toMatch(/Ratio configuré/);
    expect(p.basis).toMatch(/aucun essai apparié/);
  });

  it('reste borné à 100 %', () => {
    expect(byproductFromRatio('Au', 'Cu', 95, 2)!.recoveryPct).toBe(100);
  });

  it('refuse un ratio ou une récupération invalides', () => {
    expect(byproductFromRatio('Au', 'Ag', 90, -1)).toBeNull();
    expect(byproductFromRatio('Au', 'Ag', NaN, 0.5)).toBeNull();
  });
});

describe('la forme linéaire de l\'ajusteur', () => {
  it('retrouve une droite connue', () => {
    const pts = [1, 2, 3, 4, 5, 6].map(x => ({ gradeGt: x, recoveryPct: 7.5 * x + 12 }));
    const m = fitStageModel(pts, 'linear', S)!;
    expect(m.a).toBeCloseTo(7.5, 6);
    expect(m.b).toBeCloseTo(12, 6);
    expect(predictStage(m, 10)).toBeCloseTo(87, 6);
  });

  it('n\'altère pas les deux autres formes', () => {
    const sat = [0.2, 0.4, 0.6, 0.9, 1.2, 1.6].map(g => ({ gradeGt: g, recoveryPct: 91.02 * (1 - Math.exp(-6.42 * g)) }));
    const m = fitStageModel(sat, 'saturating', S)!;
    expect(m.a).toBeCloseTo(91.02, 1);
    expect(m.b).toBeCloseTo(6.42, 1);

    const log = [8, 12, 18, 24, 30].map(g => ({ gradeGt: g, recoveryPct: 4.4152 * Math.log(g) + 83.872 }));
    const l = fitStageModel(log, 'logarithmic', S)!;
    expect(l.a).toBeCloseTo(4.4152, 3);
    expect(l.b).toBeCloseTo(83.872, 3);
  });

  it('deux projets aux essais différents donnent deux relations différentes', () => {
    const a = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, au => 0.6897 * au - 16.076), S)!;
    const b = fitByproductRecovery('Au', 'Ag', paired(AU_RECS, au => 0.30 * au + 5), S)!;
    expect(a.model.a).not.toBeCloseTo(b.model.a, 2);
    expect(b.model.a).toBeCloseTo(0.30, 4);
  });
});
