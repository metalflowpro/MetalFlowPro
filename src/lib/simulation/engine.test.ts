import { describe, it, expect } from 'vitest';
import { dissolvedGoldKgH, effectiveParams, solveFlowsheet, streamConvergenceError } from './engine';
import { getUnit } from './unitRegistry';
import type { FeedInput, ProcessNode, StreamEdge, StreamResult } from './types';

// ─── Propagation de la dureté du minerai ─────────────────────────────────────
describe('effectiveParams — le minerai donne la dureté par défaut', () => {
  const feed = {
    feed_rate: 250, gold_grade: 2, silver_grade: 10, p80: 150000,
    hardness_bwi: 19, ore_type: 'sulphide' as never, sulphide_content: 1.5,
    carbon_content: 0, moisture: 3,
  };

  it('injecte le BWi de l\'alimentation dans un broyeur qui n\'en déclare pas', () => {
    const p = effectiveParams({ unit_type: 'ball_mill', parameters: { p80_target: 75 } }, feed);
    expect(p.bwi).toBe(19);
  });

  it('respecte un BWi fixé explicitement sur le broyeur', () => {
    const p = effectiveParams({ unit_type: 'ball_mill', parameters: { bwi: 11 } }, feed);
    expect(p.bwi).toBe(11);
  });

  it('ne touche pas aux unités hors comminution', () => {
    const p = effectiveParams({ unit_type: 'cil_tank', parameters: { residence_h: 24 } }, feed);
    expect(p.bwi).toBeUndefined();
  });

  it('ignore une dureté d\'alimentation absurde', () => {
    const p = effectiveParams({ unit_type: 'sag_mill', parameters: {} }, { ...feed, hardness_bwi: 0 });
    expect(p.bwi).toBeUndefined();
  });
});

function result(over: Partial<StreamResult> = {}): StreamResult {
  return {
    edge_id: 'e', mass_flow: 100, volume_flow: 150, solids_content: 40,
    gold_grade: 2, gold_flow: 0.2, dissolved_gold: 0,
    cyanide_concentration: 0, pH: 10.5, temperature: 25,
    ...over,
  };
}

describe('unités et convergence globales', () => {
  it('convertit mg/L × m³/h en kg/h', () => {
    expect(dissolvedGoldKgH(1, 1000)).toBeCloseTo(1, 12);
  });

  it('refuse la convergence si masse ou eau changent malgré un or stable', () => {
    const previous = { e: result() };
    expect(streamConvergenceError(previous, { e: result() })).toBe(0);
    expect(streamConvergenceError(previous, { e: result({ mass_flow: 110 }) })).toBeGreaterThan(0.09);
    expect(streamConvergenceError(previous, { e: result({ volume_flow: 165 }) })).toBeGreaterThan(0.09);
  });

  it('conserve les unités spécifiques énergie/OPEX sans division par le débit', () => {
    const feed: FeedInput = {
      feed_rate: 100, gold_grade: 2, silver_grade: 0, p80: 300,
      hardness_bwi: 14, ore_type: 'free_milling', sulphide_content: 0,
      carbon_content: 0, moisture: 0,
    };
    const nodes: ProcessNode[] = [
      { id: 'src', flowsheet_id: 'f', project_id: 'p', unit_type: 'feed_source', label: 'Feed', position_x: 0, position_y: 0, parameters: { feed_rate: 100, gold_grade: 2, moisture: 0 } },
      { id: 'mill', flowsheet_id: 'f', project_id: 'p', unit_type: 'ball_mill', label: 'Mill', position_x: 1, position_y: 0, parameters: { bwi: 14, p80_target: 75 }, design_capacity: 200 },
      { id: 'sink', flowsheet_id: 'f', project_id: 'p', unit_type: 'product_sink', label: 'Sink', position_x: 2, position_y: 0, parameters: {} },
    ];
    const edges: StreamEdge[] = [
      { id: 'e1', flowsheet_id: 'f', project_id: 'p', source_node_id: 'src', target_node_id: 'mill', stream_type: 'solid' },
      { id: 'e2', flowsheet_id: 'f', project_id: 'p', source_node_id: 'mill', target_node_id: 'sink', stream_type: 'solid' },
    ];
    const expectedEnergy = getUnit('ball_mill')!.calculate([result({ mass_flow: 100 })], { bwi: 14, p80_target: 75 }, 200).nodeResult.energy_consumption!;
    const solved = solveFlowsheet(nodes, edges, feed);
    expect(solved.globalResults.total_energy_kwh_t).toBeCloseTo(expectedEnergy, 9);
    expect(solved.globalResults.total_opex_per_t).toBeCloseTo(expectedEnergy * 0.12, 9);
  });
});
