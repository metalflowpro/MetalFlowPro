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
