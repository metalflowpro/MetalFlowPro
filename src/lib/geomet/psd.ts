// ─────────────────────────────────────────────────────────────────────────────
// PSD analysis & lab-grind model — pure module (no Supabase, no React).
//
// Three responsibilities, all feeding the P80-optimisation tab:
//   1. p80FromPsd     — compute the P80 directly from a measured size
//                       distribution (log-linear interpolation), instead of
//                       trusting the lab-reported figure blindly.
//   2. grindProductP80 — first-order lab ball-mill model: grinding parameters
//                       (speed, ball charge, time) → applied specific energy
//                       (Bond basis) → predicted product P80.
//   3. grindRecommendations — given the economic optimal P80, say how to get
//                       there: required grind time at current settings, plus
//                       speed / charge advice when they sit off the efficient
//                       operating window.
// ─────────────────────────────────────────────────────────────────────────────

import { bondEnergy } from './p80';

export interface PsdPoint {
  /** Sieve size (µm). */
  sieve: number;
  /** Cumulative % passing at that sieve. */
  passing: number;
}

/**
 * P80 from a cumulative passing curve, by log-linear interpolation between the
 * two sieves bracketing 80 % passing (Gates-Gaudin-Schuhmann behaviour is
 * near-linear in log-size / passing over one bracket).
 *
 * Returns null when the curve cannot bracket 80 % (all finer → the top sieve is
 * only a lower bound; fewer than 2 valid points → no curve at all).
 */
export function p80FromPsd(points: PsdPoint[]): number | null {
  const pts = points
    .filter(p => p.sieve > 0 && Number.isFinite(p.passing))
    .sort((a, b) => a.sieve - b.sieve);
  if (pts.length < 2) return null;

  // Exact hit
  const exact = pts.find(p => p.passing === 80);
  if (exact) return exact.sieve;

  // Find the bracket [below 80, above 80] — passing increases with sieve size.
  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i], hi = pts[i + 1];
    if (lo.passing < 80 && hi.passing >= 80) {
      const f = (80 - lo.passing) / (hi.passing - lo.passing);
      return Math.exp(Math.log(lo.sieve) + f * (Math.log(hi.sieve) - Math.log(lo.sieve)));
    }
  }
  return null; // 80 % passing outside the measured range
}

/** Convert a LIMS PSD row (% retained per sieve) into a cumulative passing curve. */
export function passingCurveFromRetained(
  retained: { sieve: number; pct: number | null }[],
): PsdPoint[] {
  // Sort coarse → fine, accumulate retained, passing = 100 − cumulative retained.
  const sorted = [...retained]
    .filter(r => r.sieve > 0)
    .sort((a, b) => b.sieve - a.sieve);
  let cum = 0;
  const out: PsdPoint[] = [];
  for (const r of sorted) {
    cum += r.pct ?? 0;
    out.push({ sieve: r.sieve, passing: Math.max(0, Math.min(100, 100 - cum)) });
  }
  return out.reverse(); // fine → coarse
}

// ─── Lab ball-mill grind model ────────────────────────────────────────────────

export interface GrindParams {
  /** Mill speed as % of critical speed. */
  speedPctCritical: number;
  /** Ball charge, % of mill volume. */
  ballChargePct: number;
  /** Grind time (min). */
  timeMin: number;
}

/** Reference operating point the power model is normalised on. */
export const GRIND_REFERENCE = {
  /** % critical speed where grinding efficiency peaks (cataracting regime). */
  SPEED_PCT: 75,
  /** Ball charge (% vol) of the reference draw. */
  BALL_CHARGE_PCT: 35,
  /** Net specific power draw (kW/t) at the reference point — typical ball mill. */
  POWER_KW_T: 12,
  /** Efficient operating windows used by the recommendations. */
  SPEED_WINDOW: [70, 80] as [number, number],
  CHARGE_WINDOW: [30, 40] as [number, number],
} as const;

/**
 * Relative grinding efficiency vs mill speed (% critical).
 *
 * Parabolic around the cataracting optimum: too slow → cascading only (balls
 * roll, little impact); too fast → centrifuging (balls pinned to the shell).
 */
export function speedEfficiency(speedPctCritical: number): number {
  const s = Math.max(30, Math.min(100, speedPctCritical));
  const x = (s - GRIND_REFERENCE.SPEED_PCT) / 45; // half-width ≈ 45 pts
  return Math.max(0.05, 1 - x * x * 2.2);
}

/**
 * Net specific power draw (kW/t) from ball charge and speed.
 *
 * Power scales ~linearly with ball charge in the practical range; above ~45 %
 * the charge shoulders and the incremental media stops drawing useful power.
 */
export function specificPowerKwT(ballChargePct: number, speedPctCritical: number): number {
  const charge = Math.max(5, Math.min(45, ballChargePct));
  return GRIND_REFERENCE.POWER_KW_T * (charge / GRIND_REFERENCE.BALL_CHARGE_PCT) * speedEfficiency(speedPctCritical);
}

/** Specific energy (kWh/t) applied after `timeMin` minutes at these settings. */
export function appliedEnergyKwhT(params: GrindParams): number {
  return specificPowerKwT(params.ballChargePct, params.speedPctCritical) * (params.timeMin / 60);
}

/**
 * Predicted product P80 (µm) after a batch grind, by inverting Bond's third
 * theory: E = 10·Wi·(1/√P80 − 1/√F80)  ⇒  P80 = (E/(10·Wi) + 1/√F80)⁻².
 *
 * Lab basis (no EF5 / plant factor): this models the LAB mill the testwork ran
 * in; the plant correction stays where it belongs, in the optimal-P80 engine.
 */
export function grindProductP80(bwi: number, f80Um: number, params: GrindParams): number | null {
  if (bwi <= 0 || f80Um <= 0) return null;
  const e = appliedEnergyKwhT(params);
  const invSqrt = e / (10 * bwi) + 1 / Math.sqrt(f80Um);
  if (invSqrt <= 0) return null;
  const p80 = 1 / (invSqrt * invSqrt);
  return Math.min(p80, f80Um); // no grinding coarser than the feed
}

/** Grind time (min) required to reach `targetP80` at the given settings. */
export function timeToReachP80(
  bwi: number, f80Um: number, targetP80Um: number,
  speedPctCritical: number, ballChargePct: number,
): number | null {
  if (bwi <= 0 || f80Um <= 0 || targetP80Um <= 0 || targetP80Um >= f80Um) return null;
  const eNeeded = bondEnergy(bwi, f80Um, targetP80Um);
  const power = specificPowerKwT(ballChargePct, speedPctCritical);
  if (power <= 0) return null;
  return (eNeeded / power) * 60;
}

export interface GrindRecommendation {
  severity: 'info' | 'action';
  text: string;
}

/**
 * Actionable advice to reach the economic optimal P80 from the current settings.
 * Pure strings-out so the UI just renders; thresholds come from GRIND_REFERENCE.
 */
export function grindRecommendations(
  bwi: number, f80Um: number, optimalP80Um: number, params: GrindParams,
): GrindRecommendation[] {
  const recs: GrindRecommendation[] = [];
  const predicted = grindProductP80(bwi, f80Um, params);
  const [spLo, spHi] = GRIND_REFERENCE.SPEED_WINDOW;
  const [chLo, chHi] = GRIND_REFERENCE.CHARGE_WINDOW;

  if (params.speedPctCritical < spLo || params.speedPctCritical > spHi) {
    recs.push({
      severity: 'action',
      text: `Vitesse ${params.speedPctCritical} % de la critique — hors fenêtre efficace ${spLo}–${spHi} % : ` +
        (params.speedPctCritical < spLo
          ? 'régime en cascade, peu d\'impact ; augmenter la vitesse.'
          : 'risque de centrifugation ; réduire la vitesse.'),
    });
  }
  if (params.ballChargePct < chLo || params.ballChargePct > chHi) {
    recs.push({
      severity: 'action',
      text: `Charge de boulets ${params.ballChargePct} % vol — hors fenêtre ${chLo}–${chHi} % : ` +
        (params.ballChargePct < chLo
          ? 'puissance utile insuffisante ; ajouter des médias.'
          : 'épaulement de charge, kWh gaspillés ; retirer des médias.'),
    });
  }

  const tNeeded = timeToReachP80(bwi, f80Um, optimalP80Um, params.speedPctCritical, params.ballChargePct);
  if (tNeeded != null && predicted != null) {
    const delta = tNeeded - params.timeMin;
    if (Math.abs(delta) < 1) {
      recs.push({ severity: 'info', text: `Réglages actuels ≈ P80 optimal (${Math.round(optimalP80Um)} µm) — aucun ajustement de temps requis.` });
    } else if (delta > 0) {
      recs.push({ severity: 'action', text: `P80 prédit ${Math.round(predicted)} µm > optimum ${Math.round(optimalP80Um)} µm : prolonger le broyage de ~${Math.round(delta)} min (total ${Math.round(tNeeded)} min).` });
    } else {
      recs.push({ severity: 'action', text: `P80 prédit ${Math.round(predicted)} µm < optimum ${Math.round(optimalP80Um)} µm : sur-broyage — réduire de ~${Math.round(-delta)} min (total ${Math.round(tNeeded)} min).` });
    }
  }
  return recs;
}
