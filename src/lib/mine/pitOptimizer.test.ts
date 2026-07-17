import { describe, it, expect } from 'vitest';
import {
  valueBlocks, optimizePit, slopeConeOffsets, immediatePrecedenceOffsets, nestedShells,
  benchPrecedenceOffsets, elevationKUp, verticalise,
  type Block, type BlockValueInputs,
} from './pitOptimizer';

const DOMAINS = {
  oxide: { recoveryPct: 95.6, bwiKwhT: 11.9 },
  sulphide: { recoveryPct: 82.8, bwiKwhT: 17.1 },
};
const FALLBACK = { recoveryPct: 89, bwiKwhT: 15 };

const INP: BlockValueInputs = {
  goldPriceUsdOz: 2000,
  processCostExGrindUsdT: 12,
  miningCostUsdT: 2.8,
  gaCostUsdT: 1.8,
  royaltyFraction: 0.045,
  elecCostUsdKwh: 0.067,
  f80Um: 12000,
  p80Um: 75,
  domains: DOMAINS,
  fallback: FALLBACK,
};

function blk(i: number, j: number, k: number, auGt: number, canon = 'oxide'): Block {
  return { i, j, k, cz: k * 10, auGt, density: 2.7, volumeM3: 500, canon };
}

/** Brute force: every subset that is a valid closure, keep the best. */
function bruteForceMaxClosure(values: number[], preds: number[][]): number {
  const n = values.length;
  let best = 0; // the empty pit is always available
  for (let mask = 0; mask < (1 << n); mask++) {
    let valid = true;
    for (let b = 0; b < n && valid; b++) {
      if (!(mask & (1 << b))) continue;
      for (const p of preds[b]) if (!(mask & (1 << p))) { valid = false; break; }
    }
    if (!valid) continue;
    let v = 0;
    for (let b = 0; b < n; b++) if (mask & (1 << b)) v += values[b];
    if (v > best) best = v;
  }
  return best;
}

describe('valueBlocks', () => {
  it('prices a block on its own domain recovery and hardness', () => {
    const [ox, su] = valueBlocks([blk(0, 0, 0, 2.0, 'oxide'), blk(0, 0, 0, 2.0, 'sulphide')], INP);
    // Same grade, same tonnage — the sulphide recovers less and grinds harder.
    expect(ox.oreValueUsd).toBeGreaterThan(su.oreValueUsd);
  });

  it('treats barren rock as waste, not as negative-value ore', () => {
    const [b] = valueBlocks([blk(0, 0, 0, 0)], INP);
    expect(b.isOre).toBe(false);
    expect(b.valueUsd).toBe(b.wasteValueUsd);
    expect(b.valueUsd).toBeLessThan(0);
  });

  it('sends rich rock to the mill', () => {
    const [b] = valueBlocks([blk(0, 0, 0, 8)], INP);
    expect(b.isOre).toBe(true);
    expect(b.valueUsd).toBeGreaterThan(0);
  });

  it('waste value is exactly the mining cost, whatever the grade', () => {
    const [a, b] = valueBlocks([blk(0, 0, 0, 0), blk(0, 0, 0, 0.01)], INP);
    expect(a.wasteValueUsd).toBeCloseTo(b.wasteValueUsd, 9);
    expect(a.wasteValueUsd).toBeCloseTo(-(500 * 2.7 * 2.8), 6);
  });

  it('an unknown domain falls back rather than throwing', () => {
    const [b] = valueBlocks([blk(0, 0, 0, 3, 'saprolite')], INP);
    expect(Number.isFinite(b.valueUsd)).toBe(true);
  });
});

describe('slopeConeOffsets', () => {
  it('widens the cone as the slope gets shallower', () => {
    const steep = slopeConeOffsets(70, 10, 10, 10, 3);
    const shallow = slopeConeOffsets(35, 10, 10, 10, 3);
    expect(shallow.length).toBeGreaterThan(steep.length);
  });

  it('only ever points upward', () => {
    for (const o of slopeConeOffsets(45, 10, 10, 10, 4)) expect(o.dk).toBeGreaterThan(0);
  });

  it('reaches one block up at 45° with cubic blocks', () => {
    // tan(45°)=1 → reach = benchHeight = one block.
    const o = slopeConeOffsets(45, 10, 10, 10, 1);
    expect(o).toContainEqual({ di: 0, dj: 0, dk: 1 });
    expect(o).toContainEqual({ di: 1, dj: 0, dk: 1 });
  });
});

describe('optimizePit — optimality', () => {
  it('matches brute force on a small model', () => {
    // 4 columns × 3 benches. k=2 is surface, k=0 is deepest.
    const blocks: Block[] = [];
    const grades = [
      [0.1, 0.2, 0.1, 0.0], // k=2 (surface)
      [0.2, 6.0, 0.3, 0.1], // k=1
      [0.1, 9.0, 4.0, 0.2], // k=0 (deep, rich)
    ];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) blocks.push(blk(i, 0, k, grades[2 - k][i]));

    const offsets = slopeConeOffsets(45, 10, 10, 10, 2);
    const valued = valueBlocks(blocks, INP);

    // Same precedence the optimiser builds, for the brute-force reference.
    const idx = new Map(blocks.map((b, n) => [`${b.i},${b.j},${b.k}`, n]));
    const preds = blocks.map(b => offsets
      .map(o => idx.get(`${b.i + o.di},${b.j + o.dj},${b.k + o.dk}`))
      .filter((v): v is number => v !== undefined));

    const brute = bruteForceMaxClosure(valued.map(v => v.valueUsd), preds);
    const res = optimizePit(valued, offsets, DOMAINS, FALLBACK);
    expect(res.totalValueUsd).toBeCloseTo(brute, 4);
  });

  it('does not fabricate precedence on a single j-plane (numeric-key collision guard)', () => {
    // Regression: the numeric block index packed (i,j,k) into one integer. With a
    // single j-plane the j-span was 1, so a lookup for phantom (i, j=1) collided
    // with the real (i+1, j=0), inventing precedence arcs and under-mining. This
    // model is entirely at j=0 and must match brute force exactly.
    const blocks: Block[] = [];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 7; i++) blocks.push(blk(i, 0, k, k === 0 && i === 3 ? 8 : 0.15));
    const offsets = slopeConeOffsets(45, 10, 10, 10, 3);
    const valued = valueBlocks(blocks, INP);
    const idx = new Map(blocks.map((b, n) => [`${b.i},${b.j},${b.k}`, n]));
    const preds = blocks.map(b => offsets
      .map(o => idx.get(`${b.i + o.di},${b.j + o.dj},${b.k + o.dk}`))
      .filter((v): v is number => v !== undefined));
    expect(optimizePit(valued, offsets, DOMAINS, FALLBACK).totalValueUsd)
      .toBeCloseTo(bruteForceMaxClosure(valued.map(v => v.valueUsd), preds), 4);
  });

  it('nestedShells reuses the graph but gives the same pits as fresh solves', () => {
    // The build-once optimisation must not change results: each shell from
    // nestedShells must equal an independent optimizePit at the same price.
    const blocks: Block[] = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
      blocks.push(blk(i, j, k, k === 0 && i >= 2 && i <= 4 ? 5 : 0.2));
    }
    const offsets = slopeConeOffsets(45, 10, 10, 10, 2);
    const factors = [0.7, 1.0, 1.3];
    const shells = nestedShells(blocks, INP, offsets, factors);
    for (const s of shells) {
      const inputs = { ...INP, goldPriceUsdOz: INP.goldPriceUsdOz * s.revenueFactor };
      const fresh = optimizePit(valueBlocks(blocks, inputs), offsets, inputs.domains, inputs.fallback);
      expect(s.result.totalValueUsd).toBeCloseTo(fresh.totalValueUsd, 4);
      expect([...s.result.inPit].sort()).toEqual([...fresh.inPit].sort());
    }
  });

  it('respects slope precedence — nothing is mined from under an untouched roof', () => {
    const blocks: Block[] = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 5; i++) blocks.push(blk(i, 0, k, k === 0 && i === 2 ? 12 : 0.05));
    const offsets = slopeConeOffsets(45, 10, 10, 10, 2);
    const valued = valueBlocks(blocks, INP);
    const res = optimizePit(valued, offsets, DOMAINS, FALLBACK);

    const idx = new Map(blocks.map((b, n) => [`${b.i},${b.j},${b.k}`, n]));
    for (const n of res.inPit) {
      const b = blocks[n];
      for (const o of offsets) {
        const above = idx.get(`${b.i + o.di},${b.j + o.dj},${b.k + o.dk}`);
        if (above !== undefined) expect(res.inPit.has(above)).toBe(true);
      }
    }
  });

  it('leaves an entirely barren deposit unmined', () => {
    const blocks: Block[] = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) blocks.push(blk(i, 0, k, 0));
    const res = optimizePit(valueBlocks(blocks, INP), slopeConeOffsets(45, 10, 10, 10, 2), DOMAINS, FALLBACK);
    expect(res.blocksInPit).toBe(0);
    expect(res.totalValueUsd).toBeCloseTo(0, 6);
  });

  it('never returns a pit worth less than nothing', () => {
    const blocks: Block[] = [];
    for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) blocks.push(blk(i, 0, k, 0.3));
    const res = optimizePit(valueBlocks(blocks, INP), slopeConeOffsets(45, 10, 10, 10, 2), DOMAINS, FALLBACK);
    expect(res.totalValueUsd).toBeGreaterThanOrEqual(0);
  });

  it('mines a rich block at surface', () => {
    const res = optimizePit(valueBlocks([blk(0, 0, 0, 10)], INP), [], DOMAINS, FALLBACK);
    expect(res.blocksInPit).toBe(1);
    expect(res.oreTonnes).toBeGreaterThan(0);
  });

  it('abandons deep ore that cannot pay for its own stripping', () => {
    // One rich block under a very wide, very deep barren cone.
    const blocks: Block[] = [blk(10, 0, 0, 3)];
    for (let k = 1; k <= 6; k++) for (let i = 10 - k * 3; i <= 10 + k * 3; i++) blocks.push(blk(i, 0, k, 0));
    const offsets = slopeConeOffsets(20, 10, 10, 10, 6); // very shallow slope = huge cone
    const res = optimizePit(valueBlocks(blocks, INP), offsets, DOMAINS, FALLBACK);
    expect(res.inPit.has(0)).toBe(false);
  });

  it('reports recovered ounces below contained ounces', () => {
    const blocks = [blk(0, 0, 0, 5, 'sulphide')];
    const res = optimizePit(valueBlocks(blocks, INP), [], DOMAINS, FALLBACK);
    expect(res.recoveredOz).toBeLessThan(res.containedOz);
    expect(res.recoveredOz).toBeCloseTo(res.containedOz * 0.828, 6);
  });

  it('a steeper slope leaves more value — less waste to move', () => {
    const blocks: Block[] = [];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 9; i++) blocks.push(blk(i, 0, k, k === 0 && i === 4 ? 15 : 0.05));
    const steep = optimizePit(valueBlocks(blocks, INP), slopeConeOffsets(65, 10, 10, 10, 3), DOMAINS, FALLBACK);
    const shallow = optimizePit(valueBlocks(blocks, INP), slopeConeOffsets(30, 10, 10, 10, 3), DOMAINS, FALLBACK);
    expect(steep.totalValueUsd).toBeGreaterThanOrEqual(shallow.totalValueUsd);
  });

  it('geometallurgy changes the pit, not just its valuation', () => {
    // Identical grades; only the domain differs.
    const mk = (canon: string) => {
      const bs: Block[] = [];
      for (let k = 0; k < 3; k++) for (let i = 0; i < 5; i++) bs.push(blk(i, 0, k, k === 0 ? 1.1 : 0.05, canon));
      return bs;
    };
    const offsets = slopeConeOffsets(45, 10, 10, 10, 2);
    const ox = optimizePit(valueBlocks(mk('oxide'), INP), offsets, DOMAINS, FALLBACK);
    const su = optimizePit(valueBlocks(mk('sulphide'), INP), offsets, DOMAINS, FALLBACK);
    expect(ox.totalValueUsd).toBeGreaterThan(su.totalValueUsd);
  });
});

describe('immediatePrecedenceOffsets — transitivity', () => {
  it('is far smaller than the full cone', () => {
    const full = slopeConeOffsets(45, 8, 8, 10, 6);
    const imm = immediatePrecedenceOffsets(45, 8, 8, 10);
    expect(imm.length).toBeLessThan(full.length / 10);
  });

  it('only reaches the bench directly above', () => {
    for (const o of immediatePrecedenceOffsets(45, 8, 8, 10)) expect(o.dk).toBe(1);
  });

  it('yields the SAME pit as the full cone — the arcs are redundant, not the geometry', () => {
    // This is the claim the 90× speed-up rests on. If it were false, the fast path
    // would be a different (wrong) pit, not a faster one.
    const blocks: Block[] = [];
    for (let k = 0; k < 5; k++) {
      for (let i = 0; i < 11; i++) {
        for (let j = 0; j < 3; j++) {
          const rich = k === 0 && i >= 4 && i <= 6;
          blocks.push(blk(i, j, k, rich ? 7 : 0.15));
        }
      }
    }
    const full = optimizePit(valueBlocks(blocks, INP), slopeConeOffsets(45, 10, 10, 10, 4), DOMAINS, FALLBACK);
    const imm = optimizePit(valueBlocks(blocks, INP), immediatePrecedenceOffsets(45, 10, 10, 10), DOMAINS, FALLBACK);

    expect(imm.blocksInPit).toBe(full.blocksInPit);
    expect(imm.totalValueUsd).toBeCloseTo(full.totalValueUsd, 4);
    expect([...imm.inPit].sort()).toEqual([...full.inPit].sort());
  });

  it('does NOT hold at a shallow slope — the pattern quantises the slope to the grid', () => {
    // At 30° the true reach is 17.3 m per 10 m bench, but the pattern can only take
    // whole blocks and the ellipse test admits just the 10 m neighbours: the chained
    // cone comes out at 45°. It mines rock the real slope forbids, so it reports MORE
    // value than the true pit. This is why optimizePit is fed the full cone.
    const blocks: Block[] = [];
    for (let k = 0; k < 4; k++) for (let i = 0; i < 13; i++) blocks.push(blk(i, 0, k, k === 0 && i === 6 ? 20 : 0.1));
    const full = optimizePit(valueBlocks(blocks, INP), slopeConeOffsets(30, 10, 10, 10, 3), DOMAINS, FALLBACK);
    const imm = optimizePit(valueBlocks(blocks, INP), immediatePrecedenceOffsets(30, 10, 10, 10), DOMAINS, FALLBACK);

    expect(imm.totalValueUsd).toBeGreaterThan(full.totalValueUsd);
    expect([...imm.inPit].sort()).not.toEqual([...full.inPit].sort());
  });
});

describe('nestedShells', () => {
  const blocks: Block[] = [];
  for (let k = 0; k < 3; k++) for (let i = 0; i < 7; i++) blocks.push(blk(i, 0, k, k === 0 ? (i === 3 ? 9 : 1.2) : 0.1));
  const offsets = slopeConeOffsets(45, 10, 10, 10, 2);

  it('grows monotonically with the revenue factor', () => {
    const shells = nestedShells(blocks, INP, offsets, [0.5, 0.8, 1.0, 1.3]);
    for (let i = 1; i < shells.length; i++) {
      expect(shells[i].result.blocksInPit).toBeGreaterThanOrEqual(shells[i - 1].result.blocksInPit);
    }
  });

  it('nests — each shell contains the one below it', () => {
    // This is the property that makes shells usable as a pushback sequence.
    const shells = nestedShells(blocks, INP, offsets, [0.6, 1.0, 1.4]);
    for (let i = 1; i < shells.length; i++) {
      for (const b of shells[i - 1].result.inPit) expect(shells[i].result.inPit.has(b)).toBe(true);
    }
  });

  it('reports the price each shell was optimised at', () => {
    const shells = nestedShells(blocks, INP, offsets, [0.5, 1.0]);
    expect(shells[0].goldPriceUsdOz).toBeCloseTo(1000, 6);
    expect(shells[1].goldPriceUsdOz).toBeCloseTo(2000, 6);
  });
});

describe('benchPrecedenceOffsets & elevationKUp — surface-reaching precedence', () => {
  it('detects which k-direction is up from elevation', () => {
    expect(elevationKUp([{ k: 0, cz: 200 }, { k: 5, cz: 250 }])).toBe(1);   // k rises with cz
    expect(elevationKUp([{ k: 0, cz: 200 }, { k: 5, cz: 150 }])).toBe(-1);  // k opposes cz
  });

  it('orients arcs upward per kUp', () => {
    for (const o of benchPrecedenceOffsets(45, 10, 10, 10, 1)) expect(o.dk).toBe(1);
    for (const o of benchPrecedenceOffsets(45, 10, 10, 10, -1)) expect(o.dk).toBe(-1);
  });

  it('constrains a deep block all the way to the surface via transitivity', () => {
    // A single rich column under a barren overburden. With k increasing DOWNWARD
    // (k=0 surface), kUp must be -1 for precedence to point up. Mining the deep
    // block must pull the whole column to surface — no floating pit.
    const blocks: Block[] = [];
    const NK = 8;
    for (let k = 0; k < NK; k++) for (let i = 0; i < 9; i++) {
      blocks.push({ i, j: 0, k, cz: (NK - k) * 10, auGt: k === NK - 1 && i === 4 ? 40 : 0.05, density: 2.7, volumeM3: 1000, canon: 'oxide' });
    }
    const kUp = elevationKUp(blocks);
    expect(kUp).toBe(-1); // cz decreases as k increases
    const offsets = benchPrecedenceOffsets(45, 10, 10, 10, kUp);
    const res = optimizePit(valueBlocks(blocks, INP), offsets, DOMAINS, FALLBACK);

    // Every mined block must have its overlying cone mined too — up to the surface.
    const idx = new Map(blocks.map((b, n) => [`${b.i},${b.j},${b.k}`, n]));
    for (const n of res.inPit) {
      const b = blocks[n];
      for (const o of offsets) {
        const above = idx.get(`${b.i + o.di},${b.j + o.dj},${b.k + o.dk}`);
        if (above !== undefined) expect(res.inPit.has(above)).toBe(true);
      }
    }
    // The rich block is deep but worth 40 g/t — it must be reached.
    expect(res.inPit.has(idx.get('4,0,7')!)).toBe(true);
    // Its surface block (i=4,k=0) must be stripped.
    expect(res.inPit.has(idx.get('4,0,0')!)).toBe(true);
  });
})

describe('verticalise — precedence must not depend on the k convention', () => {
  it('re-indexes levels from elevation, lowest cz = level 0', () => {
    const blocks: Block[] = [
      { i: 0, j: 0, k: 0, cz: 100, auGt: 1, density: 2.7, volumeM3: 1000, canon: 'oxide' }, // top
      { i: 0, j: 0, k: 1, cz: 90, auGt: 1, density: 2.7, volumeM3: 1000, canon: 'oxide' },
      { i: 0, j: 0, k: 2, cz: 80, auGt: 1, density: 2.7, volumeM3: 1000, canon: 'oxide' }, // bottom
    ];
    const { blocks: v, benchDz } = verticalise(blocks);
    expect(benchDz).toBeCloseTo(10, 9);
    // k was numbered downward; after verticalise the deepest block is level 0.
    expect(v[2].k).toBe(0);
    expect(v[0].k).toBe(2);
  });

  it('infers bench spacing from the model, not from a configured value', () => {
    const blocks: Block[] = [0, 12.5, 25].map((cz, n) => (
      { i: 0, j: 0, k: n, cz, auGt: 1, density: 2.7, volumeM3: 1000, canon: 'oxide' }
    ));
    expect(verticalise(blocks).benchDz).toBeCloseTo(12.5, 9);
  });

  it('yields a bowl — not a full-footprint box — when k is numbered DOWNWARD', () => {
    // The exact convention that inverts precedence if k is trusted blindly:
    // k=0 is the surface, k grows downward, so cz DECREASES as k increases.
    // A central high-grade lens sits in barren rock. A correct pit is a bowl that
    // does not touch the model edges; inverted precedence would excavate whole
    // columns and mine the entire footprint.
    const NI = 21, NK = 8, czTop = 200;
    const blocks: Block[] = [];
    for (let k = 0; k < NK; k++) for (let i = 0; i < NI; i++) {
      const deep = k >= NK - 3;
      const central = Math.abs(i - 10) <= 2;
      blocks.push({
        i, j: 0, k,
        cz: czTop - k * 10,                 // k DOWN: cz falls as k rises
        auGt: deep && central ? 12 : 0.02,  // lens at depth, barren elsewhere
        density: 2.7, volumeM3: 1000, canon: 'oxide',
      });
    }
    const { blocks: v, benchDz } = verticalise(blocks);
    const offsets = benchPrecedenceOffsets(45, 10, 10, benchDz, 1);
    const res = optimizePit(valueBlocks(v, INP), offsets, DOMAINS, FALLBACK);

    const columnsMined = new Set([...res.inPit].map(n => v[n].i)).size;
    expect(res.blocksInPit).toBeGreaterThan(0);
    // A bowl touches only part of the footprint — never all 21 columns.
    expect(columnsMined).toBeLessThan(NI);
    // The lens must be reached, and its overburden stripped to surface.
    const at = (i: number, cz: number) => v.findIndex(b => b.i === i && Math.abs(b.cz - cz) < 1e-6);
    expect(res.inPit.has(at(10, czTop - (NK - 1) * 10))).toBe(true); // deepest lens block
    expect(res.inPit.has(at(10, czTop))).toBe(true);                 // its surface block
    // Barren rock far from the lens must be left alone.
    expect(res.inPit.has(at(0, czTop - (NK - 1) * 10))).toBe(false);
  });
})
