import { describe, it, expect } from 'vitest';
import {
  recommendRefractoryCircuit, circuitLiberation,
  REFRACTORY_CIRCUITS, REFRACTORY_CIRCUIT_EFFICIENCIES, REFRACTORY_DECISION_THRESHOLDS,
  type RefractoryCircuitId, type RefractoryDecisionInputs,
} from './refractoryCircuit';
import { estimateRoutes, type RouteEstimationInputs } from './routeEstimation';

const T = { ...REFRACTORY_DECISION_THRESHOLDS };
const ALL = Object.keys(REFRACTORY_CIRCUITS) as RefractoryCircuitId[];

const base: RefractoryDecisionInputs = {
  sulphidePct: 4, organicCarbonPct: 0.05,
  arsenicPct: null, carbonatePct: null, throughputTph: 900,
};

describe('les quatre circuits sont bien distincts', () => {
  it('un seul procédé détruit le carbone organique : le grillage', () => {
    const destroyers = ALL.filter(id => REFRACTORY_CIRCUITS[id].destroysOrganicCarbon);
    expect(destroyers).toEqual(['ROASTING']);
  });

  it('leurs libérations diffèrent — ce n\'était qu\'un seul paramètre avant', () => {
    const libs = ALL.map(id => circuitLiberation(id));
    expect(new Set(libs).size).toBe(ALL.length);
    for (const l of libs) { expect(l).toBeGreaterThan(0); expect(l).toBeLessThanOrEqual(1); }
  });

  it('le POX libère le mieux, l\'Albion le moins', () => {
    expect(circuitLiberation('POX')).toBeGreaterThan(circuitLiberation('BIOX'));
    expect(circuitLiberation('BIOX')).toBeGreaterThan(circuitLiberation('ALBION'));
  });

  it('leurs CAPEX ne sont pas alignés', () => {
    expect(REFRACTORY_CIRCUITS.POX.capex).toBe('high');
    expect(REFRACTORY_CIRCUITS.ALBION.capex).toBe('medium');
  });

  it('les libérations sont surchargeables par projet', () => {
    const eff = { ...REFRACTORY_CIRCUIT_EFFICIENCIES, poxLiberation: 0.5 };
    expect(circuitLiberation('POX', eff)).toBe(0.5);
    expect(circuitLiberation('BIOX', eff)).toBe(REFRACTORY_CIRCUIT_EFFICIENCIES.bioxLiberation);
  });
});

describe('choix du circuit sur la chimie du minerai', () => {
  it('CARBONE ORGANIQUE → grillage, seul procédé qui le détruit', () => {
    const d = recommendRefractoryCircuit({ ...base, organicCarbonPct: T.organicCarbonPct + 0.5 }, T);
    expect(d.recommendation).toBe('ROASTING');
    expect(d.warnings.some(w => /préempteur/i.test(w))).toBe(true);
  });

  it('le carbone organique l\'emporte même sur un soufre favorable au POX', () => {
    const d = recommendRefractoryCircuit(
      { ...base, sulphidePct: 6, organicCarbonPct: T.organicCarbonPct + 1 }, T);
    expect(d.recommendation).toBe('ROASTING');
  });

  it('ARSENIC → voie humide, jamais le grillage qui le volatilise', () => {
    // POX et BIOX fixent tous deux l'arsenic en scorodite ; le discriminant
    // n'est pas entre eux mais contre le grillage, qui l'envoie aux gaz.
    const d = recommendRefractoryCircuit({ ...base, arsenicPct: T.arsenicPct + 0.5 }, T);
    expect(d.recommendation).not.toBe('ROASTING');
    expect(d.scores.ROASTING).toBeLessThan(Math.min(d.scores.POX, d.scores.BIOX));
    expect(d.warnings.some(w => /scorodite/i.test(w))).toBe(true);
  });

  it('l\'arsenic écarte le grillage même sur minerai légèrement carboné', () => {
    const d = recommendRefractoryCircuit(
      { ...base, arsenicPct: T.arsenicPct + 2, organicCarbonPct: T.organicCarbonPct + 0.1 }, T);
    expect(d.warnings.some(w => /As₂O₃/.test(w))).toBe(true);
  });

  it('CARBONATE → jamais le POX, dont il ruine l\'économie acide', () => {
    const d = recommendRefractoryCircuit({ ...base, carbonatePct: T.carbonatePct + 2 }, T);
    expect(d.recommendation).not.toBe('POX');
    expect(d.warnings.some(w => /acide/i.test(w))).toBe(true);
  });

  it('SOUFRE suffisant et gros débit → POX autotherme', () => {
    const d = recommendRefractoryCircuit({ ...base, sulphidePct: 5, throughputTph: 1500 }, T);
    expect(d.recommendation).toBe('POX');
    expect(d.reasons.some(r => /autotherme/i.test(r))).toBe(true);
  });

  it('SOUFRE insuffisant → le POX est pénalisé', () => {
    const bas = recommendRefractoryCircuit({ ...base, sulphidePct: 0.5 }, T);
    const haut = recommendRefractoryCircuit({ ...base, sulphidePct: 6 }, T);
    expect(bas.scores.POX).toBeLessThan(haut.scores.POX);
  });

  it('PETIT DÉBIT → un autoclave ne s\'amortit pas', () => {
    const petit = recommendRefractoryCircuit({ ...base, throughputTph: T.smallScaleTph - 100 }, T);
    const grand = recommendRefractoryCircuit({ ...base, throughputTph: T.smallScaleTph + 900 }, T);
    expect(petit.scores.POX).toBeLessThan(grand.scores.POX);
    expect(petit.reasons.some(r => /amortir/i.test(r))).toBe(true);
  });

  it('SOUFRE très élevé → le BIOX décroche', () => {
    const d = recommendRefractoryCircuit({ ...base, sulphidePct: T.bioxMaxSulphidePct + 4 }, T);
    expect(d.scores.BIOX).toBeLessThan(d.scores.POX);
    expect(d.warnings.some(w => /cinétique/i.test(w))).toBe(true);
  });

  it('les critères non analysés (null) sont simplement ignorés', () => {
    const d = recommendRefractoryCircuit(
      { sulphidePct: null, organicCarbonPct: null, arsenicPct: null, carbonatePct: null, throughputTph: null }, T);
    expect(ALL).toContain(d.recommendation);
    expect(d.warnings).toHaveLength(0);
  });

  it('rend toujours un circuit valide et justifié', () => {
    for (const s of [0, 1, 3, 8, 15]) {
      for (const c of [0, 0.3, 1.2]) {
        const d = recommendRefractoryCircuit({ ...base, sulphidePct: s, organicCarbonPct: c }, T);
        expect(ALL).toContain(d.recommendation);
        expect(d.reasons.length).toBeGreaterThan(0);
      }
    }
  });

  it('les seuils sont surchargeables par projet', () => {
    const inp = { ...base, organicCarbonPct: 0.3 };
    const large = recommendRefractoryCircuit(inp, { ...T, organicCarbonPct: 1.0 });
    const strict = recommendRefractoryCircuit(inp, { ...T, organicCarbonPct: 0.1 });
    expect(strict.recommendation).toBe('ROASTING');
    expect(large.recommendation).not.toBe('ROASTING');
  });
});

describe('la route réfractaire suit le circuit retenu', () => {
  const REF: RouteEstimationInputs = {
    metrics: {
      leachRec48Pct: 86, leachRec24Pct: 82, grgPct: 20,
      organicCarbonPct: 0.05, flotationAuRecPct: 90,
      sulphidePct: 4.0, auFreePct: 45,
    },
    counts: { chem: 10, comminution: 10, knelson: 10, flotation: 10, leaching: 10, mineralogy: 10 },
    adsorptionCircuit: 'CIL',
  };
  const find = (id: RefractoryCircuitId) =>
    estimateRoutes({ ...REF, refractoryCircuit: id })
      .find(r => r.route.includes(REFRACTORY_CIRCUITS[id].label))!;

  it('la route porte le NOM du circuit retenu, pas « POX/Grillage »', () => {
    for (const id of ALL) {
      const r = find(id);
      expect(r).toBeDefined();
      expect(r.route).toContain(REFRACTORY_CIRCUITS[id].label);
      expect(r.route).not.toMatch(/POX\/Grillage/);
    }
  });

  it('changer de circuit change la récupération ET le CAPEX', () => {
    const pox = find('POX'), albion = find('ALBION');
    expect(pox.recovery_pct).toBeGreaterThan(albion.recovery_pct);
    expect(pox.capex_indicator).not.toBe(albion.capex_indicator);
  });

  it('sur minerai carboné, un circuit qui ne détruit pas le TOC est SIGNALÉ', () => {
    const carbone = { ...REF, metrics: { ...REF.metrics, organicCarbonPct: 1.5 } };
    const pox = estimateRoutes({ ...carbone, refractoryCircuit: 'POX' }).find(r => r.route.includes('POX'))!;
    const roast = estimateRoutes({ ...carbone, refractoryCircuit: 'ROASTING' }).find(r => r.route.includes('Grillage'))!;
    expect(pox.basis).toMatch(/ne détruit PAS le carbone organique/i);
    expect(pox.confidence).toBe('medium');
    expect(roast.basis).toMatch(/détruit le carbone organique/i);
    expect(roast.confidence).toBe('high');
  });

  it('reste bornée par la flottation de tête — régression du bug des 100 %', () => {
    for (const id of ALL) {
      const r = find(id);
      const rFlotPct = (REF.metrics.flotationAuRecPct! / 100) * 0.93 * 100;
      expect(r.recovery_pct, id).toBeLessThanOrEqual(rFlotPct + 1e-9);
    }
  });

  it('sans circuit précisé, l\'appelant historique reste valide', () => {
    const r = estimateRoutes(REF).find(x => x.route.includes('POX'));
    expect(r).toBeDefined();
  });
});
