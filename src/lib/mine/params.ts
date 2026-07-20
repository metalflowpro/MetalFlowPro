// ─────────────────────────────────────────────────────────────────────────────
// Mine & Optimisation — parameter resolution.
//
// Every number the mine model runs on is either imported from the module that
// owns it, or explicitly overridden by the user — never hardcoded here.
//
// Ownership map:
//   récupération métallurgique → LIMS testwork (ProjectContext.effectiveRecoveryPct)
//   teneur, débit, disponibilité, prix de l'or → Projet
//   taux d'actualisation, redevance, LOM, heures/an → project_settings (resolveSettings)
//   CAPEX / OPEX → Économie (capex_lines / opex_lines)
//   BWi, récupération par domaine, part d'alimentation → GéoMet
//   F80 / P80 → Critères de conception
//
// Pure module — no Supabase, no React.
// ─────────────────────────────────────────────────────────────────────────────

/** Where an effective value came from — surfaced in the UI so no number is unexplained. */
export type ParamOrigin = 'projet' | 'lims' | 'settings' | 'economie' | 'geomet' | 'criteres' | 'override' | 'defaut';

export interface ResolvedParam<T = number> {
  value: T;
  origin: ParamOrigin;
  /** Human-readable provenance, e.g. "Économie — 12 lignes OPEX". */
  source: string;
}

function derived<T>(value: T, origin: ParamOrigin, source: string): ResolvedParam<T> {
  return { value, origin, source };
}

/**
 * Layer an explicit user override over an imported value.
 *
 * Only valid for mine_params columns that are NULLABLE — there, null genuinely
 * means "follow the source module" and a value means the user typed one.
 *
 * It must NOT be used for columns declared `NOT NULL DEFAULT x` (discount_rate_pct,
 * royalty_pct, nsr_pct, gold_price_sens, capex_unit_cost_usd_t): those always hold
 * a value, so treating them as overrides would let a stale copy of a default
 * permanently outrank the module that owns the number. Those use `ownerWins`.
 */
export function withOverride(
  imported: ResolvedParam,
  override: number | null | undefined,
  overrideLabel = 'Saisi dans Mine & Optimisation',
): ResolvedParam {
  if (typeof override !== 'number' || !Number.isFinite(override)) return imported;
  if (Math.abs(override - imported.value) < 1e-9) return imported;
  return { value: override, origin: 'override', source: overrideLabel };
}

/**
 * The owning module wins whenever it has something to say; the mine's own legacy
 * column is only a fallback for a project where that module is still empty.
 *
 * This is what makes the module "imported, not hardcoded": a project-wide
 * assumption (discount rate, royalty) has exactly one home, and Mine &
 * Optimisation reads it rather than keeping a copy that silently drifts.
 */
export function ownerWins(owner: ResolvedParam | null, fallback: ResolvedParam): ResolvedParam {
  return owner ?? fallback;
}

export interface MineSourceData {
  /** Projet */
  goldGradeGt: number;
  goldPriceUsdOz: number;
  targetTph: number;
  availabilityPct: number;
  /** LIMS testwork via ProjectContext — the app's single recovery source. */
  effectiveRecoveryPct: number;
  recoveryFromTestwork: boolean;
  /** project_settings (resolveSettings) */
  discountRate: number;      // fraction
  royaltyFraction: number;   // fraction
  lomYears: number;
  hoursPerYear: number;
  /** Économie */
  totalCapexMusd: number;
  totalOpexUsdT: number;
  opexLineCount: number;
  capexLineCount: number;
  /** Critères de conception */
  f80Um: number | null;
  p80Um: number | null;
}

export interface ResolvedMineParams {
  goldGradeGt: ResolvedParam;
  metRecoveryPct: ResolvedParam;
  goldPriceUsdOz: ResolvedParam;
  discountRatePct: ResolvedParam;
  royaltyPct: ResolvedParam;
  processCostUsdT: ResolvedParam;
  capexMusd: ResolvedParam;
  sustainingCapexMusd: ResolvedParam;
  f80Um: ResolvedParam;
  p80Um: ResolvedParam;
}

/** Overrides stored on mine_params. Null/absent means "follow the source module". */
export interface MineOverrides {
  grade_g_t?: number | null;
  gold_price_sens?: number | null;
  discount_rate_pct?: number | null;
  royalty_pct?: number | null;
  nsr_pct?: number | null;
  process_cost_t?: number | null;
  sustaining_capex_m?: number | null;
  capex_unit_cost_usd_t?: number | null;
}

/** Documented fallbacks, used ONLY when the owning module has nothing to give. */
export const MINE_FALLBACKS = {
  /** Grind circuit F80 (µm) when Critères de conception has no crushing product size. */
  F80_UM: 12000,
  /** Grind circuit P80 (µm) when Critères de conception has no target. */
  P80_UM: 75,
  /** Sustaining capex as a fraction of initial CAPEX per year, when Économie has none. */
  SUSTAINING_FRACTION_OF_CAPEX: 0.02,
  /** Hours per day, converting a nameplate t/h into the daily tonnage the factored CAPEX is quoted on. */
  HOURS_PER_DAY: 24,
} as const;

/**
 * Resolve every economic input the mine model needs, importing from the owning
 * module and applying any explicit override.
 */
export function resolveMineParams(src: MineSourceData, ov: MineOverrides = {}): ResolvedMineParams {
  const grade = withOverride(
    derived(src.goldGradeGt, 'projet', 'Projet — teneur d\'alimentation'),
    ov.grade_g_t,
  );

  // Metallurgical recovery is deliberately NOT stored on mine_params: the app has
  // one recovery, derived from LIMS testwork, and every module must agree with it.
  const metRecovery = derived(
    src.effectiveRecoveryPct,
    src.recoveryFromTestwork ? 'lims' : 'projet',
    src.recoveryFromTestwork
      ? 'LIMS — récupération globale (gravité + lixiviation)'
      : 'Projet — récupération de design (aucun testwork)',
  );

  const goldPrice = withOverride(
    derived(src.goldPriceUsdOz, 'projet', 'Projet — prix de l\'or'),
    ov.gold_price_sens,
  );

  // project_settings owns the project-wide financial assumptions. mine_params
  // carries NOT NULL copies (defaults 10 % / 3 % / 1.5 %) that predate that table;
  // they are ignored so a project has exactly one discount rate and one royalty.
  const discountRate = derived(src.discountRate * 100, 'settings', 'Paramètres — taux d\'actualisation');
  const royalty = derived(src.royaltyFraction * 100, 'settings', 'Paramètres — redevances (+ NSR)');

  // Économie owns CAPEX/OPEX and wins as soon as it has lines. The mine's own
  // cost columns are the fallback for an early-stage project with no estimate yet.
  const processCost = ownerWins(
    src.totalOpexUsdT > 0
      ? derived(src.totalOpexUsdT, 'economie', `Économie — OPEX total (${src.opexLineCount} lignes)`)
      : null,
    typeof ov.process_cost_t === 'number'
      ? derived(ov.process_cost_t, 'override', 'Saisi — Économie sans ligne OPEX')
      : derived(0, 'defaut', 'Aucun OPEX disponible'),
  );

  const capex = ownerWins(
    src.totalCapexMusd > 0
      ? derived(src.totalCapexMusd, 'economie', `Économie — CAPEX total (${src.capexLineCount} lignes)`)
      : null,
    typeof ov.capex_unit_cost_usd_t === 'number'
      ? derived(
          (ov.capex_unit_cost_usd_t * src.targetTph * MINE_FALLBACKS.HOURS_PER_DAY) / 1e6,
          'defaut',
          `Estimation factorielle — $${ov.capex_unit_cost_usd_t}/t-jour (Économie sans ligne CAPEX)`,
        )
      : derived(0, 'defaut', 'Aucun CAPEX disponible'),
  );

  // Sustaining capex is always derived from the CAPEX. mine_params.sustaining_capex_m
  // is NOT NULL DEFAULT 6.0 in the schema, so a seeded value would look like a
  // deliberate override — it is ignored here, exactly like the discount rate and
  // royalty columns above, so the derivation stays the single source.
  const sustaining = derived(
    capex.value * MINE_FALLBACKS.SUSTAINING_FRACTION_OF_CAPEX,
    capex.origin === 'economie' ? 'economie' : 'defaut',
    `Dérivé — ${(MINE_FALLBACKS.SUSTAINING_FRACTION_OF_CAPEX * 100).toFixed(0)} % du CAPEX/an`,
  );

  return {
    goldGradeGt: grade,
    metRecoveryPct: metRecovery,
    goldPriceUsdOz: goldPrice,
    discountRatePct: discountRate,
    royaltyPct: royalty,
    processCostUsdT: processCost,
    capexMusd: capex,
    sustainingCapexMusd: sustaining,
    f80Um: src.f80Um != null
      ? derived(src.f80Um, 'criteres', 'Critères — F80 concassage')
      : derived(MINE_FALLBACKS.F80_UM, 'defaut', 'Défaut documenté (Critères non renseignés)'),
    p80Um: src.p80Um != null
      ? derived(src.p80Um, 'criteres', 'Critères — P80 broyage')
      : derived(MINE_FALLBACKS.P80_UM, 'defaut', 'Défaut documenté (Critères non renseignés)'),
  };
}
