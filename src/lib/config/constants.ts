// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Physical & financial constants (single source of truth)
//
// This module centralises values that were previously hardcoded (and duplicated)
// across modules. Two tiers:
//   1. PHYSICAL_CONSTANTS  — immutable physical/units constants (never per-project).
//   2. DEFAULT_ASSUMPTIONS — versioned default economic/operational assumptions,
//      overridable per project via the `project_settings` table (see resolveSettings).
//
// Rule of thumb: if a number has a physical/units meaning it belongs in
// PHYSICAL_CONSTANTS; if it is an economic or operating assumption a user could
// legitimately change, it belongs in DEFAULT_ASSUMPTIONS and must be overridable.
// ─────────────────────────────────────────────────────────────────────────────

/** Immutable physical & unit-conversion constants. */
export const PHYSICAL_CONSTANTS = {
  /** Grams per troy ounce (exact, per international troy weight). */
  TROY_OZ_GRAMS: 31.1035,
  /** Troy ounces per kilogram = 1000 / 31.1035. */
  TROY_OZ_PER_KG: 1000 / 31.1035,
  /** Calendar hours in a (non-leap) year. */
  HOURS_PER_YEAR: 8760,
  /** Avoirdupois pounds per metric tonne (1000 kg). Used to value %-grade base metals priced in USD/lb. */
  LB_PER_TONNE: 2204.6226218,
  /** Standard gravitational acceleration (m/s²). Used for lift/hydraulic power. */
  GRAVITY_M_S2: 9.80665,
  /** Faraday constant (C/mol) — electrowinning deposition (Faraday's law). */
  FARADAY_C_PER_MOL: 96485.332,
  /** Molar mass of gold (g/mol). */
  AU_MOLAR_MASS_G_PER_MOL: 196.966569,
} as const;

/** Convenience scalar re-exports (kept in sync with PHYSICAL_CONSTANTS). */
export const TROY_OZ_GRAMS = PHYSICAL_CONSTANTS.TROY_OZ_GRAMS;
export const TROY_OZ_PER_KG = PHYSICAL_CONSTANTS.TROY_OZ_PER_KG;
export const HOURS_PER_YEAR = PHYSICAL_CONSTANTS.HOURS_PER_YEAR;
export const LB_PER_TONNE = PHYSICAL_CONSTANTS.LB_PER_TONNE;
export const GRAVITY_M_S2 = PHYSICAL_CONSTANTS.GRAVITY_M_S2;

/** Convert a gold mass in kilograms to troy ounces. */
export function kgToTroyOz(kg: number): number {
  return kg * TROY_OZ_PER_KG;
}

/** Convert a gold mass in grams to troy ounces. */
export function gramsToTroyOz(g: number): number {
  return g / TROY_OZ_GRAMS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Currency — USD is the platform's reference currency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * USD per 1 CAD.
 *
 * Every cost in the app is expressed and displayed in USD. This rate exists
 * solely to convert the CAD-denominated engineering benchmarks the OPEX model
 * was originally built from (Québec labour rates, diesel, grid power) into that
 * reference currency.
 *
 * ⚠️ Market rate, not a physical constant — it drifts. Review before publishing
 * a study; prefer capturing costs directly in USD over relying on this.
 */
export const USD_PER_CAD = 0.73;

/** Convert a CAD-denominated benchmark to the reference currency (USD). */
export function cadToUsd(cad: number): number {
  return cad * USD_PER_CAD;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default economic / operational assumptions (overridable per project)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Documented default assumptions. These are the code-versioned fallbacks used
 * when a project has not (yet) supplied a value in `project_settings`.
 * Sources/rationale are noted so figures remain auditable and defensible.
 */
export const DEFAULT_ASSUMPTIONS = {
  /** Discount rate for NPV (fraction). 8% is the mining-industry base case for gold PFS/FS. */
  DISCOUNT_RATE: 0.08,
  /** Plant availability (fraction) fallback when a project has no explicit value. */
  AVAILABILITY_FRACTION: 0.91,
  /** Life-of-mine (years) fallback for cash-flow horizon. */
  LOM_YEARS: 10,
  /** Gold price ($/oz) used for base-case economics when none supplied. */
  GOLD_PRICE_USD_OZ: 2000,
  /** Gold-price ladder ($/oz) for NPV sensitivity analysis. */
  GOLD_PRICE_SENSITIVITY: [1600, 1800, 2000, 2200, 2500, 3000] as number[],
  /**
   * Gravity-plant efficiency factor applied to GRG lab recovery to estimate the
   * installed gravity-circuit recovery (lab GRG over-states plant performance).
   * ~0.90 is a conventional derating for Knelson/Falcon centrifugal circuits.
   */
  GRAVITY_PLANT_EFFICIENCY: 0.90,
  /**
   * Leach-plant transfer factor applied to the lab bottle-roll recovery to
   * estimate the installed CIL/CIP circuit recovery (soluble losses, carbon
   * management, residence-time distribution). ~0.95 is a conventional
   * lab-to-plant discount for cyanidation circuits.
   *
   * Single source: ProjectContext (global recovery) and the Analytics route
   * engine both apply it — they previously disagreed (92.6 % vs 90 %) because
   * only the route engine discounted the lab figure.
   */
  LEACH_PLANT_EFFICIENCY: 0.95,
  /**
   * Plant-vs-lab grinding inefficiency factor (Wio / Wi), applied to the Bond
   * work index measured in the lab to estimate the energy a real mill needs.
   *
   * A lab Bond ball mill grinds more efficiently than an industrial circuit:
   * classification inefficiency, recycle load, liner wear and slurry rheology all
   * inflate the operating work index above the lab value. 1.0 = "as measured";
   * gold plants commonly sit around 1.1–1.35. Overridable per project.
   *
   * Note this is the OVERALL factor only — the size-dependent Rowland EF5 fineness
   * correction is applied separately and automatically (see rowlandEF5).
   */
  PLANT_LAB_GRIND_FACTOR: 1.15,
  /**
   * Electricity cost (USD/kWh) — the single source shared by the Economics OPEX
   * model and Granulometry's optimal-P80 energy trade-off.
   *
   * Derived from the OPEX model's engineering benchmark of 0.092 CAD/kWh
   * (Québec industrial grid power) converted at USD_PER_CAD. Granulometry
   * previously used a self-described "nominal" 0.08 USD/kWh, so the two modules
   * priced the same kWh differently; they now agree on this value.
   */
  ELECTRICITY_COST_USD_KWH: USD_PER_CAD * 0.092,
  /** Refining/smelting charge ($/oz) fallback for doré. */
  REFINERY_CHARGE_USD_OZ: 5,
  /** Mining royalty (fraction of revenue) fallback. */
  ROYALTY_FRACTION: 0.03,
  /** Working capital as a fraction of first-year CAPEX. */
  WORKING_CAPITAL_FRACTION: 0.10,
  /** Contingency (fraction) applied to CAPEX estimates. */
  CONTINGENCY_FRACTION: 0.15,
  /**
   * Annual maintenance + spare parts, as a fraction of initial CAPEX. Used by the
   * OPEX generator to produce a single "Maintenance & pièces" line.
   *
   * Sustaining maintenance is conventionally expressed as a % of installed
   * capital, but the rate is site-specific: an abrasive ore, a remote site with
   * long lead times, or an ageing plant all push it up. 3.5 %/yr is a
   * conventional greenfield gold-plant figure.
   */
  MAINTENANCE_CAPEX_FRACTION_YR: 0.035,
  /**
   * Spare-parts-ONLY annual consumption, as a fraction of initial CAPEX.
   *
   * ⚠️ Deliberately distinct from MAINTENANCE_CAPEX_FRACTION_YR: the detailed
   * OPEX table itemises labour separately, so it needs the parts-only slice,
   * whereas the OPEX generator emits one combined maintenance line. The two
   * must not be confused — the difference (~1.5 pts) is the maintenance labour
   * already counted in the labour table. Keeping both named and documented
   * prevents someone "harmonising" them into a double count.
   */
  SPARE_PARTS_CAPEX_FRACTION_YR: 0.02,
  /**
   * Bond BALL mill work index (kWh/t) assumed when a domain, a lot or a project
   * has no measured BWi yet.
   *
   * ⚠️ La broyabilité est LA propriété la plus spécifique au minerai : elle
   * pilote la puissance installée, donc une part majeure du CAPEX et de l'OPEX
   * énergétique. Un minerai tendre oxydé (~8 kWh/t) et un porphyre silicifié
   * frais (~22 kWh/t) diffèrent d'un facteur 3 sur la même équation de Bond. Ce
   * repli n'est là que pour qu'un écran reste lisible avant l'essai Bond — il
   * ne doit JAMAIS servir de base à un dimensionnement publié.
   *
   * Source unique : GéoMet portait 16.8 (6 occurrences), Criteria 16.5 et le
   * simulateur 16 — trois valeurs pour une même grandeur.
   */
  DEFAULT_BOND_BALL_WI_KWH_T: 16.5,
  /**
   * Bond ROD mill work index (kWh/t) par défaut. Grandeur DISTINCTE du BWi
   * (essai sur broyeur à barres, granulométrie d'alimentation plus grossière) —
   * à ne pas fusionner avec DEFAULT_BOND_BALL_WI_KWH_T.
   */
  DEFAULT_BOND_ROD_WI_KWH_T: 17.2,
  /**
   * Paid hours per full-time employee per year, for labour-cost build-up.
   * 2080 h = 40 h/week × 52 weeks (North American convention). Jurisdictions
   * with a 35-h week or statutory leave differ materially — and rotating
   * fly-in/fly-out schedules differ again.
   */
  LABOUR_HOURS_PER_FTE_YR: 2080,
  /**
   * Ore specific gravity fallback (t/m³) used ONLY when a project/record has no
   * measured SG yet (e.g. a fresh project, a block-model row with a blank/zero
   * density column, a simulation feed node before testwork data is entered).
   *
   * Rock SG varies enormously by deposit and even within one deposit (oxide cap
   * vs. sulphide core, silicate vs. sulphide-rich zones, BIF-hosted iron ore is
   * 3.5–4.5+): a single mine can legitimately span 2.3–4.5 t/m³. 2.7 t/m³ is only
   * an order-of-magnitude placeholder for a typical silicate host rock (porphyry/
   * granite country rock) — it must never substitute for LIMS-measured SG in a
   * published estimate. Every previously-duplicated occurrence of this fallback
   * (ResourceEstimation, BlockModel import, MineOpt blast plan, simulation feed
   * nodes, Criteria default inputs) now reads this single constant so a future
   * change only has to happen once.
   */
  DEFAULT_ORE_SG_T_M3: 2.7,
  /** NaCN delivered cost used by the simulation screening OPEX (USD/kg). */
  CYANIDE_COST_USD_KG: 2.5,
  /** Quicklime delivered cost used by the simulation screening OPEX (USD/kg). */
  LIME_COST_USD_KG: 0.12,
  /** Grinding-media (forged steel balls) delivered cost — simulation screening OPEX (USD/kg). */
  GRINDING_MEDIA_COST_USD_KG: 1.2,
  /**
   * Activated (coconut) carbon delivered cost — CIP/CIL make-up carbon (USD/kg).
   * Même classe que les autres prix réactifs ci-dessus : prix de screening,
   * surchargeable par projet. N'entre dans l'OPEX que des circuits à charbon.
   */
  ACTIVATED_CARBON_COST_USD_KG: 3.0,
  /**
   * Grinding-media consumption factor (g steel per kWh of milling energy). Ties
   * the screening OPEX media line to the comminution energy the engine already
   * computes, instead of a standalone kg/t literal. Ore-abrasivity dependent —
   * overridable per project. ~90 g/kWh is a common ball-mill benchmark.
   */
  GRINDING_MEDIA_G_PER_KWH: 90,
  /**
   * Fallback design capacity (t/h) for a unit whose model exposes no capacity
   * parameter — used only so utilization has a denominator; the real value comes
   * from the unit's own capacity parameter or from project data.
   */
  DEFAULT_UNIT_CAPACITY_TPH: 500,
  /**
   * Target overall plant gold recovery (%). A simulated run below this raises a
   * NON-blocking warning inviting the user to source/adjust unit parameters from
   * testwork. Design/ore dependent — read from design criteria, overridable.
   */
  TARGET_OVERALL_RECOVERY_PCT: 90,
  /**
   * Rendements de la section ADR (élution AARL + électro-extraction). Dans un
   * circuit réel, le carbone/la solution barren RECIRCULENT : la perte nette d'or
   * de la section est faible (<1 %). Le modèle de screening étant en once-through,
   * ces rendements élevés (config, surchargeables) évitent une sous-estimation
   * artificielle de la récupération globale. Cf. §7 ADR — remplacent des plafonds
   * codés en dur (min(98,…) / min(97,…)) dans les modèles d'unités.
   */
  ADR_ELUTION_BASE_PCT: 96,
  ADR_ELUTION_PER_CYCLE_PCT: 1.5,
  ADR_ELUTION_MAX_PCT: 99.5,
  ADR_ELECTROWINNING_MAX_PCT: 99.5,
  /**
   * Récupérations métallurgiques de conception par DÉFAUT pour un minerai
   * free-milling (couche config, surchargeable par les essais/critères du projet
   * via le connecteur). Elles fixent le comportement d'un flowsheet NEUF tant que
   * la testwork n'est pas renseignée — jamais des littéraux dans les modèles.
   * Valeurs types d'un circuit Gravité+Flottation+CIL bien conçu.
   */
  FLOTATION_AU_RECOVERY_FREEMILLING_PCT: 95,
  /**
   * Fraction (%) de la SOUSVERSE (underflow) du cyclone effectivement PURGÉE vers
   * le circuit de gravité (Knelson/Falcon).
   *
   * ⚠️ RÈGLE DE CONCEPTION : on ne fait PAS passer toute la sousverse en gravité —
   * seule une petite saignée de la charge circulante y est envoyée (le reste
   * recircule / poursuit vers la lixiviation). ~20 % est la valeur de conception
   * courante d'un circuit gravimétrique sur charge circulante. Surchargeable par
   * les données du projet (essai GRG, capacité du concentrateur). Utilisée par les
   * templates gravité comme % du diviseur « Purge gravité » — jamais un littéral.
   */
  GRAVITY_UNDERFLOW_BLEED_PCT: 20,
  CIL_RETENTION_FREEMILLING_H: 34,
  CIL_NACN_FREEMILLING_KG_T: 0.6,
  /**
   * Consommation de chaux (kg/t) par défaut d'un circuit free-milling (contrôle du
   * pH de cyanuration). Même classe que `CIL_NACN_FREEMILLING_KG_T` : repli de
   * screening quand aucun `process_factors` mesuré n'existe encore, surchargeable.
   */
  LIME_CONSUMPTION_FREEMILLING_KG_T: 1.0,
  /**
   * Facteur d'amortissement (relaxation λ) de la substitution successive sur les
   * courants de recyclage (§9 étape 8) : x^{k+1} = λ·x_calc + (1−λ)·x^k. Une
   * valeur dans [0,2 ; 0,7] stabilise les boucles (charge circulante broyage,
   * eau recyclée) sans trop ralentir. Surchargeable par run.
   */
  SIM_RECYCLE_RELAXATION_FACTOR: 0.5,
  /** Maximum reportable metallurgical recovery; 100 means no artificial cap. */
  MAX_REPORTABLE_RECOVERY_PCT: 100,
  /**
   * Absolute tolerance (percentage points) between the gold recovery a P80 study
   * recomputes from the metal balance (Mc·Cc / Mf·Cf) and the recovery reported by
   * the lab. Beyond it, the study flags the result for review rather than trusting
   * either figure. Site/QA-policy dependent: a well-controlled lab and a
   * variability campaign warrant different tolerances — overridable per project.
   */
  RECOVERY_RECON_TOLERANCE_PCT: 2,
} as const;

/**
 * Study-level defaults for the P80 optimisation module (Granulométrie / Étude P80).
 *
 * These are PRE-FILLED starting points a metallurgist edits per study, not fixed
 * rules — grouped and documented here rather than hardcoded in the page so a
 * re-default is a single visible edit.
 *  - `TARGETS_UM`: the P80 ladder a new study proposes comparing. Round sieve
 *    sizes spanning coarse→fine; the real set depends on the ore and the mill.
 *  - `CONFIDENCE_SAMPLE_THRESHOLDS`: how many approved samples back a
 *    low/medium/high confidence recommendation. Representativity, not just count,
 *    ultimately governs confidence — this only seeds the indicator.
 */
export const P80_STUDY_DEFAULTS = {
  TARGETS_UM: [150, 106, 75, 53] as number[],
  CONFIDENCE_SAMPLE_THRESHOLDS: { medium: 3, high: 6 },
} as const;

/**
 * Seuils de GOUVERNANCE du module Prédiction IA (Analytics).
 *
 * ⚠️ Ce sont des paramètres de gouvernance, PAS des constantes scientifiques :
 * ils fixent à partir de quand le module s'autorise à émettre une recommandation
 * automatique plutôt qu'un simple résultat exploratoire. Ils doivent pouvoir être
 * modifiés par un administrateur métallurgique (d'où leur centralisation ici),
 * jamais codés en dur dans la page. Un modèle qui apprend 12 essais mais généralise
 * à 4 % hors échantillon ne doit pas présenter « 79,9 % » comme une prédiction fiable.
 *
 *  - MIN_SAMPLES : en deçà, le statut reste « exploratoire » (base trop mince).
 *  - MIN_VALIDATION_R2 : R² de validation croisée minimal pour autoriser une reco.
 *  - MAX_OVERFIT_GAP : écart R²(in-sample) − R²(validation) maximal toléré.
 *  - MAX_P80_DEVIATION_FRACTION : écart relatif max entre P80 cible et P80 réel.
 *  - MIN_P80_LEVELS / MIN_REPLICATES_PER_LEVEL : plan d'essais minimal pour
 *    identifier l'effet du P80 (sinon il reste confondu avec GRG / Au libre).
 */
export const AI_GOVERNANCE = {
  MIN_SAMPLES: 20,
  MIN_VALIDATION_R2: 0.5,
  MAX_OVERFIT_GAP: 0.2,
  MAX_P80_DEVIATION_FRACTION: 0.1,
  MIN_P80_LEVELS: 4,
  MIN_REPLICATES_PER_LEVEL: 2,
} as const;

/** Seuils de gouvernance, élargis en `number` : surchargables par un administrateur. */
export type AiGovernance = { [K in keyof typeof AI_GOVERNANCE]: number };

/**
 * Default cut-off grade ladders swept by the resource grade-tonnage curve
 * (Resource Estimation page), keyed by grade unit ('g/t' precious metals,
 * 'pct' base metals). These are illustrative round-number sweep points, NOT the
 * project's economic cut-off — the real cut-off must be derived from NSR/opex
 * (see the Economics module) and confirmed by the Qualified Person. Editable
 * per run in the UI; this is only the pre-filled default.
 */
export const RESOURCE_CUTOFF_LADDERS: Record<'pct' | 'g/t', number[]> = {
  'g/t': [0, 0.2, 0.3, 0.5, 0.7, 1.0],
  'pct': [0, 0.15, 0.20, 0.25, 0.30, 0.40],
};

/**
 * Ambient conditions assumed for a fresh ore feed stream in the flowsheet
 * simulator, before any reagent addition or heating.
 *
 * ⚠️ Site-dependent, not universal:
 *   - `pH`: raw ore slurry is assumed neutral, but a sulphide ore generating
 *     acid (ARD) or a carbonate-hosted ore can enter the circuit well away from
 *     7, which changes the lime demand the simulator computes downstream.
 *   - `temperatureC`: ambient feed temperature drives leach kinetics. A tropical
 *     site and a sub-arctic one differ by 30 °C or more on the same flowsheet.
 *
 * Single source shared by `simulation/engine.ts` (feedToStream), the feed node
 * in `simulation/unitRegistry.ts` and `emptyStream()` — the three previously
 * disagreed (20 °C in the two feed constructors, 25 °C in emptyStream) for what
 * is the same physical quantity.
 */
export const FEED_STREAM_DEFAULTS = {
  pH: 7,
  temperatureC: 20,
} as const;

/**
 * Carbon-pricing sensitivity — GHG intensity default and price ladder used by
 * the Economics > Sensitivity tab's carbon-pricing impact table.
 *
 * ⚠️ Both figures are project/jurisdiction-specific policy & engineering inputs,
 * not physical constants:
 *   - EMISSION_FACTOR_T_CO2E_PER_TONNE_ORE: Scope 1+2 GHG intensity per tonne
 *     milled (diesel fleet + grid/on-site power, per tonne of ore processed).
 *     It depends on the grid mix (hydro vs. diesel/coal), haul profile and
 *     process route, and can span an order of magnitude between sites. 0.5
 *     tCO2e/t is only an order-of-magnitude placeholder — replace with the
 *     project's actual carbon footprint study (Scope 1+2, e.g. per ISO 14064-1)
 *     before publication.
 *   - CARBON_PRICE_LADDER_USD_T: $/tCO2e price points swept for the impact
 *     table. Carbon pricing is set by jurisdiction and changes yearly (e.g.
 *     Canada's federal backstop, the EU ETS, California cap-and-trade all sit
 *     at different, moving price levels) — confirm against the project's
 *     regulatory jurisdiction before use.
 */
export const CARBON_ASSUMPTIONS = {
  EMISSION_FACTOR_T_CO2E_PER_TONNE_ORE: 0.5,
  CARBON_PRICE_LADDER_USD_T: [0, 25, 50, 75, 100, 150, 200] as number[],
} as const;

/**
 * Default swing amplitudes for the NPV tornado (one variable at a time). Kept
 * here with the other economic assumptions rather than hardcoded in the page, so
 * they are documented, shared, and overridable via the same defaults+DB pattern.
 *
 * `pct` variables swing by ±fraction of their base value; `absolute` variables
 * (the discount rate) swing by ± an absolute amount in the variable's own units.
 */
export const SENSITIVITY_SWINGS = {
  goldPrice:    { kind: 'pct' as const, amount: 0.30 },  // ±30 % gold price
  grade:        { kind: 'pct' as const, amount: 0.20 },  // ±20 % head grade
  throughput:   { kind: 'pct' as const, amount: 0.15 },  // ±15 % throughput
  recovery:     { kind: 'pct' as const, amount: 0.05 },  // ±5 % recovery
  capex:        { kind: 'pct' as const, amount: 0.20 },  // ±20 % initial CAPEX
  opex:         { kind: 'pct' as const, amount: 0.20 },  // ±20 % OPEX
  discountRate: { kind: 'absolute' as const, amount: 0.02 }, // ±2 pts discount rate
} as const;

/**
 * Seuils de GOUVERNANCE des écrans de support de l'Intelligence Géométallurgique
 * (Qualité & couverture des données, Validation & réconciliation).
 *
 * ⚠️ Ce ne sont PAS des constantes scientifiques : ils fixent à partir de quand
 * un domaine est jugé suffisamment caractérisé, quand sa variabilité est jugée
 * excessive, et quand un écart prédiction↔usine devient significatif. Ils doivent
 * pouvoir être ajustés par un responsable métallurgique (d'où leur centralisation
 * ici), jamais codés en dur dans la page.
 *
 *  - CONFIDENCE_SAMPLE_THRESHOLDS : nombre d'essais métallurgiques approuvés
 *    requis pour hisser la confiance d'un domaine à « moyenne » puis « élevée ».
 *  - VARIABILITY_SPREAD_PT : écart P90−P10 de récupération (points de %) au-delà
 *    duquel un domaine est classé « Variable » puis « Très variable ».
 *  - RECON_GAP_PT : écart absolu prédiction↔usine (points de %) séparant les
 *    statuts « Acceptable » / « À revoir » / « Réviser modèle ».
 *  - RECON_SYSTEMATIC_BIAS_PT : biais moyen signé (points) au-delà duquel le
 *    module signale une dérive systématique et propose une recalibration.
 */
export const GEOMET_GOVERNANCE = {
  CONFIDENCE_SAMPLE_THRESHOLDS: { medium: 6, high: 12 },
  VARIABILITY_SPREAD_PT: { variable: 6, veryVariable: 12 },
  RECON_GAP_PT: { acceptable: 2, review: 5 },
  RECON_SYSTEMATIC_BIAS_PT: 2,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Settings resolver: merge DB overrides (project_settings) over code defaults
// ─────────────────────────────────────────────────────────────────────────────

/** Subset of project_settings fields relevant to economic/operational resolution. */
export interface ResolvableSettings {
  hours_per_year: number | null;
  discount_rate_pct: number | null;
  sustaining_capex_musd_yr: number | null;
  contingency_pct: number | null;
  lom_years: number | null;
  refinery_charge_usd_oz: number | null;
  royalty_pct: number | null;
  working_capital_pct: number | null;
}

/** Fully-resolved assumptions (defaults with any project override applied). */
export interface ResolvedAssumptions {
  hoursPerYear: number;
  discountRate: number;       // fraction
  lomYears: number;
  contingencyFraction: number;
  refineryChargeUsdOz: number;
  royaltyFraction: number;
  workingCapitalFraction: number;
}

export interface ProductionProjectInput {
  target_tph: number;
  availability_pct: number;
  gold_grade_g_t: number;
}

export interface ProductionMetrics {
  annualTonnes: number;
  annualOz: number;
}

/**
 * Parse a settings-editor input into the value to persist.
 *
 * Lives here rather than in the Economics page so it stays free of the Supabase
 * client (importing the page pulls in `supabase.ts`, which throws at module load
 * when env vars are absent — that made the test suite depend on a local .env).
 *
 * - `null`      -> field cleared; drop the override so the documented default applies
 * - `undefined` -> nothing to write (unchanged, already empty, or unparseable)
 * - number      -> persist it, including an explicit 0
 */
export function parseSettingInput(draft: string, current: number | null): number | null | undefined {
  const raw = draft.trim();
  if (raw === '') return current != null ? null : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n !== current ? n : undefined;
}

/** First finite number wins; used to layer DB override over code default. */
function pick(override: number | null | undefined, fallback: number): number {
  return typeof override === 'number' && Number.isFinite(override) ? override : fallback;
}

/**
 * Resolve the effective assumptions for a project by layering the persisted
 * `project_settings` (when present) over the documented code defaults.
 * Percentage-typed DB columns are converted to fractions here.
 */
export function resolveSettings(settings: Partial<ResolvableSettings> | null | undefined): ResolvedAssumptions {
  const s = settings ?? {};
  return {
    hoursPerYear: pick(s.hours_per_year, HOURS_PER_YEAR),
    discountRate: pick(s.discount_rate_pct != null ? s.discount_rate_pct / 100 : null, DEFAULT_ASSUMPTIONS.DISCOUNT_RATE),
    lomYears: pick(s.lom_years, DEFAULT_ASSUMPTIONS.LOM_YEARS),
    contingencyFraction: pick(s.contingency_pct != null ? s.contingency_pct / 100 : null, DEFAULT_ASSUMPTIONS.CONTINGENCY_FRACTION),
    refineryChargeUsdOz: pick(s.refinery_charge_usd_oz, DEFAULT_ASSUMPTIONS.REFINERY_CHARGE_USD_OZ),
    royaltyFraction: pick(s.royalty_pct != null ? s.royalty_pct / 100 : null, DEFAULT_ASSUMPTIONS.ROYALTY_FRACTION),
    workingCapitalFraction: pick(s.working_capital_pct != null ? s.working_capital_pct / 100 : null, DEFAULT_ASSUMPTIONS.WORKING_CAPITAL_FRACTION),
  };
}

/** Shared annual production basis: project throughput × resolved hours × availability × grade × recovery. */
export function computeProductionMetrics(
  project: ProductionProjectInput,
  assumptions: Pick<ResolvedAssumptions, 'hoursPerYear'>,
  recoveryPct: number,
): ProductionMetrics {
  const annualTonnes = project.target_tph * assumptions.hoursPerYear * (project.availability_pct / 100);
  const annualOz = annualTonnes * project.gold_grade_g_t * (recoveryPct / 100) / TROY_OZ_GRAMS;
  return { annualTonnes, annualOz };
}
