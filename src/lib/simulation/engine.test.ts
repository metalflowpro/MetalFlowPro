import { describe, it, expect } from 'vitest';
import { dissolvedGoldKgH, effectiveParams, solveFlowsheet, streamConvergenceError } from './engine';
import { getUnit, emptyStream } from './unitRegistry';
import { DEFAULT_ASSUMPTIONS, FEED_STREAM_DEFAULTS } from '../config/constants';
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

describe('conditions ambiantes du flux d\'alimentation', () => {
  it('donne les MÊMES pH et température quel que soit le constructeur de flux', () => {
    // Régression : `emptyStream()` posait 25 °C tandis que le nœud d'alimentation
    // et `feedToStream` posaient 20 °C — trois écritures d'une même grandeur
    // physique. Elles lisent maintenant FEED_STREAM_DEFAULTS.
    const empty = emptyStream();
    const feedNode = getUnit('feed_source')!.calculate([], { feed_rate: 100, gold_grade: 2, moisture: 0 }).outStreams[0];

    expect(empty.temperature).toBe(FEED_STREAM_DEFAULTS.temperatureC);
    expect(empty.pH).toBe(FEED_STREAM_DEFAULTS.pH);
    expect(feedNode.temperature).toBe(empty.temperature);
    expect(feedNode.pH).toBe(empty.pH);
  });
});

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
    // OPEX screening = électricité + médias de broyage (le broyeur est une unité
    // de comminution, donc son énergie pilote la consommation de médias acier).
    const mediaKgT = expectedEnergy * DEFAULT_ASSUMPTIONS.GRINDING_MEDIA_G_PER_KWH / 1000;
    const expectedOpex =
      expectedEnergy * DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH
      + mediaKgT * DEFAULT_ASSUMPTIONS.GRINDING_MEDIA_COST_USD_KG;
    expect(solved.globalResults.total_opex_per_t).toBeCloseTo(expectedOpex, 9);
  });

  it('ne double-compte pas la concentration dissoute et le métal contenu', () => {
    const feed: FeedInput = {
      feed_rate: 100, gold_grade: 2, silver_grade: 0, p80: 75,
      hardness_bwi: 14, ore_type: 'free_milling', sulphide_content: 0,
      carbon_content: 0, moisture: 0,
    };
    const nodes: ProcessNode[] = [
      { id: 'src', flowsheet_id: 'f', project_id: 'p', unit_type: 'feed_source', label: 'Feed', position_x: 0, position_y: 0, parameters: {} },
      { id: 'cil', flowsheet_id: 'f', project_id: 'p', unit_type: 'cil_reactor', label: 'CIL', position_x: 1, position_y: 0, parameters: { retention_h: 24, nacn_kg_t: 0.5, do_mg_l: 8, carbon_g_l: 15 } },
      { id: 'product', flowsheet_id: 'f', project_id: 'p', unit_type: 'product_sink', label: 'Produit', position_x: 2, position_y: 0, parameters: {} },
      { id: 'tails', flowsheet_id: 'f', project_id: 'p', unit_type: 'product_sink', label: 'Rejets', position_x: 2, position_y: 1, parameters: {} },
    ];
    const edges: StreamEdge[] = [
      { id: 'e1', flowsheet_id: 'f', project_id: 'p', source_node_id: 'src', target_node_id: 'cil', stream_type: 'pulp' },
      { id: 'e2', flowsheet_id: 'f', project_id: 'p', source_node_id: 'cil', target_node_id: 'product', stream_type: 'solution' },
      { id: 'e3', flowsheet_id: 'f', project_id: 'p', source_node_id: 'cil', target_node_id: 'tails', stream_type: 'solid' },
    ];
    const solved = solveFlowsheet(nodes, edges, feed);
    expect(solved.globalResults.overall_recovery).toBeLessThanOrEqual(100);
    expect(solved.globalResults.overall_recovery).toBeCloseTo(solved.nodeResults.cil.recovery, 8);
    expect(solved.globalResults.tails_grade).toBeCloseTo(2 * (1 - solved.nodeResults.cil.recovery / 100), 8);
  });

  it('ferme le bilan masse et métal sur un circuit série simple', () => {
    // feed → cil → sink : toute la masse et tout l'or (récupéré + résidus)
    // atteignent des puits → fermeture quasi parfaite.
    const feed: FeedInput = {
      feed_rate: 100, gold_grade: 2, silver_grade: 0, p80: 150,
      hardness_bwi: 14, ore_type: 'free_milling', sulphide_content: 0,
      carbon_content: 0, moisture: 0,
    };
    const nodes: ProcessNode[] = [
      { id: 'src', flowsheet_id: 'f', project_id: 'p', unit_type: 'feed_source', label: 'Feed', position_x: 0, position_y: 0, parameters: { feed_rate: 100, gold_grade: 2, moisture: 0 } },
      { id: 'cil', flowsheet_id: 'f', project_id: 'p', unit_type: 'cil_reactor', label: 'CIL', position_x: 1, position_y: 0, parameters: {} },
      { id: 'carbon', flowsheet_id: 'f', project_id: 'p', unit_type: 'product_sink', label: 'Or', position_x: 2, position_y: 0, parameters: {} },
      { id: 'tails', flowsheet_id: 'f', project_id: 'p', unit_type: 'tailings_pond', label: 'Résidus', position_x: 2, position_y: 1, parameters: {} },
    ];
    const edges: StreamEdge[] = [
      { id: 'e1', flowsheet_id: 'f', project_id: 'p', source_node_id: 'src', target_node_id: 'cil', stream_type: 'pulp' },
      { id: 'e2', flowsheet_id: 'f', project_id: 'p', source_node_id: 'cil', target_node_id: 'carbon', stream_type: 'pulp' },
      { id: 'e3', flowsheet_id: 'f', project_id: 'p', source_node_id: 'cil', target_node_id: 'tails', stream_type: 'solid' },
    ];
    const g = solveFlowsheet(nodes, edges, feed).globalResults;
    expect(g.mass_balance_error).toBeLessThan(0.02);
    expect(g.metal_balance_error).toBeLessThan(1e-6);
  });

  it('converge une boucle de recyclage broyeur↔cyclone (relaxation §9)', () => {
    // feed → mill → cyclone ; sousverse cyclone → RETOUR au broyeur (recyclage),
    // surverse → puits. Charge circulante non nulle ; au régime, toute la masse
    // et tout l'or sortent par la surverse → bilan fermé.
    const feed: FeedInput = {
      feed_rate: 100, gold_grade: 2, silver_grade: 0, p80: 2000,
      hardness_bwi: 14, ore_type: 'free_milling', sulphide_content: 0,
      carbon_content: 0, moisture: 0,
    };
    const nodes: ProcessNode[] = [
      { id: 'src', flowsheet_id: 'f', project_id: 'p', unit_type: 'feed_source', label: 'Feed', position_x: 0, position_y: 0, parameters: { feed_rate: 100, gold_grade: 2, moisture: 0 } },
      { id: 'mill', flowsheet_id: 'f', project_id: 'p', unit_type: 'ball_mill', label: 'Mill', position_x: 1, position_y: 0, parameters: {} },
      { id: 'cyc', flowsheet_id: 'f', project_id: 'p', unit_type: 'hydrocyclone', label: 'Cyclone', position_x: 2, position_y: 0, parameters: {} },
      { id: 'sink', flowsheet_id: 'f', project_id: 'p', unit_type: 'product_sink', label: 'O/F', position_x: 3, position_y: 0, parameters: {} },
    ];
    const edges: StreamEdge[] = [
      { id: 'e1', flowsheet_id: 'f', project_id: 'p', source_node_id: 'src', target_node_id: 'mill', stream_type: 'pulp' },
      { id: 'e2', flowsheet_id: 'f', project_id: 'p', source_node_id: 'mill', target_node_id: 'cyc', stream_type: 'pulp' },
      // Surverse (sortie 0) → puits ; sousverse (sortie 1) → recyclage au broyeur.
      { id: 'e3', flowsheet_id: 'f', project_id: 'p', source_node_id: 'cyc', target_node_id: 'sink', stream_type: 'pulp' },
      { id: 'e4', flowsheet_id: 'f', project_id: 'p', source_node_id: 'cyc', target_node_id: 'mill', stream_type: 'pulp' },
    ];
    const solved = solveFlowsheet(nodes, edges, feed, { maxIterations: 200, tolerance: 1e-5, mode: 'steady_state' });
    expect(solved.status).toBe('converged');
    // Charge circulante : la sousverse recyclée porte de la masse.
    expect(solved.streams.e4.mass_flow).toBeGreaterThan(0);
    // Au régime permanent, la surverse évacue toute la masse/l'or frais.
    expect(solved.streams.e3.mass_flow).toBeCloseTo(100, 0);
    expect(solved.globalResults.metal_balance_error).toBeLessThan(0.02);
  });

});
