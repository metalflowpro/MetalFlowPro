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

export type PitWorkerResponse =
  | { type: 'progress'; done: number; total: number; revenueFactor: number }
  | { type: 'done'; shells: Shell[]; edgesPerShell: number }
  | { type: 'error'; message: string };

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

    // `inPit` is a Set — structured clone handles it, but the UI only needs the
    // aggregates, so the sets are dropped to keep the transfer small.
    const slim = shells.map(s => ({
      ...s,
      result: { ...s.result, inPit: new Set<number>() },
    }));
    const done: PitWorkerResponse = {
      type: 'done', shells: slim, edgesPerShell: offsets.length * req.blocks.length,
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
