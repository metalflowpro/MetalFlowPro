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
 * Primary lithologies — the coarse rock types a Block Model usually carries.
 * A LIMS domain is often a GRADE subdivision of one of these ("Oxyde MG",
 * "Sulfure LG"), so the two sources describe the same ore at different
 * granularities.
 */
export const PRIMARY_LITHOLOGY_CANONS = new Set(['oxide', 'transition', 'sulphide']);

/**
 * Lithology root of a domain label: the primary lithology it belongs to,
 * regardless of any grade qualifier (MG/LG/HG…). "Oxyde MG" → "oxide",
 * "Sulfure LG" → "sulphide", "Transition" → "transition".
 *
 * Lets a coarse Block Model lithology ("Oxyde") be recognised as the parent of
 * the granular LIMS domains ("Oxyde MG/LG/HG") instead of spawning a separate
 * generic domain. Falls back to canonDomain when no primary lithology token is
 * present, so unrelated domains keep their own identity.
 */
export function lithologyRoot(name: string | null): string {
  const raw = (name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const token of raw.split(/[^a-z0-9]+/).filter(Boolean)) {
    const folded = DOMAIN_SYNONYMS[token];
    if (folded && PRIMARY_LITHOLOGY_CANONS.has(folded)) return folded;
  }
  return canonDomain(name);
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
  /** Weighted mean across primary domains; null when no primary data exists. */
  mean: number | null;
  /** Per-domain mean and the weight it carried — what the mean is built from. */
  byDomain: { canon: string; label: string; mean: number; n: number; weight: number }[];
  /** Mean over composite samples only ("mixte"), kept as a validation reference. */
  compositeMean: number | null;
  compositeN: number;
  /** True when a real feed split drove the weights, false when they fell back to equal. */
  weightedByFeed: boolean;
}

/**
 * Feed share per canonical domain (any positive scale — normalised internally).
 * Sourced from `geomet_domains.lom_pct`, the life-of-mine share of each domain.
 */
export type DomainWeights = Record<string, number>;

/**
 * Mean across primary domains, weighted by their share of the mill feed.
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
 *     each domain first removes that bias.
 *
 * `weights` carries the feed split (from `geomet_domains.lom_pct`). When it is
 * absent — or covers none of the domains that actually have testwork — the
 * domains are weighted equally and `weightedByFeed` reports false, so callers can
 * say which basis was used rather than implying a split that does not exist.
 */
export function domainWeightedMean(rows: DomainValue[], weights?: DomainWeights): DomainWeightedMean {
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

  const means = [...primary.entries()].map(([canon, b]) => ({
    canon,
    label: b.label,
    mean: b.vals.reduce((s, v) => s + v, 0) / b.vals.length,
    n: b.vals.length,
  }));

  // A split only counts if it actually covers the domains we have data for. A
  // weights object full of zeros (or naming other domains) must not silently
  // produce a division by zero or a meaningless mean.
  const rawWeights = means.map(d => (weights ? Math.max(0, weights[d.canon] ?? 0) : 0));
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const weightedByFeed = weightSum > 0;

  const byDomain = means.map((d, i) => ({
    ...d,
    weight: weightedByFeed ? rawWeights[i] / weightSum : (means.length ? 1 / means.length : 0),
  }));

  return {
    mean: byDomain.length ? byDomain.reduce((s, d) => s + d.mean * d.weight, 0) : null,
    byDomain: byDomain.sort((a, b) => a.canon.localeCompare(b.canon)),
    compositeMean: composite.length ? composite.reduce((s, v) => s + v, 0) / composite.length : null,
    compositeN: composite.length,
    weightedByFeed,
  };
}

// ─── Agrégation de courbes granulométriques ──────────────────────────────────
//
// Moyenner les P80 de plusieurs essais n'est PAS la même chose que lire le P80
// de leur courbe combinée : le P80 est un percentile, non une grandeur additive.
// Sur des essais dispersés les deux divergent, et la grandeur métallurgiquement
// juste est celle de la courbe combinée — on moyenne les % passants tamis par
// tamis (mêmes règles de domaine et de pondération que domainWeightedMean), puis
// on lit le P80 dessus.

/** Une courbe granulométrique tamisée, avec le domaine de l'échantillon. */
export interface DomainCurve {
  /** Points (taille µm, % passant cumulé). Tamis quelconques. */
  curve: { sieve: number; passing: number }[];
  domain: string | null;
}

export interface DomainWeightedCurve {
  /** Courbe combinée, pondérée par domaine, composites exclus. */
  curve: { sieve: number; passing: number }[];
  /** Nombre d'essais primaires effectivement combinés. */
  nSamples: number;
  /** Part portée par chaque domaine dans la combinaison. */
  byDomain: { canon: string; label: string; n: number; weight: number }[];
  /** Courbe des seuls composites ("mixte"), gardée comme référence de validation. */
  compositeCurve: { sieve: number; passing: number }[] | null;
  compositeN: number;
  /** True quand un vrai partage d'alimentation a pondéré la combinaison. */
  weightedByFeed: boolean;
}

/** Moyenne des % passants d'un ensemble de courbes, sur l'union de leurs tamis. */
function averageCurves(curves: { sieve: number; passing: number }[][]): { sieve: number; passing: number }[] {
  const valid = curves.filter(c => c.length >= 2);
  if (valid.length === 0) return [];
  // Union des tamis présents dans au moins une courbe.
  const sieves = [...new Set(valid.flatMap(c => c.map(p => p.sieve)))].sort((a, b) => a - b);
  // Chaque courbe est ré-échantillonnée à chaque tamis par interpolation
  // linéaire en log-taille sur le % passant ; hors plage, on borne aux extrêmes.
  const sampleAt = (curve: { sieve: number; passing: number }[], sieve: number): number => {
    const pts = [...curve].filter(p => p.sieve > 0).sort((a, b) => a.sieve - b.sieve);
    if (sieve <= pts[0].sieve) return pts[0].passing;
    if (sieve >= pts[pts.length - 1].sieve) return pts[pts.length - 1].passing;
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = pts[i], hi = pts[i + 1];
      if (sieve >= lo.sieve && sieve <= hi.sieve) {
        const f = Math.log(sieve / lo.sieve) / Math.log(hi.sieve / lo.sieve);
        return lo.passing + f * (hi.passing - lo.passing);
      }
    }
    return pts[pts.length - 1].passing;
  };
  return sieves.map(sieve => ({
    sieve,
    passing: valid.reduce((s, c) => s + sampleAt(c, sieve), 0) / valid.length,
  }));
}

/**
 * Courbe granulométrique combinée, pondérée par la part d'alimentation des
 * domaines — le pendant « courbe » de domainWeightedMean.
 *
 * Deux niveaux de moyenne, exactement comme pour les scalaires : on combine
 * d'abord les courbes AU SEIN de chaque domaine (une courbe par domaine), puis
 * on combine ces courbes de domaine pondérées par l'alimentation. Cela évite
 * qu'un domaine sur-échantillonné pèse par son nombre d'essais plutôt que par
 * sa part réelle du minerai.
 */
export function domainWeightedCurve(rows: DomainCurve[], weights?: DomainWeights): DomainWeightedCurve {
  const primary = new Map<string, { label: string; curves: { sieve: number; passing: number }[][] }>();
  const composite: { sieve: number; passing: number }[][] = [];

  for (const r of rows) {
    if (r.curve.length < 2) continue;
    if (isCompositeDomain(r.domain)) { composite.push(r.curve); continue; }
    const canon = canonDomain(r.domain);
    let b = primary.get(canon);
    if (!b) { b = { label: r.domain?.trim() || 'Non classifié', curves: [] }; primary.set(canon, b); }
    b.curves.push(r.curve);
  }

  const perDomain = [...primary.entries()].map(([canon, b]) => ({
    canon,
    label: b.label,
    curve: averageCurves(b.curves),
    n: b.curves.length,
  })).filter(d => d.curve.length >= 2);

  const rawWeights = perDomain.map(d => (weights ? Math.max(0, weights[d.canon] ?? 0) : 0));
  const weightSum = rawWeights.reduce((s, w) => s + w, 0);
  const weightedByFeed = weightSum > 0;

  const byDomain = perDomain.map((d, i) => ({
    canon: d.canon, label: d.label, n: d.n,
    weight: weightedByFeed ? rawWeights[i] / weightSum : (perDomain.length ? 1 / perDomain.length : 0),
  }));

  // Combinaison finale : moyenne des courbes de domaine, pondérée.
  let curve: { sieve: number; passing: number }[] = [];
  if (perDomain.length > 0) {
    const sieves = [...new Set(perDomain.flatMap(d => d.curve.map(p => p.sieve)))].sort((a, b) => a - b);
    const sampleAt = (dc: { sieve: number; passing: number }[], sieve: number): number => {
      const pts = [...dc].sort((a, b) => a.sieve - b.sieve);
      if (sieve <= pts[0].sieve) return pts[0].passing;
      if (sieve >= pts[pts.length - 1].sieve) return pts[pts.length - 1].passing;
      for (let i = 0; i < pts.length - 1; i++) {
        const lo = pts[i], hi = pts[i + 1];
        if (sieve >= lo.sieve && sieve <= hi.sieve) {
          const f = Math.log(sieve / lo.sieve) / Math.log(hi.sieve / lo.sieve);
          return lo.passing + f * (hi.passing - lo.passing);
        }
      }
      return pts[pts.length - 1].passing;
    };
    curve = sieves.map(sieve => ({
      sieve,
      passing: perDomain.reduce((s, d, i) => s + sampleAt(d.curve, sieve) * byDomain[i].weight, 0),
    }));
  }

  return {
    curve,
    nSamples: perDomain.reduce((s, d) => s + d.n, 0),
    byDomain: byDomain.sort((a, b) => a.canon.localeCompare(b.canon)),
    compositeCurve: composite.length ? averageCurves(composite) : null,
    compositeN: composite.length,
    weightedByFeed,
  };
}
