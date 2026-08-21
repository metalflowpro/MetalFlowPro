import { describe, it, expect } from 'vitest';
import {
  generateFlowsheets, goldOuncesPerDay, GENERATOR_CONFIG,
  type GeneratorInputs, type GeneratorFeed, type GenerationRequest,
} from './generator';
import type { RouteEstimate } from '../analytics/routeEstimation';

// ─── Fabriques de test ────────────────────────────────────────────────────────

function route(over: Partial<RouteEstimate>): RouteEstimate {
  return {
    route: 'CIL direct',
    recovery_pct: 88,
    confidence: 'medium',
    dataQualityScore: 60,
    basis: 'base usine',
    stages: [],
    leachBasisLabel: '48 h',
    leachBasisIsFallback: false,
    references: [],
    capex_indicator: 'medium',
    opex_indicator: 'medium',
    ...over,
  };
}

const RICH_FEED: GeneratorFeed = {
  goldGrade: 0.92, grgPct: 12, sulphidePct: 4, corgPct: 0.05,
  bwiKwhT: 15, labP80Um: 106, plantP80Um: 106, regrindP80Um: 38,
};

function baseRequest(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    objective: 'max_recovery',
    designThroughputTph: 913,
    maturity: 'pre_feasibility',
    maxScenarios: 3,
    ...over,
  };
}

let counter = 0;
function inputs(over: Partial<GeneratorInputs> = {}): GeneratorInputs {
  return {
    request: baseRequest(),
    candidateRoutes: [
      route({ route: 'Gravité + Flottation + CIL (concentré)', recovery_pct: 96.1, confidence: 'medium', capex_indicator: 'high', opex_indicator: 'medium' }),
      route({ route: 'Gravité + CIL (résidus)', recovery_pct: 88.6, confidence: 'medium', capex_indicator: 'medium', opex_indicator: 'low' }),
      route({ route: 'CIL direct', recovery_pct: 74.3, confidence: 'medium', capex_indicator: 'low', opex_indicator: 'medium' }),
    ],
    feed: RICH_FEED,
    sampleCounts: { chem: 10, leaching: 5, flotation: 3 },
    makeId: () => `gen-${counter++}`,
    ...over,
  };
}

// ─── oz/jour ──────────────────────────────────────────────────────────────────

describe('goldOuncesPerDay (§7)', () => {
  it('applique Q × G × R × 24 / 31.1035', () => {
    // 913 t/h × 0.92 g/t × 0.961 × 24 = 19 371 g/j ; /31.1035 ≈ 622,8 oz/j
    const oz = goldOuncesPerDay(913, 0.92, 0.961);
    expect(oz).toBeCloseTo((913 * 0.92 * 0.961 * 24) / 31.1035, 4);
    expect(oz).toBeGreaterThan(600);
    expect(oz).toBeLessThan(650);
  });
  it('est monotone croissante en récupération', () => {
    expect(goldOuncesPerDay(500, 1, 0.9)).toBeGreaterThan(goldOuncesPerDay(500, 1, 0.7));
  });
});

// ─── Objectifs ────────────────────────────────────────────────────────────────

describe('generateFlowsheets — objectifs', () => {
  it('max_recovery : le scénario Recommandé est la route la plus récupérante', () => {
    const res = generateFlowsheets(inputs({ request: baseRequest({ objective: 'max_recovery' }) }));
    expect(res.scenarios[0].title).toBe('Recommandé');
    expect(res.scenarios[0].route).toContain('Flottation');
    expect(res.scenarios[0].recoveryPct).toBe(96.1);
  });

  it('min_capex : le Recommandé est la route au CAPEX le plus bas', () => {
    const res = generateFlowsheets(inputs({ request: baseRequest({ objective: 'min_capex' }) }));
    expect(res.scenarios[0].route).toBe('CIL direct'); // seul capex low
    expect(res.scenarios[0].capexIndicator).toBe('low');
  });

  it('min_opex : le Recommandé est la route à l’OPEX le plus bas', () => {
    const res = generateFlowsheets(inputs({ request: baseRequest({ objective: 'min_opex' }) }));
    expect(res.scenarios[0].route).toContain('Gravité + CIL'); // seul opex low
  });

  it('max_oz_per_day suit la récupération à débit/teneur constants', () => {
    const res = generateFlowsheets(inputs({ request: baseRequest({ objective: 'max_oz_per_day' }) }));
    expect(res.scenarios[0].recoveryPct).toBe(96.1);
    expect(res.scenarios[0].ozPerDay).toBeGreaterThan(res.scenarios[1].ozPerDay);
  });
});

// ─── Nombre de scénarios ──────────────────────────────────────────────────────

describe('nombre de scénarios (§6 : 2 à 5)', () => {
  it('borne le nombre demandé à [2,5]', () => {
    const many = Array.from({ length: 8 }, (_, i) => route({ route: `R${i}`, recovery_pct: 90 - i }));
    const hi = generateFlowsheets(inputs({ candidateRoutes: many, request: baseRequest({ maxScenarios: 99 }) }));
    expect(hi.scenarios).toHaveLength(GENERATOR_CONFIG.maxScenarios);
    const lo = generateFlowsheets(inputs({ candidateRoutes: many, request: baseRequest({ maxScenarios: 1 }) }));
    expect(lo.scenarios).toHaveLength(GENERATOR_CONFIG.minScenarios);
  });
});

// ─── Contraintes ──────────────────────────────────────────────────────────────

describe('contraintes', () => {
  it('exclut les routes portant une technologie exclue', () => {
    const res = generateFlowsheets(inputs({
      request: baseRequest({ excludedTechnologies: ['Flottation'] }),
    }));
    expect(res.scenarios.every(s => !/flottation/i.test(s.route))).toBe(true);
    expect(res.warnings.some(w => /écartée/i.test(w))).toBe(true);
  });

  it('honore la route préférée par filtrage sur le libellé', () => {
    const res = generateFlowsheets(inputs({ request: baseRequest({ preferredRoute: 'CIL direct' }) }));
    expect(res.scenarios.every(s => /CIL direct/.test(s.route))).toBe(true);
  });

  it('avertit et retombe sur toutes les routes si la préférée est introuvable', () => {
    const res = generateFlowsheets(inputs({ request: baseRequest({ preferredRoute: 'POX magique' }) }));
    expect(res.warnings.some(w => /introuvable/i.test(w))).toBe(true);
    expect(res.scenarios.length).toBeGreaterThan(0);
  });

  it('renvoie zéro scénario mais un journal quand tout est exclu', () => {
    const res = generateFlowsheets(inputs({
      request: baseRequest({ excludedTechnologies: ['CIL', 'Flottation', 'Gravité'] }),
    }));
    expect(res.scenarios).toHaveLength(0);
    expect(res.dataSufficient).toBe(false);
  });
});

// ─── Gouvernance : jamais « optimal » sans données ────────────────────────────

describe('gouvernance des données (§6)', () => {
  it('marque dataSufficient=false et avertit sous le seuil d’essais', () => {
    const res = generateFlowsheets(inputs({ sampleCounts: { chem: 2 } }));
    expect(res.dataSufficient).toBe(false);
    expect(res.warnings.some(w => /insuffisante/i.test(w))).toBe(true);
  });

  it('rabaisse la confiance à « faible » quand les hypothèses dominent', () => {
    const bareFeed: GeneratorFeed = { goldGrade: 1, grgPct: null, sulphidePct: null, corgPct: null, bwiKwhT: null, labP80Um: null };
    const res = generateFlowsheets(inputs({ feed: bareFeed, sampleCounts: { chem: 10, leaching: 5 } }));
    expect(res.scenarios[0].confidence).toBe('low');
    expect(res.scenarios[0].assumptionPct).toBeGreaterThan(0);
  });

  it('renseigne P80 primaire et rebroyage depuis la caractérisation', () => {
    const res = generateFlowsheets(inputs());
    expect(res.scenarios[0].primaryGrindP80Um).toBe(106);
    expect(res.scenarios[0].regrindP80Um).toBe(38);
  });
});

// ─── Explicabilité ────────────────────────────────────────────────────────────

describe('journal de décision explicable', () => {
  it('déclenche la règle gravité quand GRG dépasse le seuil', () => {
    const res = generateFlowsheets(inputs());
    expect(res.decisionLog.some(l => /GRG/.test(l) && /gravité/i.test(l))).toBe(true);
  });
  it('signale le risque preg-robbing quand du carbone organique est présent', () => {
    const feed = { ...RICH_FEED, corgPct: 0.3 };
    const res = generateFlowsheets(inputs({ feed }));
    expect(res.decisionLog.some(l => /preg-robbing/i.test(l))).toBe(true);
  });
});
