// ─────────────────────────────────────────────────────────────────────────────
// GéoMet — domain identity & ore-character rules
//
// Pure helpers, deliberately kept out of the page module: importing a page pulls
// in `supabase.ts`, which throws at module load without env vars and would make
// the test suite depend on a local .env.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical domain key: folds case/accents + common EN/FR geometallurgical
 * synonyms so LIMS sample domains ("oxide", "transition", "sulphide") match
 * Block Model rock types ("Oxide", "Transitionnel", "Sulfure").
 *
 * Only exact tokens are folded, so distinct domains like "Sulphide-HG" vs
 * "Sulphide-LG" stay separate.
 */
export const DOMAIN_SYNONYMS: Record<string, string> = {
  oxide: 'oxide', oxyde: 'oxide', oxides: 'oxide', oxydes: 'oxide', oxidise: 'oxide', oxidize: 'oxide',
  transition: 'transition', transitional: 'transition', transitionnel: 'transition', transitionnelle: 'transition', transitionnels: 'transition',
  sulphide: 'sulphide', sulfide: 'sulphide', sulphides: 'sulphide', sulfides: 'sulphide',
  sulfure: 'sulphide', sulphure: 'sulphide', sulfures: 'sulphide', sulphures: 'sulphide', sulphidic: 'sulphide', sulfured: 'sulphide',
  // "Mixte" is not a lithology of its own: it is what oxide + transition + sulphide
  // produce once blended. Canonicalised so every spelling lands on one key.
  mixte: 'mixte', mixtes: 'mixte', mixed: 'mixte', mix: 'mixte', melange: 'mixte', mixture: 'mixte',
};

/** Normalise a domain label to its canonical key. */
export function canonDomain(name: string | null): string {
  const s = (name ?? '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (!s) return 'nonclassifie';
  return DOMAIN_SYNONYMS[s] ?? s;
}

/**
 * Canonical domains that are a *combination* of primary domains rather than a
 * primary domain themselves.
 *
 * A composite must never receive its own share of mill feed: allocating to
 * "mixte" alongside oxide/transition/sulphide double-counts the same ore, since
 * mixte is made of them. It is still kept and displayed — its testwork is real
 * measured data, and comparing it against the computed blend validates the model.
 */
export const COMPOSITE_CANONS = new Set(['mixte']);

/** True when a domain is a blend of primary domains (e.g. "mixte"). */
export function isCompositeDomain(name: string | null): boolean {
  return COMPOSITE_CANONS.has(canonDomain(name));
}

/**
 * Preg-robbing verdict for a domain.
 *
 * Prefers the direct liberation measurement (% of Au reporting as preg-robbed);
 * falls back to organic carbon, using the same >0.2% Corg threshold Analytics
 * already applies, so the two modules agree. Returns null when neither test
 * exists — "unknown" must not be reported as "no".
 */
export function derivePregRobbing(avgPregRobPct: number | null, avgCOrgPct: number | null): boolean | null {
  if (avgPregRobPct != null) return avgPregRobPct > 0.5;
  if (avgCOrgPct != null) return avgCOrgPct > 0.2;
  return null;
}

/** One measurement tagged with the domain of the sample it came from. */
export interface DomainValue {
  value: number;
  domain: string | null;
}

export interface DomainWeightedMean {
  /** Equal-weight mean across primary domains; null when no primary data exists. */
  mean: number | null;
  /** Per-domain mean, keyed by canonical domain — what the mean is built from. */
  byDomain: { canon: string; label: string; mean: number; n: number }[];
  /** Mean over composite samples only ("mixte"), kept as a validation reference. */
  compositeMean: number | null;
  compositeN: number;
}

/**
 * Mean weighted equally across primary domains.
 *
 * Two problems with the plain mean this replaces:
 *
 *  1. Composite samples ("mixte") are themselves blends of the primary domains,
 *     so averaging them alongside those domains counts the same ore twice. They
 *     are excluded here and returned separately as a validation reference.
 *
 *  2. A flat mean weights by *testing effort*, not by ore. A domain with 41
 *     comminution tests would dominate one with 18 purely because it was sampled
 *     more — which has nothing to do with what the mill is fed. Averaging within
 *     each domain first, then across domains, removes that bias.
 *
 * Note this assumes each primary domain contributes equally to the feed. When a
 * real blend split is available, weight by it instead.
 */
export function domainWeightedMean(rows: DomainValue[]): DomainWeightedMean {
  const primary = new Map<string, { label: string; vals: number[] }>();
  const composite: number[] = [];

  for (const r of rows) {
    if (!Number.isFinite(r.value)) continue;
    if (isCompositeDomain(r.domain)) { composite.push(r.value); continue; }
    const canon = canonDomain(r.domain);
    let b = primary.get(canon);
    if (!b) { b = { label: r.domain?.trim() || 'Non classifié', vals: [] }; primary.set(canon, b); }
    b.vals.push(r.value);
  }

  const byDomain = [...primary.entries()].map(([canon, b]) => ({
    canon,
    label: b.label,
    mean: b.vals.reduce((s, v) => s + v, 0) / b.vals.length,
    n: b.vals.length,
  }));

  return {
    mean: byDomain.length ? byDomain.reduce((s, d) => s + d.mean, 0) / byDomain.length : null,
    byDomain: byDomain.sort((a, b) => a.canon.localeCompare(b.canon)),
    compositeMean: composite.length ? composite.reduce((s, v) => s + v, 0) / composite.length : null,
    compositeN: composite.length,
  };
}
