import { describe, it, expect } from 'vitest';
import {
  dominates, nonDominatedSort, crowdingDistance, buildParetoFront,
  co2FromEnergy, STANDARD_OBJECTIVES,
  type Candidate, type ObjectiveSpec,
} from './pareto';
import { runParetoScan } from './optimizer';

const OBJ: ObjectiveSpec[] = [
  { key: 'recovery', label: 'Récupération', unit: '%', direction: 'maximize' },
  { key: 'energy',   label: 'Énergie',      unit: 'kWh/t', direction: 'minimize' },
];

const c = (id: string, recovery: number, energy: number): Candidate =>
  ({ id, label: id, objectives: { recovery, energy } });

describe('dominates', () => {
  it('domine quand on est meilleur partout', () => {
    expect(dominates(c('A', 92, 12), c('B', 90, 14), OBJ)).toBe(true);
    expect(dominates(c('B', 90, 14), c('A', 92, 12), OBJ)).toBe(false);
  });

  it('ne domine pas en cas d\'arbitrage (meilleur ici, moins bon là)', () => {
    // A récupère mieux mais consomme plus : aucun ne domine l'autre.
    expect(dominates(c('A', 93, 16), c('B', 90, 12), OBJ)).toBe(false);
    expect(dominates(c('B', 90, 12), c('A', 93, 16), OBJ)).toBe(false);
  });

  it('domine quand on est égal partout sauf mieux sur un critère', () => {
    expect(dominates(c('A', 92, 12), c('B', 92, 14), OBJ)).toBe(true);
  });

  it('ne domine pas un point identique', () => {
    expect(dominates(c('A', 92, 12), c('B', 92, 12), OBJ)).toBe(false);
  });

  it('respecte le sens de chaque objectif', () => {
    // énergie est à MINIMISER : moins consommer est meilleur
    expect(dominates(c('A', 90, 10), c('B', 90, 20), OBJ)).toBe(true);
    expect(dominates(c('B', 90, 20), c('A', 90, 10), OBJ)).toBe(false);
  });
});

describe('nonDominatedSort', () => {
  it('place les non dominés au rang 0', () => {
    const set = [c('best', 93, 12), c('worse', 88, 18), c('tradeoff', 95, 20)];
    const ranks = nonDominatedSort(set, OBJ);
    expect(ranks[0]).toBe(0);   // best : bon partout
    expect(ranks[2]).toBe(0);   // tradeoff : meilleure récup, non dominé
    expect(ranks[1]).toBeGreaterThan(0); // worse : dominé par best
  });

  it('stratifie en fronts successifs', () => {
    const set = [c('f0', 95, 10), c('f1', 90, 15), c('f2', 85, 20)];
    const ranks = nonDominatedSort(set, OBJ);
    expect(ranks[0]).toBe(0);
    expect(ranks[1]).toBe(1);
    expect(ranks[2]).toBe(2);
  });

  it('met tous les points au rang 0 quand aucun n\'en domine un autre', () => {
    const set = [c('a', 90, 10), c('b', 92, 14), c('c', 94, 18)];
    expect(nonDominatedSort(set, OBJ)).toEqual([0, 0, 0]);
  });
});

describe('crowdingDistance', () => {
  it('donne une distance infinie aux extrémités du front', () => {
    const front = [c('lo', 88, 10), c('mid', 91, 14), c('hi', 94, 19)];
    const d = crowdingDistance(front, OBJ);
    expect(d[0]).toBe(Infinity);
    expect(d[2]).toBe(Infinity);
    expect(d[1]).toBeLessThan(Infinity);
  });

  it('traite un front minuscule sans planter', () => {
    expect(crowdingDistance([c('a', 90, 10)], OBJ)).toEqual([Infinity]);
    expect(crowdingDistance([c('a', 90, 10), c('b', 92, 12)], OBJ)).toEqual([Infinity, Infinity]);
  });

  it('donne plus d\'espace au point le plus isolé', () => {
    // 'far' est très éloigné de ses voisins, 'tight' est resserré
    const front = [c('lo', 80, 5), c('tight', 81, 6), c('far', 95, 30), c('hi', 96, 40)];
    const d = crowdingDistance(front, OBJ);
    const idxTight = 1, idxFar = 2;
    expect(d[idxFar]).toBeGreaterThan(d[idxTight]);
  });
});

describe('buildParetoFront', () => {
  const scenarios: Candidate[] = [
    { id: 'grossier', label: 'Broyage grossier',  objectives: { recovery: 88, energy: 9,  co2: 0.32, opex: 11 } },
    { id: 'standard', label: 'Circuit standard',  objectives: { recovery: 92, energy: 14, co2: 0.49, opex: 13 } },
    { id: 'fin',      label: 'Broyage fin',       objectives: { recovery: 94, energy: 22, co2: 0.77, opex: 17 } },
    { id: 'mauvais',  label: 'Réglage inadapté',  objectives: { recovery: 86, energy: 20, co2: 0.70, opex: 19 } },
  ];

  it('écarte les scénarios dominés du front', () => {
    const r = buildParetoFront(scenarios);
    const ids = r.front.map(p => p.id);
    expect(ids).not.toContain('mauvais'); // dominé sur tous les critères
    expect(r.dominatedCount).toBeGreaterThan(0);
  });

  it('garde les vrais compromis sur le front', () => {
    const r = buildParetoFront(scenarios);
    const ids = r.front.map(p => p.id);
    expect(ids).toContain('grossier'); // le plus économe
    expect(ids).toContain('fin');      // le plus récupérant
  });

  it('désigne un point de compromis appartenant au front', () => {
    const r = buildParetoFront(scenarios);
    expect(r.knee).not.toBeNull();
    expect(r.front.some(p => p.id === r.knee!.id)).toBe(true);
  });

  it('identifie le meilleur point de chaque objectif isolé', () => {
    const r = buildParetoFront(scenarios);
    expect(r.extremes.recovery?.id).toBe('fin');       // meilleure récupération
    expect(r.extremes.energy?.id).toBe('grossier');    // énergie minimale
    expect(r.extremes.opex?.id).toBe('grossier');      // OPEX minimal
  });

  it('normalise pour qu\'un objectif en dollars n\'écrase pas un pourcentage', () => {
    // Même structure, mais OPEX exprimé en milliers : le compromis doit être
    // le même, la normalisation neutralisant l'échelle.
    const scaled = scenarios.map(s => ({ ...s, objectives: { ...s.objectives, opex: s.objectives.opex * 1000 } }));
    const a = buildParetoFront(scenarios);
    const b = buildParetoFront(scaled);
    expect(b.knee?.id).toBe(a.knee?.id);
  });

  it('ignore les objectifs absents des candidats', () => {
    const partial: Candidate[] = [
      { id: 'a', objectives: { recovery: 90, energy: 12 } },
      { id: 'b', objectives: { recovery: 92, energy: 16 } },
    ];
    const r = buildParetoFront(partial, STANDARD_OBJECTIVES);
    expect(r.objectives.map(o => o.key)).toEqual(['recovery', 'energy']);
    expect(r.front.length).toBe(2); // arbitrage → les deux sur le front
  });

  it('gère la liste vide sans planter', () => {
    const r = buildParetoFront([]);
    expect(r.front).toHaveLength(0);
    expect(r.knee).toBeNull();
    expect(r.summary).toContain('Aucun scénario');
  });

  it('résume le résultat de façon exploitable', () => {
    const r = buildParetoFront(scenarios);
    expect(r.summary).toContain('compromis');
    expect(r.summary).toContain('dominé');
  });

  it('ne produit jamais de distance non finie à l\'idéal', () => {
    const r = buildParetoFront(scenarios);
    for (const p of r.points) expect(Number.isFinite(p.distanceToIdeal)).toBe(true);
  });
});

describe('co2FromEnergy', () => {
  it('dérive l\'empreinte de la consommation via le facteur réseau', () => {
    expect(co2FromEnergy(20, 0.05)).toBeCloseTo(1.0, 6);
  });
  it('reste positif sur une entrée aberrante', () => {
    expect(co2FromEnergy(-5)).toBe(0);
  });
  it('rend un réseau plus carboné plus pénalisant', () => {
    expect(co2FromEnergy(20, 0.5)).toBeGreaterThan(co2FromEnergy(20, 0.035));
  });
});

// ─── Intégration : balayage sur un flowsheet réel ────────────────────────────
describe('runParetoScan — balayage sur circuit simulé', () => {
  const feed = {
    feed_rate: 250, gold_grade: 2, silver_grade: 10, p80: 150000,
    hardness_bwi: 15, ore_type: 'sulphide' as never, sulphide_content: 1.5,
    carbon_content: 0, moisture: 3,
  };
  const nodes = [
    { id: 'src', unit_type: 'feed_source', parameters: { feed_rate: 250, gold_grade: 2, moisture: 3 }, design_capacity: 300 },
    { id: 'mill', unit_type: 'ball_mill', parameters: { p80_target: 75, bwi: 15 }, design_capacity: 300 },
  ] as never[];
  const edges = [
    { id: 'e1', source_node_id: 'src', target_node_id: 'mill' },
  ] as never[];

  it('produit un front reproductible à partir d\'une variable balayée', () => {
    const vars = [{ node_id: 'mill', parameter: 'p80_target', min: 45, max: 150, current: 75 }] as never[];
    const a = runParetoScan(nodes, edges, feed, vars, [], { steps: 4 });
    const b = runParetoScan(nodes, edges, feed, vars, [], { steps: 4 });
    expect(a.points.length).toBeGreaterThan(0);
    // déterministe : deux exécutions donnent le même front
    expect(b.front.map(p => p.id)).toEqual(a.front.map(p => p.id));
  });

  it('évalue les quatre objectifs sur chaque scénario', () => {
    const vars = [{ node_id: 'mill', parameter: 'p80_target', min: 45, max: 150, current: 75 }] as never[];
    const r = runParetoScan(nodes, edges, feed, vars, [], { steps: 3 });
    for (const p of r.points) {
      for (const k of ['recovery', 'energy', 'co2', 'opex']) {
        expect(Number.isFinite(p.objectives[k]), `${k} non fini`).toBe(true);
      }
    }
  });

  it('rend un front vide sans variable à explorer', () => {
    expect(runParetoScan(nodes, edges, feed, [] as never[], []).front).toHaveLength(0);
  });

  // Le plafond de scénarios ne doit jamais amputer la PLAGE d'une variable :
  // sinon le front exclut en silence des réglages réalisables, et le résultat
  // dépend de l'ordre dans lequel les variables sont déclarées.
  const fourVars = [
    { node_id: 'mill', parameter: 'p80_target', min: 45, max: 150, current: 75 },
    { node_id: 'mill', parameter: 'bwi', min: 10, max: 20, current: 15 },
    { node_id: 'src', parameter: 'feed_rate', min: 200, max: 300, current: 250 },
    { node_id: 'src', parameter: 'moisture', min: 1, max: 5, current: 3 },
  ] as never[];

  it('explore chaque variable jusqu\'à sa borne haute malgré le plafond', () => {
    const r = runParetoScan(nodes, edges, feed, fourVars, [], { steps: 5, maxScenarios: 400 });
    // Chaque variable doit atteindre son max quelque part dans le balayage.
    for (const v of fourVars as unknown as { node_id: string; parameter: string; max: number }[]) {
      const key = `${v.node_id}.${v.parameter}`;
      const reached = r.points.some(p => Math.abs(Number(p.settings?.[key] ?? NaN) - v.max) < 0.01);
      expect(reached, `${key} : borne haute jamais explorée`).toBe(true);
    }
  });

  it('réduit le pas de grille plutôt que de tronquer, et le déclare', () => {
    const r = runParetoScan(nodes, edges, feed, fourVars, [], { steps: 5, maxScenarios: 400 });
    expect(r.scan?.requestedSteps).toBe(5);
    expect(r.scan?.steps).toBe(4);              // 4⁴ = 256 ≤ 400, alors que 5⁴ = 625
    expect(r.scan?.truncated).toBe(false);
    expect(r.scan?.evaluated).toBe(256);
  });

  it('ne réduit pas la grille quand elle tient dans le plafond', () => {
    const vars = [{ node_id: 'mill', parameter: 'p80_target', min: 45, max: 150, current: 75 }] as never[];
    const r = runParetoScan(nodes, edges, feed, vars, [], { steps: 5, maxScenarios: 400 });
    expect(r.scan?.steps).toBe(5);
    expect(r.scan?.truncated).toBe(false);
  });

  it('signale la troncature quand même la grille minimale déborde', () => {
    const r = runParetoScan(nodes, edges, feed, fourVars, [], { steps: 5, maxScenarios: 8 });
    expect(r.scan?.steps).toBe(2);              // 2⁴ = 16 > 8 : irréductible
    expect(r.scan?.truncated).toBe(true);
  });

  // Un plafond atteint en cours d'énumération ne doit pas livrer de combinaison
  // partielle : chaque scénario doit porter un réglage pour CHAQUE variable.
  it('ne produit jamais de scénario à variables manquantes sous un plafond serré', () => {
    const r = runParetoScan(nodes, edges, feed, fourVars, [], { steps: 5, maxScenarios: 8 });
    expect(r.points.length).toBeGreaterThan(0);
    for (const p of r.points) {
      for (const v of fourVars as unknown as { node_id: string; parameter: string }[]) {
        const key = `${v.node_id}.${v.parameter}`;
        expect(Number.isFinite(p.settings?.[key]), `${key} absent du scénario ${p.id}`).toBe(true);
      }
    }
  });
});
