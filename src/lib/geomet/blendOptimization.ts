// ─────────────────────────────────────────────────────────────────────────────
// Optimisation automatique du BLEND géométallurgique.
//
// Trouve la répartition d'alimentation (part de chaque domaine primaire, en
// fraction sommant à 1) qui MAXIMISE les onces d'or annuelles, à partir des
// seules données déjà portées par les domaines GéoMet : récupération, indice de
// broyabilité (BWi) et drapeau preg-robbing.
//
// ⚠️ Pourquoi un vrai optimum de MÉLANGE (et pas « 100 % du meilleur domaine ») ?
//   La récupération et le BWi d'un mélange sont des moyennes linéaires des parts.
//   Une fonction linéaire (ou linéaire-fractionnaire) sur le simplexe atteint son
//   maximum à un SOMMET — c.-à-d. un seul domaine. Ce qui rend le mélange
//   avantageux, c'est le PREG-ROBBING, qui est un effet de SEUIL au niveau du
//   mélange : au-delà d'une part tolérable d'ore préempteur, TOUT le mélange perd
//   de la récupération. On peut alors DILUER un domaine à forte récupération mais
//   préempteur avec de l'ore propre pour rester sous le seuil — d'où un optimum
//   INTÉRIEUR, un vrai blend. (Marsden & House ; Adams, Gold Ore Processing.)
//
// Débit LIMITÉ EN PUISSANCE : un broyeur à puissance installée fixe traite
// d'autant moins de tonnes que l'ore est dur (loi de Bond, énergie ∝ Wi), donc
// tph(mélange) = tph_design × BWi_réf / BWi_mélange. Le débit récompense les
// mélanges plus tendres, la récupération les mélanges plus riches : l'optimiseur
// arbitre les deux sur l'objectif commun, les onces annuelles.
//
// Fonctions PURES — aucun import React/Supabase, entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

/** Un domaine primaire candidat au mélange. */
export interface BlendDomain {
  id: string;
  /** Récupération de conception du domaine (%), déjà ramenée au P80 de référence. */
  recoveryPct: number;
  /** Indice de broyabilité Bond (kWh/t). */
  bwiKwhT: number;
  /** Le domaine est-il préempteur (preg-robbing) ? */
  pregRobbing: boolean;
}

/** Paramètres procédé + calibrations de l'optimisation. */
export interface BlendOptParams {
  targetTph: number;
  operatingHours: number;
  gradeGt: number;
  troyGrams: number;
  /**
   * Part maximale d'alimentation issue de domaines préempteurs SANS pénalité.
   * Au-delà, le mélange dépasse la capacité de défense du circuit (charbon,
   * dilution) et la récupération globale décroche.
   */
  pregToleranceFrac: number;
  /**
   * Points de récupération perdus par le mélange ENTIER quand toute
   * l'alimentation est préemptrice (part preg = 100 %). Le barème est linéaire
   * entre la tolérance et 100 %.
   */
  pregPenaltyPts: number;
}

/** Valeurs par défaut — barème d'ingénierie, à recaler sur les essais du site. */
export const DEFAULT_BLEND_OPT_PARAMS = {
  pregToleranceFrac: 0.15,
  pregPenaltyPts: 8,
} as const;

export interface BlendMetrics {
  /** Part par domaine (fraction, somme = 1), indexée par id. */
  shares: Record<string, number>;
  recoveryPct: number;   // récupération du mélange APRÈS pénalité preg-robbing
  bwiKwhT: number;       // BWi moyen pondéré du mélange
  tph: number;           // débit limité en puissance au mélange
  pregShareFrac: number; // part d'alimentation issue de domaines préempteurs
  annualOz: number;      // onces d'or par an
}

/** Un domaine primaire vu sous l'angle de sa DISPONIBILITÉ (tonnage de ressource). */
export interface AvailabilityDomain {
  id: string;
  /** Lithologie primaire (oxide/sulphide/transition) — pour rattacher le tonnage coarse du Block Model. */
  root: string;
  /** Nombre d'échantillons LIMS — clé de répartition du tonnage coarse sur les sous-domaines de teneur. */
  sampleCount: number;
}

/**
 * Part d'alimentation de chaque domaine = sa part du TONNAGE DE RESSOURCE.
 *
 * Le Block Model ne porte que des lithologies coarse ("Oxyde", "Sulfure",
 * "Transition") ; on répartit leur tonnage sur les sous-domaines granulaires de
 * même racine (Oxyde HG/MG/LG…) au prorata des échantillons. Sur la vie de la
 * mine on traite tout le gisement : le blend d'alimentation est donc, au premier
 * ordre, la composition en tonnage de la ressource — un VRAI mélange multi-
 * domaines, jamais « 100 % du domaine le plus riche ».
 *
 * Replis : une racine sans tonnage Block Model retombe sur le nombre
 * d'échantillons ; sans aucune information, répartition égale.
 */
export function availabilityShares(
  domains: AvailabilityDomain[],
  rootTonnage: Record<string, number>,
): Record<string, number> {
  if (domains.length === 0) return {};
  const byRoot = new Map<string, AvailabilityDomain[]>();
  for (const d of domains) {
    const g = byRoot.get(d.root) ?? [];
    g.push(d);
    byRoot.set(d.root, g);
  }
  const tonnage: Record<string, number> = {};
  for (const [root, group] of byRoot) {
    const T = rootTonnage[root] ?? 0;
    const scSum = group.reduce((s, d) => s + Math.max(0, d.sampleCount), 0);
    for (const d of group) {
      if (T > 0) {
        tonnage[d.id] = scSum > 0 ? T * (Math.max(0, d.sampleCount) / scSum) : T / group.length;
      } else {
        tonnage[d.id] = Math.max(0, d.sampleCount); // pas de tonnage BM → proxy échantillons
      }
    }
  }
  const total = Object.values(tonnage).reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  if (total > 0) {
    for (const d of domains) out[d.id] = (tonnage[d.id] ?? 0) / total;
  } else {
    const eq = 1 / domains.length;
    for (const d of domains) out[d.id] = eq;
  }
  return out;
}

/** Moyenne simple des BWi — référence de calibration du débit (constante, n'influe pas sur l'argmax). */
function meanBwi(domains: BlendDomain[]): number {
  if (!domains.length) return 1;
  return domains.reduce((s, d) => s + d.bwiKwhT, 0) / domains.length;
}

/**
 * Récupération du mélange après pénalité preg-robbing.
 * Base = moyenne pondérée des récupérations ; pénalité = barème linéaire sur la
 * part preg au-delà de la tolérance.
 */
export function blendRecovery(shares: Record<string, number>, domains: BlendDomain[], p: BlendOptParams): number {
  let base = 0, pregShare = 0;
  for (const d of domains) {
    const s = shares[d.id] ?? 0;
    base += s * d.recoveryPct;
    if (d.pregRobbing) pregShare += s;
  }
  const excess = Math.max(0, pregShare - p.pregToleranceFrac);
  const span = Math.max(1e-9, 1 - p.pregToleranceFrac);
  const penalty = p.pregPenaltyPts * (excess / span);
  return Math.max(0, base - penalty);
}

/** Toutes les métriques d'un mélange donné. */
export function blendMetrics(shares: Record<string, number>, domains: BlendDomain[], p: BlendOptParams, bwiRef = meanBwi(domains)): BlendMetrics {
  let bwi = 0, pregShare = 0;
  for (const d of domains) {
    const s = shares[d.id] ?? 0;
    bwi += s * d.bwiKwhT;
    if (d.pregRobbing) pregShare += s;
  }
  const recovery = blendRecovery(shares, domains, p);
  const tph = bwi > 0 ? p.targetTph * (bwiRef / bwi) : p.targetTph;
  const annualOz = tph * p.operatingHours * p.gradeGt * (recovery / 100) / p.troyGrams;
  return { shares: { ...shares }, recoveryPct: recovery, bwiKwhT: bwi, tph, pregShareFrac: pregShare, annualOz };
}

/** Objectif scalaire à maximiser : onces annuelles. */
function objective(shares: Record<string, number>, domains: BlendDomain[], p: BlendOptParams, bwiRef: number): number {
  return blendMetrics(shares, domains, p, bwiRef).annualOz;
}

const vertex = (domains: BlendDomain[], k: number): Record<string, number> =>
  Object.fromEntries(domains.map((d, i) => [d.id, i === k ? 1 : 0]));

const equalSplit = (domains: BlendDomain[]): Record<string, number> =>
  Object.fromEntries(domains.map(d => [d.id, 1 / domains.length]));

/**
 * Ascension par coordonnées sur le simplexe : à pas décroissant, on transfère
 * une fraction `step` d'un domaine vers un autre tant que l'objectif progresse.
 * Robuste sur cet objectif lisse par morceaux (le coude vient de la pénalité preg).
 */
function localOptimize(start: Record<string, number>, domains: BlendDomain[], p: BlendOptParams, bwiRef: number): Record<string, number> {
  const shares = { ...start };
  let best = objective(shares, domains, p, bwiRef);
  for (let step = 0.10; step >= 0.005; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const from of domains) {
        for (const to of domains) {
          if (from.id === to.id) continue;
          const avail = shares[from.id] ?? 0;
          if (avail < step) continue;
          shares[from.id] = avail - step;
          shares[to.id] = (shares[to.id] ?? 0) + step;
          const val = objective(shares, domains, p, bwiRef);
          if (val > best + 1e-9) {
            best = val;
            improved = true;
          } else {
            // revert
            shares[from.id] = avail;
            shares[to.id] = (shares[to.id] ?? 0) - step;
          }
        }
      }
    }
  }
  return shares;
}

/**
 * Répartition d'alimentation maximisant les onces annuelles.
 *
 * Multi-départ (mélange égal + chaque sommet), ascension locale sur chacun, on
 * garde le meilleur. Résultat arrondi à 0,5 % puis renormalisé à 1.
 */
export function optimizeBlend(domains: BlendDomain[], params: BlendOptParams): BlendMetrics | null {
  if (domains.length === 0) return null;
  if (domains.length === 1) return blendMetrics({ [domains[0].id]: 1 }, domains, params);

  const bwiRef = meanBwi(domains);
  const starts = [equalSplit(domains), ...domains.map((_, k) => vertex(domains, k))];

  let bestShares: Record<string, number> | null = null;
  let bestVal = -Infinity;
  for (const start of starts) {
    const s = localOptimize(start, domains, params, bwiRef);
    const val = objective(s, domains, params, bwiRef);
    if (val > bestVal) { bestVal = val; bestShares = s; }
  }
  if (!bestShares) return null;

  // Arrondi lisible à 0,5 %, renormalisé pour sommer exactement à 1.
  const rounded: Record<string, number> = {};
  for (const d of domains) rounded[d.id] = Math.round((bestShares[d.id] ?? 0) * 200) / 200;
  const total = domains.reduce((s, d) => s + rounded[d.id], 0);
  if (total > 0) for (const d of domains) rounded[d.id] = rounded[d.id] / total;

  return blendMetrics(rounded, domains, params, bwiRef);
}
