// ─────────────────────────────────────────────────────────────────────────────
// Mine-to-mill cut-off grade & hardness-derated throughput.
//
// What makes this different from a conventional mine planner (Whittle, Deswik,
// MineSight): those apply ONE metallurgical recovery and ONE fixed mill
// throughput to every block. Both are properties of the ore, not of the deposit
// as a whole — a soft, free-milling oxide and a hard, refractory sulphide do not
// pay for themselves at the same grade, and they do not go through the mill at
// the same rate.
//
// This module derives, per geometallurgical domain:
//   • the cut-off grade from that domain's OWN recovery and OWN grinding energy;
//   • the mill throughput its hardness actually allows.
//
// Pure functions — no Supabase, no React (see lib/geomet/domains for why).
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS } from '../config/constants';
import { bondEnergy } from '../geomet/p80';

/** Per-domain geometallurgical inputs the cut-off and throughput depend on. */
export interface DomainMetInputs {
  canon: string;
  label: string;
  /** Metallurgical recovery (%) for this domain. */
  recoveryPct: number;
  /** Bond ball work index (kWh/t) for this domain. */
  bwiKwhT: number;
  /** Share of mill feed (fraction 0–1). */
  feedShare: number;
}

export interface CutoffInputs {
  goldPriceUsdOz: number;
  /** Processing cost ($/t of ore) EXCLUDING the grinding energy this model prices per domain. */
  processCostExGrindUsdT: number;
  /** Mining cost ($/t moved). */
  miningCostUsdT: number;
  /** Stripping ratio (t waste per t ore) — only used by the breakeven cut-off. */
  strippingRatio: number;
  /** G&A ($/t of ore). */
  gaCostUsdT: number;
  /** Royalty + NSR as a fraction of revenue (0–1). */
  royaltyFraction: number;
  /** Electricity cost ($/kWh). */
  elecCostUsdKwh: number;
  /** Grind circuit F80 / P80 (µm) used to price grinding energy. */
  f80Um: number;
  p80Um: number;
}

export interface DomainCutoff extends DomainMetInputs {
  /** Grinding energy this domain needs (kWh/t). */
  grindEnergyKwhT: number;
  /** Processing cost including this domain's own grinding energy ($/t). */
  processCostUsdT: number;
  /** Revenue from one gramme of gold in this domain, net of royalties ($/g). */
  revenuePerGramUsd: number;
  /**
   * Marginal (internal) cut-off, g/t: the grade at which already-mined material
   * pays its own processing. Mining cost is sunk at this point, so it is excluded.
   */
  marginalCutoffGt: number;
  /**
   * Breakeven (external) cut-off, g/t: the grade at which material pays mining
   * (ore + its share of waste), processing and G&A. Drives the pit shell.
   */
  breakevenCutoffGt: number;
}

/**
 * Cut-off grade per geometallurgical domain.
 *
 * A domain that recovers less gold, or costs more to grind, must carry more
 * grade to break even. Applying a single deposit-wide cut-off — the industry
 * default — sends sub-marginal hard ore to the mill and sends payable soft ore
 * to waste.
 */
export function domainCutoffs(domains: DomainMetInputs[], inp: CutoffInputs): DomainCutoff[] {
  return domains.map(d => {
    const grindEnergyKwhT = bondEnergy(d.bwiKwhT, inp.f80Um, inp.p80Um);
    const processCostUsdT = inp.processCostExGrindUsdT + grindEnergyKwhT * inp.elecCostUsdKwh;

    // $/g of contained gold, after recovery losses and royalties.
    const revenuePerGramUsd =
      (inp.goldPriceUsdOz / TROY_OZ_GRAMS) * (d.recoveryPct / 100) * (1 - inp.royaltyFraction);

    const safe = (cost: number) => (revenuePerGramUsd > 1e-9 ? cost / revenuePerGramUsd : Infinity);

    return {
      ...d,
      grindEnergyKwhT,
      processCostUsdT,
      revenuePerGramUsd,
      marginalCutoffGt: safe(processCostUsdT),
      breakevenCutoffGt: safe(
        processCostUsdT + inp.gaCostUsdT + inp.miningCostUsdT * (1 + inp.strippingRatio),
      ),
    };
  });
}

/** Feed-share-weighted cut-off across domains — the deposit-wide equivalent. */
export function blendedCutoff(cuts: DomainCutoff[], key: 'marginalCutoffGt' | 'breakevenCutoffGt'): number | null {
  const total = cuts.reduce((s, c) => s + c.feedShare, 0);
  if (total <= 0 || !cuts.length) return null;
  return cuts.reduce((s, c) => s + c[key] * (c.feedShare / total), 0);
}

/**
 * Mill throughput a given ore hardness actually allows (t/h).
 *
 * A comminution circuit is power-limited, not tonnage-limited: installed power
 * is fixed, so specific energy (kWh/t) and throughput trade off directly —
 * tph = installedPower / W. Harder ore therefore slows the mill.
 *
 * Conventional mine schedules hold tph constant for the life of mine and let the
 * blend vary freely, which silently over-states production in the sulphide-heavy
 * years. `bwiReference` is the hardness the nameplate tph was rated at.
 */
export function throughputForHardness(
  nameplateTph: number,
  bwiReference: number,
  bwiActual: number,
  f80Um: number,
  p80Um: number,
): number {
  const wRef = bondEnergy(bwiReference, f80Um, p80Um);
  const wActual = bondEnergy(bwiActual, f80Um, p80Um);
  if (wRef <= 0 || wActual <= 0) return nameplateTph;
  return nameplateTph * (wRef / wActual);
}

/** Feed-share-weighted mean of a per-domain property. */
export function blendedProperty(domains: DomainMetInputs[], pick: (d: DomainMetInputs) => number): number | null {
  const total = domains.reduce((s, d) => s + d.feedShare, 0);
  if (total <= 0 || !domains.length) return null;
  return domains.reduce((s, d) => s + pick(d) * (d.feedShare / total), 0);
}
