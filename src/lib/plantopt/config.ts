// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Couche de configuration (source unique, surchargeable)
//
// Toute valeur numérique de départ du module vit ICI (ou provient du projet actif),
// jamais en dur dans le moteur, les composants ou une usine « démo » figée. Deux
// familles :
//   1. PLANT_OPT_RUN_DEFAULTS  — réglages d'exécution Monte-Carlo par défaut.
//   2. PLANT_OPT_MODEL_DEFAULTS — hypothèses de modélisation (bornes, replis de loi,
//      paramètres d'une aire neuve). Ce sont des points de départ qu'un ingénieur
//      édite, documentés et centralisés pour qu'un re-réglage soit une seule édition.
//
// Le pas de temps, l'horizon, le rodage, les lois de repli, etc. sont ainsi tous
// auditables et modifiables sans toucher au code de calcul.
// ─────────────────────────────────────────────────────────────────────────────

import { HOURS_PER_YEAR } from '../config/constants';
import type { DistributionKind, DistributionSpec, SimConfig } from './types';

/** Devise de référence de la plateforme (les coûts sont exprimés en USD). */
export const PLANT_OPT_CURRENCY = 'USD';

/** Réglages Monte-Carlo par défaut d'un nouveau run (tous éditables dans l'UI). */
export const PLANT_OPT_RUN_DEFAULTS: SimConfig = {
  /** Nombre d'itérations : compromis bruit statistique / temps de calcul en navigateur. */
  iterations: 400,
  /** Graine RNG : fixe la reproductibilité d'un run (même graine ⇒ même résultat). */
  seed: 12345,
  /** Rodage (heures) exclu des stats — laisse les tampons atteindre leur régime. */
  warmupHours: 168, // 1 semaine
  /** Pas de temps d'intégration (heures). */
  timeStepHours: 1,
  /** Horizon par défaut (heures) = une année calendaire. */
  horizonHours: HOURS_PER_YEAR,
};

/**
 * Hypothèses de modélisation par défaut. Bornes de sécurité de l'échantillonneur
 * et du moteur, replis de loi et gabarit d'une aire créée à la main.
 */
export const PLANT_OPT_MODEL_DEFAULTS = {
  /** Sensibilité relative capacité↔dureté d'une aire « hardnessSensitive » (fraction). */
  HARDNESS_TO_CAPACITY: 0.3,
  /** Bornes du facteur multiplicatif capacité issu de la dureté (garde-fou). */
  HARDNESS_CAPACITY_MIN_FACTOR: 0.1,
  HARDNESS_CAPACITY_MAX_FACTOR: 2,
  /** Nombre max de sous-pas d'intégration des tampons par pas de temps (stabilité). */
  MAX_BUFFER_SUBSTEPS: 50,
  /** Itérations minimales requises pour calculer un diagramme de sensibilité. */
  SENSITIVITY_MIN_ITERATIONS: 10,
  /** Fraction des itérations (basses/hautes) utilisée pour chaque barre du tornado. */
  SENSITIVITY_TAIL_FRACTION: 0.1,
  /** Écart-type plancher (évite une loi dégénérée après ajustement de données). */
  MIN_FITTED_SD: 1e-9,
  /** Taille de l'échantillon de prévisualisation d'une loi dans l'éditeur. */
  PREVIEW_SAMPLES: 4000,
  /** Graine dédiée à la prévisualisation (déterministe, séparée du run). */
  PREVIEW_SEED: 0x134d885,
  /** Nombre minimal de points de données pour ajuster une loi. */
  FIT_MIN_POINTS: 3,
  /** Décalage horizontal (px) entre deux aires ajoutées à la suite sur le canvas. */
  CANVAS_AREA_DX: 200,
} as const;

/**
 * Paramètres de repli d'une loi quand l'utilisateur bascule vers un `kind` sans
 * valeurs saisies. Non pas des « constantes physiques » : des valeurs de départ
 * plausibles qu'on édite ensuite. Toute unité dépend du champ (t/h, heures…).
 */
export const PLANT_OPT_DEFAULT_DIST_PARAMS: Record<DistributionKind, Record<string, number>> = {
  constant:    { value: 1000 },
  uniform:     { min: 900, max: 1100 },
  normal:      { mean: 1000, sd: 50 },
  exponential: { rate: 0.001 },
  weibull:     { shape: 1.4, scale: 320 },
  lognormal:   { mu: 1.5, sigma: 0.5 },
  triangular:  { min: 900, mode: 1000, max: 1100 },
  pert:        { min: 900, mode: 1000, max: 1100 },
  empirical:   {},
  categorical: {},
};

/** Libellés FR des lois (éditeur + légendes). */
export const DIST_LABELS: Record<DistributionKind, string> = {
  constant:    'Constante',
  uniform:     'Uniforme',
  normal:      'Normale',
  exponential: 'Exponentielle',
  weibull:     'Weibull',
  lognormal:   'Lognormale',
  triangular:  'Triangulaire',
  pert:        'PERT',
  empirical:   'Empirique',
  categorical: 'Catégorielle',
};

/**
 * Champs éditables (clé + libellé + pas) par famille de loi. Pilote le rendu
 * générique des champs de l'éditeur de loi — pas de champs codés en dur par loi.
 */
export const DIST_PARAM_FIELDS: Record<DistributionKind, { key: string; label: string; step?: number }[]> = {
  constant:    [{ key: 'value', label: 'Valeur' }],
  uniform:     [{ key: 'min', label: 'Min' }, { key: 'max', label: 'Max' }],
  normal:      [{ key: 'mean', label: 'Moyenne' }, { key: 'sd', label: 'Écart-type', step: 0.1 }],
  exponential: [{ key: 'rate', label: 'Taux λ', step: 0.001 }],
  weibull:     [{ key: 'shape', label: 'Forme k', step: 0.1 }, { key: 'scale', label: 'Échelle λ' }],
  lognormal:   [{ key: 'mu', label: 'μ (log)', step: 0.1 }, { key: 'sigma', label: 'σ (log)', step: 0.1 }],
  triangular:  [{ key: 'min', label: 'Min' }, { key: 'mode', label: 'Mode' }, { key: 'max', label: 'Max' }],
  pert:        [{ key: 'min', label: 'Min' }, { key: 'mode', label: 'Mode' }, { key: 'max', label: 'Max' }],
  empirical:   [],
  categorical: [],
};

/**
 * Catégories procédé reconnues → couleur d'aire sur le canvas. Table de style
 * centralisée (pas de littéraux hex dispersés dans le rendu SVG).
 */
export const AREA_TYPE_COLORS: Record<string, string> = {
  crushing:   '#92400e',
  hpgr:       '#7c2d12',
  grinding:   '#5b21b6',
  screening:  '#9f1239',
  flotation:  '#7f1d1d',
  regrind:    '#44403c',
  thickening: '#0e7490',
  leaching:   '#166534',
};

/** Couleur neutre d'une aire sans catégorie connue. */
export const AREA_DEFAULT_COLOR = '#334155';

/** Teinte HSL du vert (probabilité faible) au rouge (élevée) — carte de chaleur des goulots. */
export function heatColor(p: number): string {
  const t = Math.max(0, Math.min(1, p));
  return `hsl(${(1 - t) * 120}, 70%, 45%)`;
}

/** Fabrique une spec de loi à partir de son `kind` et des paramètres de repli. */
export function defaultDistribution(kind: DistributionKind): DistributionSpec {
  return { kind, params: { ...PLANT_OPT_DEFAULT_DIST_PARAMS[kind] } };
}

/** Paramètres d'une aire créée à la main dans l'éditeur (loi de capacité triangulaire). */
export const NEW_AREA_DEFAULTS = {
  opexPerTonne: 1,
  capacity: { min: 900, mode: 1000, max: 1100 },
} as const;
