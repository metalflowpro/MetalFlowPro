// ─────────────────────────────────────────────────────────────────────────────
// Déportation de l'or & récupération limitée par la libération — module PUR.
//
// Le moteur P80 existant (p80Optimization) utilise une courbe de récupération
// GÉNÉRIQUE (`recoveryAtP80`). Or la récupération de l'or n'est pas limitée par
// l'énergie de broyage mais par la LIBÉRATION : broyer sous le seuil où l'or est
// déjà accessible brûle des kWh sans gain. Ce module remplace l'heuristique par
// un modèle mécaniste ancré sur la donnée LIMS la plus riche — la déportation de
// l'or par classe minéralogique (essai de libération) — et en dérive :
//
//   1. la fraction d'or ACCESSIBLE à la cyanuration en fonction du P80 ;
//   2. la courbe récupération-vs-P80 propre à l'échantillon/domaine ;
//   3. le P80 DE LIBÉRATION : le grind au-delà duquel le gain marginal de
//      récupération par kWh tombe sous un seuil économique (⇒ sur-broyage).
//
// Aucune dépendance Supabase/React. Entièrement testable.
// Voir aussi src/lib/analytics/recoveryBalance.ts (bilan mécaniste, consomme ce
// module) et src/lib/geomet/p80.ts (énergie de Bond).
// ─────────────────────────────────────────────────────────────────────────────

import { bondEnergy } from './p80';

/**
 * Déportation de l'or par classe de récupérabilité, en % de l'or total, telle
 * que MESURÉE par l'essai de libération à son grind de référence `p80RefUm`.
 * Les six classes somment à ~100 % (renormalisées par `normalizeDeportment`).
 */
export interface GoldDeportment {
  /** Or natif libéré — directement cyanurable / gravitaire. */
  free: number;
  /** Or inclus dans les sulfures (pyrite/arsénopyrite) — fine dissémination. */
  sulphide: number;
  /** Or inclus dans les silicates / gangue (quartz) — se libère au broyage. */
  silicate: number;
  /** Or associé aux oxydes de fer — souvent poreux, cyanure-accessible. */
  oxide: number;
  /** Or totalement occlus — réfractaire, perdu sans oxydation chimique. */
  occluded: number;
  /** Or sujet au preg-robbing — se relargue puis se réadsorbe sur le carbone. */
  pregRob: number;
}

/**
 * Récupérabilité d'une classe LOCKED (sulfure/silicate/oxyde) en fonction du
 * broyage : combien de son or devient accessible en broyant plus fin.
 *
 *   gain(P80) = maxLiberable · (1 − exp(−rate · max(0, P80ref/P80 − 1)))
 *
 * • À P80 = P80ref → gain 0 (état mesuré). • Broyer plus fin (P80 < P80ref) →
 * gain croît vers `maxLiberable` (asymptote SANS oxydation chimique).
 */
export interface ClassLiberation {
  /** Fraction asymptotique libérable par broyage seul (0–1). */
  maxLiberable: number;
  /** Vitesse d'approche de l'asymptote quand le P80 diminue. */
  rate: number;
}

export interface DeportmentModel {
  sulphide: ClassLiberation;
  silicate: ClassLiberation;
  oxide: ClassLiberation;
  /** Efficacité intrinsèque de cyanuration de l'or accessible (0–1). */
  cnEfficiency: number;
  /** Efficacité du circuit gravimétrique appliquée au GRG (0–1). */
  gravityEfficiency: number;
}

/**
 * Défauts métallurgiques conservateurs et transparents (ajustables par
 * l'ingénieur). Silicates : gangue grossière, se libère vite et presque
 * complètement. Sulfures : or finement disséminé, libération lente et plafonnée
 * (un broyage seul ne libère jamais tout — d'où l'oxydation). Oxydes : poreux,
 * largement accessibles au cyanure même mal libérés.
 */
export const DEFAULT_DEPORTMENT_MODEL: DeportmentModel = {
  silicate: { maxLiberable: 0.90, rate: 1.4 },
  sulphide: { maxLiberable: 0.55, rate: 0.7 },
  oxide:    { maxLiberable: 0.85, rate: 1.1 },
  cnEfficiency: 0.98,
  gravityEfficiency: 0.90,
};

/** Carbone organique (%) au-delà duquel le preg-robbing est pleinement sévère. */
export const PREG_ROB_C_ORG_FULL = 0.5;

/**
 * Nettoie et renormalise une déportation à 100 %. Les nulls deviennent 0. Si la
 * somme est nulle, renvoie null (pas d'essai de libération exploitable).
 */
export function normalizeDeportment(raw: { [K in keyof GoldDeportment]?: number | null }): GoldDeportment | null {
  const v = (x: number | null | undefined) => (x != null && Number.isFinite(x) && x > 0 ? x : 0);
  const d: GoldDeportment = {
    free: v(raw.free), sulphide: v(raw.sulphide), silicate: v(raw.silicate),
    oxide: v(raw.oxide), occluded: v(raw.occluded), pregRob: v(raw.pregRob),
  };
  const sum = d.free + d.sulphide + d.silicate + d.oxide + d.occluded + d.pregRob;
  if (sum <= 0) return null;
  const k = 100 / sum;
  return {
    free: d.free * k, sulphide: d.sulphide * k, silicate: d.silicate * k,
    oxide: d.oxide * k, occluded: d.occluded * k, pregRob: d.pregRob * k,
  };
}

/** Gain de libération d'une classe locked à un P80 donné (fraction 0–1). */
export function liberationGain(cls: ClassLiberation, p80Um: number, p80RefUm: number): number {
  if (p80Um <= 0 || p80RefUm <= 0) return 0;
  const finer = Math.max(0, p80RefUm / p80Um - 1); // >0 si on broie plus fin que la réf.
  return cls.maxLiberable * (1 - Math.exp(-cls.rate * finer));
}

export interface DeportmentInputs {
  /** P80 (µm) de l'essai de libération qui a produit la déportation. */
  p80RefUm: number;
  /** Or gravitaire récupérable (GRG, %) — essai Knelson/E-GRG. Optionnel. */
  grgPct?: number | null;
  /** Carbone organique (%) — amplifie la perte preg-robbing. Optionnel. */
  cOrgPct?: number | null;
  model?: DeportmentModel;
}

/** Fraction d'or ACCESSIBLE (%) à la cyanuration à un P80 donné, par classe. */
export function accessibleByClass(
  dep: GoldDeportment, p80Um: number, inp: DeportmentInputs,
): { free: number; sulphide: number; silicate: number; oxide: number; total: number } {
  const m = inp.model ?? DEFAULT_DEPORTMENT_MODEL;
  const free = dep.free; // déjà libéré : accessible quel que soit le grind
  const sulphide = dep.sulphide * liberationGain(m.sulphide, p80Um, inp.p80RefUm);
  const silicate = dep.silicate * liberationGain(m.silicate, p80Um, inp.p80RefUm);
  const oxide = dep.oxide * liberationGain(m.oxide, p80Um, inp.p80RefUm);
  return { free, sulphide, silicate, oxide, total: free + sulphide + silicate + oxide };
}

/** Sévérité du preg-robbing (0–1) modulée par le carbone organique. */
export function pregRobSeverity(cOrgPct: number | null | undefined): number {
  if (cOrgPct == null || !Number.isFinite(cOrgPct) || cOrgPct <= 0) return 0.5; // défaut modéré
  return Math.max(0, Math.min(1, cOrgPct / PREG_ROB_C_ORG_FULL));
}

/**
 * Récupération d'or prédite (%) à un P80 donné, par bilan mécaniste :
 *
 *   R = Accessible(P80) · η_CN − Perte_pregrob
 *
 * L'or occlus n'entre jamais dans Accessible (maxLiberable ≈ 0) : le plafond
 * réfractaire émerge naturellement. La gravité ne s'ajoute PAS à R (l'or libre
 * est déjà compté dans Accessible) — sa valeur est économique et de protection
 * anti-preg-robbing, tracée séparément dans le bilan (recoveryBalance.ts).
 */
export function predictRecoveryAtP80(dep: GoldDeportment, p80Um: number, inp: DeportmentInputs): number {
  const m = inp.model ?? DEFAULT_DEPORTMENT_MODEL;
  const acc = accessibleByClass(dep, p80Um, inp);
  const pregLoss = dep.pregRob * pregRobSeverity(inp.cOrgPct);
  const r = acc.total * m.cnEfficiency - pregLoss;
  return Math.max(0, Math.min(100, r));
}

export interface RecoveryVsP80Point {
  p80: number;
  recovery: number;
  accessible: number;
}

/** Courbe récupération-vs-P80 sur une plage (défaut : 20–200 µm, pas 5). */
export function recoveryVsP80Curve(
  dep: GoldDeportment, inp: DeportmentInputs,
  opts: { p80Min?: number; p80Max?: number; step?: number } = {},
): RecoveryVsP80Point[] {
  const lo = opts.p80Min ?? 20, hi = opts.p80Max ?? 200, step = opts.step ?? 5;
  const out: RecoveryVsP80Point[] = [];
  for (let p = lo; p <= hi + 1e-9; p += step) {
    out.push({
      p80: +p.toFixed(1),
      recovery: +predictRecoveryAtP80(dep, p, inp).toFixed(3),
      accessible: +accessibleByClass(dep, p, inp).total.toFixed(3),
    });
  }
  return out;
}

export interface LiberationLimitedP80 {
  /** P80 (µm) au-delà duquel broyer plus fin ne « paie » plus. */
  p80Um: number;
  /** Récupération prédite à ce P80. */
  recoveryPct: number;
  /** Récupération asymptotique (broyage très fin) — le plafond de libération. */
  ceilingPct: number;
  /** Gain marginal au point limite (pts de récup. par kWh/t). */
  marginalPtPerKwh: number;
  /** Aucun optimum interne : la courbe paie encore à la borne fine explorée. */
  atFineBound: boolean;
  message: string;
}

/**
 * P80 DE LIBÉRATION — le grind le plus fin qui « paie » encore. On balaie du
 * grossier vers le fin ; à chaque pas on compare le gain de récupération au coût
 * énergétique INCRÉMENTAL (énergie de Bond). Dès que le gain marginal par kWh/t
 * tombe sous `econThresholdPtPerKwh`, broyer davantage est du sur-broyage.
 *
 * `econThresholdPtPerKwh` : points de récupération justifiant 1 kWh/t de broyage
 * en plus. Défaut 0.05 (à calculer par le projet : valeur du point de récup. /
 * coût du kWh). Le seuil est le SEUL réglage économique — le reste est physique.
 */
export function liberationLimitedP80(
  dep: GoldDeportment, inp: DeportmentInputs,
  opts: { bwiKwhT: number; f80Um: number; econThresholdPtPerKwh?: number; p80Min?: number; p80Max?: number; step?: number },
): LiberationLimitedP80 | null {
  const { bwiKwhT, f80Um } = opts;
  if (bwiKwhT <= 0 || f80Um <= 0) return null;
  const thr = opts.econThresholdPtPerKwh ?? 0.05;
  const lo = opts.p80Min ?? 20;
  // La courbe n'est informative qu'AU PLUS FIN que l'essai de libération : plus
  // grossier que P80ref, le modèle tient l'or libre constant (courbe plate) et le
  // gain marginal serait trivialement nul. On borne donc le scan à P80ref.
  const hi = Math.min(opts.p80Max ?? 200, f80Um, inp.p80RefUm);
  const step = opts.step ?? 5;
  if (hi <= lo) return null;
  const ceiling = predictRecoveryAtP80(dep, Math.max(1, lo / 4), inp); // grind ~très fin

  let prevP = hi;
  let prevR = predictRecoveryAtP80(dep, prevP, inp);
  let prevE = bondEnergy(bwiKwhT, f80Um, prevP);
  let limitP = hi, limitR = prevR, marginal = Infinity;

  for (let p = hi - step; p >= lo - 1e-9; p -= step) {
    const r = predictRecoveryAtP80(dep, p, inp);
    const e = bondEnergy(bwiKwhT, f80Um, p);
    const dE = e - prevE;          // kWh/t supplémentaires pour broyer plus fin
    const dR = r - prevR;          // pts de récupération gagnés
    const ratio = dE > 1e-9 ? dR / dE : Infinity;
    if (ratio < thr) {
      // Broyer sous `prevP` ne paie plus : le point limite est le pas précédent.
      return {
        p80Um: +prevP.toFixed(1),
        recoveryPct: +prevR.toFixed(2),
        ceilingPct: +ceiling.toFixed(2),
        marginalPtPerKwh: +ratio.toFixed(4),
        atFineBound: false,
        message: `P80 de libération ≈ ${Math.round(prevP)} µm : au-delà, +1 kWh/t ne rend plus que ${ratio.toFixed(3)} pt de récupération (< seuil ${thr}). ` +
          `Broyer plus fin = sur-broyage. Plafond de libération ${ceiling.toFixed(1)} % (or occlus/réfractaire non libérable au broyage seul).`,
      };
    }
    limitP = p; limitR = r; marginal = ratio;
    prevP = p; prevR = r; prevE = e;
  }
  return {
    p80Um: +limitP.toFixed(1),
    recoveryPct: +limitR.toFixed(2),
    ceilingPct: +ceiling.toFixed(2),
    marginalPtPerKwh: Number.isFinite(marginal) ? +marginal.toFixed(4) : 0,
    atFineBound: true,
    message: `La récupération paie encore le broyage jusqu'à la borne fine explorée (${Math.round(lo)} µm) : ` +
      `le grind n'est pas limité par la libération sur cette plage — la contrainte est ailleurs (énergie/mécanique).`,
  };
}
