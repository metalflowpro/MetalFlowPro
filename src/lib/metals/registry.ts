// ─────────────────────────────────────────────────────────────────────────────
// Registre des métaux — socle multi-métal (source unique de vérité).
//
// Historiquement l'app est mono-or : la teneur vit dans `Project.gold_grade_g_t`
// et se valorise en `oz × prix`. Un porphyre Cu-Au-Mo (ex. Morrison) impose de
// raisonner sur PLUSIEURS éléments, chacun avec sa propre unité de teneur et de
// prix. Ce module définit, pour chaque métal, comment convertir une teneur en
// masse payable contenue dans une tonne de minerai — la brique dont dépendent la
// valorisation, l'équivalent-métal (CuEq) et le NSR (voir ./valuation).
//
// Fonctions PURES — aucun import React/Supabase (même règle que lib/mine, lib/geomet).
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS, LB_PER_TONNE } from '../config/constants';

/** Unité dans laquelle une teneur est exprimée. */
export type GradeUnit = 'pct' | 'g/t';

/** Unité dans laquelle un prix de métal est coté. */
export type PriceUnit = 'usd/lb' | 'usd/oz';

/** Famille de métal (usage : regroupement/affichage, choix de valorisation). */
export type MetalCategory = 'base' | 'precious' | 'other';

/** Définition canonique d'un métal. */
export interface MetalDef {
  /** Symbole canonique ('Cu', 'Au', 'Ag', 'Mo', …) — la clé stable. */
  symbol: string;
  /** Libellé lisible. */
  name: string;
  category: MetalCategory;
  /** Unité de teneur attendue en entrée. */
  gradeUnit: GradeUnit;
  /** Unité du prix attendu. */
  priceUnit: PriceUnit;
  /**
   * Masse (dans l'unité de masse du PRIX) contenue dans 1 tonne de minerai
   * pour 1 unité de teneur. C'est le facteur pivot teneur → masse valorisable :
   *   • métal en % coté en $/lb  → 1 % dans 1 t = LB_PER_TONNE/100 livres.
   *   • métal en g/t coté en $/oz → 1 g/t dans 1 t = 1 g = 1/31,1035 oz troy.
   */
  massPerTonnePerGrade: number;
  /**
   * Prix de base documenté ($ dans priceUnit), utilisé comme repli quand le
   * projet n'a pas encore saisi de valeur. Ce sont des ordres de grandeur, pas
   * des cotations en temps réel — à confirmer avant publication d'une étude.
   */
  defaultPriceUsd: number;
}

/** Livres contenues dans 1 t de minerai pour 1 % de teneur. */
const LB_PER_TONNE_PER_PCT = LB_PER_TONNE / 100;
/** Onces troy contenues dans 1 t de minerai pour 1 g/t de teneur. */
const OZ_PER_TONNE_PER_GT = 1 / TROY_OZ_GRAMS;

/**
 * Registre canonique. Les métaux de base sont en %/($/lb), les précieux en
 * g/t/($/oz). Étendre ici pour ajouter un métal (une seule source).
 */
export const METALS: Record<string, MetalDef> = {
  Cu: { symbol: 'Cu', name: 'Cuivre',     category: 'base',     gradeUnit: 'pct', priceUnit: 'usd/lb', massPerTonnePerGrade: LB_PER_TONNE_PER_PCT, defaultPriceUsd: 4.00 },
  Mo: { symbol: 'Mo', name: 'Molybdène',  category: 'base',     gradeUnit: 'pct', priceUnit: 'usd/lb', massPerTonnePerGrade: LB_PER_TONNE_PER_PCT, defaultPriceUsd: 20.00 },
  Zn: { symbol: 'Zn', name: 'Zinc',       category: 'base',     gradeUnit: 'pct', priceUnit: 'usd/lb', massPerTonnePerGrade: LB_PER_TONNE_PER_PCT, defaultPriceUsd: 1.30 },
  Pb: { symbol: 'Pb', name: 'Plomb',      category: 'base',     gradeUnit: 'pct', priceUnit: 'usd/lb', massPerTonnePerGrade: LB_PER_TONNE_PER_PCT, defaultPriceUsd: 0.95 },
  Ni: { symbol: 'Ni', name: 'Nickel',     category: 'base',     gradeUnit: 'pct', priceUnit: 'usd/lb', massPerTonnePerGrade: LB_PER_TONNE_PER_PCT, defaultPriceUsd: 8.00 },
  Co: { symbol: 'Co', name: 'Cobalt',     category: 'base',     gradeUnit: 'pct', priceUnit: 'usd/lb', massPerTonnePerGrade: LB_PER_TONNE_PER_PCT, defaultPriceUsd: 15.00 },
  Au: { symbol: 'Au', name: 'Or',         category: 'precious', gradeUnit: 'g/t', priceUnit: 'usd/oz', massPerTonnePerGrade: OZ_PER_TONNE_PER_GT, defaultPriceUsd: 2000 },
  Ag: { symbol: 'Ag', name: 'Argent',     category: 'precious', gradeUnit: 'g/t', priceUnit: 'usd/oz', massPerTonnePerGrade: OZ_PER_TONNE_PER_GT, defaultPriceUsd: 24 },
} as const;

/** Vrai si le symbole correspond à un métal connu du registre. */
export function isKnownMetal(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(METALS, symbol);
}

/**
 * Renvoie la définition d'un métal. Lève une erreur si inconnu : un symbole
 * absent du registre est un bug d'appel (mauvaise clé), pas une donnée à ignorer
 * silencieusement — qui masquerait une perte de revenu dans la valorisation.
 */
export function getMetal(symbol: string): MetalDef {
  const def = METALS[symbol];
  if (!def) {
    throw new Error(`Métal inconnu : « ${symbol} ». Métaux connus : ${Object.keys(METALS).join(', ')}.`);
  }
  return def;
}

/** Liste des symboles connus (ordre d'insertion du registre). */
export function knownMetalSymbols(): string[] {
  return Object.keys(METALS);
}

/** Table { symbole → prix de base documenté } — repli pour un nouveau projet. */
export function defaultMetalPrices(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sym, def] of Object.entries(METALS)) out[sym] = def.defaultPriceUsd;
  return out;
}
