import { describe, it, expect } from 'vitest';
import { ROUTE_ESTIMATION, selectRecommendedRoute, ROUTE_TIE_TOLERANCE_PCT } from './routeSelection';

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
