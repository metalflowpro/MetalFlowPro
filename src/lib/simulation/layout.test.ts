import { describe, it, expect } from 'vitest';
import { layoutByCircuit, unitCircuit, CIRCUIT_ORDER, type LayoutNode, type LayoutEdge } from './layout';

describe('unitCircuit', () => {
  it('recatégorise alimentation, doré et résidus hors des catégories génériques', () => {
    expect(unitCircuit('feed_source')).toBe('Alimentation');
    expect(unitCircuit('product_sink')).toBe('Doré');
    expect(unitCircuit('tailings_pond')).toBe('Résidus');
  });
  it('utilise la catégorie du registre pour les unités de procédé', () => {
    expect(unitCircuit('ball_mill')).toBe('Comminution');
    expect(unitCircuit('flotation_rougher')).toBe('Flottation');
    expect(unitCircuit('cil_reactor')).toBe('Lixiviation');
    expect(unitCircuit('electrowinning')).toBe('Électrométallurgie');
  });
});

describe('layoutByCircuit', () => {
  const nodes: LayoutNode[] = [
    { id: 'feed', unit_type: 'feed_source' },
    { id: 'crush', unit_type: 'jaw_crusher' },
    { id: 'mill', unit_type: 'ball_mill' },
    { id: 'flot', unit_type: 'flotation_rougher' },
    { id: 'cil', unit_type: 'cil_reactor' },
    { id: 'ew', unit_type: 'electrowinning' },
    { id: 'product', unit_type: 'product_sink' },
    { id: 'tails', unit_type: 'tailings_pond' },
  ];
  const edges: LayoutEdge[] = [
    { source: 'feed', target: 'crush' }, { source: 'crush', target: 'mill' },
    { source: 'mill', target: 'flot' }, { source: 'flot', target: 'cil' },
    { source: 'cil', target: 'ew' }, { source: 'ew', target: 'product' },
    { source: 'flot', target: 'tails' },
  ];

  it('place chaque nœud et regroupe les circuits en bandes empilées', () => {
    const pos = layoutByCircuit(nodes, edges);
    expect(pos.size).toBe(nodes.length);
    // Cascade : l'alimentation (haut) au-dessus de la lixiviation, elle-même
    // au-dessus du doré.
    expect(pos.get('feed')!.y).toBeLessThan(pos.get('cil')!.y);
    expect(pos.get('cil')!.y).toBeLessThan(pos.get('product')!.y);
  });

  it('n’aligne jamais tout sur une seule ligne', () => {
    const rows = new Set([...layoutByCircuit(nodes, edges).values()].map(p => p.y));
    expect(rows.size).toBeGreaterThan(1);
  });

  it('respecte l’ordre des circuits (y croissant avec le rang procédé)', () => {
    const pos = layoutByCircuit(nodes, edges);
    const yFor = (id: string) => pos.get(id)!.y;
    // Comminution avant Flottation avant Lixiviation avant Électrométallurgie.
    expect(yFor('mill')).toBeLessThanOrEqual(yFor('flot'));
    expect(yFor('flot')).toBeLessThanOrEqual(yFor('cil'));
    expect(yFor('cil')).toBeLessThanOrEqual(yFor('ew'));
  });

  it('borne la largeur : jamais plus de maxPerRow unités sur une bande', () => {
    // 8 unités de comminution → doivent se répartir sur plusieurs bandes.
    const many: LayoutNode[] = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, unit_type: 'ball_mill' }));
    const pos = layoutByCircuit(many, [], { maxPerRow: 3, x0: 0, colW: 100 });
    const maxX = Math.max(...[...pos.values()].map(p => p.x));
    expect(maxX).toBeLessThanOrEqual(2 * 100); // 3 colonnes max → x ∈ {0,100,200}
    const rows = new Set([...pos.values()].map(p => p.y));
    expect(rows.size).toBe(3); // 8 unités / 3 par bande → 3 bandes
  });

  it('CIRCUIT_ORDER commence par l’alimentation et finit par les utilitaires', () => {
    expect(CIRCUIT_ORDER[0]).toBe('Alimentation');
    expect(CIRCUIT_ORDER[CIRCUIT_ORDER.length - 1]).toBe('Utilitaires');
  });
});
