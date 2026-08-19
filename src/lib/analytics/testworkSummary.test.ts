import { describe, it, expect } from 'vitest';
import { summariseTestwork, hasAnyTestwork } from './testworkSummary';
import type { RouteMetrics, RouteSampleCounts } from './routeEstimation';

const COUNTS: RouteSampleCounts = {
  chem: 8, comminution: 4, knelson: 6, flotation: 5, leaching: 12, mineralogy: 3,
};

const METRICS: RouteMetrics = {
  leachRec48Pct: 79.9, leachRec24Pct: 70.2, grgPct: 51.1,
  organicCarbonPct: 0.3, flotationAuRecPct: 86.5,
  sulphidePct: 0.8, auFreePct: 60,
};

describe('moyennes des essais LIMS', () => {
  it('rend une ligne par famille de récupération', () => {
    const rows = summariseTestwork(METRICS, COUNTS);
    expect(rows.map(r => r.key)).toEqual(['leach48', 'leach24', 'grg', 'flotation', 'auFree']);
  });

  it('reporte la moyenne et l\'effectif de chaque famille', () => {
    const rows = summariseTestwork(METRICS, COUNTS);
    const leach = rows.find(r => r.key === 'leach48')!;
    expect(leach.meanPct).toBe(79.9);
    expect(leach.n).toBe(12);
    expect(rows.find(r => r.key === 'grg')!.n).toBe(6);
    expect(rows.find(r => r.key === 'auFree')!.n).toBe(3);
  });

  it('garde les familles NON mesurées — une lacune s\'affiche, ne se masque pas', () => {
    const rows = summariseTestwork(
      { ...METRICS, grgPct: null, flotationAuRecPct: null },
      { ...COUNTS, knelson: 0, flotation: 0 },
    );
    expect(rows).toHaveLength(5);
    expect(rows.find(r => r.key === 'grg')!.meanPct).toBeNull();
    expect(rows.find(r => r.key === 'flotation')!.meanPct).toBeNull();
  });

  it('expose la valeur AJUSTÉE quand un modèle d\'étage la soutient', () => {
    // C'est l'ajustement, pas la moyenne, qui alimente les routes : les deux
    // doivent être visibles côte à côte, sinon l'écart passe pour une erreur.
    const rows = summariseTestwork(METRICS, COUNTS, { leachPct: 77.4, flotationPct: 84.1 });
    expect(rows.find(r => r.key === 'leach48')!.fittedPct).toBe(77.4);
    expect(rows.find(r => r.key === 'flotation')!.fittedPct).toBe(84.1);
    // Les familles sans modèle ajusté n'en inventent pas.
    expect(rows.find(r => r.key === 'grg')!.fittedPct).toBeNull();
    expect(rows.find(r => r.key === 'leach24')!.fittedPct).toBeNull();
  });

  it('encaisse des valeurs non finies sans les propager', () => {
    const rows = summariseTestwork(
      { ...METRICS, leachRec48Pct: NaN as unknown as number },
      COUNTS,
      { leachPct: Infinity },
    );
    expect(rows.find(r => r.key === 'leach48')!.meanPct).toBeNull();
    expect(rows.find(r => r.key === 'leach48')!.fittedPct).toBeNull();
  });

  it('sait dire qu\'aucun essai n\'existe', () => {
    const vide = summariseTestwork(
      { leachRec48Pct: null, leachRec24Pct: null, grgPct: null, organicCarbonPct: null,
        flotationAuRecPct: null, sulphidePct: null, auFreePct: null },
      { chem: 0, comminution: 0, knelson: 0, flotation: 0, leaching: 0, mineralogy: 0 },
    );
    expect(hasAnyTestwork(vide)).toBe(false);
    expect(hasAnyTestwork(summariseTestwork(METRICS, COUNTS))).toBe(true);
  });

  it('chaque famille explique ce qu\'elle mesure — jamais une récupération d\'usine', () => {
    for (const r of summariseTestwork(METRICS, COUNTS)) {
      expect(r.note.length).toBeGreaterThan(20);
    }
  });
});
