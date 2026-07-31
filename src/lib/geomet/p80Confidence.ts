// ─────────────────────────────────────────────────────────────────────────────
// Bande de confiance sur le P80 — module PUR.
//
// Le P80 lu sur une courbe granulométrique n'est pas exact : il dépend de
// l'espacement des tamis qui encadrent 80 % passant, et du bruit de mesure. Le
// « P80 usine » propagé dans tout le design (×K_indus, énergie de Bond) est donc
// affiché avec une fausse précision. Ce module quantifie l'incertitude :
//   • largeur du bracket — distance en log-taille entre les deux tamis encadrant
//     80 % (une lecture entre 106 et 212 µm est bien moins sûre qu'entre 74 et 90) ;
//   • bruit de courbe — via le R² d'un ajustement Rosin-Rammler (dispersion).
// Renvoie un P80 avec bornes basse/haute et l'incertitude relative.
//
// Aucune dépendance Supabase/React. Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import { p80FromPsd, fitRosinRammler, type PsdPoint } from './psd';

export interface P80Confidence {
  p80: number;
  lower: number;
  upper: number;
  /** Incertitude relative (± %) autour du P80. */
  relUncertaintyPct: number;
  method: 'bracket+rr' | 'bracket';
  message: string;
}

/**
 * Incertitude sur le P80 (log-normale). σ_log combine :
 *   • σ_bracket = demi-largeur log du bracket × facteur de position (max au
 *     milieu du bracket, min près d'un tamis mesuré) ;
 *   • σ_rr = pénalité de dispersion (1 − R²) du fit Rosin-Rammler.
 * Bornes = P80 · exp(±1.96·σ_log) (intervalle ~95 %).
 */
export function p80Confidence(points: PsdPoint[]): P80Confidence | null {
  const pts = points
    .filter(p => p.sieve > 0 && Number.isFinite(p.passing))
    .sort((a, b) => a.sieve - b.sieve);
  const p80 = p80FromPsd(pts);
  if (p80 == null || pts.length < 2) return null;

  // Bracket encadrant 80 % passant.
  let lo: PsdPoint | null = null, hi: PsdPoint | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i].passing < 80 && pts[i + 1].passing >= 80) { lo = pts[i]; hi = pts[i + 1]; break; }
  }
  // Demi-largeur log du bracket ; position du P80 dans le bracket (0.5 = pire).
  let sigmaBracket: number;
  if (lo && hi && hi.sieve > lo.sieve) {
    const logGap = Math.log(hi.sieve / lo.sieve);
    const pos = (Math.log(p80) - Math.log(lo.sieve)) / logGap;       // 0..1
    const positional = 1 - 2 * Math.abs(pos - 0.5);                   // 1 au milieu, 0 aux bords
    sigmaBracket = (logGap / 2) * (0.4 + 0.6 * positional);          // plancher 40 %
  } else {
    sigmaBracket = 0.15; // bracket indisponible : incertitude modérée par défaut
  }

  // Pénalité de dispersion via Rosin-Rammler.
  const rr = fitRosinRammler(pts);
  let sigmaRR = 0;
  let method: P80Confidence['method'] = 'bracket';
  if (rr) {
    sigmaRR = 0.25 * Math.max(0, 1 - rr.rSquared); // jusqu'à ±0.25 log si R²→0
    method = 'bracket+rr';
  }

  const sigmaLog = Math.sqrt(sigmaBracket * sigmaBracket + sigmaRR * sigmaRR);
  const z = 1.96;
  const lower = p80 * Math.exp(-z * sigmaLog);
  const upper = p80 * Math.exp(z * sigmaLog);
  const relUncertaintyPct = ((upper - lower) / (2 * p80)) * 100;

  return {
    p80: +p80.toFixed(1),
    lower: +lower.toFixed(1),
    upper: +upper.toFixed(1),
    relUncertaintyPct: +relUncertaintyPct.toFixed(1),
    method,
    message: `P80 ${Math.round(p80)} µm, intervalle ~95 % [${Math.round(lower)} – ${Math.round(upper)}] µm (±${relUncertaintyPct.toFixed(0)} %). ` +
      (relUncertaintyPct > 25
        ? 'Incertitude élevée — tamis trop espacés autour de 80 % passant : ajouter des tamis intermédiaires avant de figer la consigne usine.'
        : 'Incertitude maîtrisée pour le design.'),
  };
}
