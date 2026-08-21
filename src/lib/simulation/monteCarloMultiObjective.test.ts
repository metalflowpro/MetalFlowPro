import { describe, it, expect } from 'vitest';
import { runMultiObjectiveMC, type MCScenario, type MCObjective } from './monteCarloMultiObjective';

// Distributions ponctuelles (std 0) → sorties déterministes, test reproductible.
function point(name: string, value: number) {
  return { name, dist: { kind: 'normal' as const, mean: value, std: 0 } };
}

const OBJECTIVES: MCObjective[] = [
  { key: 'recovery', label: 'Récupération', unit: '%', direction: 'maximize', model: d => d.rec },
  { key: 'opex', label: 'OPEX', unit: '$/t', direction: 'minimize', model: d => d.opex },
];

describe('runMultiObjectiveMC', () => {
  it('propage l’incertitude par objectif et calcule médiane + robuste', () => {
    const scenarios: MCScenario[] = [
      { id: 'A', label: 'A', inputs: [point('rec', 96), point('opex', 12)] },
    ];
    const res = runMultiObjectiveMC(scenarios, OBJECTIVES, 300);
    const s = res.scenarios[0];
    expect(s.medians.recovery).toBeCloseTo(96, 6);
    expect(s.medians.opex).toBeCloseTo(12, 6);
    // Distributions ponctuelles → P10/P90 = valeur.
    expect(s.robust.recovery).toBeCloseTo(96, 6);
    expect(s.robust.opex).toBeCloseTo(12, 6);
  });

  it('construit un front de Pareto médian écartant les scénarios dominés', () => {
    const scenarios: MCScenario[] = [
      { id: 'A', label: 'A', inputs: [point('rec', 96), point('opex', 10)] }, // meilleur sur les deux
      { id: 'B', label: 'B', inputs: [point('rec', 90), point('opex', 14)] }, // dominé par A
      { id: 'C', label: 'C', inputs: [point('rec', 94), point('opex', 8)] },  // compromis (moins de récup, moins d'OPEX)
    ];
    const res = runMultiObjectiveMC(scenarios, OBJECTIVES, 200);
    const frontIds = res.paretoMedian.front.map(p => p.id);
    expect(frontIds).toContain('A');
    expect(frontIds).toContain('C');
    expect(frontIds).not.toContain('B'); // B est dominé
    expect(res.paretoMedian.dominatedCount).toBeGreaterThanOrEqual(1);
  });

  it('le front robuste privilégie les scénarios à faible variance quand la moyenne est proche', () => {
    const scenarios: MCScenario[] = [
      // Même moyenne de récup (~92) mais A est très incertain, B est sûr.
      { id: 'incertain', label: 'incertain', inputs: [{ name: 'rec', dist: { kind: 'normal', mean: 92, std: 8, min: 0, max: 100 } }, point('opex', 10)] },
      { id: 'sur', label: 'sûr', inputs: [{ name: 'rec', dist: { kind: 'normal', mean: 92, std: 0.5, min: 0, max: 100 } }, point('opex', 10)] },
    ];
    const res = runMultiObjectiveMC(scenarios, OBJECTIVES, 4000);
    const rob = res.scenarios.reduce<Record<string, number>>((m, s) => { m[s.id] = s.robust.recovery; return m; }, {});
    // En récupération (maximize), la valeur robuste = P10 : le scénario sûr a un
    // P10 plus élevé que l'incertain, malgré la même moyenne.
    expect(rob['sur']).toBeGreaterThan(rob['incertain']);
  });
});
