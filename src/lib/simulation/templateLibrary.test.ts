import { describe, it, expect } from 'vitest';
import {
  FLOWSHEET_TEMPLATES, instantiateTemplate, matchTemplateForRoute, getTemplate,
} from './templateLibrary';
import { getUnit } from './unitRegistry';
import { solveFlowsheet } from './engine';
import type { FeedInput } from './types';

function ctx() {
  let n = 0;
  return { flowsheetId: 'fs1', projectId: 'p1', makeId: () => `id-${n++}` };
}

const FEED: FeedInput = {
  feed_rate: 500, gold_grade: 2, silver_grade: 10, p80: 106, hardness_bwi: 15,
  ore_type: 'sulphide', sulphide_content: 5, carbon_content: 0.05, moisture: 6,
};

describe('FLOWSHEET_TEMPLATES — intégrité', () => {
  it('fournit au moins les 12 templates du cahier des charges', () => {
    expect(FLOWSHEET_TEMPLATES.length).toBeGreaterThanOrEqual(12);
  });

  it('ont des identifiants uniques', () => {
    const ids = FLOWSHEET_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ne référencent QUE des unités présentes dans le registre', () => {
    for (const t of FLOWSHEET_TEMPLATES)
      for (const n of t.nodes)
        expect(getUnit(n.unitType), `${t.id} → ${n.unitType}`).toBeTruthy();
  });

  it('ont des arêtes dont les extrémités existent parmi les nœuds', () => {
    for (const t of FLOWSHEET_TEMPLATES) {
      const keys = new Set(t.nodes.map(n => n.key));
      for (const e of t.edges) {
        expect(keys.has(e.from), `${t.id}: ${e.from}`).toBe(true);
        expect(keys.has(e.to), `${t.id}: ${e.to}`).toBe(true);
      }
    }
  });

  it('portent les métadonnées de gouvernance (applicabilité, données, maturité)', () => {
    for (const t of FLOWSHEET_TEMPLATES) {
      expect(t.applicability.length).toBeGreaterThan(0);
      expect(t.dataNeeds.length).toBeGreaterThan(0);
      expect(t.mainChain.length).toBeGreaterThan(0);
      expect(t.routeKeywords.length).toBeGreaterThan(0);
    }
  });
});

describe('instantiateTemplate', () => {
  it('pose des coordonnées en cascade groupée par circuit', () => {
    for (const t of FLOWSHEET_TEMPLATES) {
      const { nodes, edges } = instantiateTemplate(t, ctx());
      expect(nodes).toHaveLength(t.nodes.length);
      expect(edges).toHaveLength(t.edges.length);
      // Lecture gauche → droite : l'alimentation est à gauche, le doré et les
      // résidus (en aval) plus à droite.
      const feed = nodes.find(n => n.unit_type === 'feed_source');
      const product = nodes.find(n => n.unit_type === 'product_sink');
      const tails = nodes.find(n => n.unit_type === 'tailings_pond');
      if (feed && product) expect(product.position_x).toBeGreaterThan(feed.position_x);
      if (feed && tails) expect(tails.position_x).toBeGreaterThan(feed.position_x);
      // Le flowsheet s'étale sur plusieurs colonnes de profondeur (pas empilé).
      const distinctCols = new Set(nodes.map(n => n.position_x)).size;
      expect(distinctCols).toBeGreaterThan(1);
    }
  });

  it('porte les paramètres par défaut et les ids projet/flowsheet', () => {
    const { nodes } = instantiateTemplate(FLOWSHEET_TEMPLATES[0], ctx());
    expect(nodes[0].project_id).toBe('p1');
    expect(nodes[0].flowsheet_id).toBe('fs1');
    expect(Object.keys(nodes[0].parameters).length).toBeGreaterThan(0);
  });
});

describe('solveur — bilan Au sur chaque template', () => {
  const feedGold = FEED.feed_rate * (1 - FEED.moisture / 100) * FEED.gold_grade / 1000; // kg/h

  for (const t of FLOWSHEET_TEMPLATES) {
    it(`« ${t.name} » : ferme le bilan et donne une récupération cohérente`, () => {
      const { nodes, edges } = instantiateTemplate(t, ctx());
      const res = solveFlowsheet(nodes, edges, FEED, { maxIterations: 60, tolerance: 1e-4, mode: 'steady_state' });

      // Récupération globale finie et bornée.
      expect(Number.isFinite(res.globalResults.overall_recovery)).toBe(true);
      expect(res.globalResults.overall_recovery).toBeGreaterThan(0);
      expect(res.globalResults.overall_recovery).toBeLessThanOrEqual(100);

      // Aucun flux aberrant (pas de NaN, pas de masse négative).
      for (const s of Object.values(res.streams)) {
        expect(Number.isFinite(s.mass_flow)).toBe(true);
        expect(Number.isFinite(s.gold_flow)).toBe(true);
        expect(s.mass_flow).toBeGreaterThanOrEqual(-1e-6);
      }

      // L'or n'est jamais CRÉÉ : la somme de l'or atteignant les puits ne dépasse
      // pas l'or d'alimentation (tolérance numérique).
      const sinkTypes = new Set(['product_sink', 'tailings_pond']);
      const hasOutgoing = new Set(edges.map(e => e.source_node_id));
      const sinkNodeIds = new Set(
        nodes.filter(n => sinkTypes.has(n.unit_type) || !hasOutgoing.has(n.id)).map(n => n.id),
      );
      let goldToSinks = 0;
      for (const e of edges) {
        if (sinkNodeIds.has(e.target_node_id)) goldToSinks += res.streams[e.id]?.gold_flow ?? 0;
      }
      expect(goldToSinks).toBeLessThanOrEqual(feedGold * 1.001);
    });
  }
});

describe('matchTemplateForRoute — mapping route → template (générateur)', () => {
  it('associe une route CIL directe au template CIL direct', () => {
    expect(matchTemplateForRoute('CIL direct')).toBe('direct-cil');
  });
  it('associe une route gravité+flottation+CIL au bon template', () => {
    const id = matchTemplateForRoute('Gravité (Knelson) + Flottation + CIL (concentré)');
    expect(id).toBeTruthy();
    expect(getTemplate(id!)).toBeTruthy();
  });
  it('associe une route réfractaire POX au template oxydation', () => {
    expect(matchTemplateForRoute('Flottation + POX + CIL')).toBe('flotation-oxidation-cil');
  });
  it('renvoie null pour une route sans correspondance', () => {
    expect(matchTemplateForRoute('procédé totalement inconnu xyz')).toBeNull();
  });
});
