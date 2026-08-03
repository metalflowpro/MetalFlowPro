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
];

export interface TemplateContext {
  flowsheetId: string;
  projectId: string;
  /** Générateur d'identifiants (injecté pour la testabilité — ex. crypto.randomUUID). */
  makeId: () => string;
}

/** Espacement de la disposition en série (coordonnées canvas). */
const X0 = 60, Y0 = 130, DX = 185, DY = 80;

/**
 * Assemble un modèle en nœuds + arêtes prêts à injecter dans l'état du module.
 *
 * - Les unités inconnues du registre sont ignorées (le circuit reste cohérent).
 * - Les paramètres par défaut de chaque unité sont copiés depuis le registre.
 * - Disposition gauche→droite avec un léger zig-zag vertical pour lisibilité.
 * - Arêtes en série entre unités consécutives (pulpe).
 */
export function buildTemplate(template: CircuitTemplate, ctx: TemplateContext): { nodes: ProcessNode[]; edges: StreamEdge[] } {
  const nodes: ProcessNode[] = [];
  for (const unitType of template.units) {
    const unit = getUnit(unitType);
    if (!unit) continue; // unité absente du registre → ignorée
    const parameters: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(unit.defaultParameters)) parameters[k] = v.default;
    const i = nodes.length;
    nodes.push({
      id: ctx.makeId(),
      flowsheet_id: ctx.flowsheetId,
      project_id: ctx.projectId,
      unit_type: unitType,
      label: unit.displayName,
      position_x: X0 + i * DX,
      position_y: Y0 + (i % 2) * DY,
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

  return { nodes, edges };
}
