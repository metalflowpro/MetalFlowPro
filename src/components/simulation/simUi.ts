// Helpers d'affichage partagés par les onglets de Flowsheet Simulation Pro.
// Purement présentationnels (classes Tailwind) — la logique de qualité vit dans
// lib/simulation/provenance.ts.

import type { QualityLevel } from '../../lib/simulation/provenance';

/** Couleur d'incertitude (§9) → styles de pastille + libellé. */
export const QUALITY_UI: Record<QualityLevel, { dot: string; text: string; label: string }> = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'Données validées' },
  amber: { dot: 'bg-amber-500',   text: 'text-amber-400',   label: 'Partiellement estimé' },
  red:   { dot: 'bg-red-500',     text: 'text-red-400',     label: 'Majoritairement hypothétique' },
  grey:  { dot: 'bg-slate-500',   text: 'text-slate-400',   label: 'Calcul non disponible' },
};

export const CONFIDENCE_UI: Record<'high' | 'medium' | 'low', { badge: string; label: string }> = {
  high:   { badge: 'badge-success', label: 'élevée' },
  medium: { badge: 'badge-warning', label: 'moyenne' },
  low:    { badge: 'badge-error',   label: 'faible' },
};

export const INDICATOR_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'faible', medium: 'moyen', high: 'élevé',
};
