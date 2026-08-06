// ─────────────────────────────────────────────────────────────────────────────
// Valorisation multi-métal — masse contenue, valeur $/t, revenu, équivalent-métal.
//
// À partir du registre (./registry), ce module généralise le calcul mono-or
// (oz × prix) à un panier de métaux : chaque élément apporte une valeur $/t de
// minerai selon sa teneur, sa récupération et son prix. Sert de base à :
//   • la teneur-équivalente (CuEq / AuEq) utilisée pour le cut-off et les
//     rapports de ressource ;
//   • la valeur nette par bloc alimentant l'optimisation de fosse.
//
// ⚠️ Il n'y a PAS de formule d'équivalent universelle : le facteur dépend des
// prix ET (selon la convention retenue) des récupérations. Le document Morrison
// donne une colonne CuEq sans publier sa formule — d'où le choix ici d'un calcul
// EXPLICITE et paramétrable (jamais de constante cachée). Voir `useRecovery`.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { getMetal } from './registry';

/** Teneur, récupération et prix d'un métal pour une valorisation. */
export interface MetalAssay {
  /** Symbole canonique ('Cu', 'Au', …). */
  symbol: string;
  /** Teneur in situ, dans l'unité de teneur du métal (% ou g/t). */
  grade: number;
  /** Récupération métallurgique (fraction 0–1). */
  recovery: number;
  /** Prix ($ dans l'unité de prix du métal). */
  price: number;
  /**
   * Fraction payable (0–1) : part du métal récupéré effectivement payée par la
   * fonderie (déductions d'unité, humidité, pertes de manutention). 1 par défaut.
   */
  payable?: number;
}

/**
 * Masse payable-brute contenue dans 1 t de minerai, AVANT récupération, dans
 * l'unité de masse du prix du métal (lb pour un métal de base, oz troy pour un
 * précieux). = teneur × facteur pivot du registre.
 */
export function containedUnitsPerTonne(symbol: string, grade: number): number {
  return grade * getMetal(symbol).massPerTonnePerGrade;
}

/** Masse récupérée et payable par tonne (applique récupération et fraction payable). */
export function recoverableUnitsPerTonne(a: MetalAssay): number {
  const payable = a.payable ?? 1;
  return containedUnitsPerTonne(a.symbol, a.grade) * a.recovery * payable;
}

/** Valeur ($/t de minerai) apportée par un métal : masse récupérable × prix. */
export function metalValuePerTonne(a: MetalAssay): number {
  return recoverableUnitsPerTonne(a) * a.price;
}

/** Revenu récupérable total ($/t de minerai) du panier de métaux. */
export function revenuePerTonne(assays: MetalAssay[]): number {
  return assays.reduce((sum, a) => sum + metalValuePerTonne(a), 0);
}

/** Options de calcul de l'équivalent-métal. */
export interface EquivalentOptions {
  /** Symbole du métal de référence (ex. 'Cu' pour un CuEq, 'Au' pour un AuEq). */
  primary: string;
  /**
   * Inclure les récupérations dans l'équivalence (défaut : true).
   *   • true  → équivalent « récupérable » : chaque métal converti à sa valeur
   *     récupérée/payée (convention la plus fréquente et la plus honnête).
   *   • false → équivalent « in situ » : conversion aux seuls prix, récupérations
   *     ignorées (parfois utilisé pour un rapport de ressource brut).
   * Rendu EXPLICITE parce que le choix change le chiffre et n'est pas normalisé.
   */
  useRecovery?: boolean;
}

/**
 * Teneur-équivalente exprimée dans l'unité du métal de référence.
 *
 * Généralise le CuEq : on ramène la valeur $/t de chaque métal secondaire à une
 * teneur équivalente du métal primaire, via la valeur d'un « point de teneur »
 * du primaire (masse pivot × prix [× récupération]).
 *
 *   equiv = teneur_primaire + Σ_secondaires  valeur_i / valeurParUniteDeTeneur_primaire
 *
 * @throws si aucun assay ne correspond au métal primaire (référence introuvable).
 */
export function metalEquivalent(assays: MetalAssay[], opts: EquivalentOptions): number {
  const useRecovery = opts.useRecovery ?? true;
  const primary = assays.find(a => a.symbol === opts.primary);
  if (!primary) {
    throw new Error(`Équivalent impossible : métal de référence « ${opts.primary} » absent du panier.`);
  }

  // Valeur d'une unité de teneur du métal primaire ($ par 1 % ou par 1 g/t).
  const primaryPayable = primary.payable ?? 1;
  const primaryPerGrade =
    getMetal(primary.symbol).massPerTonnePerGrade *
    primary.price *
    (useRecovery ? primary.recovery * primaryPayable : 1);

  if (primaryPerGrade <= 0) {
    throw new Error(`Équivalent impossible : valeur unitaire du métal « ${opts.primary} » nulle (prix/récupération = 0).`);
  }

  let equiv = primary.grade;
  for (const a of assays) {
    if (a.symbol === opts.primary) continue;
    const payable = a.payable ?? 1;
    const contained = getMetal(a.symbol).massPerTonnePerGrade * a.grade;
    const value = useRecovery ? contained * a.recovery * payable * a.price : contained * a.price;
    equiv += value / primaryPerGrade;
  }
  return equiv;
}
