// ─────────────────────────────────────────────────────────────────────────────
// Classification des ressources — catégories CIM (Mesuré / Indiqué / Inféré).
//
// Le NI 43-101 impose de classer chaque bloc selon la CONFIANCE géologique, via
// les définitions CIM. La confiance croît avec la densité d'information autour du
// bloc : distance aux composites, nombre de composites, nombre de trous distincts.
// Ce module applique des seuils PARAMÉTRABLES (le rapport Morrison ne publie pas
// ses règles exactes — §8.1) et sépare strictement l'Inféré, qui ne pourra jamais
// alimenter une réserve (règle dure vérifiée en Phase C).
//
// Fonctions PURES.
// ─────────────────────────────────────────────────────────────────────────────

/** Catégorie de ressource CIM (aligne les libellés du module Block Model). */
export type ResourceClass = 'Mesuré' | 'Indiqué' | 'Inféré';

/** Preuves de confiance disponibles autour d'un bloc estimé. */
export interface ConfidenceEvidence {
  /** Distance moyenne des composites retenus (m). */
  avgDistance: number;
  /** Nombre de composites retenus. */
  nSamples: number;
  /** Nombre de trous distincts parmi ces composites. */
  nHoles: number;
}

/** Seuils de classification (paramétrables par projet / QP). */
export interface ClassificationThresholds {
  measured: { maxDistance: number; minSamples: number; minHoles: number };
  indicated: { maxDistance: number; minSamples: number; minHoles: number };
  /** Au-delà du rayon inféré, le bloc reste non classé (null). */
  inferred: { maxDistance: number };
}

/**
 * Seuils par défaut documentés — ordre de grandeur pour un porphyre à maille
 * large. À ajuster au variogramme et à l'espacement de forage réels.
 */
export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  measured:  { maxDistance: 50,  minSamples: 12, minHoles: 3 },
  indicated: { maxDistance: 100, minSamples: 6,  minHoles: 2 },
  inferred:  { maxDistance: 200 },
};

/**
 * Classe un bloc à partir des preuves de confiance. Renvoie null (non classé)
 * si le bloc est trop mal contraint pour être même inféré — un bloc non classé
 * n'entre NI dans la ressource NI dans la réserve.
 */
export function classifyBlock(
  ev: ConfidenceEvidence,
  thresholds: ClassificationThresholds = DEFAULT_THRESHOLDS,
): ResourceClass | null {
  const { measured: m, indicated: i, inferred: inf } = thresholds;
  if (ev.avgDistance <= m.maxDistance && ev.nSamples >= m.minSamples && ev.nHoles >= m.minHoles) {
    return 'Mesuré';
  }
  if (ev.avgDistance <= i.maxDistance && ev.nSamples >= i.minSamples && ev.nHoles >= i.minHoles) {
    return 'Indiqué';
  }
  if (ev.avgDistance <= inf.maxDistance && ev.nSamples >= 1) {
    return 'Inféré';
  }
  return null;
}

/** Vrai si la catégorie compte comme Mesuré+Indiqué (base des réserves). */
export function isMeasuredOrIndicated(cls: ResourceClass | null): boolean {
  return cls === 'Mesuré' || cls === 'Indiqué';
}
