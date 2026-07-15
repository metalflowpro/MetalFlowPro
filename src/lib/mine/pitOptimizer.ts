// ─────────────────────────────────────────────────────────────────────────────
// Étape 1 — Optimisation de la fosse (Lerchs-Grossmann / fermeture maximale).
//
// The ultimate pit is the maximum-weight closure of the block precedence graph:
// a block can only be mined if everything in its slope cone above it is mined
// too. Lerchs-Grossmann solved this with a graph algorithm in 1965; the modern
// equivalent — used here — is Picard's reduction to a minimum cut:
//
//     source → block            capacity = value            (blocks worth money)
//     block  → sink             capacity = |value|          (blocks that cost money)
//     block  → block above it   capacity = ∞                (slope precedence)
//
// The min-cut separates the blocks worth mining from the rest, and by the
// max-flow/min-cut theorem that cut is optimal — not a heuristic. This is the
// same optimum Whittle reports.
//
// What conventional optimisers do NOT do, and this does: value each block with
// the metallurgical recovery AND the grinding energy of ITS OWN geometallurgical
// domain. A hard, refractory sulphide block and a soft oxide block of identical
// grade are not worth the same, and a single deposit-wide recovery cannot say so.
//
// Pure module — no Supabase, no React.
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS } from '../config/constants';
import { bondEnergy } from '../geomet/p80';

export interface Block {
  i: number; j: number; k: number;
  /** Centroid elevation (m). Higher k must mean higher elevation, or pass zUp. */
  cz: number;
  auGt: number;
  density: number;
  volumeM3: number;
  /** Canonical geometallurgical domain, used to pick recovery + hardness. */
  canon: string;
}

/** Per-domain geometallurgy driving block value. */
export interface DomainEconomics {
  recoveryPct: number;
  bwiKwhT: number;
}

export interface BlockValueInputs {
  goldPriceUsdOz: number;
  /** $/t of ore, EXCLUDING grinding energy (priced per block from its own BWi). */
  processCostExGrindUsdT: number;
  miningCostUsdT: number;
  gaCostUsdT: number;
  royaltyFraction: number;
  elecCostUsdKwh: number;
  f80Um: number;
  p80Um: number;
  /** Recovery/hardness per canonical domain. */
  domains: Record<string, DomainEconomics>;
  /** Used when a block's domain has no geometallurgy. */
  fallback: DomainEconomics;
}

export interface ValuedBlock extends Block {
  tonnes: number;
  /** Net value if processed as ore ($). Negative means it does not pay. */
  oreValueUsd: number;
  /** Cost to mine it as waste ($, always negative). */
  wasteValueUsd: number;
  /** max(oreValue, wasteValue) — the decision the optimiser makes per block. */
  valueUsd: number;
  isOre: boolean;
}

/**
 * Block Economic Value.
 *
 * A block is mined as ore if processing it beats dumping it as waste; the mining
 * cost is paid either way, so it does not decide ore vs waste — only whether the
 * block belongs in the pit at all. That distinction is what separates the
 * marginal cut-off from the breakeven cut-off.
 */
export function valueBlocks(blocks: Block[], inp: BlockValueInputs): ValuedBlock[] {
  return blocks.map(b => {
    const tonnes = b.volumeM3 * b.density;
    const met = inp.domains[b.canon] ?? inp.fallback;

    const grindKwhT = bondEnergy(met.bwiKwhT, inp.f80Um, inp.p80Um);
    const processUsdT = inp.processCostExGrindUsdT + grindKwhT * inp.elecCostUsdKwh + inp.gaCostUsdT;

    const recoveredGrams = tonnes * b.auGt * (met.recoveryPct / 100);
    const revenueUsd = (recoveredGrams / TROY_OZ_GRAMS) * inp.goldPriceUsdOz * (1 - inp.royaltyFraction);

    const miningUsd = tonnes * inp.miningCostUsdT;
    const oreValueUsd = revenueUsd - tonnes * processUsdT - miningUsd;
    const wasteValueUsd = -miningUsd;

    const isOre = oreValueUsd > wasteValueUsd;
    return {
      ...b, tonnes, oreValueUsd, wasteValueUsd,
      valueUsd: isOre ? oreValueUsd : wasteValueUsd,
      isOre,
    };
  });
}

// ─── Precedence cone ─────────────────────────────────────────────────────────

/**
 * Blocks that must be removed above a given block for a slope angle to hold.
 *
 * Offsets are generated once for the whole model: at a slope of θ, reaching one
 * bench higher lets the cone widen by benchHeight / tan(θ) horizontally.
 */
export function slopeConeOffsets(
  slopeAngleDeg: number,
  blockSizeX: number,
  blockSizeY: number,
  benchHeight: number,
  maxLevelsUp: number,
): { di: number; dj: number; dk: number }[] {
  const theta = (slopeAngleDeg * Math.PI) / 180;
  const tan = Math.tan(theta);
  const offsets: { di: number; dj: number; dk: number }[] = [];

  for (let dk = 1; dk <= maxLevelsUp; dk++) {
    // Horizontal reach required at dk benches above.
    const reach = tan > 1e-6 ? (dk * benchHeight) / tan : Infinity;
    const ri = Math.ceil(reach / blockSizeX);
    const rj = Math.ceil(reach / blockSizeY);
    for (let di = -ri; di <= ri; di++) {
      for (let dj = -rj; dj <= rj; dj++) {
        // Elliptical cone in plan — a square would over-strip the diagonals.
        const dist = Math.hypot(di * blockSizeX, dj * blockSizeY);
        if (dist <= reach + 1e-9) offsets.push({ di, dj, dk });
      }
    }
  }
  return offsets;
}

// ─── Max-flow (Dinic) ────────────────────────────────────────────────────────

/**
 * Dinic's algorithm. Chosen over Ford-Fulkerson because the precedence arcs are
 * infinite-capacity: augmenting-path methods degrade badly on those, while
 * Dinic's level graph handles them in near-linear time on this topology.
 */
class MaxFlow {
  private to: number[] = [];
  private cap: number[] = [];
  private next: number[] = [];
  private head: Int32Array;
  private level: Int32Array;
  private iter: Int32Array;

  constructor(private n: number) {
    this.head = new Int32Array(n).fill(-1);
    this.level = new Int32Array(n);
    this.iter = new Int32Array(n);
  }

  addEdge(u: number, v: number, c: number) {
    this.to.push(v); this.cap.push(c); this.next.push(this.head[u]); this.head[u] = this.to.length - 1;
    this.to.push(u); this.cap.push(0); this.next.push(this.head[v]); this.head[v] = this.to.length - 1;
  }

  private bfs(s: number, t: number): boolean {
    this.level.fill(-1);
    const q = new Int32Array(this.n);
    let qh = 0, qt = 0;
    this.level[s] = 0; q[qt++] = s;
    while (qh < qt) {
      const u = q[qh++];
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        if (this.cap[e] > 1e-9 && this.level[this.to[e]] < 0) {
          this.level[this.to[e]] = this.level[u] + 1;
          q[qt++] = this.to[e];
        }
      }
    }
    return this.level[t] >= 0;
  }

  private dfs(u: number, t: number, f: number): number {
    if (u === t) return f;
    for (let e = this.iter[u]; e !== -1; e = this.next[e]) {
      this.iter[u] = e;
      const v = this.to[e];
      if (this.cap[e] > 1e-9 && this.level[v] === this.level[u] + 1) {
        const d = this.dfs(v, t, Math.min(f, this.cap[e]));
        if (d > 1e-9) { this.cap[e] -= d; this.cap[e ^ 1] += d; return d; }
      }
    }
    this.iter[u] = -1;
    return 0;
  }

  run(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let i = 0; i < this.n; i++) this.iter[i] = this.head[i];
      let f: number;
      while ((f = this.dfs(s, t, Infinity)) > 1e-9) flow += f;
    }
    return flow;
  }

  /** Nodes reachable from the source in the residual graph = the maximum closure. */
  minCutSourceSide(s: number): boolean[] {
    const seen = new Array<boolean>(this.n).fill(false);
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        if (this.cap[e] > 1e-9 && !seen[this.to[e]]) { seen[this.to[e]] = true; stack.push(this.to[e]); }
      }
    }
    return seen;
  }
}

export interface PitResult {
  /** Indices (into the valued block array) of the blocks inside the ultimate pit. */
  inPit: Set<number>;
  totalValueUsd: number;
  oreTonnes: number;
  wasteTonnes: number;
  containedOz: number;
  recoveredOz: number;
  strippingRatio: number;
  blocksInPit: number;
}

/**
 * Ultimate pit = maximum-weight closure of the precedence graph, via min-cut.
 *
 * Guaranteed optimal for the given block values and slope — that is the property
 * Lerchs-Grossmann provides and a heuristic "shell" does not.
 */
export function optimizePit(
  blocks: ValuedBlock[],
  offsets: { di: number; dj: number; dk: number }[],
  domains: Record<string, DomainEconomics>,
  fallback: DomainEconomics,
): PitResult {
  const n = blocks.length;
  const S = n, T = n + 1;
  const mf = new MaxFlow(n + 2);

  const index = new Map<string, number>();
  for (let idx = 0; idx < n; idx++) index.set(`${blocks[idx].i},${blocks[idx].j},${blocks[idx].k}`, idx);

  let positiveSum = 0;
  for (let idx = 0; idx < n; idx++) {
    const v = blocks[idx].valueUsd;
    if (v > 0) { mf.addEdge(S, idx, v); positiveSum += v; }
    else if (v < 0) mf.addEdge(idx, T, -v);

    // Precedence: mining this block requires mining its slope cone above it.
    for (const o of offsets) {
      const above = index.get(`${blocks[idx].i + o.di},${blocks[idx].j + o.dj},${blocks[idx].k + o.dk}`);
      if (above !== undefined) mf.addEdge(idx, above, Infinity);
    }
  }

  const flow = mf.run(S, T);
  const reach = mf.minCutSourceSide(S);

  const inPit = new Set<number>();
  for (let idx = 0; idx < n; idx++) if (reach[idx]) inPit.add(idx);

  let oreTonnes = 0, wasteTonnes = 0, containedOz = 0, recoveredOz = 0, totalValueUsd = 0;
  for (const idx of inPit) {
    const b = blocks[idx];
    totalValueUsd += b.valueUsd;
    if (b.isOre) {
      oreTonnes += b.tonnes;
      const oz = (b.tonnes * b.auGt) / TROY_OZ_GRAMS;
      containedOz += oz;
      recoveredOz += oz * ((domains[b.canon] ?? fallback).recoveryPct / 100);
    } else {
      wasteTonnes += b.tonnes;
    }
  }

  return {
    inPit,
    // Max closure value = Σ positive values − maxflow. Reported directly from the
    // selected blocks too; the identity is asserted in the tests.
    totalValueUsd: positiveSum - flow,
    oreTonnes, wasteTonnes, containedOz, recoveredOz,
    strippingRatio: oreTonnes > 0 ? wasteTonnes / oreTonnes : 0,
    blocksInPit: inPit.size,
  };
}

// ─── Nested shells (Whittle-style price parameterisation) ────────────────────

export interface Shell {
  /** Revenue factor applied to the gold price for this shell. */
  revenueFactor: number;
  goldPriceUsdOz: number;
  result: PitResult;
}

/**
 * Nested pit shells: re-optimise at a ladder of revenue factors.
 *
 * Low factors reveal the high-value core that pays first — the shells become the
 * pushback sequence in the strategic plan (étape 3), which is exactly how a
 * Whittle-style analysis feeds scheduling.
 */
export function nestedShells(
  blocks: Block[],
  baseInputs: BlockValueInputs,
  offsets: { di: number; dj: number; dk: number }[],
  revenueFactors: number[],
): Shell[] {
  return revenueFactors.map(rf => {
    const inputs = { ...baseInputs, goldPriceUsdOz: baseInputs.goldPriceUsdOz * rf };
    const valued = valueBlocks(blocks, inputs);
    return {
      revenueFactor: rf,
      goldPriceUsdOz: inputs.goldPriceUsdOz,
      result: optimizePit(valued, offsets, inputs.domains, inputs.fallback),
    };
  });
}
