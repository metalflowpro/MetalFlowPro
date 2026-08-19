// ─────────────────────────────────────────────────────────────────────────────
// RÉCUPÉRATION PAR DOMAINE GÉOMÉTALLURGIQUE — module PUR.
//
// ── Pourquoi ────────────────────────────────────────────────────────────────
// L'application calculait UNE récupération sur les moyennes de TOUS les essais
// du projet. Un gisement à forte variabilité — le cas courant — n'est pas décrit
// par sa moyenne : un oxyde qui lixivie à 92 % et un sulfure réfractaire à 60 %
// ne donnent pas « 76 % » de minerai, ils donnent deux minerais qu'il faut
// traiter, planifier et chiffrer séparément.
//
// Un rapport technique estime la récupération PAR DOMAINE, puis la combine selon
// ce que le plan minier envoie réellement à l'usine.
//
// ── La subtilité qui compte : pondérer par le MÉTAL, pas par le tonnage ─────
// Une récupération est un rapport « métal récupéré / métal alimenté ». La
// combiner au prorata des TONNAGES est faux dès que les domaines n'ont pas la
// même teneur : un domaine pauvre mais volumineux tirerait la moyenne alors
// qu'il apporte peu de métal. La pondération correcte est par MÉTAL CONTENU :
//
//     R_global = Σ(tᵢ × gᵢ × Rᵢ) / Σ(tᵢ × gᵢ)
//
// C'est une erreur classique, et elle se voit d'autant moins que les deux
// formules coïncident quand les teneurs sont proches.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { canonDomain } from '../geomet/domains';

/** Ce qu'un domaine apporte à l'alimentation de l'usine, et comment il répond. */
export interface DomainRecoveryInput {
  /** Libellé du domaine tel que saisi — canonicalisé en interne. */
  domain: string;
  /** Tonnage envoyé à l'usine sur la période considérée (t). */
  tonnes: number;
  /** Teneur d'alimentation du domaine (g/t). */
  gradeGt: number;
  /**
   * Récupération du domaine (%), issue de SES propres essais. `null` quand le
   * domaine n'a pas de testwork : il est alors signalé, jamais deviné.
   */
  recoveryPct: number | null;
}

/** Contribution d'un domaine au bilan global. */
export interface DomainContribution {
  /** Clé canonique du domaine. */
  domain: string;
  tonnes: number;
  gradeGt: number;
  recoveryPct: number;
  /** Métal contenu alimenté (g) — c'est LUI qui pondère. */
  metalIn: number;
  /** Part du métal alimenté que ce domaine représente (%). */
  metalSharePct: number;
  /** Métal effectivement récupéré (g). */
  metalRecovered: number;
  /** Vrai si la récupération vient d'un repli et non des essais du domaine. */
  imputed: boolean;
}

export interface DomainBlendResult {
  /** Récupération globale (%), pondérée par le métal contenu. */
  recoveryPct: number;
  /** Récupération qu'aurait donnée une pondération par TONNAGE — pour comparaison. */
  tonnageWeightedPct: number;
  /** Contributions par domaine, du plus gros apport de métal au plus petit. */
  byDomain: DomainContribution[];
  /** Domaines sans essais, dont la récupération a été imputée. */
  imputedDomains: string[];
  /**
   * Vrai dès qu'AU MOINS UN domaine tient sa récupération de ses propres essais.
   *
   * ⚠️ Quand il est faux, `recoveryPct` vaut EXACTEMENT `fallbackRecoveryPct` :
   * Σ(t×g×R)/Σ(t×g) avec le même R partout se simplifie en R. La pondération par
   * le métal n'apporte alors aucune information — elle recopie la récupération
   * projet en lui donnant l'apparence d'un calcul par domaine. L'appelant ne doit
   * pas la présenter comme une récupération d'usine reconstituée, ni la
   * substituer à la récupération de la route.
   */
  hasMeasuredDomain: boolean;
  /** Tonnage total pris en compte (t). */
  totalTonnes: number;
  /** Métal contenu total alimenté (g). */
  totalMetalIn: number;
  /** Formule et provenance, pour la traçabilité 43-101. */
  basis: string;
}

/** Un domaine ne compte que s'il apporte réellement du minerai titré. */
function usable(r: DomainRecoveryInput): boolean {
  return Number.isFinite(r.tonnes) && r.tonnes > 0
    && Number.isFinite(r.gradeGt) && r.gradeGt > 0;
}

/**
 * Combine les récupérations par domaine en une récupération d'usine.
 *
 * `fallbackRecoveryPct` sert aux domaines dépourvus d'essais — typiquement la
 * récupération du modèle projet. Ils sont alors listés dans `imputedDomains` :
 * un domaine imputé est une INCERTITUDE à documenter, pas un détail.
 *
 * Renvoie `null` si aucun domaine exploitable — l'appelant retombe alors sur le
 * calcul projet, plutôt que d'afficher un zéro trompeur.
 */
export function blendDomainRecovery(
  rows: DomainRecoveryInput[],
  fallbackRecoveryPct: number | null = null,
): DomainBlendResult | null {
  const kept = rows.filter(usable);
  if (kept.length === 0) return null;

  const contributions: DomainContribution[] = [];
  const imputedDomains: string[] = [];

  for (const r of kept) {
    const imputed = r.recoveryPct == null || !Number.isFinite(r.recoveryPct);
    const rec = imputed ? fallbackRecoveryPct : r.recoveryPct!;
    if (rec == null || !Number.isFinite(rec)) continue;   // ni essais ni repli → écarté
    const domain = canonDomain(r.domain);
    const metalIn = r.tonnes * r.gradeGt;
    if (imputed) imputedDomains.push(domain);
    contributions.push({
      domain, tonnes: r.tonnes, gradeGt: r.gradeGt,
      recoveryPct: Math.min(100, Math.max(0, rec)),
      metalIn, metalSharePct: 0,
      metalRecovered: metalIn * Math.min(100, Math.max(0, rec)) / 100,
      imputed,
    });
  }
  if (contributions.length === 0) return null;

  const totalMetalIn = contributions.reduce((s, c) => s + c.metalIn, 0);
  const totalTonnes = contributions.reduce((s, c) => s + c.tonnes, 0);
  if (!(totalMetalIn > 0)) return null;

  for (const c of contributions) c.metalSharePct = (c.metalIn / totalMetalIn) * 100;
  contributions.sort((a, b) => b.metalIn - a.metalIn);

  const recovered = contributions.reduce((s, c) => s + c.metalRecovered, 0);
  const recoveryPct = (recovered / totalMetalIn) * 100;
  const tonnageWeightedPct =
    contributions.reduce((s, c) => s + c.tonnes * c.recoveryPct, 0) / totalTonnes;

  const uniqueImputed = [...new Set(imputedDomains)];
  const hasMeasuredDomain = contributions.some(c => !c.imputed);

  // Un blend sans AUCUN domaine mesuré ne se décrit pas comme une pondération :
  // annoncer « R = Σ(t×g×R)/Σ(t×g) » sur six domaines tous imputés donne à une
  // identité l'allure d'une mesure. On dit ce qui est.
  const basis = hasMeasuredDomain
    ? `Récupération pondérée par le MÉTAL CONTENU sur ${contributions.length} domaine(s) : ` +
      `R = Σ(t×g×R) / Σ(t×g) = ${recoveryPct.toFixed(1)} % ` +
      `(pondérée par tonnage : ${tonnageWeightedPct.toFixed(1)} %)` +
      (uniqueImputed.length
        ? ` · ${uniqueImputed.length} domaine(s) sans essais, récupération imputée : ${uniqueImputed.join(', ')}`
        : '')
    : `Aucun des ${contributions.length} domaine(s) du modèle de blocs n'a d'essais : ` +
      `tous imputés à ${recoveryPct.toFixed(1)} %, la pondération par le métal reproduit ` +
      `la récupération projet sans l'informer — domaines à caractériser : ${uniqueImputed.join(', ')}`;

  return {
    recoveryPct, tonnageWeightedPct, byDomain: contributions,
    imputedDomains: uniqueImputed, hasMeasuredDomain,
    totalTonnes, totalMetalIn, basis,
  };
}

/** Un bloc du modèle, réduit à ce qui pèse dans un bilan de récupération. */
export interface DomainBlock {
  /** Lithologie / type de roche portée par le bloc. */
  rockType: string | null;
  /** Teneur du bloc (g/t). */
  gradeGt: number | null;
  /** Masse volumique (t/m³). */
  density: number | null;
  /** Volume du bloc (m³). */
  volumeM3: number | null;
}

/**
 * Agrège un modèle de blocs en tonnage et teneur MOYENNE PONDÉRÉE par domaine —
 * l'alimentation que chaque domaine enverra à l'usine.
 *
 * La teneur d'un domaine est pondérée par le TONNAGE de ses blocs, pas leur
 * nombre : des blocs de tailles ou de densités différentes ne pèsent pas pareil.
 * Le résultat s'enchaîne directement dans `blendDomainRecovery`, dont il ne
 * reste qu'à renseigner la récupération de chaque domaine.
 *
 * Les libellés de lithologie du modèle de blocs et les domaines LIMS sont
 * ramenés à la MÊME clé canonique (voir geomet/domains), de sorte qu'un
 * « Oxyde » du modèle rejoigne un « oxide » du laboratoire.
 */
export function aggregateBlocksByDomain(blocks: DomainBlock[]): Omit<DomainRecoveryInput, 'recoveryPct'>[] {
  const acc = new Map<string, { tonnes: number; metal: number }>();
  for (const b of blocks) {
    const density = b.density ?? 0;
    const volume = b.volumeM3 ?? 0;
    const grade = b.gradeGt ?? 0;
    const tonnes = density * volume;
    if (!Number.isFinite(tonnes) || tonnes <= 0) continue;
    if (!Number.isFinite(grade) || grade < 0) continue;
    const key = canonDomain(b.rockType);
    const cur = acc.get(key) ?? { tonnes: 0, metal: 0 };
    cur.tonnes += tonnes;
    cur.metal += tonnes * grade;
    acc.set(key, cur);
  }
  return [...acc.entries()]
    .map(([domain, v]) => ({ domain, tonnes: v.tonnes, gradeGt: v.tonnes > 0 ? v.metal / v.tonnes : 0 }))
    .filter(d => d.tonnes > 0 && d.gradeGt > 0)
    .sort((a, b) => b.tonnes * b.gradeGt - a.tonnes * a.gradeGt);
}

/**
 * Regroupe des essais par domaine canonique — préalable à l'ajustement d'un
 * modèle PAR DOMAINE plutôt que sur la moyenne de tout le projet.
 *
 * Les libellés sont canonicalisés (« Sulfure », « sulphide », « Sulphides »
 * tombent sur la même clé) : sans cela, un même domaine orthographié de trois
 * façons donnerait trois modèles anémiques au lieu d'un modèle robuste.
 */
export function groupByDomain<T>(
  rows: T[],
  domainOf: (row: T) => string | null,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = canonDomain(domainOf(row));
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}
