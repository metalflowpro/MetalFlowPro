// ─────────────────────────────────────────────────────────────────────────────
// Modèles de circuit prêts à l'emploi — module PUR.
//
// Construire un flowsheet depuis une toile vide, unité par unité puis en reliant
// chaque port à la main, est la friction n°1 du module Simulation. Ces modèles
// instancient en un clic un circuit aurifère typique, unités pré-placées de
// gauche à droite et déjà connectées en série ; l'utilisateur n'a plus qu'à
// ajuster. Purement des données + un assembleur testable (aucun React/Supabase).
// ─────────────────────────────────────────────────────────────────────────────

import { getUnit } from './unitRegistry';
import { layoutByCircuit } from './layout';
import type { ProcessNode, StreamEdge } from './types';

export interface CircuitTemplate {
  id: string;
  name: string;
  description: string;
  /** Chaîne d'unités (unitType) reliées en série, de l'alimentation à la sortie. */
  units: string[];
}

export const CIRCUIT_TEMPLATES: CircuitTemplate[] = [
  {
    id: 'gravity-cil',
    name: 'Gravité + CIL',
    description: 'Concassage → broyage à boulets → concentration gravimétrique → CIL → charbon → électrolyse → fusion',
    units: ['feed_source', 'jaw_crusher', 'ball_mill', 'gravity_concentrator', 'cil_reactor', 'carbon_adsorption', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink'],
  },
  {
    id: 'sag-cil',
    name: 'SAG + CIL classique',
    description: 'Giratoire → SAG → hydrocyclone → CIL → charbon → élution → électrolyse',
    units: ['feed_source', 'primary_gyratory', 'sag_mill', 'hydrocyclone', 'cil_reactor', 'carbon_adsorption', 'elution_column', 'electrowinning', 'product_sink'],
  },
  {
    id: 'heap-leach',
    name: 'Lixiviation en tas',
    description: 'Concassage 2 étages → tas → adsorption charbon → électrolyse',
    units: ['feed_source', 'jaw_crusher', 'cone_crusher', 'heap_leach_pad', 'carbon_adsorption', 'electrowinning', 'product_sink'],
  },
  {
    id: 'cip-standard',
    name: 'CIP standard — adsorption séparée',
    description: 'Giratoire → SAG → cyclone → billes → pré-aération → lixiviation agitée → CIP (charbon en pulpe) → élution → électrolyse → fusion',
    units: ['feed_source', 'primary_gyratory', 'sag_mill', 'hydrocyclone', 'ball_mill', 'pre_aeration_tank', 'agitator', 'cip_reactor', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink'],
  },
  {
    id: 'gravity-ilr-cip',
    name: 'Gravité intensive + CIP — or grossier',
    description: 'Broyage → cyclone → concentrateur centrifuge → table à secousses → lixiviation intensive du concentré → CIP sur les queues → élution → électrolyse',
    units: ['feed_source', 'jaw_crusher', 'ball_mill', 'hydrocyclone', 'gravity_concentrator', 'shaking_table', 'agitator', 'cip_reactor', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink'],
  },
  {
    id: 'pox-cil',
    name: 'POX (oxydation sous pression) — réfractaire',
    description: 'Broyage → épaississage → autoclave POX → neutralisation → CIL → charbon → élution → électrolyse → fusion',
    units: ['feed_source', 'primary_gyratory', 'sag_mill', 'hydrocyclone', 'ball_mill', 'thickener', 'pressure_oxidation', 'agitator', 'cil_reactor', 'carbon_adsorption', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink'],
  },
  {
    id: 'roasting-cil',
    name: 'Grillage (roasting) — réfractaire sulfuré',
    description: 'Broyage → grillage oxydant → CIL sur calcine → charbon → élution → électrolyse → fusion',
    units: ['feed_source', 'primary_gyratory', 'sag_mill', 'hydrocyclone', 'ball_mill', 'roasting', 'cil_reactor', 'carbon_adsorption', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink'],
  },
  {
    id: 'biox-cil',
    name: 'Bio-oxydation (BIOX) + CIL',
    description: 'Concassage → broyage → épaississage → réacteurs BIOX → lavage CCD → CIL → élution → électrolyse',
    units: ['feed_source', 'jaw_crusher', 'cone_crusher', 'ball_mill', 'hydrocyclone', 'thickener', 'bioleach', 'ccd_circuit', 'cil_reactor', 'elution_column', 'electrowinning', 'product_sink'],
  },
  {
    id: 'hpgr-cil',
    name: 'HPGR + billes + CIL — économe en énergie',
    description: 'Giratoire → HPGR → crible banane → broyage à billes → cyclone → CIL → charbon → élution → électrolyse → fusion',
    units: ['feed_source', 'primary_gyratory', 'hpgr', 'banana_screen', 'ball_mill', 'hydrocyclone', 'cil_reactor', 'carbon_adsorption', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink'],
  },
];

export interface TemplateContext {
  flowsheetId: string;
  projectId: string;
  /** Générateur d'identifiants (injecté pour la testabilité — ex. crypto.randomUUID). */
  makeId: () => string;
}

/**
 * Assemble un modèle en nœuds + arêtes prêts à injecter dans l'état du module.
 *
 * - Les unités inconnues du registre sont ignorées (le circuit reste cohérent).
 * - Les paramètres par défaut de chaque unité sont copiés depuis le registre.
 * - Arêtes en série entre unités consécutives (pulpe).
 * - Disposition EN CASCADE GROUPÉE PAR CIRCUIT (voir layout.ts) : les unités sont
 *   regroupées par circuit en bandes empilées, pas alignées sur une seule ligne.
 */
export function buildTemplate(template: CircuitTemplate, ctx: TemplateContext): { nodes: ProcessNode[]; edges: StreamEdge[] } {
  const nodes: ProcessNode[] = [];
  for (const unitType of template.units) {
    const unit = getUnit(unitType);
    if (!unit) continue; // unité absente du registre → ignorée
    const parameters: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(unit.defaultParameters)) parameters[k] = v.default;
    nodes.push({
      id: ctx.makeId(),
      flowsheet_id: ctx.flowsheetId,
      project_id: ctx.projectId,
      unit_type: unitType,
      label: unit.displayName,
      position_x: 0,
      position_y: 0,
      parameters,
      design_capacity: 500,
      availability_pct: 91,
    });
  }

  const edges: StreamEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: ctx.makeId(),
      flowsheet_id: ctx.flowsheetId,
      project_id: ctx.projectId,
      source_node_id: nodes[i].id,
      target_node_id: nodes[i + 1].id,
      stream_type: 'pulp',
    });
  }

  // Agencement en cascade groupée par circuit.
  const pos = layoutByCircuit(
    nodes.map(n => ({ id: n.id, unit_type: n.unit_type })),
    edges.map(e => ({ source: e.source_node_id, target: e.target_node_id })),
  );
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (p) { n.position_x = p.x; n.position_y = p.y; }
  }

  return { nodes, edges };
}
