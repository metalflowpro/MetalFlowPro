import { describe, it, expect } from 'vitest';
import {
  ROUTE_ESTIMATION, selectRecommendedRoute, ROUTE_TIE_TOLERANCE_PCT,
  ROUTE_SELECTION_CRITERIA, scoreRoute, type RouteCandidate,
} from './routeSelection';

// The circuits the reported project actually produced.
const NGM_ROUTES = [
  { route: 'Gravité (Knelson) + CIP', recovery_pct: 91.0 },
  { route: 'Gravité (Knelson) + CIL', recovery_pct: 90.0 },
  { route: 'Lixiviation directe CIL/CIP', recovery_pct: 87.8 },
  { route: 'Flottation + Rebroyage + Leach + CIP', recovery_pct: 83.6 },
];

describe('selectRecommendedRoute', () => {
  it('gives ONE answer that both views share', () => {
    // Regression: "Synthèse LIMS" showed Gravité+Lixiviation+CIP (91 %) while
    // "Route Métallurgique" showed Gravité+CIL (90 %) — same project, same data.
    const a = selectRecommendedRoute(NGM_ROUTES, 'CIL');
    const b = selectRecommendedRoute(NGM_ROUTES, 'CIL');
    expect(a).toBe(b);
    expect(a!.route).toBe('Gravité (Knelson) + CIL');
  });

  it('prefers the adsorption circuit the CIL/CIP analysis calls for, on a near-tie', () => {
    expect(selectRecommendedRoute(NGM_ROUTES, 'CIL')!.route).toContain('CIL');
    expect(selectRecommendedRoute(NGM_ROUTES, 'CIP')!.route).toContain('CIP');
  });

  it('does not overturn a decisive recovery advantage', () => {
    const decisive = [
      { route: 'Gravité (Knelson) + CIP', recovery_pct: 94.0 },
      { route: 'Gravité (Knelson) + CIL', recovery_pct: 88.0 },
    ];
    // 6 points is well past the noise: the better circuit wins regardless.
    expect(selectRecommendedRoute(decisive, 'CIL')!.route).toContain('CIP');
  });

  it('treats the tie window as exactly ±1.5 pt', () => {
    const inside = [
      { route: 'X CIP', recovery_pct: 90 },
      { route: 'Y CIL', recovery_pct: 90 - ROUTE_TIE_TOLERANCE_PCT },
    ];
    expect(selectRecommendedRoute(inside, 'CIL')!.route).toBe('Y CIL');

    const outside = [
      { route: 'X CIP', recovery_pct: 90 },
      { route: 'Y CIL', recovery_pct: 90 - ROUTE_TIE_TOLERANCE_PCT - 0.1 },
    ];
    expect(selectRecommendedRoute(outside, 'CIL')!.route).toBe('X CIP');
  });

  it('leaves a non-adsorption leader alone — CIL/CIP advice does not apply to it', () => {
    const routes = [
      { route: 'Lixiviation en tas (Heap Leach)', recovery_pct: 92 },
      { route: 'Gravité (Knelson) + CIL', recovery_pct: 91.5 },
    ];
    expect(selectRecommendedRoute(routes, 'CIL')!.route).toContain('Heap');
  });

  it('picks the highest recovery when no circuit matches the advice', () => {
    const routes = [
      { route: 'Gravité (Knelson) + CIP', recovery_pct: 91 },
      { route: 'Flottation directe', recovery_pct: 80 },
    ];
    expect(selectRecommendedRoute(routes, 'CIL')!.route).toContain('CIP');
  });

  it('does not mutate the caller array', () => {
    const copy = [...NGM_ROUTES];
    selectRecommendedRoute(NGM_ROUTES, 'CIL');
    expect(NGM_ROUTES).toEqual(copy);
  });

  it('returns undefined on no candidates', () => {
    expect(selectRecommendedRoute([], 'CIL')).toBeUndefined();
  });
});

describe('sélection multi-critères — au-delà de la seule récupération', () => {
  // Deux routes en quasi-égalité de récupération, MÊME circuit (le conseil CIL ne
  // les départage pas) : l'économie (CAPEX/OPEX) doit trancher.
  const NEAR_TIE: RouteCandidate[] = [
    { route: 'Gravité (Knelson) + CIL', recovery_pct: 90.0, capex_indicator: 'high', opex_indicator: 'high', confidence: 'high', dataQualityScore: 80 },
    { route: 'CIL direct (tout-venant)', recovery_pct: 89.2, capex_indicator: 'low', opex_indicator: 'low', confidence: 'high', dataQualityScore: 80 },
  ];

  it('en quasi-égalité, la route la moins coûteuse (CAPEX/OPEX) l\'emporte', () => {
    // 89,2 % moins cher bat 90,0 % plus cher : la récupération ne suffit pas.
    expect(selectRecommendedRoute(NEAR_TIE, 'CIL')!.route).toContain('direct');
  });

  it('à coût égal, la route la mieux étayée (confiance + données) l\'emporte', () => {
    const routes: RouteCandidate[] = [
      { route: 'A CIL', recovery_pct: 90.0, capex_indicator: 'medium', opex_indicator: 'medium', confidence: 'low',  dataQualityScore: 20 },
      { route: 'B CIL', recovery_pct: 89.5, capex_indicator: 'medium', opex_indicator: 'medium', confidence: 'high', dataQualityScore: 95 },
    ];
    expect(selectRecommendedRoute(routes, 'CIL')!.route).toBe('B CIL');
  });

  it('ne renverse PAS un écart décisif de récupération sur l\'économie', () => {
    // 8 points d'écart : hors fenêtre de quasi-égalité, la récupération reste souveraine
    // même si la route de tête est la plus chère (pas de NPV inventé pour la battre).
    const decisive: RouteCandidate[] = [
      { route: 'Gravité (Knelson) + CIL', recovery_pct: 98.0, capex_indicator: 'high', opex_indicator: 'high', confidence: 'medium', dataQualityScore: 60 },
      { route: 'CIL direct',              recovery_pct: 90.0, capex_indicator: 'low',  opex_indicator: 'low',  confidence: 'high',   dataQualityScore: 90 },
    ];
    expect(selectRecommendedRoute(decisive, 'CIL')!.recovery_pct).toBe(98.0);
  });

  it('reste piloté par le barème CONFIGURABLE (aucune valeur en dur)', () => {
    // Même quasi-égalité, mais on annule le poids économique : la récupération
    // reprend la main → la route la plus chère mais la plus haute repasse devant.
    const recoveryOnly = { ...ROUTE_SELECTION_CRITERIA, weights: { recovery: 1, economics: 0, dataSupport: 0 } };
    expect(selectRecommendedRoute(NEAR_TIE, 'CIL', recoveryOnly)!.route).toContain('Gravité');
    // …et par défaut (poids économique non nul), l'économie tranche dans l'autre sens.
    expect(selectRecommendedRoute(NEAR_TIE, 'CIL')!.route).toContain('direct');
  });

  it('scoreRoute : récupération dominante, décomposition par critère bornée', () => {
    const s = scoreRoute(NEAR_TIE[0]);
    for (const v of [s.total, s.recovery, s.economics, s.dataSupport]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // À économie et données identiques, plus de récupération ⇒ meilleur score.
    const hi = scoreRoute({ route: 'x', recovery_pct: 95, capex_indicator: 'low', opex_indicator: 'low', confidence: 'high', dataQualityScore: 90 });
    const lo = scoreRoute({ route: 'x', recovery_pct: 80, capex_indicator: 'low', opex_indicator: 'low', confidence: 'high', dataQualityScore: 90 });
    expect(hi.total).toBeGreaterThan(lo.total);
  });

  it('une route sans indicateurs est notée sur sa seule récupération (neutre ailleurs)', () => {
    const bare = scoreRoute({ route: 'x', recovery_pct: 80 });
    // Critères absents = valeur neutre configurée (ni bonus ni malus).
    expect(bare.economics).toBeCloseTo(ROUTE_SELECTION_CRITERIA.neutral.economics * 100, 6);
    expect(bare.dataSupport).toBeCloseTo(ROUTE_SELECTION_CRITERIA.neutral.dataSupport * 100, 6);
  });
});

describe('ROUTE_ESTIMATION — barème d\'estimation des routes', () => {
  it('applique des rendements et facteurs fractionnaires', () => {
    // La lixiviation en tas récupère MOINS qu'une cuve agitée (percolation plus
    // grossière, plus lente) : un facteur ≥ 1 inverserait la hiérarchie des routes.
    expect(ROUTE_ESTIMATION.heapLeachEfficiency).toBeGreaterThan(0);
    expect(ROUTE_ESTIMATION.heapLeachEfficiency).toBeLessThan(1);
    expect(ROUTE_ESTIMATION.flotationScoreFactor).toBeGreaterThan(0);
    expect(ROUTE_ESTIMATION.flotationScoreFactor).toBeLessThanOrEqual(1);
  });

  it('borne le tas sous une récupération totale', () => {
    expect(ROUTE_ESTIMATION.heapLeachMaxRecoveryPct).toBeGreaterThan(0);
    expect(ROUTE_ESTIMATION.heapLeachMaxRecoveryPct).toBeLessThan(100);
  });

  it('n\'utilise que des pénalités positives (une pénalité négative serait un bonus)', () => {
    expect(ROUTE_ESTIMATION.pregRobbingPenaltyPts).toBeGreaterThan(0);
    expect(ROUTE_ESTIMATION.corgScorePenaltyPerPct).toBeGreaterThan(0);
  });

  it('exige plus d\'or libre pour bonifier que pour envisager un tas', () => {
    // Cohérence des deux seuils d'or libre : le bonus de score est plus exigeant
    // que la simple éligibilité au tas.
    expect(ROUTE_ESTIMATION.highAuFreeThresholdPct)
      .toBeGreaterThanOrEqual(ROUTE_ESTIMATION.heapLeachMinAuFreePct);
  });

  it('déclenche la pénalité de preg-robbing sur une teneur en carbone faible', () => {
    // Le preg-robbing se manifeste dès quelques dixièmes de % de carbone organique.
    expect(ROUTE_ESTIMATION.pregRobbingCorgThresholdPct).toBeGreaterThan(0);
    expect(ROUTE_ESTIMATION.pregRobbingCorgThresholdPct).toBeLessThan(1);
  });
});
