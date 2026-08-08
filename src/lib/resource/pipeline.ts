// ─────────────────────────────────────────────────────────────────────────────
// Pipeline forages → composites 3D — pont entre lib/drilling et l'estimation.
//
// Transforme les analyses brutes d'un ensemble de trous en points d'échantillon
// 3D prêts pour le krigeage : pour chaque trou, on desurvey la trace, on
// composite l'élément à la longueur cible, puis on projette le milieu de chaque
// composite en coordonnées. C'est l'entrée directe de estimateGrid.
//
// Fonctions PURES.
// ─────────────────────────────────────────────────────────────────────────────

import { desurveyHole, pointAtDepth, type Collar, type SurveyStation } from '../drilling/desurvey';
import { compositeByLength, type RawSample } from '../drilling/compositing';
import type { SamplePoint } from './statistics';

/** Données d'un trou pour UN élément (échantillons déjà filtrés qaqc='sample'). */
export interface HoleData {
  collar: Collar;
  surveys: SurveyStation[];
  samples: RawSample[];
}

/** Emprise 3D d'un nuage de points. */
export interface Bounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/**
 * Construit les composites 3D d'un ensemble de trous pour un élément.
 * Un trou sans survey est desurveyé en vertical (voir desurveyHole).
 */
export function buildSamplePoints(holes: HoleData[], compositeLength: number): SamplePoint[] {
  const out: SamplePoint[] = [];
  for (const h of holes) {
    const trace = desurveyHole(h.collar, h.surveys);
    const comps = compositeByLength(h.samples, { length: compositeLength });
    for (const c of comps) {
      const mid = (c.from + c.to) / 2;
      const p = pointAtDepth(trace, mid);
      out.push({ x: p.x, y: p.y, z: p.z, value: c.value, holeId: h.collar.holeId });
    }
  }
  return out;
}

/** Emprise d'un nuage de points (null si vide). */
export function boundsOf(points: SamplePoint[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Centre de bloc d'un modèle régulier. */
export interface GridBlock { i: number; j: number; k: number; x: number; y: number; z: number; }

/**
 * Génère une grille régulière de centres de blocs couvrant l'emprise, avec une
 * taille de bloc par axe. `maxBlocks` borne le total (protection navigateur) :
 * si dépassé, la fonction lève pour que l'appelant élargisse la maille plutôt que
 * de figer l'interface.
 */
export function buildGrid(bounds: Bounds, block: { x: number; y: number; z: number }, maxBlocks = 60000): GridBlock[] {
  if (!(block.x > 0 && block.y > 0 && block.z > 0)) throw new Error('Taille de bloc invalide.');
  const nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / block.x));
  const ny = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / block.y));
  const nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / block.z));
  const total = nx * ny * nz;
  if (total > maxBlocks) {
    throw new Error(`Grille trop fine : ${total.toLocaleString('fr')} blocs > ${maxBlocks.toLocaleString('fr')}. Augmentez la taille de bloc.`);
  }
  const grid: GridBlock[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        grid.push({
          i, j, k,
          x: bounds.minX + (i + 0.5) * block.x,
          y: bounds.minY + (j + 0.5) * block.y,
          z: bounds.minZ + (k + 0.5) * block.z,
        });
      }
    }
  }
  return grid;
}
