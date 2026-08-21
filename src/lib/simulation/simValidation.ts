// ─────────────────────────────────────────────────────────────────────────────
// Moteur de validation du flowsheet — module PUR (aucun React/DB).
//
// Cahier des charges §8 (validation topologique) + §15 (erreurs bloquantes /
// avertissements). S'exécute AVANT le solveur : un flowsheet invalide ne doit
// pas produire de chiffres trompeurs. Les règles portent sur la TOPOLOGIE et la
// COHÉRENCE PROJET, indépendamment du modèle de courant — donc utilisable dès la
// Phase 1, avant la migration vers les courants multi-composants.
//
// Règle phare (aurait attrapé le bug Phase 0) : toute SORTIE d'un modèle d'unité
// doit être câblée. L'hydrocyclone produit [surverse, sousverse] ; n'en brancher
// qu'une largue l'autre (35 % de l'or perdu du bilan). Ici c'est une ERREUR.
// ─────────────────────────────────────────────────────────────────────────────

import type { ProcessNode, StreamEdge } from './types';
import { getUnit } from './unitRegistry';

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  /** Code stable, testable et traçable (ex. `UNWIRED_OUTPUT`). */
  code: string;
  severity: Severity;
  message: string;
  /** Nœud concerné, le cas échéant. */
  nodeId?: string;
  /** Arête concernée, le cas échéant. */
  edgeId?: string;
}

export interface ValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ok: boolean; // aucune erreur bloquante
}

/** Types de nœuds qui n'exigent PAS d'arête sortante (produits/résidus finaux). */
const SINK_UNIT_TYPES = new Set(['product_sink', 'tailings_pond']);
/** Types de nœuds qui n'exigent PAS d'arête entrante (sources d'alimentation). */
const SOURCE_UNIT_TYPES = new Set(['feed_source']);

/**
 * Valide un flowsheet (§8 + §15). Ne calcule aucun bilan : il prépare le terrain
 * du solveur. `expectedProjectId` active la vérification d'isolation projet (§14)
 * quand on la connaît.
 */
export function validateFlowsheet(
  nodes: ProcessNode[],
  edges: StreamEdge[],
  opts: { expectedProjectId?: string } = {},
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const nodeIds = new Set(nodes.map(n => n.id));
  const outByNode = new Map<string, StreamEdge[]>();
  const inByNode = new Map<string, StreamEdge[]>();
  for (const e of edges) {
    (outByNode.get(e.source_node_id) ?? outByNode.set(e.source_node_id, []).get(e.source_node_id)!).push(e);
    (inByNode.get(e.target_node_id) ?? inByNode.set(e.target_node_id, []).get(e.target_node_id)!).push(e);
  }

  // — §15 : alimentation obligatoire —
  if (!nodes.some(n => SOURCE_UNIT_TYPES.has(n.unit_type))) {
    errors.push({ code: 'NO_FEED_SOURCE', severity: 'error', message: 'Aucun flux d\'alimentation (feed_source) défini.' });
  }

  // — Arêtes pendantes : source/cible inexistante —
  for (const e of edges) {
    if (!nodeIds.has(e.source_node_id)) {
      errors.push({ code: 'EDGE_SOURCE_MISSING', severity: 'error', message: 'Courant sans nœud source valide.', edgeId: e.id });
    }
    if (!nodeIds.has(e.target_node_id)) {
      errors.push({ code: 'EDGE_TARGET_MISSING', severity: 'error', message: 'Courant sans nœud cible valide.', edgeId: e.id });
    }
    // — §14 : isolation projet — tout doit partager le project_id du flowsheet —
    if (opts.expectedProjectId != null && e.project_id !== opts.expectedProjectId) {
      errors.push({ code: 'EDGE_PROJECT_MISMATCH', severity: 'error', message: 'Courant appartenant à un autre projet.', edgeId: e.id });
    }
  }

  for (const n of nodes) {
    const unit = getUnit(n.unit_type);

    // — §15 : unité sans modèle de calcul —
    if (!unit) {
      errors.push({ code: 'UNKNOWN_UNIT_TYPE', severity: 'error', message: `Type d'unité inconnu : « ${n.unit_type} ».`, nodeId: n.id });
      continue;
    }

    // — §14 : isolation projet —
    if (opts.expectedProjectId != null && n.project_id !== opts.expectedProjectId) {
      errors.push({ code: 'NODE_PROJECT_MISMATCH', severity: 'error', message: `Unité « ${n.label} » appartenant à un autre projet.`, nodeId: n.id });
    }

    const outs = outByNode.get(n.id) ?? [];
    const ins = inByNode.get(n.id) ?? [];

    // — Règle phare : trop d'arêtes sortantes vs sorties du modèle → duplication
    //   de flux (or créé, cf. piège positionnel). ERREUR. —
    if (outs.length > unit.maxOutputs) {
      errors.push({
        code: 'TOO_MANY_OUTPUTS', severity: 'error', nodeId: n.id,
        message: `« ${n.label} » a ${outs.length} courants sortants pour ${unit.maxOutputs} sortie(s) — le flux serait dupliqué.`,
      });
    }

    // — Règle phare : sortie du modèle non câblée → flux largué (classe du bug
    //   Phase 0). AVERTISSEMENT et non erreur : la topologie seule ne peut juger
    //   la magnitude (une sousverse cyclone larguée perd 35 % de l'or ; une
    //   solution barren ADR ~0). C'est la FERMETURE DE BILAN métal (§9, Phase 3),
    //   avec les débits réels, qui escalade en erreur au-delà de la tolérance. —
    if (!SINK_UNIT_TYPES.has(n.unit_type) && unit.maxOutputs > 0 && outs.length < unit.maxOutputs) {
      const missing = unit.maxOutputs - outs.length;
      warnings.push({
        code: 'UNWIRED_OUTPUT', severity: 'warning', nodeId: n.id,
        message: `« ${n.label} » a ${missing} sortie(s) non câblée(s) — la matière/l'or de ce courant sortirait du bilan (à vérifier au bilan métal).`,
      });
    }

    // — Trop d'entrées vs le modèle (le solveur les mélange, mais on avertit). —
    if (unit.maxInputs > 0 && ins.length > unit.maxInputs) {
      warnings.push({
        code: 'TOO_MANY_INPUTS', severity: 'warning', nodeId: n.id,
        message: `« ${n.label} » reçoit ${ins.length} courants pour ${unit.maxInputs} entrée(s) prévue(s) — ils seront mélangés.`,
      });
    }

    // — Unité de procédé sans alimentation (hors source) → jamais calculée. —
    if (!SOURCE_UNIT_TYPES.has(n.unit_type) && unit.maxInputs > 0 && ins.length === 0) {
      warnings.push({
        code: 'NO_INPUT', severity: 'warning', nodeId: n.id,
        message: `« ${n.label} » n'a aucun courant entrant — l'unité restera inactive.`,
      });
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}
