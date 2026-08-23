// ─────────────────────────────────────────────────────────────────────────────
// Modèle Monte-Carlo technico-économique — module PUR (aucun React/DB).
//
// Le module « Simulation Monte-Carlo » propage l'incertitude des variables de
// procédé à travers un bilan technico-économique de screening, pour produire des
// DISTRIBUTIONS (P10/P50/P90) d'onces produites, d'OPEX, de marge et de VAN.
//
// MODÈLE DE RÉCUPÉRATION MÉCANISTE (§ conforme à la maquette de référence) :
//   R = Rmax · libération(P80) · extraction_lixiviation(k, t) · (1 − pertes_ADR)
//   • Rmax                — récupération asymptotique du minerai (PERT).
//   • libération(P80)     — un broyage plus grossier que la référence libère moins
//                            l'or (facteur ≤ 1, saturant à la finesse de référence).
//   • extraction(k, t)    — cinétique du 1er ordre 1 − e^(−k·t) (circuits à lixiviation).
//   • pertes ADR          — or perdu au charbon fin / effluents / fonderie (CIP/CIL).
//
// BLENDING GÉOMÉTALLURGIQUE : l'alimentation usine est un MÉLANGE de domaines /
// types de minerai, chacun avec SA teneur et SON Rmax. À chaque itération les parts
// et les teneurs fluctuent ; la teneur mélangée est pondérée par la masse et la
// récupération mélangée par le MÉTAL contenu (jamais par le tonnage — cf. domainRecovery).
//
// RÈGLE ANTI-VALEURS-EN-DUR : les CENTRES viennent des données projet via `MCSeed`
// (critères, essais LIMS, facteurs de procédé, prix). Les PRIX/actualisation
// réutilisent `DEFAULT_ASSUMPTIONS`. Ne restent en dur que les paramètres de FORME
// (dispersions par défaut, sensibilité de libération, cinétique de repli), groupés
// et documentés dans `MC_MODEL_CONFIG` — même convention que `GENERATOR_CONFIG`.
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS } from '../config/constants';
import type { Distribution } from './monteCarlo';

// ─── Circuits (alignés sur les routes de l'application) ───────────────────────

export type MCCircuit = 'leach' | 'cip' | 'cil' | 'gravity' | 'flotation' | 'regrind';

export const MC_CIRCUITS: { id: MCCircuit; label: string; description: string }[] = [
  { id: 'leach', label: 'Lixiviation (tas/cuve)', description: 'Cyanuration directe sans charbon en circuit.' },
  { id: 'cip', label: 'CIP (Charbon en pulpe)', description: 'Lixiviation suivie de l\'adsorption sur charbon en cuves séparées.' },
  { id: 'cil', label: 'CIL (Charbon en lixiviation)', description: 'Lixiviation et adsorption simultanées.' },
  { id: 'gravity', label: 'Gravité (concentration gravimétrique)', description: 'Récupération de l\'or libre par centrifugation.' },
  { id: 'flotation', label: 'Flotation', description: 'Concentration des sulfures porteurs d\'or.' },
  { id: 'regrind', label: 'Rebroyage', description: 'Broyage fin d\'un concentré avant lixiviation intensive.' },
];

/** Un circuit met-il en jeu une lixiviation (cinétique + réactifs cyanuration) ? */
export function circuitHasLeach(c: MCCircuit): boolean {
  return c === 'leach' || c === 'cip' || c === 'cil';
}
/** Un circuit met-il en jeu une adsorption sur charbon (pertes ADR) ? */
export function circuitHasCarbon(c: MCCircuit): boolean {
  return c === 'cip' || c === 'cil';
}

// ─── Sections d'entrée ────────────────────────────────────────────────────────

export type MCSection = 'feed' | 'process' | 'reagents' | 'economics';

export const MC_SECTIONS: { id: MCSection; label: string }[] = [
  { id: 'feed', label: 'Alimentation' },
  { id: 'process', label: 'Procédé' },
  { id: 'reagents', label: 'Réactifs & énergie' },
  { id: 'economics', label: 'Économie' },
];

// ─── Données sources (centres des lois), injectées depuis le contexte projet ──

export interface MCSeed {
  feedTpd: number;            // t/j — débit sec au broyage (target_tph × 24)
  availabilityFrac: number;   // fraction — disponibilité usine
  goldGradeGt: number;        // g/t — teneur d'alimentation
  p80Um: number;              // µm — finesse de broyage (référence de libération)
  rmaxFrac: number;           // fraction — récupération maximale (asymptote)
  leachKPerH: number;         // 1/h — constante cinétique de lixiviation
  cilRetentionH: number;      // h — temps de rétention nominal
  adsLossPct: number;         // % relatif — pertes adsorption/élution/fonderie
  cyanideKgT: number;         // kg/t — NaCN
  limeKgT: number;            // kg/t — chaux
  energyKwhT: number;         // kWh/t — énergie spécifique
  cyanidePriceUsdKg: number;  // $/kg
  limePriceUsdKg: number;     // $/kg
  electricityUsdKwh: number;  // $/kWh
  otherCostsUsdT: number;     // $/t — main-d'œuvre, entretien, boulets, charbon, frais fixes
  goldPriceUsdOz: number;     // $/oz
  discountRate: number;       // fraction — taux d'actualisation
  lomYears: number;           // ans — durée de vie retenue
}

// ─── Blending géométallurgique ────────────────────────────────────────────────

export interface MCBlendDomain {
  id: string;
  /** Libellé (domaine géomét. ou type de minerai : Oxyde, Sulfuré, Réfractaire…). */
  name: string;
  /** Part massique de l'alimentation (%), fluctuante. */
  share: MCParam;
  /** Teneur du domaine (g/t). */
  grade: MCParam;
  /** Récupération maximale propre au domaine (fraction). */
  rmax: MCParam;
}

// ─── Paramètres de forme du module ────────────────────────────────────────────

export const MC_MODEL_CONFIG = {
  /** Nombre d'itérations par défaut. */
  defaultIterations: 10000,
  /** λ de la loi PERT (poids du mode). */
  pertLambda: 4,
  /**
   * Coefficient de variation (σ/µ) par défaut — AMPLITUDE d'incertitude, pas une
   * valeur métier. À resserrer avec la maturité du projet.
   */
  defaultCv: {
    feedTpd: 0.05,
    availabilityFrac: 0.04,
    goldGradeGt: 0.25,
    p80Um: 0.10,
    rmaxFrac: 0.04,
    leachKPerH: 0.20,
    cilRetentionH: 0.10,
    adsLossPct: 0.30,
    cyanideKgT: 0.15,
    limeKgT: 0.15,
    energyKwhT: 0.12,
    cyanidePriceUsdKg: 0.15,
    limePriceUsdKg: 0.15,
    electricityUsdKwh: 0.12,
    otherCostsUsdT: 0.15,
    goldPriceUsdOz: 0.12,
    blendShare: 0.15,
  } as Record<string, number>,
  /** Demi-largeurs (fraction du centre) des bornes PERT. */
  pertBand: { downFrac: 0.06, upFrac: 0.03 },
  /**
   * Sensibilité de la libération au broyage : perte relative de récupération par
   * unité d'écart RELATIF de P80 au-dessus de la référence, plancher inclus.
   * Propriété du minerai (courbe P80↔récup.), surchargeable.
   */
  liberation: { sensitivity: 0.15, floor: 0.6 },
  /**
   * Constante cinétique de lixiviation de repli (1/h) quand aucun essai cinétique
   * n'est disponible — un modèle du 1er ordre atteint ~86 % de Rmax en 24 h à k=0,08.
   */
  fallbackLeachKPerH: 0.08,
  /** Pertes adsorption/élution de repli (% relatif) — appoint ADR de screening. */
  fallbackAdsLossPct: 1.5,
  /** Jours calendaires par an (base annualisation). */
  daysPerYear: 365,
  /** Plafond de récupération reportable (fraction). */
  maxRecoveryFrac: 1.0,
} as const;

// ─── Catalogue des variables ──────────────────────────────────────────────────

export interface MCVariableDef {
  key: string;
  label: string;
  unit: string;
  section: MCSection;
  circuits: MCCircuit[] | 'all';
  defaultKind: Distribution['kind'];
  seedKey: keyof MCSeed;
  hint: string;
  /** Bornage de l'échantillon : positif, [0,100] (%) ou [0,1] (fraction). */
  clamp?: 'positive' | 'recovery' | 'fraction';
}

export const MC_VARIABLES: MCVariableDef[] = [
  // Alimentation
  { key: 'feed_tpd', label: 'Débit usine', unit: 't/j', section: 'feed', circuits: 'all', defaultKind: 'normal', seedKey: 'feedTpd', hint: 'Tonnage sec traité par jour au broyage.', clamp: 'positive' },
  { key: 'availability', label: 'Disponibilité usine', unit: 'fraction', section: 'feed', circuits: 'all', defaultKind: 'pert', seedKey: 'availabilityFrac', hint: 'Temps de marche effectif (arrêts mécaniques, coupures, entretien).', clamp: 'fraction' },
  { key: 'gold_grade', label: 'Teneur d\'alimentation', unit: 'g/t Au', section: 'feed', circuits: 'all', defaultKind: 'lognormal', seedKey: 'goldGradeGt', hint: 'Teneur en or du minerai alimentant l\'usine (variabilité géologique).', clamp: 'positive' },
  // Procédé
  { key: 'p80_um', label: 'Finesse de broyage P80', unit: 'µm', section: 'process', circuits: 'all', defaultKind: 'normal', seedKey: 'p80Um', hint: '80 % passant en sortie de broyage ; pilote la libération de l\'or.', clamp: 'positive' },
  { key: 'rmax', label: 'Récupération maximale (Rmax)', unit: 'fraction', section: 'process', circuits: 'all', defaultKind: 'pert', seedKey: 'rmaxFrac', hint: 'Récupération asymptotique du minerai (or réfractaire / preg-robbing exclus).', clamp: 'fraction' },
  { key: 'leach_k', label: 'Constante cinétique de lixiviation k', unit: '1/h', section: 'process', circuits: ['leach', 'cip', 'cil'], defaultKind: 'lognormal', seedKey: 'leachKPerH', hint: 'Cinétique de dissolution du cyanure, modèle du 1er ordre.', clamp: 'positive' },
  { key: 'cil_retention_h', label: 'Temps de rétention CIL', unit: 'h', section: 'process', circuits: ['leach', 'cip', 'cil'], defaultKind: 'triangular', seedKey: 'cilRetentionH', hint: 'Temps de séjour total dans la cascade de cuves de lixiviation/CIL.', clamp: 'positive' },
  { key: 'ads_loss_pct', label: 'Pertes adsorption/élution', unit: '% relatif', section: 'process', circuits: ['cip', 'cil'], defaultKind: 'triangular', seedKey: 'adsLossPct', hint: 'Or perdu au charbon fin, aux effluents et à la fonderie.', clamp: 'positive' },
  // Réactifs & énergie
  { key: 'cyanide_kg_t', label: 'Consommation NaCN', unit: 'kg/t', section: 'reagents', circuits: ['leach', 'cip', 'cil'], defaultKind: 'lognormal', seedKey: 'cyanideKgT', hint: 'Cyanure de sodium consommé par tonne traitée.', clamp: 'positive' },
  { key: 'lime_kg_t', label: 'Consommation chaux', unit: 'kg/t', section: 'reagents', circuits: ['leach', 'cip', 'cil'], defaultKind: 'lognormal', seedKey: 'limeKgT', hint: 'Chaux pour maintenir le pH ≈ 10,5 (protection alcaline).', clamp: 'positive' },
  { key: 'energy_kwh_t', label: 'Énergie spécifique', unit: 'kWh/t', section: 'reagents', circuits: 'all', defaultKind: 'normal', seedKey: 'energyKwhT', hint: 'Consommation électrique par tonne (broyage majoritaire).', clamp: 'positive' },
  // Économie
  { key: 'cyanide_price', label: 'Prix NaCN', unit: '$/kg', section: 'economics', circuits: ['leach', 'cip', 'cil'], defaultKind: 'triangular', seedKey: 'cyanidePriceUsdKg', hint: 'Prix rendu usine du cyanure.', clamp: 'positive' },
  { key: 'lime_price', label: 'Prix chaux', unit: '$/kg', section: 'economics', circuits: ['leach', 'cip', 'cil'], defaultKind: 'triangular', seedKey: 'limePriceUsdKg', hint: 'Prix rendu usine de la chaux.', clamp: 'positive' },
  { key: 'electricity_price', label: 'Prix électricité', unit: '$/kWh', section: 'economics', circuits: 'all', defaultKind: 'triangular', seedKey: 'electricityUsdKwh', hint: 'Coût du kWh (réseau ou groupes électrogènes).', clamp: 'positive' },
  { key: 'other_costs_usd_t', label: 'Autres coûts usine', unit: '$/t', section: 'economics', circuits: 'all', defaultKind: 'pert', seedKey: 'otherCostsUsdT', hint: 'Main-d\'œuvre, entretien, boulets, charbon actif, frais fixes ramenés à la tonne.', clamp: 'positive' },
  { key: 'gold_price', label: 'Prix de l\'or', unit: '$/oz', section: 'economics', circuits: 'all', defaultKind: 'lognormal', seedKey: 'goldPriceUsdOz', hint: 'Prix de vente réalisé de l\'once troy.', clamp: 'positive' },
];

/** Variables applicables à un circuit donné. */
export function variablesForCircuit(circuit: MCCircuit): MCVariableDef[] {
  return MC_VARIABLES.filter(v => v.circuits === 'all' || v.circuits.includes(circuit));
}

// ─── Paramètres éditables (miroir de l'UI) ────────────────────────────────────

export type MCParam =
  | { kind: 'normal'; mean: number; std: number }
  | { kind: 'lognormal'; mean: number; cv: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  | { kind: 'uniform'; min: number; max: number }
  | { kind: 'pert'; min: number; mode: number; max: number };

/** Borne haute d'un bornage donné (fraction → 1, recovery → 100). */
function clampCeil(clamp: MCVariableDef['clamp']): number | undefined {
  if (clamp === 'fraction') return 1;
  if (clamp === 'recovery') return 100;
  return undefined;
}

/** Construit un paramètre par défaut autour d'un centre et d'un CV. */
export function paramFromCenter(kind: Distribution['kind'], center: number, cv: number, clamp?: MCVariableDef['clamp']): MCParam {
  const ceil = clampCeil(clamp);
  const clampMax = (v: number) => (ceil != null ? Math.min(ceil, v) : v);
  switch (kind) {
    case 'lognormal':
      return { kind: 'lognormal', mean: center, cv };
    case 'pert': {
      const { downFrac, upFrac } = MC_MODEL_CONFIG.pertBand;
      return { kind: 'pert', min: Math.max(0, center * (1 - downFrac)), mode: center, max: clampMax(center * (1 + upFrac)) };
    }
    case 'triangular':
      return { kind: 'triangular', min: Math.max(0, center * (1 - cv)), mode: center, max: clampMax(center * (1 + cv)) };
    case 'uniform':
      return { kind: 'uniform', min: Math.max(0, center * (1 - cv)), max: clampMax(center * (1 + cv)) };
    case 'normal':
    default:
      return { kind: 'normal', mean: center, std: Math.abs(center) * cv };
  }
}

/** Paramètre par défaut d'une variable à partir du centre sourcé. */
export function defaultParam(def: MCVariableDef, seed: MCSeed): MCParam {
  const cv = MC_MODEL_CONFIG.defaultCv[def.seedKey] ?? 0.1;
  return paramFromCenter(def.defaultKind, seed[def.seedKey], cv, def.clamp);
}

/** Jeu de paramètres par défaut pour un circuit (clé de variable → paramètre). */
export function defaultParams(circuit: MCCircuit, seed: MCSeed): Record<string, MCParam> {
  const out: Record<string, MCParam> = {};
  for (const def of variablesForCircuit(circuit)) out[def.key] = defaultParam(def, seed);
  return out;
}

/** Convertit un paramètre éditable en loi échantillonnable, avec bornage. */
export function toDistribution(param: MCParam, clamp?: MCVariableDef['clamp']): Distribution {
  const lo = clamp ? 0 : undefined;
  const hi = clampCeil(clamp);
  switch (param.kind) {
    case 'normal':
      return { kind: 'normal', mean: param.mean, std: Math.max(0, param.std), min: lo, max: hi };
    case 'lognormal': {
      const cv = Math.max(0, param.cv);
      const stdLog = Math.sqrt(Math.log(1 + cv * cv));
      const meanLog = Math.log(Math.max(1e-9, param.mean)) - (stdLog * stdLog) / 2;
      return { kind: 'lognormal', meanLog, stdLog, min: lo, max: hi };
    }
    case 'triangular':
      return { kind: 'triangular', min: param.min, mode: param.mode, max: param.max };
    case 'uniform':
      return { kind: 'uniform', min: param.min, max: param.max };
    case 'pert':
      return { kind: 'pert', min: param.min, mode: param.mode, max: param.max, lambda: MC_MODEL_CONFIG.pertLambda };
  }
}

// ─── Sorties du modèle ────────────────────────────────────────────────────────

export type MCOutputKey = 'gold_oz_year' | 'gold_oz_day' | 'revenue_year' | 'opex_year' | 'margin_year' | 'aisc_oz' | 'recovery_pct' | 'npv';

export interface MCOutputDef {
  key: MCOutputKey;
  label: string;
  unit: string;
  direction: 'maximize' | 'minimize';
  currency?: boolean;
}

export const MC_OUTPUTS: MCOutputDef[] = [
  { key: 'margin_year', label: 'Marge annuelle', unit: '$/an', direction: 'maximize', currency: true },
  { key: 'npv', label: 'VAN (marge actualisée)', unit: '$', direction: 'maximize', currency: true },
  { key: 'gold_oz_year', label: 'Or produit', unit: 'oz/an', direction: 'maximize' },
  { key: 'recovery_pct', label: 'Récupération globale', unit: '%', direction: 'maximize' },
  { key: 'aisc_oz', label: 'Coût comptant (AISC proxy)', unit: '$/oz', direction: 'minimize', currency: true },
  { key: 'revenue_year', label: 'Revenu annuel', unit: '$/an', direction: 'maximize', currency: true },
  { key: 'opex_year', label: 'OPEX annuel', unit: '$/an', direction: 'minimize', currency: true },
  { key: 'gold_oz_day', label: 'Or produit (jour ouvré)', unit: 'oz/j', direction: 'maximize' },
];

export const MC_OUTPUT_KEYS: MCOutputKey[] = MC_OUTPUTS.map(o => o.key);

/** Facteur de libération lié à la finesse de broyage (≤ 1, saturant à la référence). */
export function liberationFactor(p80Um: number, refP80Um: number): number {
  if (refP80Um <= 0) return 1;
  const rel = p80Um / refP80Um - 1; // > 0 si plus grossier que la référence
  const { sensitivity, floor } = MC_MODEL_CONFIG.liberation;
  return Math.max(floor, Math.min(1, 1 - sensitivity * rel));
}

/** Extraction de lixiviation du 1er ordre 1 − e^(−k·t) (1 hors circuit de lixiviation). */
export function leachExtraction(kPerH: number, retentionH: number, hasLeach: boolean): number {
  if (!hasLeach) return 1;
  return Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(0, kPerH) * Math.max(0, retentionH))));
}

/** Récupération mécaniste R = Rmax · libération · extraction · (1 − pertes ADR). */
export function mechanisticRecovery(args: {
  rmaxFrac: number; p80Um: number; refP80Um: number;
  kPerH: number; retentionH: number; adsLossPct: number;
  hasLeach: boolean; hasCarbon: boolean;
}): number {
  const lib = liberationFactor(args.p80Um, args.refP80Um);
  const ext = leachExtraction(args.kPerH, args.retentionH, args.hasLeach);
  const ads = args.hasCarbon ? Math.max(0, 1 - Math.max(0, args.adsLossPct) / 100) : 1;
  const R = args.rmaxFrac * lib * ext * ads;
  return Math.max(0, Math.min(MC_MODEL_CONFIG.maxRecoveryFrac, R));
}

export interface MCModelOptions {
  /** Identifiants des domaines de blending ; vide/undefined = alimentation homogène. */
  blendDomainIds?: string[];
}

/** Clés d'entrée d'un domaine de blending. */
export const blendKeys = (id: string) => ({
  share: `blend_${id}_share`,
  grade: `blend_${id}_grade`,
  rmax: `blend_${id}_rmax`,
});

/**
 * Construit le modèle vectoriel (tirage → sorties) pour un circuit. Applique le
 * modèle de récupération mécaniste, l'annualisation par la disponibilité, et — si
 * `blendDomainIds` est fourni — le mélange géométallurgique par domaine.
 */
export function makeModel(circuit: MCCircuit, seed: MCSeed, opts: MCModelOptions = {}): (draws: Record<string, number>) => Record<MCOutputKey, number> {
  const active = new Set(variablesForCircuit(circuit).map(v => v.key));
  const hasLeach = circuitHasLeach(circuit);
  const hasCarbon = circuitHasCarbon(circuit);
  const domainIds = opts.blendDomainIds ?? [];
  const blending = domainIds.length > 0;

  return (d: Record<string, number>): Record<MCOutputKey, number> => {
    const val = (key: string, seedKey: keyof MCSeed) =>
      active.has(key) && Number.isFinite(d[key]) ? d[key] : (seed[seedKey] as number);
    const reagent = (key: string) => (active.has(key) && Number.isFinite(d[key]) ? d[key] : 0);

    const tpd = Math.max(0, val('feed_tpd', 'feedTpd'));
    const avail = Math.max(0, Math.min(1, val('availability', 'availabilityFrac')));
    const p80 = Math.max(1e-6, val('p80_um', 'p80Um'));
    const kPerH = val('leach_k', 'leachKPerH');
    const retention = val('cil_retention_h', 'cilRetentionH');
    const adsLoss = val('ads_loss_pct', 'adsLossPct');

    const recArgs = { p80Um: p80, refP80Um: seed.p80Um, kPerH, retentionH: retention, adsLossPct: adsLoss, hasLeach, hasCarbon };

    // Teneur et récupération : homogènes, ou mélangées par domaine.
    let grade: number;
    let recFrac: number;
    if (blending) {
      let totalShare = 0;
      const shares: number[] = [], grades: number[] = [], recs: number[] = [];
      for (const id of domainIds) {
        const k = blendKeys(id);
        const s = Math.max(0, Number.isFinite(d[k.share]) ? d[k.share] : 0);
        const g = Math.max(0, Number.isFinite(d[k.grade]) ? d[k.grade] : 0);
        const rm = Number.isFinite(d[k.rmax]) ? d[k.rmax] : seed.rmaxFrac;
        shares.push(s); grades.push(g);
        recs.push(mechanisticRecovery({ ...recArgs, rmaxFrac: rm }));
        totalShare += s;
      }
      if (totalShare <= 0) { grade = 0; recFrac = 0; }
      else {
        let blendGrade = 0, metalIn = 0, metalRec = 0;
        for (let i = 0; i < domainIds.length; i++) {
          const w = shares[i] / totalShare;
          const m = w * grades[i];
          blendGrade += w * grades[i];
          metalIn += m;
          metalRec += m * recs[i];
        }
        grade = blendGrade;
        recFrac = metalIn > 0 ? metalRec / metalIn : 0; // pondération par le MÉTAL
      }
    } else {
      grade = Math.max(0, val('gold_grade', 'goldGradeGt'));
      recFrac = mechanisticRecovery({ ...recArgs, rmaxFrac: val('rmax', 'rmaxFrac') });
    }

    // Production.
    const ozDay = (tpd * grade * recFrac) / TROY_OZ_GRAMS; // g/j ÷ (g/oz)
    const daysYear = MC_MODEL_CONFIG.daysPerYear * avail;
    const ozYear = ozDay * daysYear;

    // Économie.
    const goldPrice = Math.max(0, val('gold_price', 'goldPriceUsdOz'));
    const revenueYear = ozYear * goldPrice;
    const cyanideCost = reagent('cyanide_kg_t') * val('cyanide_price', 'cyanidePriceUsdKg');
    const limeCost = reagent('lime_kg_t') * val('lime_price', 'limePriceUsdKg');
    const energyCost = val('energy_kwh_t', 'energyKwhT') * val('electricity_price', 'electricityUsdKwh');
    const otherPerT = Math.max(0, val('other_costs_usd_t', 'otherCostsUsdT'));
    const opexPerT = cyanideCost + limeCost + energyCost + otherPerT;
    const tonnesYear = tpd * daysYear;
    const opexYear = opexPerT * tonnesYear;
    const marginYear = revenueYear - opexYear;
    const aiscOz = ozYear > 0 ? opexYear / ozYear : 0;

    // VAN de screening : marge annuelle actualisée sur la durée de vie (sans CAPEX).
    let npv = 0;
    for (let y = 1; y <= Math.max(1, Math.round(seed.lomYears)); y++) {
      npv += marginYear / Math.pow(1 + seed.discountRate, y);
    }

    return {
      gold_oz_year: ozYear,
      gold_oz_day: ozDay,
      revenue_year: revenueYear,
      opex_year: opexYear,
      margin_year: marginYear,
      aisc_oz: aiscOz,
      recovery_pct: recFrac * 100,
      npv,
    };
  };
}
