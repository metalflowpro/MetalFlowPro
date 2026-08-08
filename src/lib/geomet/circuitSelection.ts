// ─────────────────────────────────────────────────────────────────────────────
// Choix de la CONFIGURATION du circuit de comminution.
//
// Les moteurs voisins répondent à « quel P80 viser ? » (p80Optimization) et
// « quel P80 par étage ? » (p80Chain). Celui-ci répond à la question d'un cran
// au-dessus : **quel circuit bâtir** pour atteindre le P80 usine retenu.
//
// La sélection suit la pratique d'ingénierie usuelle : on part de la dureté du
// minerai (BWi), de la granulométrie ROM (F80) et de la finesse visée, puis on
// écarte les configurations qui ne tiennent pas. Chaque configuration porte son
// enchaînement d'étages, son énergie Bond et ses arguments pour/contre.
//
// ⚠️ Il n'existe PAS de règle normalisée de choix de circuit : c'est un
// arbitrage CAPEX/OPEX propre au site (tonnage, coût de l'énergie, abrasivité,
// disponibilité de l'eau, compétence de la main-d'œuvre). Ce moteur produit une
// RECOMMANDATION ARGUMENTÉE à confronter à un trade-off study, pas une décision.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { bondEnergy } from './p80';
import { DEFAULT_ASSUMPTIONS } from '../config/constants';
import { P80_FALLBACK_HEURISTICS } from './p80Optimization';

/** Configuration de circuit de comminution reconnue. */
export type ComminutionCircuitId =
  | 'sab'            // Concassage primaire + SAG + Ball
  | 'sabc'           // idem + concasseur à galets (pebble crusher)
  | 'crush_ball'     // Concassage 3 étages + Ball mill
  | 'hpgr_ball'      // Concassage + HPGR + Ball
  | 'single_sag';    // SAG seul (autogène/semi-autogène en une passe)

/** Un étage du circuit retenu, avec sa réduction et son énergie. */
export interface CircuitStage {
  label: string;
  f80Um: number;
  p80Um: number;
  /** Indice de travail appliqué (CWi en concassage, BWi en broyage). */
  wiKwhT: number;
  specificEnergyKwhT: number;
}

/** Configuration évaluée. */
export interface CircuitOption {
  id: ComminutionCircuitId;
  label: string;
  /** Enchaînement des étages, du ROM au produit final. */
  stages: CircuitStage[];
  /** Énergie de comminution totale (kWh/t). */
  totalEnergyKwhT: number;
  /** Puissance installée requise (kW) si le débit est connu. */
  powerRequiredKw: number | null;
  /** Vrai si la configuration est applicable au cas (dureté, finesse, ROM). */
  eligible: boolean;
  /** Pourquoi elle est retenue ou écartée. */
  rationale: string;
  /** Indicateurs relatifs — arbitrage, pas des montants. */
  capex: 'low' | 'medium' | 'high';
  opex: 'low' | 'medium' | 'high';
}

export interface CircuitRecommendation {
  /** Configuration recommandée (null si aucune n'est applicable). */
  recommended: CircuitOption | null;
  /** Toutes les configurations évaluées, la recommandée en tête. */
  options: CircuitOption[];
  /** Synthèse lisible du choix. */
  summary: string;
}

/**
 * Seuils de sélection du circuit.
 *
 * ⚠️ Bornes de JUGEMENT d'ingénierie, à recaler sur les essais et le trade-off
 * study du projet. Elles reflètent la pratique d'un circuit or conventionnel ;
 * un projet à énergie très chère ou à minerai très abrasif les déplacera.
 */
export const CIRCUIT_SELECTION_THRESHOLDS = {
  /** BWi (kWh/t) au-delà duquel le minerai est jugé DUR : les galets s'accumulent en SAG. */
  hardOreBwi: 15,
  /** BWi (kWh/t) au-delà duquel on considère le HPGR pour son rendement énergétique. */
  veryHardOreBwi: 18,
  /** Débit (t/h) au-delà duquel le CAPEX du HPGR s'amortit. */
  hpgrMinThroughputTph: 1500,
  /** P80 final (µm) au-delà duquel un SAG seul peut suffire (pas de broyage fin). */
  singleSagMaxFinenessUm: 300,
  /** F80 ROM (µm) au-delà duquel un concassage primaire est indispensable. */
  primaryCrushRequiredF80Um: 200_000,
} as const;

/** Étages intermédiaires typiques (µm) — cibles de transition entre étages. */
export const CIRCUIT_STAGE_TARGETS = {
  /** Produit du concassage primaire (µm). */
  primaryCrushP80Um: 100_000,
  /** Produit du concassage secondaire (µm). */
  secondaryCrushP80Um: 30_000,
  /** Produit du concassage tertiaire (µm). */
  tertiaryCrushP80Um: 8_000,
  /** Produit du HPGR (µm). */
  hpgrP80Um: 4_000,
  /** Produit du SAG, alimentation du ball mill (µm). */
  sagP80Um: 1_500,
} as const;

export interface CircuitSelectionInputs {
  /** Indice de Bond ball (kWh/t) — dureté du minerai. */
  bwiKwhT: number;
  /** Indice de concassage (kWh/t). À défaut, dérivé du BWi. */
  cwiKwhT?: number | null;
  /** F80 du ROM (µm). */
  romF80Um: number;
  /** P80 final visé en usine (µm). */
  targetP80Um: number;
  /** Débit usine (t/h) — sert à la puissance requise et à l'éligibilité du HPGR. */
  throughputTph?: number | null;
  /** Présence d'un regrind en aval (concentré) — n'entre pas dans le choix du circuit primaire. */
  withRegrind?: boolean;
}

function stage(label: string, f80Um: number, p80Um: number, wiKwhT: number): CircuitStage {
  return { label, f80Um, p80Um, wiKwhT, specificEnergyKwhT: bondEnergy(wiKwhT, f80Um, p80Um) };
}

function totalise(stages: CircuitStage[], throughputTph: number | null | undefined) {
  const total = stages.reduce((s, st) => s + st.specificEnergyKwhT, 0);
  return {
    totalEnergyKwhT: total,
    powerRequiredKw: throughputTph != null && throughputTph > 0 ? total * throughputTph : null,
  };
}

/**
 * Évalue les configurations de circuit et recommande la plus adaptée.
 *
 * Hiérarchie de décision (la même qu'un ingénieur procédé applique) :
 *   1. Faisabilité — la configuration atteint-elle la finesse visée ?
 *   2. Dureté — un SAG sur minerai dur accumule les galets → SABC ou concassage.
 *   3. Énergie — à faisabilité égale, l'énergie de comminution la plus basse.
 *   4. CAPEX — à énergie comparable, la configuration la plus simple.
 */
export function recommendComminutionCircuit(inputs: CircuitSelectionInputs): CircuitRecommendation {
  const T = CIRCUIT_SELECTION_THRESHOLDS;
  const S = CIRCUIT_STAGE_TARGETS;
  const bwi = inputs.bwiKwhT;
  const cwi = inputs.cwiKwhT ?? Math.max(
    P80_FALLBACK_HEURISTICS.cwiFloor,
    bwi * P80_FALLBACK_HEURISTICS.cwiFromBwiRatio,
  );
  const rom = inputs.romF80Um;
  const target = inputs.targetP80Um;
  const tph = inputs.throughputTph ?? null;

  if (!(bwi > 0) || !(rom > 0) || !(target > 0)) {
    return { recommended: null, options: [], summary: 'Données insuffisantes : BWi, F80 ROM et P80 cible doivent être renseignés et positifs.' };
  }
  if (target >= rom) {
    return { recommended: null, options: [], summary: `P80 cible (${Math.round(target)} µm) ≥ F80 ROM (${Math.round(rom)} µm) : aucune réduction à réaliser.` };
  }

  const isHard = bwi >= T.hardOreBwi;
  const isVeryHard = bwi >= T.veryHardOreBwi;
  const needsFineGrind = target < T.singleSagMaxFinenessUm;
  const primaryP80 = Math.min(S.primaryCrushP80Um, rom * 0.5);

  const options: CircuitOption[] = [];

  // ── SAB — concassage primaire + SAG + ball ────────────────────────────────
  {
    const stages = [
      stage('Concassage primaire', rom, primaryP80, cwi),
      stage('Broyage SAG', primaryP80, S.sagP80Um, bwi),
      stage('Broyage ball mill', S.sagP80Um, target, bwi),
    ];
    const t = totalise(stages, tph);
    options.push({
      id: 'sab', label: 'SAB — Concassage primaire + SAG + Ball mill',
      stages, ...t,
      eligible: needsFineGrind && !isHard,
      rationale: isHard
        ? `Écarté : BWi ${bwi.toFixed(1)} kWh/t ≥ ${T.hardOreBwi} — un minerai dur génère des galets qui s'accumulent dans le SAG et bride le débit. Prévoir un concasseur à galets (SABC).`
        : `Circuit conventionnel le plus simple. BWi ${bwi.toFixed(1)} kWh/t < ${T.hardOreBwi} : le SAG casse le minerai sans accumulation de galets notable.`,
      capex: 'medium', opex: 'medium',
    });
  }

  // ── SABC — SAB + concasseur à galets ──────────────────────────────────────
  {
    const stages = [
      stage('Concassage primaire', rom, primaryP80, cwi),
      stage('Broyage SAG', primaryP80, S.sagP80Um, bwi),
      stage('Concasseur à galets', S.sagP80Um * 4, S.sagP80Um, cwi),
      stage('Broyage ball mill', S.sagP80Um, target, bwi),
    ];
    const t = totalise(stages, tph);
    options.push({
      id: 'sabc', label: 'SABC — SAB + concasseur à galets',
      stages, ...t,
      eligible: needsFineGrind,
      rationale: isHard
        ? `Adapté à un minerai dur (BWi ${bwi.toFixed(1)} kWh/t) : le concasseur à galets évacue la recirculation critique du SAG et sécurise le débit.`
        : `Applicable, mais le concasseur à galets ajoute du CAPEX peu utile à BWi ${bwi.toFixed(1)} kWh/t.`,
      capex: 'high', opex: 'medium',
    });
  }

  // ── Concassage 3 étages + ball mill ───────────────────────────────────────
  {
    const stages = [
      stage('Concassage primaire', rom, primaryP80, cwi),
      stage('Concassage secondaire', primaryP80, S.secondaryCrushP80Um, cwi),
      stage('Concassage tertiaire', S.secondaryCrushP80Um, S.tertiaryCrushP80Um, cwi),
      stage('Broyage ball mill', S.tertiaryCrushP80Um, target, bwi),
    ];
    const t = totalise(stages, tph);
    options.push({
      id: 'crush_ball', label: 'Concassage 3 étages + Ball mill',
      stages, ...t,
      eligible: needsFineGrind,
      rationale: isHard
        ? `Robuste sur minerai dur : le concassage étagé est insensible aux galets, au prix de plus d'équipements et d'entretien mécanique.`
        : `Applicable ; plus d'équipements à entretenir qu'un SAB pour un gain d'énergie limité.`,
      capex: 'high', opex: 'medium',
    });
  }

  // ── HPGR + ball mill ─────────────────────────────────────────────────────
  {
    const stages = [
      stage('Concassage primaire', rom, primaryP80, cwi),
      stage('Concassage secondaire', primaryP80, S.secondaryCrushP80Um, cwi),
      stage('HPGR', S.secondaryCrushP80Um, S.hpgrP80Um, cwi),
      stage('Broyage ball mill', S.hpgrP80Um, target, bwi),
    ];
    const t = totalise(stages, tph);
    const tonnageOk = tph == null || tph >= T.hpgrMinThroughputTph;
    options.push({
      id: 'hpgr_ball', label: 'HPGR + Ball mill',
      stages, ...t,
      eligible: needsFineGrind && isVeryHard && tonnageOk,
      rationale: !isVeryHard
        ? `Écarté : le HPGR se justifie surtout au-delà de BWi ${T.veryHardOreBwi} kWh/t (ici ${bwi.toFixed(1)}), où son rendement énergétique compense son CAPEX.`
        : !tonnageOk
          ? `Écarté : débit ${tph} t/h < ${T.hpgrMinThroughputTph} t/h — le CAPEX du HPGR ne s'amortit pas.`
          : `Minerai très dur (BWi ${bwi.toFixed(1)} kWh/t) et débit suffisant : le HPGR réduit l'énergie et pré-fissure le minerai, ce qui allège le broyage aval.`,
      capex: 'high', opex: 'low',
    });
  }

  // ── SAG seul ─────────────────────────────────────────────────────────────
  {
    const stages = [
      stage('Concassage primaire', rom, primaryP80, cwi),
      stage('Broyage SAG (une passe)', primaryP80, target, bwi),
    ];
    const t = totalise(stages, tph);
    options.push({
      id: 'single_sag', label: 'SAG seul (une passe)',
      stages, ...t,
      eligible: !needsFineGrind && !isHard,
      rationale: needsFineGrind
        ? `Écarté : un SAG seul ne descend pas à ${Math.round(target)} µm — sous ${T.singleSagMaxFinenessUm} µm un broyeur à boulets est nécessaire.`
        : `Suffisant : P80 visé ${Math.round(target)} µm ≥ ${T.singleSagMaxFinenessUm} µm et minerai non dur — le circuit le plus simple et le moins cher.`,
      capex: 'low', opex: 'medium',
    });
  }

  // Éligibles d'abord, puis énergie croissante, puis CAPEX le plus faible.
  const capexRank = { low: 0, medium: 1, high: 2 } as const;
  const sorted = [...options].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (Math.abs(a.totalEnergyKwhT - b.totalEnergyKwhT) > 0.5) return a.totalEnergyKwhT - b.totalEnergyKwhT;
    return capexRank[a.capex] - capexRank[b.capex];
  });

  const recommended = sorted.find(o => o.eligible) ?? null;
  const summary = recommended
    ? `${recommended.label} — ${recommended.totalEnergyKwhT.toFixed(1)} kWh/t de comminution pour descendre de ${Math.round(rom / 1000)} mm à ${Math.round(target)} µm.`
    : `Aucune configuration standard ne couvre ce cas (BWi ${bwi.toFixed(1)} kWh/t, ROM ${Math.round(rom)} µm → ${Math.round(target)} µm) : un trade-off study spécifique est nécessaire.`;

  return { recommended, options: sorted, summary };
}

/** Coût énergétique annuel indicatif d'une configuration ($/t). */
export function circuitEnergyCostUsdT(
  option: CircuitOption,
  elecCostUsdKwh: number = DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH,
): number {
  return option.totalEnergyKwhT * elecCostUsdKwh;
}
