import { describe, it, expect } from 'vitest';
import { chosenRoute, flowsheetRoute } from './routeChoice';
import { estimateRoutes, type RouteEstimationInputs } from './routeEstimation';

const COUNTS = { chem: 10, comminution: 10, knelson: 10, flotation: 10, leaching: 10, mineralogy: 10 };

const FREE_MILLING: RouteEstimationInputs = {
  metrics: {
    leachRec48Pct: 79.9, leachRec24Pct: 70, grgPct: 51.1,
    organicCarbonPct: 0.05, flotationAuRecPct: 86.5,
    sulphidePct: 0.8, auFreePct: 60,
  },
  counts: COUNTS,
  adsorptionCircuit: 'CIL',
};

const REFRACTORY: RouteEstimationInputs = {
  ...FREE_MILLING,
  metrics: { ...FREE_MILLING.metrics, sulphidePct: 4.0, flotationAuRecPct: 90 },
};

/** Flowsheet minimal : seuls les équipements déterminants comptent. */
const equip = (...ids: string[]): Record<string, boolean> => {
  const e: Record<string, boolean> = { general: true, sag: true, ball: true, hydrocyclone: true };
  for (const id of ids) e[id] = true;
  return e;
};

describe('lecture du flowsheet utilisateur', () => {
  it('ne retient que les équipements qui distinguent une route', () => {
    const f = flowsheetRoute(equip('gravity', 'flotation', 'cil', 'vertimill'));
    expect(f).toEqual({ gravity: true, flotation: true, leach: true, heap: false, regrind: true, oxidation: false });
  });

  it('une case décochée vaut « non retenu », comme une case absente', () => {
    expect(flowsheetRoute({ gravity: false, cil: true }).gravity).toBe(false);
    expect(flowsheetRoute({ cil: true }).gravity).toBe(false);
  });

  it('reconnaît le rebroyage et l\'oxydation quel qu\'en soit l\'équipement', () => {
    expect(flowsheetRoute(equip('isamill')).regrind).toBe(true);
    expect(flowsheetRoute(equip('towermill')).regrind).toBe(true);
    expect(flowsheetRoute(equip('biox')).oxidation).toBe(true);
    expect(flowsheetRoute(equip('roasting')).oxidation).toBe(true);
  });
});

describe('route retenue par l\'utilisateur', () => {
  const routes = estimateRoutes(FREE_MILLING);

  it('gravité + flottation + CIL → la meilleure route gravité+flottation+CIL (résidus lixiviés)', () => {
    // Le motif le plus SPÉCIFIQUE gagne (pas « Gravité + CIL »). Et parmi les deux
    // circuits gravité+flottation+CIL du catalogue, on retient le plus performant :
    // celui qui LIXIVIE LES RÉSIDUS de flottation, conforme à l'assistant
    // « lixiviation CIL du reste ». Les routes étant triées par récupération
    // décroissante, c'est la route « (résidus de flottation) » qui est retenue.
    const r = chosenRoute(routes, equip('gravity', 'flotation', 'cil'))!;
    expect(r.estimate.route).toMatch(/^Gravité .*\+ Flottation \+ CIL/);
    expect(r.downgraded).toBe(false);
    // C'est bien la plus performante des routes gravité+flottation+CIL disponibles.
    const family = routes.filter(x => /^Gravité .*\+ Flottation \+ (CIL|CIP)/.test(x.route));
    const bestOfFamily = family.reduce((b, x) => (x.recovery_pct > b.recovery_pct ? x : b), family[0]);
    expect(r.estimate.route).toBe(bestOfFamily.route);
  });

  it('gravité + CIL sans flottation → la route à deux étages', () => {
    const r = chosenRoute(routes, equip('gravity', 'cil'))!;
    expect(r.estimate.route).toBe('Gravité (Knelson) + CIL');
    expect(r.downgraded).toBe(false);
  });

  it('CIL seul → cyanuration directe du tout-venant', () => {
    const r = chosenRoute(routes, equip('cil'))!;
    expect(r.estimate.route).toMatch(/^CIL direct/);
    expect(r.downgraded).toBe(false);
  });

  it('flottation + CIL sans gravité → flottation + rebroyage', () => {
    const r = chosenRoute(routes, equip('flotation', 'cil'))!;
    expect(r.estimate.route).toMatch(/^Flottation \+ Rebroyage/);
  });

  it('l\'oxydation prime : flottation + POX + CIL → route réfractaire', () => {
    const r = chosenRoute(estimateRoutes(REFRACTORY), equip('gravity', 'flotation', 'pox', 'cil'))!;
    expect(r.estimate.route).toMatch(/POX|BIOX|Grillage|Albion/);
  });

  it('suit le circuit d\'adsorption retenu (CIP au lieu de CIL)', () => {
    const cip = estimateRoutes({ ...FREE_MILLING, adsorptionCircuit: 'CIP' });
    expect(chosenRoute(cip, equip('gravity', 'cil'))!.estimate.route).toBe('Gravité (Knelson) + CIP');
  });
});

describe('repli sur une route moins spécifique — signalé, jamais silencieux', () => {
  // Le cas réel du tableau de bord : lixiviation mesurée, ni Knelson ni flottation.
  // Seule « CIL direct » est chiffrable, quoi que le flowsheet décrive.
  const leachOnly = estimateRoutes({
    ...FREE_MILLING,
    metrics: { ...FREE_MILLING.metrics, grgPct: null, flotationAuRecPct: null },
  });

  it('gravité + CIL sans essai Knelson → CIL direct, marqué comme repli', () => {
    const r = chosenRoute(leachOnly, equip('gravity', 'cil'))!;
    expect(r.estimate.route).toMatch(/^CIL direct/);
    expect(r.downgraded).toBe(true);
    expect(r.requested).toBe('Gravité + cyanuration');
  });

  it('flottation + CIL sans essai de flottation → CIL direct, marqué comme repli', () => {
    const r = chosenRoute(leachOnly, equip('flotation', 'cil'))!;
    expect(r.estimate.route).toMatch(/^CIL direct/);
    expect(r.downgraded).toBe(true);
    expect(r.requested).toBe('Flottation + rebroyage + cyanuration');
  });

  it('le repli annonce la route la PLUS spécifique que le flowsheet décrit', () => {
    // Gravité + flottation + CIL : c'est la route à trois étages qui a été
    // décrite, pas « gravité + cyanuration » qui n'est qu'un repli intermédiaire.
    const r = chosenRoute(leachOnly, equip('gravity', 'flotation', 'cil'))!;
    expect(r.requested).toBe('Gravité + flottation + cyanuration');
    expect(r.downgraded).toBe(true);
  });

  it('une route chiffrable telle quelle n\'est jamais marquée comme repli', () => {
    const r = chosenRoute(leachOnly, equip('cil'))!;
    expect(r.downgraded).toBe(false);
    expect(r.requested).toBe('Cyanuration directe du tout-venant');
  });
});

describe('replis — jamais de chiffre inventé', () => {
  const routes = estimateRoutes(FREE_MILLING);

  it('sans flowsheet enregistré, aucun choix utilisateur', () => {
    expect(chosenRoute(routes, null)).toBeNull();
    expect(chosenRoute(routes, undefined)).toBeNull();
  });

  it('un flowsheet sans étage de récupération ne désigne aucune route', () => {
    expect(chosenRoute(routes, equip())).toBeNull();
  });

  it('une route cochée mais non chiffrable, SANS repli possible, ne renvoie rien', () => {
    // L'utilisateur coche la flottation seule : aucun essai de flottation, et
    // aucun motif moins spécifique ne matche (pas de CIL coché). Rien à chiffrer.
    const sansFlot = estimateRoutes({
      ...FREE_MILLING,
      metrics: { ...FREE_MILLING.metrics, flotationAuRecPct: null },
    });
    const r = chosenRoute(sansFlot, equip('flotation'));
    expect(r).toBeNull();
  });

  it('sans aucune route candidate, renvoie null', () => {
    expect(chosenRoute([], equip('gravity', 'cil'))).toBeNull();
  });
});
