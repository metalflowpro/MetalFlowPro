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

  it('gravité + flottation + CIL → la route à trois étages, pas gravité + CIL', () => {
    // Le motif le plus SPÉCIFIQUE gagne : un flowsheet avec flottation ne doit
    // pas se résoudre en « Gravité + CIL », qui lui est aussi « compatible ».
    const r = chosenRoute(routes, equip('gravity', 'flotation', 'cil'))!;
    expect(r.route).toMatch(/^Gravité \(Knelson\) \+ Flottation/);
  });

  it('gravité + CIL sans flottation → la route à deux étages', () => {
    const r = chosenRoute(routes, equip('gravity', 'cil'))!;
    expect(r.route).toBe('Gravité (Knelson) + CIL');
  });

  it('CIL seul → cyanuration directe du tout-venant', () => {
    const r = chosenRoute(routes, equip('cil'))!;
    expect(r.route).toMatch(/^CIL direct/);
  });

  it('flottation + CIL sans gravité → flottation + rebroyage', () => {
    const r = chosenRoute(routes, equip('flotation', 'cil'))!;
    expect(r.route).toMatch(/^Flottation \+ Rebroyage/);
  });

  it('l\'oxydation prime : flottation + POX + CIL → route réfractaire', () => {
    const r = chosenRoute(estimateRoutes(REFRACTORY), equip('gravity', 'flotation', 'pox', 'cil'))!;
    expect(r.route).toMatch(/POX|BIOX|Grillage|Albion/);
  });

  it('suit le circuit d\'adsorption retenu (CIP au lieu de CIL)', () => {
    const cip = estimateRoutes({ ...FREE_MILLING, adsorptionCircuit: 'CIP' });
    expect(chosenRoute(cip, equip('gravity', 'cil'))!.route).toBe('Gravité (Knelson) + CIP');
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

  it('une route cochée mais non chiffrable (essais manquants) ne renvoie rien', () => {
    // L'utilisateur coche la flottation, mais aucun essai de flottation
    // n'existe : la route n'est pas chiffrée, donc pas de choix exploitable.
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
