// ─────────────────────────────────────────────────────────────────────────────
// Compositage — ré-échantillonnage des analyses à un support régulier.
//
// Les analyses brutes ont des longueurs d'échantillon irrégulières (0,5 m, 1 m,
// 3 m…). L'estimation de ressource exige un SUPPORT constant, sinon un échantillon
// long pèse à tort autant qu'un court. Le compositage recalcule des intervalles
// de longueur cible, chaque teneur composite étant la moyenne PONDÉRÉE PAR LA
// LONGUEUR des échantillons qui le recouvrent — ce qui conserve le métal contenu.
//
// ⚠️ La longueur de composite n'est PAS dans le rapport Morrison (§8.4 de
// l'analyse) : c'est un PARAMÈTRE, jamais une constante cachée.
//
// Opère sur UNE série numérique (un élément). L'appelant composite chaque élément
// séparément — la séparation garde le moteur simple et multi-métal par nature.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/** Échantillon brut : intervalle et valeur (null = non dosé / trou). */
export interface RawSample {
  from: number;
  to: number;
  value: number | null;
}

/** Composite résultant. */
export interface Composite {
  from: number;
  to: number;
  /** Longueur nominale du composite (m). */
  length: number;
  /** Teneur moyenne pondérée par la longueur recouverte. */
  value: number;
  /** Fraction de la longueur nominale effectivement dosée (0–1). */
  coverage: number;
}

/** Options de compositage. */
export interface CompositeOptions {
  /** Longueur cible d'un composite (m). Doit être > 0. */
  length: number;
  /**
   * Couverture minimale (fraction 0–1) pour conserver un composite. En deçà, le
   * composite est jugé trop lacunaire et écarté (défaut 0,5). Le dernier
   * composite résiduel plus court est toujours évalué à cette même règle.
   */
  minCoverage?: number;
}

/**
 * Composite une série d'échantillons par longueurs fixes à partir du sommet
 * (le `from` minimal). Les échantillons doivent concerner un seul trou/élément.
 *
 * @throws si la longueur cible n'est pas strictement positive.
 */
export function compositeByLength(samples: RawSample[], opts: CompositeOptions): Composite[] {
  if (!(opts.length > 0)) throw new Error('Longueur de composite invalide (doit être > 0).');
  const minCoverage = opts.minCoverage ?? 0.5;
  if (samples.length === 0) return [];

  const sorted = [...samples].sort((a, b) => a.from - b.from);
  const top = sorted[0].from;
  const bottom = Math.max(...sorted.map(s => s.to));

  const out: Composite[] = [];
  for (let start = top; start < bottom - 1e-9; start += opts.length) {
    const end = Math.min(start + opts.length, bottom);
    const nominal = end - start;

    let weighted = 0;
    let covered = 0;
    for (const s of sorted) {
      if (s.value == null || !Number.isFinite(s.value)) continue;
      const overlap = Math.min(end, s.to) - Math.max(start, s.from);
      if (overlap <= 0) continue;
      weighted += s.value * overlap;
      covered += overlap;
    }

    const coverage = nominal > 0 ? covered / nominal : 0;
    if (covered <= 0 || coverage < minCoverage) continue;

    out.push({
      from: start,
      to: end,
      length: nominal,
      value: weighted / covered,
      coverage,
    });
  }

  return out;
}
