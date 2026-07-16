// ─────────────────────────────────────────────────────────────────────────────
// Pit optimisation, off the UI thread.
//
// Uses a one-bench precedence template (benchPrecedenceOffsets) so the graph is
// ~5–9 arcs/block instead of ~450, and builds it once for all shells. That took a
// 35 280-block run from minutes to seconds. The worker still runs off-thread so
// the tab stays responsive and reports progress per shell.
// ─────────────────────────────────────────────────────────────────────────────

import {
  nestedShells, benchPrecedenceOffsets, elevationKUp,
  type Block, type BlockValueInputs, type Shell,
} from './pitOptimizer';

export interface PitWorkerRequest {
  blocks: Block[];
  inputs: BlockValueInputs;
  slopeAngleDeg: number;
  blockSizeX: number;
  blockSizeY: number;
  benchHeight: number;
  coneLevels: number;
  revenueFactors: number[];
}

/** One mined column of the ultimate pit — top surface for the 3D view. */
export interface PitColumn { i: number; j: number; floorCz: number; grade: number }

/**
 * Compact geometry for visualising the pit, computed in the worker so the UI
 * never receives ~14 000 block sets. The 3D view needs only the pit floor per
 * mined column; the cross-section needs the floor profile per shell along one row.
 */
export interface PitViz {
  surface: PitColumn[];           // ultimate pit floor, one entry per mined column
  topCz: number;                  // reference surface elevation
  gradeMax: number;
  centerJ: number;
  iMin: number; iMax: number; czMin: number; czMax: number;
  /** Per shell (coarse→fine price), floor elevation per i along centerJ (null = untouched). */
  section: { revenueFactor: number; floorByI: (number | null)[] }[];
}

export type PitWorkerResponse =
  | { type: 'progress'; done: number; total: number; revenueFactor: number }
  | { type: 'done'; shells: Shell[]; edgesPerShell: number; viz: PitViz | null }
  | { type: 'error'; message: string };

/**
 * Reduce the solved shells to the compact geometry the views need.
 *
 * The pit "floor" at a column is its deepest mined block — the lowest elevation
 * (cz), since `kUp` tells us which way is up. The 3D view draws that floor
 * surface; the cross-section draws the floor profile of each shell along the
 * model's centre row.
 */
function buildViz(blocks: Block[], shells: Shell[], kUp: 1 | -1): PitViz | null {
  if (!blocks.length || !shells.length) return null;

  let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
  let czMin = Infinity, czMax = -Infinity, gradeMax = 0;
  for (const b of blocks) {
    if (b.i < iMin) iMin = b.i; if (b.i > iMax) iMax = b.i;
    if (b.j < jMin) jMin = b.j; if (b.j > jMax) jMax = b.j;
    if (b.cz < czMin) czMin = b.cz; if (b.cz > czMax) czMax = b.cz;
    if (b.auGt > gradeMax) gradeMax = b.auGt;
  }
  const topCz = czMax;
  const centerJ = Math.round((jMin + jMax) / 2);

  const ultimate = shells.find(s => Math.abs(s.revenueFactor - 1) < 1e-9) ?? shells[shells.length - 1];

  // Deepest mined block per (i,j) for the ultimate pit → the floor surface.
  const floorKey = (i: number, j: number) => (i - iMin) * (jMax - jMin + 1) + (j - jMin);
  const floorBlock = new Map<number, Block>();
  for (const idx of ultimate.result.inPit) {
    const b = blocks[idx];
    const key = floorKey(b.i, b.j);
    const cur = floorBlock.get(key);
    // "Deeper" = lower elevation regardless of the k convention.
    if (!cur || b.cz < cur.cz) floorBlock.set(key, b);
  }
  const surface: PitColumn[] = [...floorBlock.values()].map(b => ({ i: b.i, j: b.j, floorCz: b.cz, grade: b.auGt }));

  // Nested cross-section: floor elevation per i along centre j, one profile per shell.
  const section = shells.map(s => {
    const floorByI: (number | null)[] = new Array(iMax - iMin + 1).fill(null);
    for (const idx of s.result.inPit) {
      const b = blocks[idx];
      if (b.j !== centerJ) continue;
      const c = b.i - iMin;
      if (floorByI[c] === null || b.cz < (floorByI[c] as number)) floorByI[c] = b.cz;
    }
    return { revenueFactor: s.revenueFactor, floorByI };
  });

  return { surface, topCz, gradeMax, centerJ, iMin, iMax, czMin, czMax, section };
}

self.onmessage = (e: MessageEvent<PitWorkerRequest>) => {
  const req = e.data;
  try {
    // One-bench precedence, pointed toward the surface using the model's own
    // elevation — never assuming a k convention.
    const kUp = elevationKUp(req.blocks);
    const offsets = benchPrecedenceOffsets(
      req.slopeAngleDeg, req.blockSizeX, req.blockSizeY, req.benchHeight, kUp,
    );

    const shells = nestedShells(
      req.blocks, req.inputs, offsets, req.revenueFactors,
      (done, total) => {
        const msg: PitWorkerResponse = { type: 'progress', done, total, revenueFactor: req.revenueFactors[done - 1] };
        (self as unknown as Worker).postMessage(msg);
      },
    );

    const viz = buildViz(req.blocks, shells, kUp);

    // `inPit` is a Set — structured clone handles it, but the UI only needs the
    // aggregates plus the compact viz above, so the sets are dropped.
    const slim = shells.map(s => ({ ...s, result: { ...s.result, inPit: new Set<number>() } }));
    const done: PitWorkerResponse = {
      type: 'done', shells: slim, edgesPerShell: offsets.length * req.blocks.length, viz,
    };
    (self as unknown as Worker).postMessage(done);
  } catch (err) {
    const msg: PitWorkerResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : 'Erreur inconnue pendant l\'optimisation.',
    };
    (self as unknown as Worker).postMessage(msg);
  }
};
