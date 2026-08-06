// ─────────────────────────────────────────────────────────────────────────────
// Orchestrateur d'estimation — remplit un block model à partir des composites.
//
// Assemble la chaîne : sélection de voisins → krigeage (ou IDW) → classification
// CIM, bloc par bloc et pour UN élément. La page appelle cet orchestrateur une
// fois par élément (Cu, Au, Mo…), puis calcule le CuEq via lib/metals. Candidat
// à l'exécution en web-worker sur un gros modèle (patron pitOptimizer.worker).
//
// Fonctions PURES.
// ─────────────────────────────────────────────────────────────────────────────

import { krigeBlock, selectNeighbours, type BlockCentroid, type SearchConfig } from './kriging';
import { idwBlock } from './idw';
import { classifyBlock, type ResourceClass, type ClassificationThresholds, DEFAULT_THRESHOLDS } from './classification';
import type { VariogramModel } from './variogram';
import type { SamplePoint } from './statistics';

/** Configuration d'un passage d'estimation (un élément). */
export interface EstimationConfig {
  method: 'kriging' | 'idw';
  /** Modèle de variogramme (requis pour le krigeage). */
  model?: VariogramModel;
  /** Puissance IDW (défaut 2). */
  power?: number;
  search: SearchConfig;
  thresholds?: ClassificationThresholds;
}

/** Bloc estimé : teneur, incertitude, preuves et classe CIM. */
export interface EstimatedCell {
  value: number | null;
  krigingVariance: number | null;
  nSamples: number;
  avgDistance: number;
  nHoles: number;
  class: ResourceClass | null;
}

/** Compte les trous distincts d'un ensemble de composites voisins. */
function countHoles(neighbours: SamplePoint[]): number {
  const set = new Set<string>();
  let anonymous = 0;
  for (const s of neighbours) {
    if (s.holeId) set.add(s.holeId);
    else anonymous++;
  }
  // Sans holeId renseigné, on ne peut pas regrouper : chaque composite compte pour 1.
  return set.size + anonymous;
}

/**
 * Estime chaque bloc pour un élément. Le krigeage exige `config.model` ; à défaut
 * (ou en méthode 'idw'), l'IDW est utilisé et la classification retombe sur la
 * géométrie (distance/effectif) puisqu'il n'y a pas de variance.
 *
 * @throws si method='kriging' sans modèle de variogramme.
 */
export function estimateGrid(
  blocks: BlockCentroid[],
  samples: SamplePoint[],
  config: EstimationConfig,
): EstimatedCell[] {
  if (config.method === 'kriging' && !config.model) {
    throw new Error('Krigeage : modèle de variogramme requis (config.model).');
  }
  const thresholds = config.thresholds ?? DEFAULT_THRESHOLDS;

  return blocks.map((block: BlockCentroid): EstimatedCell => {
    const neighbours = selectNeighbours(block, samples, config.search);
    if (neighbours.length === 0) {
      return { value: null, krigingVariance: null, nSamples: 0, avgDistance: 0, nHoles: 0, class: null };
    }

    const est =
      config.method === 'kriging'
        ? krigeBlock(block, neighbours, config.model as VariogramModel)
        : idwBlock(block, neighbours, config.power ?? 2);

    const nHoles = countHoles(neighbours);
    const cls = classifyBlock(
      { avgDistance: est.avgDistance, nSamples: est.nSamples, nHoles },
      thresholds,
    );

    return {
      value: est.value,
      krigingVariance: est.krigingVariance,
      nSamples: est.nSamples,
      avgDistance: est.avgDistance,
      nHoles,
      class: cls,
    };
  });
}
