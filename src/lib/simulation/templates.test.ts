import { describe, it, expect } from 'vitest';
import { CIRCUIT_TEMPLATES, buildTemplate, type CircuitTemplate } from './templates';
import { getUnit } from './unitRegistry';

function ctx() {
  let n = 0;
  return { flowsheetId: 'fs1', projectId: 'p1', makeId: () => `id-${n++}` };
}

describe('CIRCUIT_TEMPLATES', () => {
  it('reference only unit types that exist in the registry', () => {
    for (const t of CIRCUIT_TEMPLATES)
      for (const u of t.units)
        expect(getUnit(u), `${t.id} → ${u}`).toBeTruthy();
  });

  it('have unique ids', () => {
    const ids = CIRCUIT_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildTemplate', () => {
  const template = CIRCUIT_TEMPLATES[0];

  it('creates one node per unit and chains them in series', () => {
    const { nodes, edges } = buildTemplate(template, ctx());
    expect(nodes).toHaveLength(template.units.length);
    expect(edges).toHaveLength(template.units.length - 1);
    // Each edge links consecutive nodes.
    edges.forEach((e, i) => {
      expect(e.source_node_id).toBe(nodes[i].id);
      expect(e.target_node_id).toBe(nodes[i + 1].id);
      expect(e.stream_type).toBe('pulp');
    });
  });

  it('carries flowsheet/project ids and default parameters', () => {
    const { nodes } = buildTemplate(template, ctx());
    expect(nodes[0].flowsheet_id).toBe('fs1');
    expect(nodes[0].project_id).toBe('p1');
    // ball_mill has default parameters in the registry → copied onto the node.
    const ball = nodes.find(n => n.unit_type === 'ball_mill')!;
    expect(Object.keys(ball.parameters).length).toBeGreaterThan(0);
    expect(nodes[0].label).toBe(getUnit(nodes[0].unit_type)!.displayName);
  });

  it('agence de gauche à droite selon le procédé (plusieurs colonnes)', () => {
    const { nodes } = buildTemplate(template, ctx());
    // L'alimentation est à gauche ; le doré/résidus plus à droite.
    const feed = nodes.find(n => n.unit_type === 'feed_source');
    const product = nodes.find(n => n.unit_type === 'product_sink');
    if (feed && product) expect(product.position_x).toBeGreaterThan(feed.position_x);
    // Jamais une seule colonne : au moins deux colonnes distinctes.
    expect(new Set(nodes.map(n => n.position_x)).size).toBeGreaterThan(1);
  });

  it('generates unique node and edge ids', () => {
    const { nodes, edges } = buildTemplate(template, ctx());
    const ids = [...nodes.map(n => n.id), ...edges.map(e => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips unknown unit types but keeps the chain consistent', () => {
    const bad: CircuitTemplate = { id: 'x', name: 'x', description: 'x', units: ['feed_source', 'not_a_real_unit', 'product_sink'] };
    const { nodes, edges } = buildTemplate(bad, ctx());
    expect(nodes.map(n => n.unit_type)).toEqual(['feed_source', 'product_sink']);
    expect(edges).toHaveLength(1);
    expect(edges[0].source_node_id).toBe(nodes[0].id);
    expect(edges[0].target_node_id).toBe(nodes[1].id);
  });
});
