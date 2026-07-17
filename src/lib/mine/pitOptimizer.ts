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
import { plantGrindEnergy } from '../geomet/p80';

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
  /** Plant/lab grinding factor (Wio/Wi); defaults to the documented value. */
  plantFactor?: number;
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

    const grindKwhT = plantGrindEnergy(met.bwiKwhT, inp.f80Um, inp.p80Um, inp.plantFactor);
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
 * Precedence arcs to the bench IMMEDIATELY above.
 *
 * Tempting as a shortcut — precedence is transitive, so chaining one-bench arcs
 * builds a cone with ~90× fewer arcs (5 offsets/block instead of 450 on a real
 * 35 280-block model at 45°).
 *
 * ⚠️ But it is NOT equivalent, and the tests prove it. The pattern can only reach
 * whole blocks, so the effective slope is quantised to the grid: at 30° with 10 m
 * blocks and a 10 m bench the true reach is 17.3 m per bench, yet the ellipse test
 * admits only the 10 m neighbours — the chained cone comes out at 45°, steeper
 * than asked, and mines rock the real slope forbids. It matched at 45° purely
 * because reach happened to equal one block there.
 *
 * Use it only when `benchHeight / tan(slope)` is an exact multiple of the block
 * size. `optimizePit` is fed the full cone precisely so the slope is honoured;
 * the cost of that is paid by running the solve off the UI thread instead.
 */
export function immediatePrecedenceOffsets(
  slopeAngleDeg: number,
  blockSizeX: number,
  blockSizeY: number,
  benchHeight: number,
): { di: number; dj: number; dk: number }[] {
  return slopeConeOffsets(slopeAngleDeg, blockSizeX, blockSizeY, benchHeight, 1);
}

/**
 * Blocks that must be removed above a given block for a slope angle to hold.
 *
 * Offsets are generated once for the whole model: at a slope of θ, reaching one
 * bench higher lets the cone widen by benchHeight / tan(θ) horizontally.
 *
 * Prefer `immediatePrecedenceOffsets` for real models — see why above.
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

// ─── Numeric block index ─────────────────────────────────────────────────────

/**
 * Map (i,j,k) → block index using a single integer key.
 *
 * The previous version keyed the precedence lookup on the string `"i,j,k"`. On a
 * 35 280-block model that is ~15.9 M string allocations per shell, ×9 shells =
 * 143 M — the dominant cost, almost all of it garbage-collection pressure. A
 * numeric key allocates nothing and hashes far faster.
 */
function buildIndex(
  blocks: { i: number; j: number; k: number }[],
  offsets: { di: number; dj: number; dk: number }[],
) {
  let iMin = Infinity, jMin = Infinity, jMax = -Infinity, kMin = Infinity, kMax = -Infinity;
  for (const b of blocks) {
    if (b.i < iMin) iMin = b.i;
    if (b.j < jMin) jMin = b.j; if (b.j > jMax) jMax = b.j;
    if (b.k < kMin) kMin = b.k; if (b.k > kMax) kMax = b.k;
  }

  // The key must stay injective over every coordinate we LOOK UP, not just the
  // ones we store — precedence looks up (i+di, j+dj, k+dk). If the spans covered
  // only the stored range, a lookup for a phantom (i, j=1) could collide with a
  // real (i+1, j=0) when the data has a single j-plane, fabricating precedence
  // arcs. Padding each span by the offset reach guarantees no collision.
  let mDj = 0, mDk = 0;
  for (const o of offsets) {
    const aj = Math.abs(o.dj); if (aj > mDj) mDj = aj;
    const ak = Math.abs(o.dk); if (ak > mDk) mDk = ak;
  }
  const jLo = jMin - mDj, kLo = kMin - mDk;
  const njSpan = (jMax + mDj) - jLo + 1;
  const nkSpan = (kMax + mDk) - kLo + 1;
  const key = (i: number, j: number, k: number) => ((i - iMin) * njSpan + (j - jLo)) * nkSpan + (k - kLo);
  const map = new Map<number, number>();
  for (let idx = 0; idx < blocks.length; idx++) map.set(key(blocks[idx].i, blocks[idx].j, blocks[idx].k), idx);
  return { map, key };
}

// ─── Reusable pit solver (Dinic max-flow / min-cut) ──────────────────────────

/**
 * Builds the precedence graph ONCE and re-solves it for many block-value sets.
 *
 * Nested shells differ only in block VALUES (the source/sink capacities); the
 * precedence arcs depend on geometry alone and are identical across all shells.
 * The old code rebuilt the entire 15.9 M-arc graph for each of the nine shells;
 * this builds it once and, per shell, only resets capacities and re-runs the
 * flow. Combined with the numeric index, that is the bulk of the speed-up.
 *
 * Dinic's algorithm (over Ford-Fulkerson) because the precedence arcs are
 * infinite-capacity, which augmenting-path methods handle badly. Augmenting
 * paths here are short — S → block → (a few benches up) → block → T — so the
 * recursive DFS never approaches a stack limit.
 */
class PitSolver {
  private readonly n: number;
  private readonly S: number;
  private readonly T: number;
  private readonly nNodes: number;
  private readonly to: Int32Array;
  private readonly nxt: Int32Array;
  private readonly head: Int32Array;
  private readonly cap: Float64Array;
  private readonly capBase: Float64Array;   // pristine capacities, restored per solve
  private readonly sEdge: Int32Array;       // forward edge S→block, per block
  private readonly tEdge: Int32Array;       // forward edge block→T, per block
  private readonly level: Int32Array;
  private readonly iter: Int32Array;

  constructor(blocks: { i: number; j: number; k: number }[], offsets: { di: number; dj: number; dk: number }[]) {
    const n = blocks.length;
    this.n = n; this.S = n; this.T = n + 1; this.nNodes = n + 2;
    const head = new Int32Array(n + 2).fill(-1);
    const toA: number[] = [], capA: number[] = [], nxtA: number[] = [];
    const addEdge = (u: number, v: number, c: number) => {
      toA.push(v); capA.push(c); nxtA.push(head[u]); head[u] = toA.length - 1;
      toA.push(u); capA.push(0); nxtA.push(head[v]); head[v] = toA.length - 1;
    };

    const { map, key } = buildIndex(blocks, offsets);
    // Precedence arcs (built once, shared by every shell).
    for (let idx = 0; idx < n; idx++) {
      const b = blocks[idx];
      for (const o of offsets) {
        const above = map.get(key(b.i + o.di, b.j + o.dj, b.k + o.dk));
        if (above !== undefined) addEdge(idx, above, Infinity);
      }
    }
    // Pre-allocated source/sink slots — their capacities are set per shell.
    const sEdge = new Int32Array(n), tEdge = new Int32Array(n);
    for (let idx = 0; idx < n; idx++) {
      sEdge[idx] = toA.length; addEdge(this.S, idx, 0);
      tEdge[idx] = toA.length; addEdge(idx, this.T, 0);
    }

    this.to = Int32Array.from(toA);
    this.nxt = Int32Array.from(nxtA);
    this.head = head;
    this.cap = Float64Array.from(capA);
    this.capBase = this.cap.slice();
    this.sEdge = sEdge; this.tEdge = tEdge;
    this.level = new Int32Array(n + 2);
    this.iter = new Int32Array(n + 2);
  }

  private bfs(): boolean {
    this.level.fill(-1);
    const q = new Int32Array(this.nNodes);
    let qh = 0, qt = 0;
    this.level[this.S] = 0; q[qt++] = this.S;
    while (qh < qt) {
      const u = q[qh++];
      for (let e = this.head[u]; e !== -1; e = this.nxt[e]) {
        if (this.cap[e] > 1e-9 && this.level[this.to[e]] < 0) {
          this.level[this.to[e]] = this.level[u] + 1;
          q[qt++] = this.to[e];
        }
      }
    }
    return this.level[this.T] >= 0;
  }

  private dfs(u: number, f: number): number {
    if (u === this.T) return f;
    for (let e = this.iter[u]; e !== -1; e = this.nxt[e]) {
      this.iter[u] = e;
      const v = this.to[e];
      if (this.cap[e] > 1e-9 && this.level[v] === this.level[u] + 1) {
        const d = this.dfs(v, Math.min(f, this.cap[e]));
        if (d > 1e-9) { this.cap[e] -= d; this.cap[e ^ 1] += d; return d; }
      }
    }
    this.iter[u] = -1;
    return 0;
  }

  /** Solve for one set of block values; returns the maximum closure. */
  solve(values: ArrayLike<number>): { reach: Uint8Array; positiveSum: number; flow: number } {
    this.cap.set(this.capBase);
    let positiveSum = 0;
    for (let idx = 0; idx < this.n; idx++) {
      const v = values[idx];
      if (v > 0) { this.cap[this.sEdge[idx]] = v; positiveSum += v; }
      else if (v < 0) { this.cap[this.tEdge[idx]] = -v; }
    }

    let flow = 0;
    while (this.bfs()) {
      for (let i = 0; i < this.nNodes; i++) this.iter[i] = this.head[i];
      let f: number;
      while ((f = this.dfs(this.S, Infinity)) > 1e-9) flow += f;
    }

    // Nodes reachable from S in the residual graph = the maximum closure.
    const reach = new Uint8Array(this.nNodes);
    const stack = [this.S]; reach[this.S] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = this.head[u]; e !== -1; e = this.nxt[e]) {
        if (this.cap[e] > 1e-9 && !reach[this.to[e]]) { reach[this.to[e]] = 1; stack.push(this.to[e]); }
      }
    }
    return { reach, positiveSum, flow };
  }
}

/** Aggregate a solved closure into a PitResult. */
function aggregatePit(
  blocks: ValuedBlock[],
  reach: Uint8Array,
  positiveSum: number,
  flow: number,
  domains: Record<string, DomainEconomics>,
  fallback: DomainEconomics,
): PitResult {
  const inPit = new Set<number>();
  let oreTonnes = 0, wasteTonnes = 0, containedOz = 0, recoveredOz = 0;
  for (let idx = 0; idx < blocks.length; idx++) {
    if (!reach[idx]) continue;
    inPit.add(idx);
    const b = blocks[idx];
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
    totalValueUsd: positiveSum - flow,
    oreTonnes, wasteTonnes, containedOz, recoveredOz,
    strippingRatio: oreTonnes > 0 ? wasteTonnes / oreTonnes : 0,
    blocksInPit: inPit.size,
  };
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
  const solver = new PitSolver(blocks, offsets);
  const values = new Float64Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) values[i] = blocks[i].valueUsd;
  const { reach, positiveSum, flow } = solver.solve(values);
  return aggregatePit(blocks, reach, positiveSum, flow, domains, fallback);
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
  onShell?: (done: number, total: number) => void,
): Shell[] {
  // Build the precedence graph exactly once; every shell re-solves it with new
  // block values. This is the change that makes nine shells affordable.
  const solver = new PitSolver(blocks, offsets);
  const values = new Float64Array(blocks.length);
  return revenueFactors.map((rf, i) => {
    const inputs = { ...baseInputs, goldPriceUsdOz: baseInputs.goldPriceUsdOz * rf };
    const valued = valueBlocks(blocks, inputs);
    for (let n = 0; n < valued.length; n++) values[n] = valued[n].valueUsd;
    const { reach, positiveSum, flow } = solver.solve(values);
    onShell?.(i + 1, revenueFactors.length);
    return {
      revenueFactor: rf,
      goldPriceUsdOz: inputs.goldPriceUsdOz,
      result: aggregatePit(valued, reach, positiveSum, flow, inputs.domains, inputs.fallback),
    };
  });
}

/**
 * Precedence template for open-pit optimisation: a SINGLE bench of arcs pointing
 * toward the surface, whose horizontal reach = benchHeight / tan(slope).
 *
 * Transitivity does the rest — chaining one-bench arcs reproduces the full cone
 * all the way to the surface. This is the standard, tractable method:
 *
 *  - A full multi-bench cone truncated at N levels does NOT reach the surface for
 *    a pit deeper than N benches, so it permits invalid "floating" pits. Making
 *    it reach the surface needs one level per bench (~20 on a real model), which
 *    is ~450 arcs/block — intractable in a browser.
 *  - The one-bench pattern is ~5–9 arcs/block: hundreds of times fewer arcs, and
 *    it constrains depth correctly.
 *
 * The trade-off is that the slope is quantised to the block grid (as it is in any
 * block-model optimiser). `kUp` is +1 when higher k means higher elevation, −1
 * otherwise, so the arcs always point up regardless of the model's k convention.
 */
export function benchPrecedenceOffsets(
  slopeAngleDeg: number,
  blockSizeX: number,
  blockSizeY: number,
  benchHeight: number,
  kUp: 1 | -1,
): { di: number; dj: number; dk: number }[] {
  return slopeConeOffsets(slopeAngleDeg, blockSizeX, blockSizeY, benchHeight, 1)
    .map(o => ({ di: o.di, dj: o.dj, dk: o.dk * kUp }));
}

/**
 * Which k-direction points toward the surface (higher elevation cz).
 *
 * Returns +1 when k and cz rise together, −1 when they oppose. Kept for callers
 * that must reason about an existing k axis; `verticalise` is the safer route.
 */
export function elevationKUp(blocks: { k: number; cz: number }[]): 1 | -1 {
  let kMin = Infinity, kMax = -Infinity, czAtMin = 0, czAtMax = 0;
  for (const b of blocks) {
    if (b.k < kMin) { kMin = b.k; czAtMin = b.cz; }
    if (b.k > kMax) { kMax = b.k; czAtMax = b.cz; }
  }
  return czAtMax >= czAtMin ? 1 : -1;
}

/**
 * Re-index blocks vertically from their ELEVATION, so precedence never depends on
 * the model's k convention.
 *
 * `k` is only a layer label: some models number it upward, some downward. Guessing
 * wrong inverts precedence — a block then "requires" the rock beneath it, so
 * reaching surface ore means excavating the whole column downward, and the result
 * is a full-footprint flat-bottomed box instead of a pit.
 *
 * After this, level 0 is the lowest bench and dk = +1 is always "toward surface",
 * by construction. `benchDz` is the model's real bench spacing, which the cone
 * reach must use — a configured bench height that disagrees would mis-shape the slope.
 */
export function verticalise(blocks: Block[]): { blocks: Block[]; benchDz: number } {
  const czs = [...new Set(blocks.map(b => b.cz))].sort((a, b) => a - b);
  let dz = Infinity;
  for (let i = 1; i < czs.length; i++) {
    const d = czs[i] - czs[i - 1];
    if (d > 1e-6 && d < dz) dz = d;
  }
  if (!Number.isFinite(dz) || dz <= 0) dz = 1;
  const base = czs[0] ?? 0;
  return {
    blocks: blocks.map(b => ({ ...b, k: Math.round((b.cz - base) / dz) })),
    benchDz: dz,
  };
}
