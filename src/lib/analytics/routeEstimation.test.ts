import { describe, it, expect } from 'vitest';
import {
  estimateRoutes, seriesRecovery, sequentialRecovery, qualityScore, weightedQuality,
  ROUTE_STAGE_EFFICIENCIES, QUALITY_SCORE_SATURATION_N,
  type RouteEstimationInputs, type RouteMetrics,
} from './routeEstimation';
import { ADSORPTION_CIRCUITS } from './adsorptionCircuit';
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
  // Le nom se termine par « CIL » : les DEUX courants de flottation y passent.
  // Le concentré, rebroyé, lixivie mieux ; les queues rejoignent le CIL
  // principal.  R = R_g + (1−R_g)×[R_f·R_l,conc + (1−R_f)·R_l]
  const DESIGN: RouteEstimationInputs = {
    metrics: {
      leachRec48Pct: 79.9, leachRec24Pct: 70, grgPct: 51.1,
      organicCarbonPct: 0.05, flotationAuRecPct: 86.5,
      sulphidePct: 0.8, auFreePct: 60,
    },
    counts: COUNTS,
    adsorptionCircuit: 'CIL',
  };

  const E = ROUTE_STAGE_EFFICIENCIES;
  const cyan = (pct: number) =>
    (pct / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ADSORPTION_CIRCUITS.CIL.adsorptionEfficiency;

  it('applique R = R_g + (1−R_g)·[R_f·R_l,conc + (1−R_f)·R_l]', () => {
    const m = DESIGN.metrics;
    const rGrav = (m.grgPct! / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const rFlot = (m.flotationAuRecPct! / 100) * E.flotationAu;
    const rLeach = cyan(m.leachRec48Pct!);
    const rConc = Math.min(E.regrindLeachMax, cyan(m.leachRec48Pct! + E.regrindLeachBonusPts));
    const expected = (rGrav + (1 - rGrav) * (rFlot * rConc + (1 - rFlot) * rLeach)) * 100;

    const combo = estimateRoutes(DESIGN).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.recovery_pct).toBeCloseTo(expected, 1);
  });

  it('reste sous la formule des RÉSIDUS — régression du 97,4 %', () => {
    // La formule des résidus 1−(1−Rg)(1−Rf)(1−Rl) tient l'or du concentré pour
    // déjà récupéré, sans le lixivier : elle majore strictement le bilan réel.
    const m = DESIGN.metrics;
    const rGrav = (m.grgPct! / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const rFlot = (m.flotationAuRecPct! / 100) * E.flotationAu;
    const surResidus = (1 - (1 - rGrav) * (1 - rFlot) * (1 - cyan(m.leachRec48Pct!))) * 100;

    const combo = estimateRoutes(DESIGN).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.recovery_pct).toBeLessThan(surResidus);
  });

  it('lixivie les DEUX courants — aucun or abandonné aux queues de flottation', () => {
    const combo = estimateRoutes(DESIGN).find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    expect(combo.basis).toMatch(/DEUX courants sont lixiviés/i);
    expect(combo.basis).toMatch(/queues au CIL/i);
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

  it('le gain de la flottation vient du CONCENTRÉ REBROYÉ, qui lixivie mieux', () => {
    // Sans bonus de rebroyage, le concentré lixivierait comme les queues : la
    // flottation ne changerait alors RIEN et la route retomberait exactement sur
    // « Gravité + CIL ». C'est la libération au rebroyage qui la justifie.
    const r = estimateRoutes(DESIGN);
    const combo = r.find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    const gravCil = r.find(x => x.route === 'Gravité (Knelson) + CIL')!;
    expect(combo.recovery_pct).toBeGreaterThan(gravCil.recovery_pct);

    const sansBonus = estimateRoutes({
      ...DESIGN,
      stageEfficiencies: { ...ROUTE_STAGE_EFFICIENCIES, regrindLeachBonusPts: 0 },
    });
    const comboSansBonus = sansBonus.find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    const gravCilSansBonus = sansBonus.find(x => x.route === 'Gravité (Knelson) + CIL')!;
    expect(comboSansBonus.recovery_pct).toBeCloseTo(gravCilSansBonus.recovery_pct, 1);
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
    const pox = estimateRoutes(REFRACTORY).find(r => r.route.includes('Oxydation'))!;
    const flot = pox.stages.find(s => s.label === 'Flottation')!;
    expect(pox.recovery_pct).toBeLessThanOrEqual(flot.recovery_pct + 1e-9);
  });
});

describe('INVARIANT — un étage de scavenging ne peut pas détruire de la récupération', () => {
  // Le défaut que cet invariant verrouille : « Gravité + Flottation + CIL »
  // affichait 78,7 % contre 86,6 % pour « Gravité + CIL ». Ajouter un étage
  // faisait BAISSER la récupération — un circuit que personne ne construirait.
  // Cause : la formule « lixiviation sur concentré » envoyait les queues de
  // flottation aux rejets, alors qu'une route « … + CIL » les y fait passer.
  const cases: [string, RouteEstimationInputs][] = [
    ['free-milling', FREE_MILLING],
    ['réfractaire', REFRACTORY],
    ['gravité faible', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, grgPct: 5 } }],
    ['flottation faible', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, flotationAuRecPct: 40 } }],
    ['lixiviation faible', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, leachRec48Pct: 55 } }],
    ['tout élevé', { ...FREE_MILLING, metrics: { ...FREE_MILLING.metrics, grgPct: 70, flotationAuRecPct: 95, leachRec48Pct: 95 } }],
  ];

  it.each(cases)('%s — gravité+flottation+CIL ≥ gravité+CIL', (_label, input) => {
    const r = estimateRoutes(input);
    const combo = r.find(x => x.route.startsWith('Gravité (Knelson) + Flottation'))!;
    const gravCil = r.find(x => /^Gravité \(Knelson\) \+ (CIL|CIP)$/.test(x.route))!;
    expect(combo.recovery_pct).toBeGreaterThanOrEqual(gravCil.recovery_pct);
  });

  it.each(cases)('%s — flottation+rebroyage+CIL ≥ cyanuration directe', (_label, input) => {
    const r = estimateRoutes(input);
    const flot = r.find(x => x.route.startsWith('Flottation + Rebroyage'))!;
    const direct = r.find(x => /^(CIL|CIP) direct/.test(x.route))!;
    expect(flot.recovery_pct).toBeGreaterThanOrEqual(direct.recovery_pct);
  });

  it.each(cases)('%s — aucune route ne descend sous son propre étage de lixiviation seul', (_label, input) => {
    const r = estimateRoutes(input);
    const direct = r.find(x => /^(CIL|CIP) direct/.test(x.route))!;
    for (const route of r) {
      if (/tas|Oxydation/.test(route.route)) continue;   // topologies à part
      expect(route.recovery_pct, route.route).toBeGreaterThanOrEqual(direct.recovery_pct);
    }
  });
});

describe('catalogue de formules — référentiel métallurgiste', () => {
  // Vérifie chaque route contre SA formule du catalogue, sur les mêmes entrées.
  const E = ROUTE_STAGE_EFFICIENCIES;
  const m = FREE_MILLING.metrics;
  const cyan = (pct: number) =>
    (pct / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ADSORPTION_CIRCUITS.CIL.adsorptionEfficiency;

  const rGrav = (m.grgPct! / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
  const rFlot = (m.flotationAuRecPct! / 100) * E.flotationAu;
  const rLeach = cyan(m.leachRec48Pct!);
  const rRegrind = Math.min(E.regrindLeachMax, cyan(m.leachRec48Pct! + E.regrindLeachBonusPts));

  const routes = estimateRoutes(FREE_MILLING);
  const find = (prefix: string) => routes.find(r => r.route.startsWith(prefix))!;

  it('CIL direct : R = R_CIL', () => {
    expect(find('CIL direct').recovery_pct).toBeCloseTo(rLeach * 100, 1);
  });

  it('Gravité + Leach (résidus) : R = 1 − (1−R_g)(1−R_l)', () => {
    expect(find('Gravité (Knelson) + CIL').recovery_pct)
      .toBeCloseTo((1 - (1 - rGrav) * (1 - rLeach)) * 100, 1);
  });

  it('Grav. + Flot. + CIL : R = R_g + (1−R_g)·[R_f·R_l,conc + (1−R_f)·R_l]', () => {
    expect(find('Gravité (Knelson) + Flottation').recovery_pct)
      .toBeCloseTo((rGrav + (1 - rGrav) * (rFlot * rRegrind + (1 - rFlot) * rLeach)) * 100, 1);
  });

  it('Flot. + Rebroyage + CIL : R = R_f·R_l,rebroyé + (1−R_f)·R_l', () => {
    expect(find('Flottation + Rebroyage').recovery_pct)
      .toBeCloseTo((rFlot * rRegrind + (1 - rFlot) * rLeach) * 100, 1);
  });

  it('le rebroyage n\'ajoute pas d\'étage — il relève R_l sur le concentré', () => {
    // Le gain du rebroyage est PORTÉ par la lixiviation du concentré : aucun
    // étage « rebroyage » ne porte de récupération propre.
    expect(rRegrind).toBeGreaterThan(rLeach);
    const regrind = find('Flottation + Rebroyage');
    expect(regrind.stages.some(s => /^rebroyage$/i.test(s.label))).toBe(false);
    const conc = regrind.stages.find(s => /concentré rebroyé/i.test(s.label))!;
    expect(conc.recovery_pct).toBeCloseTo(rRegrind * 100, 1);
  });

  it('lixiviation sur concentré < lixiviation sur résidus, à entrées égales', () => {
    // L'invariant qui distingue les deux topologies : multiplier donne toujours
    // moins qu'additionner les contributions.
    const surConcentre = rGrav + (1 - rGrav) * rFlot * rLeach;
    const surResidus = 1 - (1 - rGrav) * (1 - rFlot) * (1 - rLeach);
    expect(surConcentre).toBeLessThan(surResidus);
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
