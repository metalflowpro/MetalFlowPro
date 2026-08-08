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
/**
 * Détail du calcul du P80 — la MÊME interpolation que `p80FromPsd`, mais qui
 * restitue son cheminement au lieu du seul résultat.
 *
 * Sert à afficher à l'écran d'où vient le chiffre : sur un livrable NI 43-101,
 * un P80 qu'on ne sait pas justifier n'a pas de valeur. Les deux fonctions
 * partagent la même implémentation (voir `p80FromPsd`) pour qu'un chiffre
 * affiché et le chiffre calculé ne puissent jamais différer.
 */
export interface P80Interpolation {
  /**
   * • `exact` — un tamis tombe pile à 80 % passant, aucune interpolation.
   * • `log_interpolation` — 80 % encadré par deux tamis, interpolation log-linéaire.
   * • `out_of_range` — la courbe n'encadre pas 80 % (tout plus fin ou plus grossier).
   * • `insufficient_data` — moins de deux points valides.
   */
  method: 'exact' | 'log_interpolation' | 'out_of_range' | 'insufficient_data';
  p80Um: number | null;
  /** Tamis encadrant inférieur (passant < 80 %), null hors interpolation. */
  lower: PsdPoint | null;
  /** Tamis encadrant supérieur (passant ≥ 80 %), null hors interpolation. */
  upper: PsdPoint | null;
  /** Fraction f = (80 − passant_inf) / (passant_sup − passant_inf), dans [0,1]. */
  fraction: number | null;
  /** Courbe nettoyée et triée effectivement utilisée. */
  curve: PsdPoint[];
}

/**
 * P80 avec le détail du calcul (tamis encadrants, fraction interpolée).
 * Voir `p80FromPsd` pour la formule ; cette variante expose le raisonnement.
 */
export function p80Interpolation(points: PsdPoint[]): P80Interpolation {
  const pts = points
    .filter(p => p.sieve > 0 && Number.isFinite(p.passing))
    .sort((a, b) => a.sieve - b.sieve);

  if (pts.length < 2) {
    return { method: 'insufficient_data', p80Um: null, lower: null, upper: null, fraction: null, curve: pts };
  }

  const exact = pts.find(p => p.passing === 80);
  if (exact) {
    return { method: 'exact', p80Um: exact.sieve, lower: null, upper: null, fraction: null, curve: pts };
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i], hi = pts[i + 1];
    if (lo.passing < 80 && hi.passing >= 80) {
      const f = (80 - lo.passing) / (hi.passing - lo.passing);
      const p80 = Math.exp(Math.log(lo.sieve) + f * (Math.log(hi.sieve) - Math.log(lo.sieve)));
      return { method: 'log_interpolation', p80Um: p80, lower: lo, upper: hi, fraction: f, curve: pts };
    }
  }

  return { method: 'out_of_range', p80Um: null, lower: null, upper: null, fraction: null, curve: pts };
}

export function p80FromPsd(points: PsdPoint[]): number | null {
  // Délègue à `p80Interpolation` : UNE seule implémentation de l'interpolation,
  // pour que le P80 calculé et le P80 dont l'écran montre le cheminement soient
  // le même nombre par construction.
  return p80Interpolation(points).p80Um;
}

/**
 * Convert LIMS sieve fractions retained per size band into a cumulative passing
 * curve. `+500`, `+212`, … are distinct retained bands, not cumulative oversize.
 */
export function passingCurveFromRetained(
  retained: { sieve: number; pct: number | null }[],
): PsdPoint[] {
  // Sort coarse → fine, accumulate retained, passing = 100 − cumulative retained.
  const sorted = [...retained]
    .filter(r => r.sieve > 0 && r.pct != null && Number.isFinite(r.pct))
    .sort((a, b) => b.sieve - a.sieve);
  let cumulativeRetained = 0;
  const out: PsdPoint[] = [];
  for (const r of sorted) {
    cumulativeRetained += r.pct as number;
    out.push({
      sieve: r.sieve,
      passing: Math.max(0, Math.min(100, 100 - cumulativeRetained)),
    });
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

// ─── Rosin-Rammler distribution fit ───────────────────────────────────────────

export interface RosinRammlerFit {
  /** Size modulus (µm) — the 63.2 % passing size. */
  x63: number;
  /** Uniformity exponent (steepness of the curve). */
  n: number;
  /** R² of the linear fit in log-log space. */
  rSquared: number;
}

/**
 * Fit a Rosin-Rammler (Weibull) distribution to a cumulative passing curve.
 *
 * R(x) = exp(−(x / x63)^n)  →  ln(−ln(R)) = n · ln(x) − n · ln(x63)
 *
 * Linear regression in log-log space recovers n (slope) and x63 (from intercept).
 * This is the standard comminution PSD model — a good fit confirms the data
 * follows a ground-ore distribution, and deviations flag screening/misclassification.
 */
export function fitRosinRammler(points: PsdPoint[]): RosinRammlerFit | null {
  const valid = points
    .filter(p => p.sieve > 0 && p.passing > 0 && p.passing < 100)
    .sort((a, b) => a.sieve - b.sieve);
  if (valid.length < 3) return null;

  // y = ln(-ln(1 - passing/100)), x = ln(sieve)
  const xs = valid.map(p => Math.log(p.sieve));
  const ys = valid.map(p => Math.log(-Math.log(1 - p.passing / 100)));

  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = my - slope * mx;

  // R²
  const preds = xs.map(x => slope * x + intercept);
  const ssRes = preds.reduce((s, p, i) => s + (ys[i] - p) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // x63 = exp(-intercept / slope)
  if (slope <= 0) return null;
  const x63 = Math.exp(-intercept / slope);

  return { x63, n: slope, rSquared: r2 };
}

/** Predicted % passing at size x from a Rosin-Rammler fit. */
export function rrPassingAt(fit: RosinRammlerFit, sizeUm: number): number {
  return 100 * (1 - Math.exp(-Math.pow(sizeUm / fit.x63, fit.n)));
}

/** Predicted P80 (µm) from a Rosin-Rammler fit: x80 = x63 · (−ln(0.2))^(1/n). */
export function rrP80(fit: RosinRammlerFit): number {
  return fit.x63 * Math.pow(-Math.log(0.2), 1 / fit.n);
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
