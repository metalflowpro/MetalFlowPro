// ─────────────────────────────────────────────────────────────────────────────
// Style des courants par type — module PUR (aucun React/DB).
//
// Le moteur ne connaît que 5 types de flux (types.ts : StreamType). On leur donne
// une couleur et un libellé de légende cohérents, réutilisés par l'éditeur
// (tracé des arêtes) ET par la légende du canevas — pour qu'un flowsheet se lise
// comme un schéma d'usine (cf. exemple : procédé, solution grossese, réactif,
// air, eau color-codés) plutôt qu'un enchevêtrement gris uniforme.
// ─────────────────────────────────────────────────────────────────────────────

import type { StreamType } from './types';

export interface StreamStyle {
  color: string;
  /** Libellé de légende (regroupe les nuances de l'exemple sous chaque type). */
  legend: string;
}

export const STREAM_STYLE: Record<StreamType, StreamStyle> = {
  pulp:     { color: '#60a5fa', legend: 'Pulpe / procédé' },        // bleu — flux principal
  solid:    { color: '#b45309', legend: 'Solide / concentré / résidu' }, // brun — solides
  solution: { color: '#22c55e', legend: 'Solution (grossese / stérile)' },  // vert — solution or
  liquid:   { color: '#06b6d4', legend: 'Liquide / eau / réactif' },   // cyan — eau & réactifs
  gas:      { color: '#a855f7', legend: 'Gaz / air / O₂' },          // violet — air/oxygène
};

/** Couleur d'un type de courant (repli pulpe si type inconnu). */
export function streamColor(type: StreamType | null | undefined): string {
  return (type && STREAM_STYLE[type]?.color) || STREAM_STYLE.pulp.color;
}

/** Ordre d'affichage de la légende. */
export const STREAM_LEGEND: Array<{ type: StreamType } & StreamStyle> =
  (['pulp', 'solid', 'solution', 'liquid', 'gas'] as StreamType[]).map(t => ({ type: t, ...STREAM_STYLE[t] }));
