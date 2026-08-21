// ─────────────────────────────────────────────────────────────────────────────
// Modèle de courant « Sim Pro » — module PUR (aucun React/DB).
//
// Fondation de la Phase 1 du cahier des charges MetSim/JKSimMet : un courant
// porte des DÉBITS MASSIQUES par composant (métaux, minéraux, réactifs…) et une
// distribution granulométrique (PSD) par classe de taille — pas seulement un
// P80 scalaire. Les TENEURS se DÉRIVENT des masses (règle §3), jamais l'inverse,
// ce qui élimine les moyennes de teneurs non pondérées.
//
// Ce module est ADDITIF : il n'altère pas le `StreamResult` gold-only du moteur
// actuel. Il fournit les briques pures (mélange, split, PSD, P80, fermeture de
// bilan) que les modèles unitaires par classe (Phase 2) et le solveur (Phase 3)
// consommeront, avec des adaptateurs vers/depuis `StreamResult` ajoutés au
// câblage. Réutilise `p80FromPsd`/`p80Interpolation` (une seule implémentation
// du P80 dans toute l'application).
// ─────────────────────────────────────────────────────────────────────────────

import { p80FromPsd, type PsdPoint } from '../geomet/psd';

// ─── Distribution granulométrique (§5) ────────────────────────────────────────

/**
 * PSD discrétisée par classes. `sizeBinsUm` est croissant (fin → grossier) ;
 * `massFractions[i]` est la fraction de masse solide DANS la bande se terminant à
 * `sizeBinsUm[i]` (bande `(sizeBinsUm[i-1], sizeBinsUm[i]]`). La somme des
 * fractions vaut 1 (garantie par {@link normalizePsd}). Le passant cumulé à
 * `sizeBinsUm[i]` est donc la somme des fractions jusqu'à `i`.
 */
export interface Psd {
  sizeBinsUm: number[];
  massFractions: number[];
}

/** PSD vide (aucune classe). */
export function emptyPsd(): Psd {
  return { sizeBinsUm: [], massFractions: [] };
}

/**
 * Normalise les fractions pour qu'elles somment à 1 (§5 : Σ f_b = 1). Une PSD de
 * somme nulle (courant sans solide) est renvoyée telle quelle — normaliser par 0
 * fabriquerait des NaN.
 */
export function normalizePsd(psd: Psd): Psd {
  const total = psd.massFractions.reduce((s, f) => s + (Number.isFinite(f) ? Math.max(0, f) : 0), 0);
  if (total <= 0) return { sizeBinsUm: [...psd.sizeBinsUm], massFractions: psd.massFractions.map(() => 0) };
  return {
    sizeBinsUm: [...psd.sizeBinsUm],
    massFractions: psd.massFractions.map(f => Math.max(0, Number.isFinite(f) ? f : 0) / total),
  };
}

/**
 * Courbe de passant cumulé (points tamis→% passant) déduite de la PSD par
 * classes, dans le format `PsdPoint` attendu par `p80FromPsd`. Le passant au
 * tamis `sizeBinsUm[i]` = Σ des fractions [0..i] × 100.
 */
export function psdToPassingCurve(psd: Psd): PsdPoint[] {
  const norm = normalizePsd(psd);
  let cumulative = 0;
  const points: PsdPoint[] = [];
  for (let i = 0; i < norm.sizeBinsUm.length; i++) {
    cumulative += norm.massFractions[i] ?? 0;
    points.push({ sieve: norm.sizeBinsUm[i], passing: cumulative * 100 });
  }
  return points;
}

/**
 * P80 (µm) de la PSD par classes. Réutilise `p80FromPsd` (interpolation
 * log-linéaire, §5). `null` si la courbe n'encadre pas 80 % passant (moins de
 * deux classes, ou tout dans une seule bande).
 */
export function psdP80(psd: Psd): number | null {
  return p80FromPsd(psdToPassingCurve(psd));
}

/**
 * Mélange de PSD pondéré par la masse solide (§7.1) :
 *   f_{b,out} = Σ_i (m_i · f_{b,i}) / Σ_i m_i
 * Toutes les entrées doivent partager les MÊMES bornes de classes (les circuits
 * MetalFlow utilisent une grille de tamis commune) — sinon on lève, plutôt que
 * de mélanger silencieusement des bases incompatibles.
 */
export function blendPsd(inputs: { solidsMass: number; psd: Psd }[]): Psd {
  const withSolids = inputs.filter(s => s.solidsMass > 0 && s.psd.sizeBinsUm.length > 0);
  if (withSolids.length === 0) return emptyPsd();

  const bins = withSolids[0].psd.sizeBinsUm;
  for (const s of withSolids) {
    if (s.psd.sizeBinsUm.length !== bins.length || s.psd.sizeBinsUm.some((v, i) => v !== bins[i])) {
      throw new Error('blendPsd: les courants ont des bornes de classes granulométriques différentes');
    }
  }

  const totalSolids = withSolids.reduce((s, x) => s + x.solidsMass, 0);
  const massByBin = bins.map((_, b) =>
    withSolids.reduce((s, x) => s + x.solidsMass * (normalizePsd(x.psd).massFractions[b] ?? 0), 0),
  );
  return normalizePsd({ sizeBinsUm: [...bins], massFractions: massByBin.map(m => m / totalSolids) });
}

// ─── Composants (§3, §4) ──────────────────────────────────────────────────────

/**
 * Débits massiques par composant, dans une unité COHÉRENTE pour tout le
 * flowsheet (ex. kg/h). Clés libres (`Au`, `Ag`, `Cu`, `SiO2`, `FeS2`, `NaCN`…),
 * cf. bibliothèque §3. Absence de clé = 0.
 */
export type ComponentMap = Record<string, number>;

/** Somme composant par composant de plusieurs courants (§4 bilan additif). */
export function addComponents(maps: ComponentMap[]): ComponentMap {
  const out: ComponentMap = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) {
      if (!Number.isFinite(v)) continue;
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/** Multiplie tous les débits composant par un facteur (split massique, §7.2). */
export function scaleComponents(map: ComponentMap, factor: number): ComponentMap {
  const out: ComponentMap = {};
  for (const [k, v] of Object.entries(map)) out[k] = v * factor;
  return out;
}

/**
 * Teneur d'un métal (g/t) dérivée des masses (§3) :
 *   G = m_métal / m_solides
 * `metalMassGramsPerH` et `solidsMassTonnesPerH` doivent être en g/h et t/h pour
 * un résultat en g/t. Solides nuls → 0 (pas de division par zéro).
 */
export function gradeGpt(metalMassGramsPerH: number, solidsMassTonnesPerH: number): number {
  return solidsMassTonnesPerH > 0 ? metalMassGramsPerH / solidsMassTonnesPerH : 0;
}

// ─── Fermeture des bilans (§4, §9) ────────────────────────────────────────────

/**
 * Erreur relative de fermeture d'un bilan (§4) :
 *   ε = |Σ_in − Σ_out| / |Σ_in|
 * Une entrée nulle renvoie 0 si la sortie est nulle aussi (bilan trivialement
 * fermé), sinon 1 (100 % d'écart) — jamais NaN.
 */
export function closureError(totalIn: number, totalOut: number): number {
  const denom = Math.abs(totalIn);
  if (denom < 1e-12) return Math.abs(totalOut) < 1e-12 ? 0 : 1;
  return Math.abs(totalIn - totalOut) / denom;
}

/** Le bilan est-il fermé sous la tolérance (§4 : ε ≤ ε_tol) ? */
export function isBalanceClosed(totalIn: number, totalOut: number, tolerance: number): boolean {
  return closureError(totalIn, totalOut) <= tolerance;
}

/**
 * Fermeture composant par composant (§4 bilan par composant). Retourne, pour
 * chaque composant présent en entrée ou sortie, son erreur relative et le
 * verdict sous tolérance. Utile au moteur de validation (§9/§15).
 */
export function componentClosure(
  totalsIn: ComponentMap,
  totalsOut: ComponentMap,
  tolerance: number,
): Record<string, { error: number; closed: boolean }> {
  const keys = new Set([...Object.keys(totalsIn), ...Object.keys(totalsOut)]);
  const out: Record<string, { error: number; closed: boolean }> = {};
  for (const k of keys) {
    const err = closureError(totalsIn[k] ?? 0, totalsOut[k] ?? 0);
    out[k] = { error: err, closed: err <= tolerance };
  }
  return out;
}
