import { describe, it, expect } from 'vitest';
import {
  estimateRoutes, seriesRecovery, sequentialRecovery, qualityScore, weightedQuality,
  gravityCircuitRecovery,
  ROUTE_STAGE_EFFICIENCIES, QUALITY_SCORE_SATURATION_N,
  type RouteEstimationInputs, type RouteMetrics, type RouteStageEfficiencies,
} from './routeEstimation';
import { ADSORPTION_CIRCUITS } from './adsorptionCircuit';
import { ROUTE_ESTIMATION } from './routeSelection';
import { DEFAULT_ASSUMPTIONS } from '../config/constants';

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

describe('route gravité + flottation + circuit de cyanuration', () => {
  // Flowsheet aligné sur le PFS Spanish Mountain (§13.5, §17.2) :
  //   · concentré de GRAVITÉ  → lixiviation intensive (ILR)
  //   · concentré de FLOTTATION → rebroyage → CIL
  //   · rejets de flottation   → parc à résidus (NON lixiviés)
  //   · gravité scavenger sur les rejets cleaner → quelques points
  //   R = R_g·R_ILR + (1−R_g)·R_f·R_conc + scavenger
  const DESIGN: RouteEstimationInputs = {
    metrics: {
      leachRec48Pct: 79.9, leachRec24Pct: 70, grgPct: 51.1,
      organicCarbonPct: 0.05, flotationAuRecPct: 86.5,
      sulphidePct: 0.8, auFreePct: 60,
    },
    counts: COUNTS,
    adsorptionCircuit: 'CIL',
  };

  const E: RouteStageEfficiencies = { ...ROUTE_STAGE_EFFICIENCIES };
  const expected = (eff: RouteStageEfficiencies = E) => {
    const rGrav = gravityCircuitRecovery(DESIGN.metrics.grgPct!, eff);
    const rFlot = (DESIGN.metrics.flotationAuRecPct! / 100) * eff.flotationAu;
    const conc = Math.min(eff.regrindLeachMax, eff.concentrateLeachRecoveryPct / 100);
    return (rGrav * eff.intensiveLeachRecovery
      + (1 - rGrav) * rFlot * conc
      + eff.scavengerGravityRecoveryPts / 100) * 100;
  };

  it('applique R = R_g·R_ILR + (1−R_g)·R_f·R_conc + scavenger', () => {
    const combo = estimateRoutes(DESIGN).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.recovery_pct).toBeCloseTo(expected(), 1);
  });

  it('le concentré de gravité passe par la lixiviation intensive, pas le CIL', () => {
    const combo = estimateRoutes(DESIGN).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.stages.some(s => s.label === 'Gravité + ILR')).toBe(true);
    expect(combo.basis).toMatch(/lixiviation intensive/i);
  });

  it('annonce que les rejets de flottation partent au parc à résidus', () => {
    const combo = estimateRoutes(DESIGN).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.basis).toMatch(/parc à résidus/i);
    expect(combo.basis).toMatch(/non lixiviés/i);
  });

  it('reste bornée sous le plafond configurable', () => {
    const combo = estimateRoutes(DESIGN).find(r => r.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.recovery_pct).toBeLessThanOrEqual(ROUTE_STAGE_EFFICIENCIES.gravFlotLeachRouteMaxPct);
  });

  it('chaque paramètre du flowsheet est surchargeable par projet', () => {
    // Rien en dur : dérivation gravité, ILR, lixiviation de concentré et apport
    // scavenger déplacent tous le résultat, et le calcul suit la surcharge.
    for (const patch of [
      { gravityUnderflowBleedFraction: 0.35 },
      { intensiveLeachRecovery: 0.80 },
      { concentrateLeachRecoveryPct: 70 },
      { scavengerGravityRecoveryPts: 4 },
    ]) {
      const eff = { ...ROUTE_STAGE_EFFICIENCIES, ...patch };
      const got = estimateRoutes({ ...DESIGN, stageEfficiencies: eff })
        .find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
      expect(got.recovery_pct, JSON.stringify(patch)).toBeCloseTo(expected(eff), 1);
      expect(got.recovery_pct, JSON.stringify(patch)).not.toBeCloseTo(expected(), 1);
    }
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
    // Route flottation-seule (sans tête gravité) : c'est ELLE que borne la
    // récupération de flottation. La route « Gravité + Flottation + POX » a une
    // tête gravité en série et peut légitimement la dépasser.
    const pox = r.find(x => x.route.startsWith('Flottation + POX'))!;
    const E = ROUTE_STAGE_EFFICIENCIES;
    const rFlotPct = (REFRACTORY.metrics.flotationAuRecPct! / 100) * E.flotationSulphides * 100;
    expect(pox.recovery_pct).toBeLessThanOrEqual(rFlotPct + 1e-9);
  });

  it('reste nettement sous 100 %', () => {
    const pox = estimateRoutes(REFRACTORY).find(x => x.route.startsWith('Flottation + POX'))!;
    expect(pox.recovery_pct).toBeLessThan(95);
  });

  it('annonce une chaîne séquentielle dans sa justification', () => {
    const pox = estimateRoutes(REFRACTORY).find(x => x.route.startsWith('Flottation + POX'))!;
    expect(pox.basis).toMatch(/séquentielle/i);
  });

  it('n\'ouvre la route oxydante qu\'au-delà du seuil de sulfures', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    const clean = estimateRoutes({ ...REFRACTORY, metrics: { ...REFRACTORY.metrics, sulphidePct: E.refractorySulphidesPct } });
    expect(clean.some(r => r.route.includes('POX'))).toBe(false);
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

describe('étages affichés — dérivés de la route, jamais supposés', () => {
  it('chaque route énumère ses propres étages, dans l\'ordre du procédé', () => {
    for (const r of estimateRoutes(FREE_MILLING)) {
      expect(r.stages.length, r.route).toBeGreaterThan(0);
      for (const s of r.stages) {
        expect(s.label.length, r.route).toBeGreaterThan(0);
        expect(s.note.length, r.route).toBeGreaterThan(0);
        expect(s.recovery_pct, `${r.route} / ${s.label}`).toBeGreaterThanOrEqual(0);
        expect(s.recovery_pct, `${r.route} / ${s.label}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('n\'annonce un étage de gravité que si la route en comporte un', () => {
    // Le Tableau de bord affichait « Gravité » pour tout projet. Une route sans
    // gravité (flottation seule, tout-venant) ne doit pas en produire d'étage.
    const hasGravity = (prefix: string) =>
      estimateRoutes(FREE_MILLING).find(r => r.route.startsWith(prefix))!.stages.some(s => s.label === 'Gravité');
    expect(hasGravity('Gravité (Knelson) + CIL')).toBe(true);
    expect(hasGravity('CIL direct')).toBe(false);
    expect(hasGravity('Flottation + Rebroyage')).toBe(false);
  });

  it('nomme les étages de cyanuration d\'après le circuit retenu', () => {
    const cip = estimateRoutes({ ...FREE_MILLING, adsorptionCircuit: 'CIP' });
    for (const r of cip) {
      expect(r.stages.some(s => s.label.includes('CIL')), r.route).toBe(false);
    }
  });

  it('aucun étage ne dépasse la récupération globale sur une chaîne séquentielle', () => {
    // Sur la route oxydante, la flottation de tête borne le tout : son étage doit
    // majorer la globale, pas l'inverse.
    const pox = estimateRoutes(REFRACTORY).find(r => r.route.startsWith('Flottation + POX'))!;
    const flot = pox.stages.find(s => s.label === 'Flottation')!;
    expect(pox.recovery_pct).toBeLessThanOrEqual(flot.recovery_pct + 1e-9);
  });
});

describe('circuit gravimétrique — borné par le minerai ET par le circuit', () => {
  // Règle métallurgiste : on ne dérive que 18–20 % du cyclone underflow vers les
  // concentrateurs. Un circuit ne récupère pas l'or qu'il ne voit jamais, quel
  // que soit le GRG. L'app prenait GRG × 0,90 → 46 % là où le PFS retient 18 %.
  const E = ROUTE_STAGE_EFFICIENCIES;
  const eta = DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;

  it('un GRG élevé est plafonné par la dérivation du cyclone underflow', () => {
    // GRG 51,1 % mais seulement 20 % de l'underflow dérivé → 20 % × 0,90 = 18 %.
    expect(gravityCircuitRecovery(51.1, E)).toBeCloseTo(E.gravityUnderflowBleedFraction * eta, 10);
    expect(gravityCircuitRecovery(51.1, E) * 100).toBeCloseTo(18, 1);
  });

  it('un GRG faible borne à son tour : le plus contraignant gagne', () => {
    expect(gravityCircuitRecovery(5, E)).toBeCloseTo(0.05 * eta, 10);
  });

  it('la dérivation est configurable par projet', () => {
    const large = { gravityUnderflowBleedFraction: 0.40 };
    expect(gravityCircuitRecovery(51.1, large)).toBeCloseTo(0.40 * eta, 10);
    const nulle = { gravityUnderflowBleedFraction: 0 };
    expect(gravityCircuitRecovery(51.1, nulle)).toBe(0);
  });

  it('reste dans [0, 1] sur des entrées extrêmes', () => {
    for (const grg of [-10, 0, 100, 1000]) {
      const r = gravityCircuitRecovery(grg, E);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('la route gravité+CIL utilise ce plafonnement', () => {
    const r = estimateRoutes(FREE_MILLING).find(x => /^Gravité \(Knelson\) \+ CIL$/.test(x.route))!;
    const grav = r.stages.find(s => s.label === 'Gravité')!;
    expect(grav.recovery_pct).toBeCloseTo(gravityCircuitRecovery(FREE_MILLING.metrics.grgPct!, E) * 100, 1);
    expect(grav.note).toMatch(/cyclone underflow/);
  });
});

describe('lixiviation de CONCENTRÉ — paramètre propre, pas l\'essai tout-venant', () => {
  it('la route flottation utilise la récup. de concentré configurée', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    const r = estimateRoutes(FREE_MILLING).find(x => x.route.startsWith('Flottation + Rebroyage'))!;
    const cil = r.stages.find(s => /concentré rebroyé/i.test(s.label))!;
    expect(cil.recovery_pct).toBeCloseTo(Math.min(E.regrindLeachMax, E.concentrateLeachRecoveryPct / 100) * 100, 1);
  });

  it('un concentré lixivie mieux que le tout-venant du même minerai', () => {
    const routes = estimateRoutes(FREE_MILLING);
    const direct = routes.find(x => /^CIL direct/.test(x.route))!;
    const conc = routes.find(x => x.route.startsWith('Flottation + Rebroyage'))!
      .stages.find(s => /concentré rebroyé/i.test(s.label))!;
    expect(conc.recovery_pct).toBeGreaterThan(direct.recovery_pct);
  });

  it('avertit explicitement de ne pas y mettre l\'essai tout-venant', () => {
    const r = estimateRoutes(FREE_MILLING).find(x => x.route.startsWith('Flottation + Rebroyage'))!;
    expect(r.basis).toMatch(/pas l'essai tout-venant/i);
  });

  it('est configurable par projet', () => {
    const bas = estimateRoutes({
      ...FREE_MILLING,
      stageEfficiencies: { ...ROUTE_STAGE_EFFICIENCIES, concentrateLeachRecoveryPct: 60 },
    }).find(x => x.route.startsWith('Flottation + Rebroyage'))!;
    const haut = estimateRoutes(FREE_MILLING).find(x => x.route.startsWith('Flottation + Rebroyage'))!;
    expect(bas.recovery_pct).toBeLessThan(haut.recovery_pct);
  });
});

describe('INVARIANTS de bilan — ce qu\'un séparateur rejette n\'est jamais récupéré', () => {
  // ⚠️ L'invariant « ajouter une flottation ne peut pas nuire » est FAUX et a été
  // retiré : sur un minerai qui lixivie bien, une route qui envoie les rejets de
  // flottation au parc à résidus récupère MOINS qu'un CIL sur tout-venant. C'est
  // un arbitrage de flowsheet réel — Spanish Mountain n'installe la flottation
  // que parce qu'elle rejette le carbone organique préempteur (PFS §13.5.2).
  // Comparer deux flowsheets qui ne traitent pas les mêmes courants n'a pas de
  // sens comme loi générale. Restent les bornes de BILAN, elles universelles.
  const cases: [string, RouteEstimationInputs][] = [
    ['free-milling', FREE_MILLING],
    ['réfractaire', REFRACTORY],
    ['gravité faible', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, grgPct: 5 } }],
    ['flottation faible', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, flotationAuRecPct: 40 } }],
    ['lixiviation faible', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, leachRec48Pct: 55 } }],
    ['tout élevé', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, grgPct: 70, flotationAuRecPct: 95, leachRec48Pct: 95 } }],
  ];
  const E = ROUTE_STAGE_EFFICIENCIES;
  const scav = E.scavengerGravityRecoveryPts;

  it.each(cases)('%s — flottation+rebroyage ne dépasse pas ce que la flottation concentre', (_label, input) => {
    const r = estimateRoutes(input).find(x => x.route.startsWith('Flottation + Rebroyage'))!;
    const rFlotPct = (input.metrics.flotationAuRecPct! / 100) * E.flotationAu * 100;
    expect(r.recovery_pct).toBeLessThanOrEqual(rFlotPct + scav + 1e-9);
  });

  it.each(cases)('%s — gravité+flottation ne dépasse pas gravité + ce que la flottation concentre', (_label, input) => {
    const r = estimateRoutes(input).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    const rGrav = gravityCircuitRecovery(input.metrics.grgPct!, E);
    const rFlot = (input.metrics.flotationAuRecPct! / 100) * E.flotationAu;
    const plafond = (rGrav + (1 - rGrav) * rFlot) * 100 + scav;
    expect(r.recovery_pct).toBeLessThanOrEqual(plafond + 1e-9);
  });

  it.each(cases)('%s — toute récupération reste dans [0, 100)', (_label, input) => {
    for (const route of estimateRoutes(input)) {
      expect(route.recovery_pct, route.route).toBeGreaterThanOrEqual(0);
      expect(route.recovery_pct, route.route).toBeLessThan(100);
    }
  });
});

describe('catalogue de formules — référentiel métallurgiste', () => {
  // Vérifie chaque route contre SA formule du catalogue, sur les mêmes entrées.
  const E = ROUTE_STAGE_EFFICIENCIES;
  const m = FREE_MILLING.metrics;
  const cyan = (pct: number) =>
    (pct / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ADSORPTION_CIRCUITS.CIL.adsorptionEfficiency;

  const rGrav = gravityCircuitRecovery(m.grgPct!, E);
  const rFlot = (m.flotationAuRecPct! / 100) * E.flotationAu;
  const rLeach = cyan(m.leachRec48Pct!);
  const rConc = Math.min(E.regrindLeachMax, E.concentrateLeachRecoveryPct / 100);

  const routes = estimateRoutes(FREE_MILLING);
  const find = (prefix: string) => routes.find(r => r.route.startsWith(prefix))!;

  it('CIL direct : R = R_CIL', () => {
    expect(find('CIL direct').recovery_pct).toBeCloseTo(rLeach * 100, 1);
  });

  it('Gravité + Leach (résidus) : R = 1 − (1−R_g)(1−R_l)', () => {
    expect(find('Gravité (Knelson) + CIL').recovery_pct)
      .toBeCloseTo((1 - (1 - rGrav) * (1 - rLeach)) * 100, 1);
  });

  it('Grav. + Flot. + CIL : R = R_g·R_ILR + (1−R_g)·R_f·R_conc + scavenger', () => {
    expect(find('Gravité (Knelson) + Flottation').recovery_pct).toBeCloseTo(
      (rGrav * E.intensiveLeachRecovery + (1 - rGrav) * rFlot * rConc
        + E.scavengerGravityRecoveryPts / 100) * 100, 1);
  });

  it('Flot. + Rebroyage + CIL : R = R_f·R_conc + scavenger', () => {
    expect(find('Flottation + Rebroyage').recovery_pct)
      .toBeCloseTo((rFlot * rConc + E.scavengerGravityRecoveryPts / 100) * 100, 1);
  });

  it('le rebroyage n\'ajoute pas d\'étage — il est porté par la lixiviabilité du concentré', () => {
    const regrind = find('Flottation + Rebroyage');
    expect(regrind.stages.some(s => /^rebroyage$/i.test(s.label))).toBe(false);
    const conc = regrind.stages.find(s => /concentré rebroyé/i.test(s.label))!;
    expect(conc.recovery_pct).toBeCloseTo(rConc * 100, 1);
  });

  it('lixiviation sur concentré < lixiviation sur résidus, à entrées égales', () => {
    // L'invariant qui distingue les deux topologies : multiplier donne toujours
    // moins qu'additionner les contributions.
    const surConcentre = rGrav + (1 - rGrav) * rFlot * rLeach;
    const surResidus = 1 - (1 - rGrav) * (1 - rFlot) * (1 - rLeach);
    expect(surConcentre).toBeLessThan(surResidus);
  });
});

describe('catalogue étendu — routes ajoutées le 18 août 2026 (groupes A et B)', () => {
  const E = ROUTE_STAGE_EFFICIENCIES;
  const m = FREE_MILLING.metrics;
  const cyan = (pct: number) =>
    (pct / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ADSORPTION_CIRCUITS.CIL.adsorptionEfficiency;

  const rGrav = gravityCircuitRecovery(m.grgPct!, E);
  const rFlot = (m.flotationAuRecPct! / 100) * E.flotationAu;
  const rLeach = cyan(m.leachRec48Pct!);

  const routes = estimateRoutes(FREE_MILLING);
  const find = (prefix: string) => routes.find(r => r.route.startsWith(prefix))!;

  it('R16 Grav.+IGR+Leach (résidus grav.) : R = R_g×R_IGR + (1−R_g)×R_l', () => {
    const r = find('Gravité (Knelson) + IGR');
    expect(r.recovery_pct).toBeCloseTo(
      Math.min(E.directLeachMaxPct, (rGrav * E.intensiveLeachRecovery + (1 - rGrav) * rLeach) * 100), 1);
  });

  it('R15 Flot.+Leach (résidus flott.) : R = 1 − (1−R_f)(1−R_l)', () => {
    const r = find('Flottation + CIL (résidus de flottation)');
    expect(r.recovery_pct).toBeCloseTo((1 - (1 - rFlot) * (1 - rLeach)) * 100, 1);
  });

  it('R4 Grav.+Flot.+Leach (résidus flott.) : R = 1 − (1−R_g)(1−R_f)(1−R_l)', () => {
    const r = find('Gravité + Flottation + CIL (résidus de flottation)');
    expect(r.recovery_pct).toBeCloseTo((1 - (1 - rGrav) * (1 - rFlot) * (1 - rLeach)) * 100, 1);
  });

  it('R12 Grav.+Heap : R = 1 − (1−R_g)(1−R_heap)', () => {
    const rHeap = Math.max(0, Math.min(ROUTE_ESTIMATION.heapLeachMaxRecoveryPct,
      m.leachRec48Pct! * ROUTE_ESTIMATION.heapLeachEfficiency)) / 100;
    const r = find('Gravité (Knelson) + Heap Leach');
    expect(r.recovery_pct).toBeCloseTo((1 - (1 - rGrav) * (1 - rHeap)) * 100, 1);
  });

  it('« sur résidus » rend PLUS que « sur concentré » à entrées égales (topologie additive)', () => {
    // R4 (résidus) additionne ; « Gravité (Knelson) + Flottation » (concentré)
    // multiplie et abandonne les queues. Le premier doit coiffer le second.
    const surResidus = find('Gravité + Flottation + CIL (résidus de flottation)').recovery_pct;
    const surConcentre = find('Gravité (Knelson) + Flottation').recovery_pct;
    expect(surResidus).toBeGreaterThan(surConcentre);
  });

  it('les routes « sur résidus » NOMMENT le flux lixivié (lève l\'ambiguïté du bug 97,4 %)', () => {
    expect(find('Flottation + CIL (résidus de flottation)').route).toMatch(/résidus de flottation/);
    expect(find('Gravité + Flottation + CIL (résidus de flottation)').route).toMatch(/résidus de flottation/);
  });

  it('la route Grav.+Flot.+oxydation (tête gravité) existe et coiffe la flottation-seule', () => {
    const r = estimateRoutes(REFRACTORY);
    const gravOx = r.find(x => x.route.startsWith('Gravité + Flottation + POX'))!;
    const flotOx = r.find(x => x.route.startsWith('Flottation + POX'))!;
    expect(gravOx).toBeDefined();
    // La tête gravité récupère de l'or EN SÉRIE avant la flottation : elle majore.
    expect(gravOx.recovery_pct).toBeGreaterThan(flotOx.recovery_pct);
    expect(gravOx.stages.some(s => s.label.startsWith('Gravité'))).toBe(true);
  });

  it('toutes les routes ajoutées restent bornées dans [0, 100)', () => {
    for (const input of [FREE_MILLING, REFRACTORY]) {
      for (const r of estimateRoutes(input)) {
        expect(r.recovery_pct, r.route).toBeGreaterThanOrEqual(0);
        expect(r.recovery_pct, r.route).toBeLessThan(100);
      }
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
    for (const k of ['flotationAu', 'flotationSulphides', 'intensiveLeachRecovery',
                     'gravityUnderflowBleedFraction', 'regrindLeachMax', 'postOxidationLeachMax'] as const) {
      expect(E[k], k).toBeGreaterThan(0);
      expect(E[k], k).toBeLessThanOrEqual(1);
    }
  });

  it('un concentré rebroyé lixivie mieux que le tout-venant', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    expect(E.regrindLeachBonusPts).toBeGreaterThan(0);
    expect(E.concentrateLeachRecoveryPct).toBeGreaterThan(E.directLeachHighConfidencePct);
  });

  it('plafonne toute récupération sous 100 %', () => {
    const E = ROUTE_STAGE_EFFICIENCIES;
    for (const k of ['directLeachMaxPct', 'flotationRouteMaxPct'] as const) {
      expect(E[k], k).toBeLessThan(100);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASCADE DE RÉFÉRENCE — arbitrée par le métallurgiste.
//
//   1. GRAVITÉ sur le tout-venant, si elle existe ;
//   2. FLOTTATION sur le RÉSIDU DE GRAVITÉ, si elle existe ;
//   3. LIXIVIATION sur le CONCENTRÉ DE FLOTTATION ;
//   4. sans flottation, la LIXIVIATION traite le RÉSIDU DE GRAVITÉ.
//
// Ces tests fixent la cascade elle-même, indépendamment des coefficients : ils
// la relisent depuis les constantes, de sorte qu'un recalage de projet les
// laisse verts et qu'un changement de TOPOLOGIE les casse.
// ─────────────────────────────────────────────────────────────────────────────
describe('cascade de référence : gravité → flottation sur résidu → lixiviation sur concentré', () => {
  const E = ROUTE_STAGE_EFFICIENCIES;
  const M = {
    leachRec48Pct: 79.9, leachRec24Pct: 70, grgPct: 51.1,
    organicCarbonPct: 0.05, flotationAuRecPct: 86.5,
    sulphidePct: 0.8, auFreePct: 60,
  };
  const N = { chem: 10, comminution: 10, knelson: 10, flotation: 10, leaching: 10, mineralogy: 10 };
  const base: RouteEstimationInputs = { metrics: M, counts: N, adsorptionCircuit: 'CIL' };

  const rGrav = gravityCircuitRecovery(M.grgPct, E);
  const rFlot = (M.flotationAuRecPct / 100) * E.flotationAu;
  const rConc = Math.min(E.regrindLeachMax, E.concentrateLeachRecoveryPct / 100);
  const ads = ADSORPTION_CIRCUITS.CIL;
  const rLeach = (M.leachRec48Pct / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ads.adsorptionEfficiency;

  const find = (prefix: string, input = base) =>
    estimateRoutes(input).find(r => r.route.startsWith(prefix));

  it('gravité + flottation + lixiviation : R = R_g + (1−R_g)·R_f·R_conc', () => {
    // La flottation traite le RÉSIDU de gravité — d'où le facteur (1−R_g) — et
    // la lixiviation ne voit que son CONCENTRÉ.
    const r = find('Gravité (Knelson) + Flottation')!;
    expect(r.recovery_pct).toBeCloseTo(
      (rGrav * E.intensiveLeachRecovery + (1 - rGrav) * rFlot * rConc) * 100, 1);
  });

  it('sans flottation, la lixiviation traite le RÉSIDU DE GRAVITÉ : R = R_g + (1−R_g)·R_l', () => {
    const r = find('Gravité (Knelson) + CIL')!;
    expect(r.recovery_pct).toBeCloseTo((rGrav + (1 - rGrav) * rLeach) * 100, 1);
  });

  it('sans gravité, la flottation part du tout-venant : R = R_f·R_conc', () => {
    const r = find('Flottation + Rebroyage')!;
    expect(r.recovery_pct).toBeCloseTo(rFlot * rConc * 100, 1);
  });

  it('sans gravité ni flottation, la lixiviation traite le tout-venant : R = R_l', () => {
    expect(find('CIL direct')!.recovery_pct).toBeCloseTo(rLeach * 100, 1);
  });

  it('les QUEUES de flottation ne sont pas créditées — elles partent aux résidus', () => {
    // Le terme fautif serait (1−R_g)·(1−R_f)·R_l : il décrirait un flowsheet qui
    // lixivie aussi les queues, donc un AUTRE circuit.
    const r = find('Gravité (Knelson) + Flottation')!;
    const avecQueuesLixiviees =
      (rGrav * E.intensiveLeachRecovery
        + (1 - rGrav) * rFlot * rConc
        + (1 - rGrav) * (1 - rFlot) * rLeach) * 100;
    expect(r.recovery_pct).toBeLessThan(avecQueuesLixiviees - 1);
    expect(r.basis).toMatch(/parc à résidus/i);
  });

  it('aucun apport n\'est crédité pour un circuit scavenger absent', () => {
    // Le défaut était de 1 pt AJOUTÉ SANS CONDITION : toute route à flottation
    // portait un point d'or venu d'un équipement que le flowsheet n'a pas.
    expect(E.scavengerGravityRecoveryPts).toBe(0);
    const r = find('Flottation + Rebroyage')!;
    expect(r.recovery_pct).toBeCloseTo(rFlot * rConc * 100, 1);
  });

  it('un projet qui A un scavenger le renseigne, et le calcul le suit', () => {
    const eff = { ...E, scavengerGravityRecoveryPts: 1.5 };
    const r = find('Flottation + Rebroyage', { ...base, stageEfficiencies: eff })!;
    expect(r.recovery_pct).toBeCloseTo((rFlot * rConc + 0.015) * 100, 1);
  });
});

describe('la globale se lit à 48 h — le 24 h est un repli traçable', () => {
  const N = { chem: 10, comminution: 10, knelson: 10, flotation: 10, leaching: 10, mineralogy: 10 };
  const metrics = {
    leachRec48Pct: 79.9, leachRec24Pct: 70, grgPct: 51.1,
    organicCarbonPct: 0.05, flotationAuRecPct: 86.5, sulphidePct: 0.8, auFreePct: 60,
  };

  it('avec un essai à 48 h, toute route s\'en déclare issue', () => {
    for (const r of estimateRoutes({ metrics, counts: N, adsorptionCircuit: 'CIL' })) {
      expect(r.leachBasisIsFallback).toBe(false);
      expect(r.leachBasisLabel).toBe('48 h');
    }
  });

  it('sans 48 h, toute route se déclare bâtie sur le repli 24 h', () => {
    const routes = estimateRoutes({
      metrics: { ...metrics, leachRec48Pct: null },
      counts: N, adsorptionCircuit: 'CIL',
    });
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.leachBasisIsFallback).toBe(true);
      expect(r.leachBasisLabel).toMatch(/24 h/);
    }
  });

  it('le 24 h donne une récupération PLUS BASSE — c\'est une cinétique, pas une conception', () => {
    const a48 = estimateRoutes({ metrics, counts: N, adsorptionCircuit: 'CIL' })
      .find(r => r.route.startsWith('CIL direct'))!;
    const a24 = estimateRoutes({
      metrics: { ...metrics, leachRec48Pct: null }, counts: N, adsorptionCircuit: 'CIL',
    }).find(r => r.route.startsWith('CIL direct'))!;
    expect(a24.recovery_pct).toBeLessThan(a48.recovery_pct);
  });
});
