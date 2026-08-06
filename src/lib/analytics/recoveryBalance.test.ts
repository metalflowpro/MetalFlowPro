import { describe, it, expect } from 'vitest';
import { recoveryWaterfall, reconcile, refractoriness, REFRACTORINESS_MODEL } from './recoveryBalance';
import { predictRecoveryAtP80, type GoldDeportment } from '../geomet/deportment';

const DEP: GoldDeportment = { free: 50, sulphide: 20, silicate: 15, oxide: 5, occluded: 8, pregRob: 2 };
const INP = { p80RefUm: 100, grgPct: 40, cOrgPct: 0.5 };

describe('recoveryWaterfall', () => {
  it('les contributions somment à la récupération prédite (source unique)', () => {
    const w = recoveryWaterfall(DEP, 60, INP);
    const sum = w.contributions.reduce((a, c) => a + c.points, 0);
    expect(sum).toBeCloseTo(w.predictedPct, 1);
    expect(w.predictedPct).toBeCloseTo(predictRecoveryAtP80(DEP, 60, INP), 1);
  });

  it('contributions positives + pertes = 100 % (bilan matière fermé)', () => {
    const w = recoveryWaterfall(DEP, 60, INP);
    const positive = w.contributions.filter(c => c.points > 0).reduce((a, c) => a + c.points, 0);
    const losses = w.losses.reduce((a, l) => a + l.points, 0);
    expect(positive + losses).toBeCloseTo(100, 1);
  });

  it('la gravité est un sous-ensemble de la récupération de l’or libre', () => {
    const w = recoveryWaterfall(DEP, 100, INP);
    const cnFree = w.contributions.find(c => c.key === 'cn_free')!.points;
    // gravité (min(free, grg×η)) + cyanuration du reste = récup. totale de l’or libre
    expect(w.gravityRoutePts).toBeGreaterThan(0);
    expect(w.gravityRoutePts + cnFree).toBeCloseTo(50 * 0.98, 1);
  });

  it('preg-robbing apparaît en contribution négative et en perte', () => {
    const w = recoveryWaterfall(DEP, 60, INP);
    expect(w.contributions.find(c => c.key === 'preg_loss')!.points).toBeLessThan(0);
    expect(w.losses.find(l => l.key === 'preg_loss')!.points).toBeGreaterThan(0);
  });
});

describe('reconcile', () => {
  it('écart faible → cohérent', () => {
    const r = reconcile(47, 45);
    expect(r.verdict).toBe('coherent');
  });
  it('prédit ≫ mesuré → pertes inexpliquées', () => {
    const r = reconcile(47, 38);
    expect(r.verdict).toBe('pertes_inexpliquees');
    expect(r.residualPct).toBeGreaterThan(0);
  });
  it('prédit ≪ mesuré → modèle pessimiste', () => {
    const r = reconcile(47, 60);
    expect(r.verdict).toBe('modele_pessimiste');
    expect(r.residualPct).toBeLessThan(0);
  });
  it('sans mesure', () => {
    expect(reconcile(47, null).verdict).toBe('sans_mesure');
    expect(reconcile(47, 0).verdict).toBe('sans_mesure');
  });
});

describe('refractoriness', () => {
  it('minerai libre (haut Au libre, peu d’occlus) → free_milling', () => {
    const free: GoldDeportment = { free: 90, sulphide: 3, silicate: 3, oxide: 2, occluded: 1, pregRob: 1 };
    const r = refractoriness(free, { p80RefUm: 100 });
    expect(r.class).toBe('free_milling');
    expect(r.index).toBeLessThan(15);
  });

  it('fort taux d’occlus → réfractaire à double réfractaire', () => {
    const refr: GoldDeportment = { free: 15, sulphide: 30, silicate: 5, oxide: 2, occluded: 45, pregRob: 3 };
    const r = refractoriness(refr, { p80RefUm: 100 });
    expect(['refractaire', 'double_refractaire']).toContain(r.class);
    expect(r.lockedCeilingPct).toBeGreaterThan(40);
  });

  it('lenteur cinétique 24→48 h captée', () => {
    const r = refractoriness(DEP, INP, { leach24hPct: 60, leach48hPct: 78 });
    expect(r.kineticSlowness).not.toBeNull();
    expect(r.kineticSlowness!).toBeGreaterThan(0);
  });

  it('garde des seuils de classe strictement croissants', () => {
    // Un barème mal recalé (seuils désordonnés) rendrait une classe inatteignable
    // et fausserait la recommandation de route de traitement.
    const b = REFRACTORINESS_MODEL.classBreaks;
    expect(b.freeMilling).toBeLessThan(b.slightlyRefractory);
    expect(b.slightlyRefractory).toBeLessThan(b.refractory);
    expect(b.refractory).toBeLessThan(100);
  });

  it('fait dominer la minéralogie sur les autres contributions', () => {
    // Le plafond minéralogique peut à lui seul porter l'indice au-delà de la
    // classe « réfractaire » ; la cinétique et l'écart de réconciliation, non.
    const R = REFRACTORINESS_MODEL;
    expect(R.mineralogyWeight * 100).toBeGreaterThan(R.classBreaks.refractory);
    expect(R.kineticsWeight).toBeLessThan(R.classBreaks.refractory);
    expect(R.unexplainedLossCap).toBeLessThan(R.classBreaks.refractory);
  });

  it('les pertes inexpliquées augmentent l’indice', () => {
    const base = refractoriness(DEP, INP);
    const withGap = refractoriness(DEP, INP, {}, reconcile(47, 33));
    expect(withGap.index).toBeGreaterThan(base.index);
  });
});
