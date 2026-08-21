import { describe, it, expect } from 'vitest';
import { reconcile, RECON_CONFIG, type ReconTag } from './plantReconciliation';

const TAGS: ReconTag[] = [
  { name: 'Récupération', simulated: 90, measured: 91, unit: '%' },
  { name: 'Débit', simulated: 500, measured: 505, unit: 't/h' },
];

describe('reconcile', () => {
  it('accord parfait → score 100, tous dans la tolérance', () => {
    const r = reconcile([{ name: 'R', simulated: 90, measured: 90 }]);
    expect(r.score).toBe(100);
    expect(r.overallBiasPct).toBe(0);
    expect(r.withinToleranceCount).toBe(1);
  });

  it('calcule l’écart relatif signé par tag', () => {
    const r = reconcile(TAGS);
    const rec = r.tags.find(t => t.name === 'Récupération')!;
    expect(rec.biasAbs).toBeCloseTo(1, 6);
    expect(rec.biasPct).toBeCloseTo(1 / 91 * 100, 4);
    expect(rec.withinTolerance).toBe(true);
  });

  it('signale un tag hors tolérance', () => {
    const r = reconcile([{ name: 'R', simulated: 80, measured: 95 }], { tolerancePct: 5 });
    expect(r.tags[0].withinTolerance).toBe(false); // ~15.8% d'écart
    expect(r.withinToleranceCount).toBe(0);
    expect(r.score).toBeLessThan(90);
  });

  it('pondère le biais global', () => {
    const r = reconcile([
      { name: 'clé', simulated: 100, measured: 80, weight: 10 },   // (80-100)/80 = -25%, fort poids
      { name: 'mineur', simulated: 100, measured: 100, weight: 1 }, // 0%
    ]);
    // Biais pondéré ≈ (25*10 + 0*1)/11 ≈ 22.7% (écart rapporté à la mesure)
    expect(r.overallBiasPct).toBeCloseTo((25 * 10) / 11, 1);
  });

  it('évalue la fermeture du bilan de masse quand débits fournis', () => {
    const r = reconcile(TAGS, { massIn: 500, massOut: 495 });
    expect(r.massBalanceClosureError).toBeCloseTo(0.01, 6);
  });

  it('laisse la fermeture à null sans débits', () => {
    expect(reconcile(TAGS).massBalanceClosureError).toBeNull();
  });

  it('utilise la tolérance par défaut', () => {
    expect(RECON_CONFIG.defaultTolerancePct).toBeGreaterThan(0);
  });
});
