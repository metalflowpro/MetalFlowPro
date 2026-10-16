// Résolution de la provenance d'un champ du module Coûts miniers.

import type { Provenance } from '../../../lib/mining/types';
import type { MiningCostState } from './useMiningCostModel';

/** Provenance d'un chemin : la sienne, sinon celle du plus proche parent. */
export function provenanceOf(state: MiningCostState, path: string): Provenance | undefined {
  if (state.isOverridden(path)) return { origin: 'override', source: 'Saisi dans le module Coûts miniers' };
  const parts = path.split('.');
  while (parts.length) {
    const p = state.provenance[parts.join('.')];
    if (p) return p;
    parts.pop();
  }
  return undefined;
}
