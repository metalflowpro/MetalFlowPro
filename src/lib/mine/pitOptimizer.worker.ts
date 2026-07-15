// ─────────────────────────────────────────────────────────────────────────────
// Pit optimisation, off the UI thread.
//
// The solve is genuinely heavy — a real 35 280-block model at 45° carries ~15.9 M
// precedence arcs per shell — and the cone cannot be thinned without changing the
// slope (see `immediatePrecedenceOffsets`). Since the work is irreducible, it runs
// here instead: the tab stays responsive and progress is reported per shell.
// ─────────────────────────────────────────────────────────────────────────────

import { valueBlocks, optimizePit, slopeConeOffsets, type Block, type BlockValueInputs, type Shell } from './pitOptimizer';

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
    const offsets = slopeConeOffsets(
      req.slopeAngleDeg, req.blockSizeX, req.blockSizeY, req.benchHeight, req.coneLevels,
    );

    const shells: Shell[] = [];
    for (let i = 0; i < req.revenueFactors.length; i++) {
      const rf = req.revenueFactors[i];
      const inputs = { ...req.inputs, goldPriceUsdOz: req.inputs.goldPriceUsdOz * rf };
      const valued = valueBlocks(req.blocks, inputs);
      const result = optimizePit(valued, offsets, inputs.domains, inputs.fallback);
      shells.push({ revenueFactor: rf, goldPriceUsdOz: inputs.goldPriceUsdOz, result });

      const msg: PitWorkerResponse = { type: 'progress', done: i + 1, total: req.revenueFactors.length, revenueFactor: rf };
      (self as unknown as Worker).postMessage(msg);
    }

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
