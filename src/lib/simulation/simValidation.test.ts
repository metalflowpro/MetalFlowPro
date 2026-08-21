import { describe, it, expect } from 'vitest';
import { validateFlowsheet } from './simValidation';
import { getTemplate, instantiateTemplate } from './templateLibrary';
import type { ProcessNode, StreamEdge } from './types';

let seq = 0;
function node(unit_type: string, id = `n${seq++}`, project_id = 'pj'): ProcessNode {
  return { id, flowsheet_id: 'fs', project_id, unit_type, label: unit_type, position_x: 0, position_y: 0, parameters: {} };
}
function edge(source: string, target: string, id = `e${seq++}`, project_id = 'pj'): StreamEdge {
  return { id, flowsheet_id: 'fs', project_id, source_node_id: source, target_node_id: target, stream_type: 'pulp' };
}

describe('simValidation — §8/§15', () => {
  it('erreur si aucune alimentation', () => {
    const n = [node('ball_mill', 'a'), node('product_sink', 'b')];
    const e = [edge('a', 'b')];
    const r = validateFlowsheet(n, e);
    expect(r.errors.some(x => x.code === 'NO_FEED_SOURCE')).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('AVERTIT sur sortie non câblée — la classe du bug Phase 0 (cyclone à 1 sortie)', () => {
    // hydrocyclone a maxOutputs=2 ([surverse, sousverse]) ; n'en brancher qu'une
    // largue l'autre (35 % de l'or). Avertissement (magnitude jugée au bilan).
    const n = [node('feed_source', 'f'), node('hydrocyclone', 'c'), node('product_sink', 's')];
    const e = [edge('f', 'c'), edge('c', 's')];
    const r = validateFlowsheet(n, e);
    const iss = r.warnings.find(x => x.code === 'UNWIRED_OUTPUT');
    expect(iss).toBeDefined();
    expect(iss!.nodeId).toBe('c');
  });

  it('ERREUR trop de sorties — duplication de flux (piège positionnel)', () => {
    // sag_mill a maxOutputs=1 : 2 arêtes sortantes dupliqueraient son flux.
    const n = [node('feed_source', 'f'), node('sag_mill', 'm'), node('product_sink', 's1'), node('product_sink', 's2')];
    const e = [edge('f', 'm'), edge('m', 's1'), edge('m', 's2')];
    const r = validateFlowsheet(n, e);
    expect(r.errors.some(x => x.code === 'TOO_MANY_OUTPUTS' && x.nodeId === 'm')).toBe(true);
  });

  it('erreurs sur arêtes pendantes et type d\'unité inconnu', () => {
    const n = [node('feed_source', 'f'), node('unobtanium_reactor', 'x')];
    const e = [edge('f', 'ghost'), edge('nope', 'x')];
    const r = validateFlowsheet(n, e);
    expect(r.errors.some(x => x.code === 'EDGE_TARGET_MISSING')).toBe(true);
    expect(r.errors.some(x => x.code === 'EDGE_SOURCE_MISSING')).toBe(true);
    expect(r.errors.some(x => x.code === 'UNKNOWN_UNIT_TYPE' && x.nodeId === 'x')).toBe(true);
  });

  it('§14 : isolation projet — nœud/arête d\'un autre projet', () => {
    const n = [node('feed_source', 'f', 'pj'), node('product_sink', 's', 'OTHER')];
    const e = [edge('f', 's', 'e0', 'OTHER')];
    const r = validateFlowsheet(n, e, { expectedProjectId: 'pj' });
    expect(r.errors.some(x => x.code === 'NODE_PROJECT_MISMATCH')).toBe(true);
    expect(r.errors.some(x => x.code === 'EDGE_PROJECT_MISMATCH')).toBe(true);
  });

  it('avertit si une unité de procédé n\'a aucune alimentation', () => {
    const n = [node('feed_source', 'f'), node('ball_mill', 'orphan'), node('product_sink', 's')];
    const e = [edge('f', 's')];
    const r = validateFlowsheet(n, e);
    // ball_mill 'orphan' a une sortie non câblée (erreur) ET aucune entrée (warning).
    expect(r.warnings.some(x => x.code === 'NO_INPUT' && x.nodeId === 'orphan')).toBe(true);
  });

  it('le template #6 CORRIGÉ passe la validation (aucune erreur)', () => {
    const tpl = getTemplate('gravity-flotation-cil')!;
    let k = 0;
    const { nodes, edges } = instantiateTemplate(tpl, { makeId: () => `id${k++}`, flowsheetId: 'fs', projectId: 'pj' });
    const r = validateFlowsheet(nodes, edges, { expectedProjectId: 'pj' });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
