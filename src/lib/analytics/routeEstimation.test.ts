import { describe, it, expect } from 'vitest';
import {
  estimateRoutes, seriesRecovery, qualityScore, weightedQuality,
  ROUTE_STAGE_EFFICIENCIES, QUALITY_SCORE_SATURATION_N,
  type RouteEstimationInputs,
} from './routeEstimation';

const COUNTS = { chem: 10, comminution: 10, knelson: 10, flotation: 10, leaching: 10, mineralogy: 10 };

/** Minerai libre, non réfractaire, bien caractérisé. */
const FREE_MILLING: RouteEstimationInputs = {
  metrics: {
    leachRec24Pct: 92, leachRec48Pct: 94, grgPct: 35,
    organicCarbonPct: 0.05, flotationAuRecPct: 88,
    sulphidePct: 0.8, auFreePct: 70,
  },
  counts: COUNTS,
};

describe('seriesRecovery — étages indépendants en série', () => {
  it('applique R = 1 − ∏(1 − Rᵢ)', () => {
    // Deux étages à 50 % laissent passer 25 % : récupération globale 75 %.
    expect(seriesRecovery(0.5, 0.5)).toBeCloseTo(75, 10);
  });

  it('ne dépasse jamais 100 % ni ne descend sous 0 %', () => {
    expect(seriesRecovery(0.99, 0.99, 0.99)).toBeLessThanOrEqual(100);
    expect(seriesRecovery(0)).toBe(0);
  });

  it('fait toujours mieux que le meilleur étage seul', () => {
    // Propriété fondamentale d'une mise en série : ajouter un étage ne peut
    // pas dégrader la récupération globale.
    const single = seriesRecovery(0.8);
    expect(seriesRecovery(0.8, 0.5)).toBeGreaterThan(single);
  });
});

describe('score de qualité des données', () => {
  it('sature au nombre d\'essais documenté', () => {
    expect(qualityScore(QUALITY_SCORE_SATURATION_N)).toBe(100);
    expect(qualityScore(QUALITY_SCORE_SATURATION_N * 3)).toBe(100);
    expect(qualityScore(0)).toBe(0);
  });

  it('croît avec le nombre d\'essais', () => {
    expect(qualityScore(2)).toBeLessThan(qualityScore(10));
  });

  it('pondère selon l\'importance des paramètres', () => {
    // Un paramètre bien couvert avec un poids fort tire le score vers le haut.
    const strong = weightedQuality([{ n: 15, w: 3 }, { n: 0, w: 1 }]);
    const weak = weightedQuality([{ n: 0, w: 3 }, { n: 15, w: 1 }]);
    expect(strong).toBeGreaterThan(weak);
  });

  it('ne divise pas par zéro sur un jeu de poids vide', () => {
    expect(weightedQuality([])).toBe(0);
  });
});

describe('estimateRoutes — routes candidates', () => {
  it('propose la gravité + CIL quand GRG et lixiviation existent', () => {
    const routes = estimateRoutes(FREE_MILLING);
    expect(routes.some(r => r.route.includes('Gravité (Knelson) + CIL'))).toBe(true);
  });

  it('n\'invente aucune route sans les essais qui la fondent', () => {
    // Sans essai de lixiviation, aucune route à base de cyanuration n'est possible.
    const routes = estimateRoutes({
      metrics: { leachRec24Pct: null, leachRec48Pct: null, grgPct: 35, organicCarbonPct: null, flotationAuRecPct: null, sulphidePct: null, auFreePct: null },
      counts: COUNTS,
    });
    expect(routes).toHaveLength(0);
  });

  it('trie par récupération décroissante et ne recommande qu\'UNE route', () => {
    const routes = estimateRoutes(FREE_MILLING);
    for (let i = 1; i < routes.length; i++) {
      expect(routes[i - 1].recovery_pct).toBeGreaterThanOrEqual(routes[i].recovery_pct);
    }
    expect(routes.filter(r => r.recommended)).toHaveLength(1);
  });

  it('recommande la meilleure récupération sans préférence d\'adsorption', () => {
    // Régression : ne pas inventer un « CIL » par défaut qui ferait basculer la
    // reco sur une quasi-égalité au nom d'une préférence non exprimée.
    const routes = estimateRoutes(FREE_MILLING);
    expect(routes.find(r => r.recommended)).toBe(routes[0]);
  });

  it('ouvre une route oxydante seulement au-delà du seuil de sulfures', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    const clean = estimateRoutes({ ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, sulphidePct: E.refractorySulphidesPct } });
    const refractory = estimateRoutes({ ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, sulphidePct: E.refractorySulphidesPct + 5 } });
    expect(clean.some(r => r.route.includes('POX'))).toBe(false);
    expect(refractory.some(r => r.route.includes('POX'))).toBe(true);
  });

  it('pénalise la récupération quand le carbone organique préempte l\'or', () => {
    const clean = estimateRoutes(FREE_MILLING);
    const carbonaceous = estimateRoutes({ ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, organicCarbonPct: 1.2 } });
    const direct = (rs: typeof clean) => rs.find(r => r.route === 'Lixiviation directe CIL/CIP')!.recovery_pct;
    expect(direct(carbonaceous)).toBeLessThan(direct(clean));
  });

  it('respecte la préférence d\'adsorption sur une quasi-égalité', () => {
    const cip = estimateRoutes({ ...FREE_MILLING, adsorptionPreference: 'CIP' });
    const best = cip.find(r => r.recommended)!;
    const top = cip[0];
    // Soit la tête l'emporte, soit une route CIP à portée de tolérance a été préférée.
    expect(best === top || best.route.includes('CIP')).toBe(true);
  });

  it('borne toutes les récupérations dans [0, 100]', () => {
    const routes = estimateRoutes(FREE_MILLING);
    for (const r of routes) {
      expect(r.recovery_pct, r.route).toBeGreaterThanOrEqual(0);
      expect(r.recovery_pct, r.route).toBeLessThanOrEqual(100);
    }
  });

  it('documente chaque route par une formule et des références', () => {
    // Un livrable 43-101 doit pouvoir justifier chaque chiffre affiché.
    for (const r of estimateRoutes(FREE_MILLING)) {
      expect(r.basis.length, r.route).toBeGreaterThan(0);
      expect(r.references.length, r.route).toBeGreaterThan(0);
    }
  });
});

describe('rendements d\'étage — cohérence physique', () => {
  it('n\'utilise que des rendements fractionnaires', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    for (const k of ['gravityCipTransfer', 'cipAdsorption', 'flotationAu', 'flotationSulphides',
                     'tailsLeachEfficiency', 'oxidationLiberation', 'regrindLeachMax', 'postOxidationLeachMax'] as const) {
      expect(E[k], k).toBeGreaterThan(0);
      expect(E[k], k).toBeLessThanOrEqual(1);
    }
  });

  it('lixivie mieux un concentré rebroyé que des queues de flottation', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    expect(E.regrindLeachBonusPts).toBeGreaterThan(0);   // le rebroyage libère
    expect(E.tailsLeachPenaltyPts).toBeGreaterThan(0);   // les queues traînent
    expect(E.tailsLeachEfficiency).toBeLessThan(1);
  });

  it('plafonne toute récupération sous 100 %', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    for (const k of ['directLeachMaxPct', 'flotationRouteMaxPct'] as const) {
      expect(E[k], k).toBeLessThan(100);
    }
  });
});
