import { describe, it, expect } from 'vitest';
import {
  estimateRoutes, seriesRecovery, sequentialRecovery, qualityScore, weightedQuality,
  ROUTE_STAGE_EFFICIENCIES, QUALITY_SCORE_SATURATION_N,
  type RouteEstimationInputs, type RouteMetrics,
} from './routeEstimation';
import { ADSORPTION_CIRCUITS } from './adsorptionCircuit';

const COUNTS = { chem: 10, comminution: 10, knelson: 10, flotation: 10, leaching: 10, mineralogy: 10 };

const FREE_MILLING: RouteEstimationInputs = {
  metrics: {
    leachRec48Pct: 94, leachRec24Pct: 92, grgPct: 35,
    organicCarbonPct: 0.05, flotationAuRecPct: 88,
    sulphidePct: 0.8, auFreePct: 70,
  },
  counts: COUNTS,
  adsorptionCircuit: 'CIL',
};

const REFRACTORY: RouteEstimationInputs = {
  metrics: {
    leachRec48Pct: 86, leachRec24Pct: 82, grgPct: 20,
    organicCarbonPct: 0.05, flotationAuRecPct: 90,
    sulphidePct: 4.0, auFreePct: 45,
  },
  counts: COUNTS,
  adsorptionCircuit: 'CIL',
};

describe('topologies de récupération — série vs séquentiel', () => {
  it('série : chaque étage rattrape le rejet du précédent', () => {
    expect(seriesRecovery(0.5, 0.5)).toBeCloseTo(75, 10);
    expect(seriesRecovery(0.8, 0.5)).toBeGreaterThan(seriesRecovery(0.8));
  });

  it('séquentiel : le produit, borné par l\'étage de tête', () => {
    expect(sequentialRecovery(0.9, 0.8)).toBeCloseTo(72, 10);
    // Ajouter un étage ne peut QUE dégrader une chaîne séquentielle.
    expect(sequentialRecovery(0.9, 0.8)).toBeLessThan(sequentialRecovery(0.9) );
  });

  it('ne confond pas les deux : la série majore toujours le séquentiel', () => {
    for (const [a, b] of [[0.8, 0.9], [0.5, 0.5], [0.95, 0.97]]) {
      expect(seriesRecovery(a, b)).toBeGreaterThan(sequentialRecovery(a, b));
    }
  });

  it('les deux restent bornées dans [0, 100]', () => {
    expect(seriesRecovery(0.99, 0.99, 0.99)).toBeLessThanOrEqual(100);
    expect(sequentialRecovery(0.99, 0.99, 0.99)).toBeLessThanOrEqual(100);
    expect(sequentialRecovery(0)).toBe(0);
  });
});

describe('route gravité + flottation + lixiviation — série sur base usine', () => {
  // Trois étages de scavenging (gravité → flottation → lixiviation), TOUS minorés
  // des mêmes rendements usine que les routes sœurs → comparaison homogène.
  const DESIGN: RouteEstimationInputs = {
    metrics: {
      leachRec48Pct: 79.9, leachRec24Pct: 70, grgPct: 51.1,
      organicCarbonPct: 0.05, flotationAuRecPct: 86.5,
      sulphidePct: 0.8, auFreePct: 60,
    },
    counts: COUNTS,
    adsorptionCircuit: 'CIL',
  };

  it('ajouter la flottation comme étage de scavenging augmente la récupération série', () => {
    const r = estimateRoutes(DESIGN);
    const combo = r.find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    const gravCil = r.find(x => x.route === 'Gravité (Knelson) + CIL')!;
    expect(combo).toBeDefined();
    // La série à 3 étages majore la série à 2 étages (gravité + lixiviation).
    expect(combo.recovery_pct).toBeGreaterThan(gravCil.recovery_pct);
  });

  it('utilise la MÊME base usine que les routes sœurs (transfert usine, pas "brutes")', () => {
    const combo = estimateRoutes(DESIGN).find(r => r.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.basis).toMatch(/transfert usine/);
    expect(combo.basis).not.toMatch(/brute/i);
  });

  it('reste bornée sous le plafond configurable', () => {
    const combo = estimateRoutes(DESIGN).find(r => r.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.recovery_pct).toBeLessThanOrEqual(ROUTE_STAGE_EFFICIENCIES.gravFlotLeachRouteMaxPct);
  });

  it('est la route recommandée quand elle domine (récup. la plus haute)', () => {
    const reco = estimateRoutes(DESIGN).find(x => x.recommended)!;
    expect(reco.route).toMatch(/^Gravité \(Knelson\) \+ Flottation/);
  });

  it('n\'existe pas sans essai de flottation ni de gravité', () => {
    const noFlot = estimateRoutes({ ...DESIGN, metrics: { ...DESIGN.metrics, flotationAuRecPct: null } });
    expect(noFlot.some(r => r.route.startsWith('Gravité (Knelson) + Flottation'))).toBe(false);
    const noGrav = estimateRoutes({ ...DESIGN, metrics: { ...DESIGN.metrics, grgPct: null } });
    expect(noGrav.some(r => r.route.startsWith('Gravité (Knelson) + Flottation'))).toBe(false);
  });
});

describe('base de lixiviation — 48 h fait référence', () => {
  it('utilise le 48 h et non le 24 h quand les deux existent', () => {
    const at48 = estimateRoutes(FREE_MILLING);
    // Mêmes essais, mais 48 h volontairement dégradé au niveau du 24 h :
    // la récupération doit baisser, preuve que c'est bien le 48 h qui pilote.
    const degraded = estimateRoutes({
      ...FREE_MILLING,
      metrics: { ...FREE_MILLING.metrics, leachRec48Pct: FREE_MILLING.metrics.leachRec24Pct },
    });
    const direct = (rs: typeof at48) => rs.find(r => r.route.includes('direct (tout-venant'))!.recovery_pct;
    expect(direct(at48)).toBeGreaterThan(direct(degraded));
  });

  it('retombe sur le 24 h en le SIGNALANT quand le 48 h manque', () => {
    const r = estimateRoutes({
      ...FREE_MILLING,
      metrics: { ...FREE_MILLING.metrics, leachRec48Pct: null },
    });
    expect(r.length).toBeGreaterThan(0);
    // On vise la route de cyanuration directe (décomposition explicite du repli),
    // pas r[0] : la route série gravité+flottation+lixiviation peut désormais la coiffer.
    const direct = r.find(x => x.route.includes('direct (tout-venant'))!;
    expect(direct.basis).toMatch(/repli/i);
    expect(direct.basis).toMatch(/24 h/);
  });

  it('ne produit aucune route sans essai de lixiviation', () => {
    const r = estimateRoutes({
      ...FREE_MILLING,
      metrics: { ...FREE_MILLING.metrics, leachRec48Pct: null, leachRec24Pct: null },
    });
    expect(r).toHaveLength(0);
  });
});

describe('l\'essai de lixiviation n\'est ni un CIL ni un CIP', () => {
  it('nomme les routes d\'après le circuit d\'adsorption retenu', () => {
    const cil = estimateRoutes({ ...FREE_MILLING, adsorptionCircuit: 'CIL' });
    const cip = estimateRoutes({ ...FREE_MILLING, adsorptionCircuit: 'CIP' });
    expect(cil.some(r => r.route.includes('CIL'))).toBe(true);
    expect(cil.some(r => r.route.includes('CIP'))).toBe(false);
    expect(cip.some(r => r.route.includes('CIP'))).toBe(true);
    expect(cip.some(r => r.route.includes('CIL'))).toBe(false);
  });

  it('décompose explicitement lixiviation × transfert usine × adsorption', () => {
    // La décomposition lab→usine concerne les routes de cyanuration ; on vise la
    // route directe, pas r[0] (que la route série brute peut désormais coiffer).
    const direct = estimateRoutes(FREE_MILLING).find(r => r.route.includes('direct (tout-venant'))!;
    expect(direct.basis).toMatch(/lixiviation 48 h/);
    expect(direct.basis).toMatch(/transfert usine/);
    expect(direct.basis).toMatch(/adsorption CIL/);
  });

  it('ne départage CIL et CIP que sur le preg-robbing, à essais identiques', () => {
    // Sans carbone organique, les deux circuits donnent le même chiffre : c'est
    // le même essai de lixiviation, seule l'adsorption diffère (identique ici).
    const clean = { ...FREE_MILLING.metrics, organicCarbonPct: 0.05 };
    const cil = estimateRoutes({ ...FREE_MILLING, metrics: clean, adsorptionCircuit: 'CIL' });
    const cip = estimateRoutes({ ...FREE_MILLING, metrics: clean, adsorptionCircuit: 'CIP' });
    const direct = (rs: typeof cil) => rs.find(r => r.route.includes('direct (tout-venant'))!.recovery_pct;
    expect(direct(cil)).toBeCloseTo(direct(cip), 6);
  });

  it('avantage le CIL sur minerai préempteur (le charbon concurrence le carbone natif)', () => {
    const carbonaceous = { ...FREE_MILLING.metrics, organicCarbonPct: 0.8 };
    const cil = estimateRoutes({ ...FREE_MILLING, metrics: carbonaceous, adsorptionCircuit: 'CIL' });
    const cip = estimateRoutes({ ...FREE_MILLING, metrics: carbonaceous, adsorptionCircuit: 'CIP' });
    const direct = (rs: typeof cil) => rs.find(r => r.route.includes('direct (tout-venant'))!.recovery_pct;
    expect(direct(cil)).toBeGreaterThan(direct(cip));
    expect(ADSORPTION_CIRCUITS.CIL.pregRobbingMitigation).toBeGreaterThan(ADSORPTION_CIRCUITS.CIP.pregRobbingMitigation);
  });
});

describe('route réfractaire — régression du bug des 100 %', () => {
  it('ne dépasse JAMAIS la récupération de la flottation de tête', () => {
    // Le bug : la formule série donnait 100 % alors que la flottation ne
    // récupérait que ~84 % de l'or — le reste part aux rejets et ne revoit ni
    // l'oxydation ni la lixiviation.
    const r = estimateRoutes(REFRACTORY);
    const pox = r.find(x => x.route.includes('Oxydation'))!;
    const E = ROUTE_STAGE_EFFICIENCIES;
    const rFlotPct = (REFRACTORY.metrics.flotationAuRecPct! / 100) * E.flotationSulphides * 100;
    expect(pox.recovery_pct).toBeLessThanOrEqual(rFlotPct + 1e-9);
  });

  it('reste nettement sous 100 %', () => {
    const pox = estimateRoutes(REFRACTORY).find(x => x.route.includes('Oxydation'))!;
    expect(pox.recovery_pct).toBeLessThan(95);
  });

  it('annonce une chaîne séquentielle dans sa justification', () => {
    const pox = estimateRoutes(REFRACTORY).find(x => x.route.includes('Oxydation'))!;
    expect(pox.basis).toMatch(/séquentielle/i);
  });

  it('n\'ouvre la route oxydante qu\'au-delà du seuil de sulfures', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    const clean = estimateRoutes({ ...REFRACTORY, metrics: { ...REFRACTORY.metrics, sulphidePct: E.refractorySulphidesPct } });
    expect(clean.some(r => r.route.includes('Oxydation'))).toBe(false);
  });
});

describe('invariant global — aucune récupération aberrante', () => {
  it('borne toutes les routes dans [0, 100] sur des cas variés', () => {
    const cas: RouteMetrics[] = [
      FREE_MILLING.metrics,
      REFRACTORY.metrics,
      { leachRec48Pct: 99, leachRec24Pct: 98, grgPct: 90, organicCarbonPct: 0, flotationAuRecPct: 99, sulphidePct: 10, auFreePct: 95 },
      { leachRec48Pct: 40, leachRec24Pct: 30, grgPct: 2, organicCarbonPct: 3, flotationAuRecPct: 30, sulphidePct: 8, auFreePct: 10 },
    ];
    for (const m of cas) {
      for (const circuit of ['CIL', 'CIP'] as const) {
        for (const r of estimateRoutes({ metrics: m, counts: COUNTS, adsorptionCircuit: circuit })) {
          expect(r.recovery_pct, `${r.route} / ${circuit}`).toBeGreaterThanOrEqual(0);
          expect(r.recovery_pct, `${r.route} / ${circuit}`).toBeLessThan(100);
        }
      }
    }
  });

  it('trie par récupération décroissante et ne recommande qu\'UNE route', () => {
    const r = estimateRoutes(FREE_MILLING);
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].recovery_pct).toBeGreaterThanOrEqual(r[i].recovery_pct);
    }
    expect(r.filter(x => x.recommended)).toHaveLength(1);
  });

  it('documente chaque route par une formule et des références', () => {
    for (const r of estimateRoutes(FREE_MILLING)) {
      expect(r.basis.length, r.route).toBeGreaterThan(0);
      expect(r.references.length, r.route).toBeGreaterThan(0);
    }
  });
});

describe('score de qualité des données', () => {
  it('sature au nombre d\'essais documenté', () => {
    expect(qualityScore(QUALITY_SCORE_SATURATION_N)).toBe(100);
    expect(qualityScore(QUALITY_SCORE_SATURATION_N * 3)).toBe(100);
    expect(qualityScore(0)).toBe(0);
  });

  it('pondère selon l\'importance des paramètres et ne divise pas par zéro', () => {
    expect(weightedQuality([{ n: 15, w: 3 }, { n: 0, w: 1 }]))
      .toBeGreaterThan(weightedQuality([{ n: 0, w: 3 }, { n: 15, w: 1 }]));
    expect(weightedQuality([])).toBe(0);
  });
});

describe('rendements d\'étage — cohérence physique', () => {
  it('n\'utilise que des rendements fractionnaires', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    for (const k of ['flotationAu', 'flotationSulphides', 'tailsLeachEfficiency',
                     'oxidationLiberation', 'regrindLeachMax', 'postOxidationLeachMax'] as const) {
      expect(E[k], k).toBeGreaterThan(0);
      expect(E[k], k).toBeLessThanOrEqual(1);
    }
  });

  it('lixivie mieux un concentré rebroyé que des queues de flottation', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    expect(E.regrindLeachBonusPts).toBeGreaterThan(0);
    expect(E.tailsLeachPenaltyPts).toBeGreaterThan(0);
    expect(E.tailsLeachEfficiency).toBeLessThan(1);
  });

  it('plafonne toute récupération sous 100 %', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    for (const k of ['directLeachMaxPct', 'flotationRouteMaxPct'] as const) {
      expect(E[k], k).toBeLessThan(100);
    }
  });
});
