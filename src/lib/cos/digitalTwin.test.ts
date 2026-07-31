import { describe, it, expect } from 'vitest';
import {
  compareTwin, measuredFromTags, METRIC_SPECS,
  type TwinMetric, type TagReading,
} from './digitalTwin';

describe('compareTwin — comparaison prédit / mesuré', () => {
  it('classe conforme un écart dans la tolérance', () => {
    // pH : tolérance 0.3 → un écart de 0.2 reste conforme
    const r = compareTwin({ pH: 10.5 }, { pH: 10.7 });
    expect(r.comparisons[0].severity).toBe('conforme');
    expect(r.comparisons[0].probableCause).toBeNull();
    expect(r.healthIndex).toBe(100);
  });

  it('gradue la sévérité avec l\'ampleur de l\'écart', () => {
    const tol = METRIC_SPECS.pH.tolerance; // 0.3
    const sev = (delta: number) => compareTwin({ pH: 10.5 }, { pH: 10.5 + delta }).comparisons[0].severity;
    expect(sev(tol * 0.5)).toBe('conforme');
    expect(sev(tol * 1.5)).toBe('surveillance');
    expect(sev(tol * 3)).toBe('derive');
    expect(sev(tol * 6)).toBe('critique');
  });

  it('normalise par la tolérance pour rendre les grandeurs comparables', () => {
    // 2 °C (tolérance 4) et 0.15 de pH (tolérance 0.3) = même écart normalisé 0.5
    const t = compareTwin({ temperature: 25 }, { temperature: 27 }).comparisons[0];
    const p = compareTwin({ pH: 10 }, { pH: 10.15 }).comparisons[0];
    expect(t.normalized).toBeCloseTo(0.5, 2);
    expect(p.normalized).toBeCloseTo(0.5, 2);
  });

  it('applique une tolérance relative aux grandeurs proportionnelles', () => {
    // mass_flow : tolérance 5 % → 400 t/h ±20 t/h
    expect(compareTwin({ mass_flow: 400 }, { mass_flow: 418 }).comparisons[0].severity).toBe('conforme');
    expect(compareTwin({ mass_flow: 400 }, { mass_flow: 460 }).comparisons[0].severity).not.toBe('conforme');
  });

  it('donne une cause probable orientée par le signe de l\'écart', () => {
    const bas = compareTwin({ pH: 10.5 }, { pH: 9.2 }).comparisons[0];
    const haut = compareTwin({ pH: 10.5 }, { pH: 12.0 }).comparisons[0];
    expect(bas.probableCause).toContain('HCN');       // danger cyanure sous pH 10
    expect(haut.probableCause).toContain('chaux');    // surdosage
    expect(bas.probableCause).not.toBe(haut.probableCause);
  });

  it('signale la surconsommation d\'énergie comme un minerai plus dur', () => {
    const c = compareTwin({ energy_consumption: 14 }, { energy_consumption: 19 }).comparisons[0];
    expect(c.severity).not.toBe('conforme');
    expect(c.probableCause).toContain('dur');
  });

  it('ignore les grandeurs absentes d\'un des deux côtés', () => {
    const r = compareTwin({ pH: 10.5, mass_flow: 400 }, { pH: 10.5 });
    expect(r.comparisons.map(c => c.metric)).toEqual(['pH']);
  });

  it('rapporte un état vide quand rien n\'est comparable', () => {
    const r = compareTwin({ mass_flow: 400 }, { pH: 10 });
    expect(r.empty).toBe(true);
    expect(r.comparisons).toHaveLength(0);
    expect(r.summary).toContain('Aucune grandeur comparable');
  });

  it('classe les dérives de la plus grave à la moins grave', () => {
    const r = compareTwin(
      { pH: 10.5, temperature: 25, mass_flow: 400 },
      { pH: 10.6, temperature: 45, mass_flow: 500 },  // temp très hors tolérance
    );
    expect(r.drifts[0].normalized).toBeGreaterThanOrEqual(r.drifts[1].normalized);
    expect(r.drifts.every(d => d.severity !== 'conforme')).toBe(true);
  });

  it('fait chuter l\'indice de santé avec la gravité', () => {
    const bon = compareTwin({ pH: 10.5, temperature: 25 }, { pH: 10.5, temperature: 25 });
    const mauvais = compareTwin({ pH: 10.5, temperature: 25 }, { pH: 7, temperature: 60 });
    expect(bon.healthIndex).toBe(100);
    expect(mauvais.healthIndex).toBeLessThan(70);
    expect(mauvais.counts.critique).toBeGreaterThan(0);
  });

  it('ne divise pas par zéro sur une prédiction nulle', () => {
    const r = compareTwin({ mass_flow: 0 }, { mass_flow: 5 });
    expect(Number.isFinite(r.comparisons[0].normalized)).toBe(true);
    expect(Number.isFinite(r.comparisons[0].deviationPct)).toBe(true);
  });

  it('résume l\'état en une phrase exploitable', () => {
    const ok = compareTwin({ pH: 10.5 }, { pH: 10.5 });
    expect(ok.summary).toContain('tolérance');
    const ko = compareTwin({ pH: 10.5 }, { pH: 6 });
    expect(ko.summary).toContain('critique');
  });
});

describe('measuredFromTags — agrégation des tags historian', () => {
  const readings: TagReading[] = [
    { tag: 'SAG01.FEED_DRY',       unit: 't/h',      value: 412, quality: 'good' },
    { tag: 'SAG01.DENSITY_PULP',   unit: '%solids',  value: 72,  quality: 'good' },
    { tag: 'CIL_A.TANK1.PH',       unit: 'pH',       value: 10.6, quality: 'good' },
    { tag: 'CIL_A.TANK1.CN_FREE',  unit: 'mg/L',     value: 185, quality: 'good' },
    { tag: 'CIL_A.TANK1.TEMP',     unit: 'degC',     value: 26.4, quality: 'good' },
  ];

  it('reconnaît les grandeurs depuis le suffixe du tag', () => {
    const { measured } = measuredFromTags(readings);
    expect(measured.mass_flow).toBe(412);
    expect(measured.solids_content).toBe(72);
    expect(measured.pH).toBe(10.6);
    expect(measured.cyanide_concentration).toBe(185);
    expect(measured.temperature).toBe(26.4);
  });

  it('écarte les lectures de qualité douteuse plutôt que créer une fausse dérive', () => {
    const withBad: TagReading[] = [
      ...readings,
      { tag: 'SAG02.FEED_DRY', value: 9999, quality: 'frozen' },
      { tag: 'SAG03.FEED_DRY', value: 8888, quality: 'bad' },
      { tag: 'SAG04.FEED_DRY', value: null, quality: 'missing' },
    ];
    const { measured, skipped } = measuredFromTags(withBad);
    expect(measured.mass_flow).toBe(412); // inchangé, les gelés/faux sont exclus
    expect(skipped).toBe(3);
  });

  it('moyenne plusieurs lectures d\'une même grandeur', () => {
    const { measured } = measuredFromTags([
      { tag: 'A.TEMP', value: 20, quality: 'good' },
      { tag: 'B.TEMP', value: 30, quality: 'good' },
    ]);
    expect(measured.temperature).toBe(25);
  });

  it('ignore les tags non reconnus sans planter', () => {
    const { measured, skipped } = measuredFromTags([
      { tag: 'SAG01.VIBRATION_XYZ', value: 3.2, quality: 'good' },
    ]);
    expect(Object.keys(measured)).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('alimente directement la comparaison du jumeau', () => {
    const { measured } = measuredFromTags(readings);
    const predicted: Partial<Record<TwinMetric, number>> = {
      mass_flow: 400, solids_content: 70, pH: 10.5, temperature: 25,
    };
    const report = compareTwin(predicted, measured);
    expect(report.empty).toBe(false);
    expect(report.comparisons.length).toBeGreaterThanOrEqual(4);
    expect(report.healthIndex).toBeGreaterThan(50);
  });
});
