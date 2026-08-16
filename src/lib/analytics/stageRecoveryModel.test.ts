import { describe, it, expect } from 'vitest';
import {
  fitStageModel, predictStage, predictStageRecovery,
  STAGE_FIT_SETTINGS, type StagePoint, type StageFitSettings,
} from './stageRecoveryModel';

const S: StageFitSettings = { ...STAGE_FIT_SETTINGS };

/** Génère des points sur une courbe connue, pour vérifier que l'ajusteur la retrouve. */
const sample = (grades: number[], f: (g: number) => number): StagePoint[] =>
  grades.map(g => ({ gradeGt: g, recoveryPct: f(g) }));

const GRADES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8];

describe('retrouve les modèles publiés du PFS Spanish Mountain', () => {
  // La vraie épreuve : générer des points avec les équations du rapport, et
  // vérifier que l'ajusteur en retrouve les coefficients sans les connaître.

  it('flottation — R = 91,02 × (1 − e^(−6,42 × teneur))', () => {
    const pts = sample(GRADES, g => 91.02 * (1 - Math.exp(-6.42 * g)));
    const m = fitStageModel(pts, 'saturating', S)!;
    expect(m.a).toBeCloseTo(91.02, 1);
    expect(m.b).toBeCloseTo(6.42, 1);
    expect(m.rSquared).toBeGreaterThan(0.999);
    expect(m.weak).toBe(false);
  });

  it('lixiviation — R = 4,4152 × ln(teneur) + 83,872', () => {
    const pts = sample([8, 10, 12, 15, 20, 24, 28, 30], g => 4.4152 * Math.log(g) + 83.872);
    const m = fitStageModel(pts, 'logarithmic', S)!;
    expect(m.a).toBeCloseTo(4.4152, 3);
    expect(m.b).toBeCloseTo(83.872, 3);
    expect(m.rSquared).toBeCloseTo(1, 6);
  });

  it('globale — R = 10,189 × ln(teneur) + 91,686 → 90,8 % à 0,92 g/t', () => {
    const pts = sample([0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95],
      g => 10.189 * Math.log(g) + 91.686);
    const m = fitStageModel(pts, 'logarithmic', S)!;
    expect(m.a).toBeCloseTo(10.189, 3);
    expect(m.b).toBeCloseTo(91.686, 3);
    expect(predictStageRecovery(m, 0.92)!.recoveryPct).toBeCloseTo(90.8, 1);
  });

  it('l\'équation lisible reprend les coefficients ajustés', () => {
    const m = fitStageModel(sample(GRADES, g => 91.02 * (1 - Math.exp(-6.42 * g))), 'saturating', S)!;
    expect(m.equation).toMatch(/91\.0/);
    expect(m.equation).toMatch(/6\.4/);
    expect(m.equation).toMatch(/1 − e\^/);
  });
});

describe('robustesse de l\'ajustement', () => {
  it('encaisse du bruit sans dériver sur les coefficients', () => {
    // Bruit déterministe ±2 pts : le modèle doit rester proche de la vérité.
    const pts = GRADES.map((g, i) => ({
      gradeGt: g,
      recoveryPct: 91.02 * (1 - Math.exp(-6.42 * g)) + (i % 2 === 0 ? 2 : -2),
    }));
    const m = fitStageModel(pts, 'saturating', S)!;
    expect(m.a).toBeGreaterThan(85);
    expect(m.a).toBeLessThan(97);
    expect(m.rSquared).toBeGreaterThan(0.9);
  });

  it('signale un ajustement faiblement soutenu au lieu de le masquer', () => {
    // Récupérations sans lien avec la teneur → R² effondré, `weak` levé.
    const pts: StagePoint[] = [
      { gradeGt: 0.2, recoveryPct: 90 }, { gradeGt: 0.4, recoveryPct: 40 },
      { gradeGt: 0.6, recoveryPct: 85 }, { gradeGt: 0.8, recoveryPct: 35 },
      { gradeGt: 1.0, recoveryPct: 88 }, { gradeGt: 1.2, recoveryPct: 42 },
    ];
    const m = fitStageModel(pts, 'saturating', S)!;
    expect(m.rSquared).toBeLessThan(S.weakFitRSquared);
    expect(m.weak).toBe(true);
  });

  it('rapporte l\'effectif et la plage couverte par les essais', () => {
    const m = fitStageModel(sample(GRADES, g => 91.02 * (1 - Math.exp(-6.42 * g))), 'saturating', S)!;
    expect(m.n).toBe(GRADES.length);
    expect(m.minGradeGt).toBe(0.1);
    expect(m.maxGradeGt).toBe(1.8);
  });

  it('la saturante ne dépasse jamais son asymptote', () => {
    const m = fitStageModel(sample(GRADES, g => 91.02 * (1 - Math.exp(-6.42 * g))), 'saturating', S)!;
    for (const g of [0.05, 0.5, 5, 50]) expect(predictStage(m, g)).toBeLessThanOrEqual(m.a + 1e-9);
  });
});

describe('refuse d\'ajuster ce que les essais ne soutiennent pas', () => {
  it('trop peu de points', () => {
    const pts = sample([0.3, 0.6, 0.9], g => 91.02 * (1 - Math.exp(-6.42 * g)));
    expect(fitStageModel(pts, 'saturating', S)).toBeNull();
    // …et l'effectif minimal est lui-même configurable.
    expect(fitStageModel(pts, 'saturating', { ...S, minPoints: 3 })).not.toBeNull();
  });

  it('teneurs toutes identiques — aucune variation à expliquer', () => {
    const pts = [0.5, 0.5, 0.5, 0.5, 0.5].map(g => ({ gradeGt: g, recoveryPct: 80 }));
    expect(fitStageModel(pts, 'logarithmic', S)).toBeNull();
    expect(fitStageModel(pts, 'saturating', S)).toBeNull();
  });

  it('écarte les points inexploitables avant de compter l\'effectif', () => {
    const pts: StagePoint[] = [
      { gradeGt: 0, recoveryPct: 50 },        // teneur nulle
      { gradeGt: -1, recoveryPct: 50 },       // teneur négative
      { gradeGt: 0.5, recoveryPct: NaN },     // récupération non finie
      { gradeGt: 0.6, recoveryPct: 140 },     // récupération > 100 %
      { gradeGt: 0.7, recoveryPct: 80 },
    ];
    expect(fitStageModel(pts, 'saturating', S)).toBeNull();
  });

  it('liste vide', () => {
    expect(fitStageModel([], 'saturating', S)).toBeNull();
  });
});

describe('prédiction — borner plutôt qu\'extrapoler', () => {
  const m = fitStageModel(sample(GRADES, g => 91.02 * (1 - Math.exp(-6.42 * g))), 'saturating', S)!;

  it('dans la plage des essais, ne signale aucune extrapolation', () => {
    const p = predictStageRecovery(m, 0.9)!;
    expect(p.extrapolated).toBe(false);
    expect(p.gradeUsedGt).toBe(0.9);
  });

  it('hors plage, borne et le signale', () => {
    expect(predictStageRecovery(m, 0.01)!.extrapolated).toBe(true);
    expect(predictStageRecovery(m, 0.01)!.gradeUsedGt).toBe(m.minGradeGt);
    expect(predictStageRecovery(m, 99)!.gradeUsedGt).toBe(m.maxGradeGt);
  });

  it('reste toujours dans [0, 100] %', () => {
    for (const g of [0.001, 0.5, 5, 1000]) {
      const p = predictStageRecovery(m, g)!;
      expect(p.recoveryPct).toBeGreaterThanOrEqual(0);
      expect(p.recoveryPct).toBeLessThanOrEqual(100);
    }
  });

  it('refuse une teneur non exploitable', () => {
    for (const g of [0, -1, NaN, Infinity]) expect(predictStageRecovery(m, g)).toBeNull();
  });
});

describe('aucun coefficient de gisement dans le code', () => {
  it('les réglages ne contiennent que des paramètres d\'ajusteur', () => {
    // Si un coefficient de projet se glissait ici, il s'appliquerait à TOUS les
    // projets — exactement ce que l'application doit interdire.
    expect(Object.keys(STAGE_FIT_SETTINGS).sort()).toEqual([
      'minPoints', 'rateRefinePasses', 'rateSearchMax', 'rateSearchMin',
      'rateSearchSteps', 'weakFitRSquared',
    ]);
  });

  it('deux projets aux essais différents donnent des modèles différents', () => {
    const a = fitStageModel(sample(GRADES, g => 91.02 * (1 - Math.exp(-6.42 * g))), 'saturating', S)!;
    const b = fitStageModel(sample(GRADES, g => 78.0 * (1 - Math.exp(-2.10 * g))), 'saturating', S)!;
    expect(a.a).not.toBeCloseTo(b.a, 1);
    expect(a.b).not.toBeCloseTo(b.b, 1);
    expect(b.a).toBeCloseTo(78.0, 1);
    expect(b.b).toBeCloseTo(2.10, 1);
  });
});
