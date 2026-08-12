// ─────────────────────────────────────────────────────────────────────────────
// Cinétique de lixiviation de l'or — module PUR.
//
// Le LIMS enregistre la récupération à plusieurs temps (2/4/8/12/24/48 h) mais
// l'app n'en lisait que des moyennes. Ce module ajuste une cinétique de 1er
// ordre R(t) = R∞·(1 − e^(−k·t)) sur ces points et en tire :
//   • R∞  — le plafond de lixiviation (récupération à temps infini) ;
//   • k    — la constante de vitesse (h⁻¹) ;
//   • t95  — le temps pour atteindre 95 % de R∞ ;
//   • le temps de séjour ÉCONOMIQUE (au-delà duquel +1 h ne rend presque plus) ;
//   • un indice de réfractarité CINÉTIQUE (une lixiviation lente traîne de l'or).
//
// Aucune dépendance Supabase/React. Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeachPoint {
  hours: number;
  recoveryPct: number;
}

export interface LeachKinetics {
  /** Plafond de lixiviation R∞ (%). */
  rInf: number;
  /** Constante de vitesse k (h⁻¹). */
  k: number;
  /** Temps pour 95 % de R∞ (h). */
  t95: number;
  /** Temps de séjour économique (h) : dR/dt sous le seuil. */
  optimalHours: number;
  /** Qualité de l'ajustement. */
  rSquared: number;
  slowness: 'rapide' | 'modere' | 'lent' | 'tres_lent';
  message: string;
}

/** R(t) prédite d'une cinétique de 1er ordre. */
export function leachAt(kin: { rInf: number; k: number }, hours: number): number {
  return kin.rInf * (1 - Math.exp(-kin.k * hours));
}

/**
 * Ajuste R(t)=R∞·(1−e^(−k·t)). Pour un R∞ donné, ln(1−R/R∞)=−k·t est linéaire
 * (droite par l'origine) : on estime k par moindres carrés à travers l'origine.
 * On balaie R∞ de max(R observé) à 100 % et on retient celui qui minimise la SSE
 * dans l'espace RÉEL (récupération), pas le linéarisé — plus robuste au bruit.
 */
/** Paramètres d'ajustement cinétique — surchargeables par projet. */
export const LEACH_KINETICS = {
  /** Gain de récupération marginal (pt/h) sous lequel le séjour n'est plus rentable. */
  marginalThresholdPtPerH: 0.15,
  /** k (h⁻¹) au-delà duquel la cinétique est « rapide ». */
  kFastThreshold: 0.30,
  /** k (h⁻¹) au-delà duquel la cinétique est « modérée ». */
  kModerateThreshold: 0.12,
  /** k (h⁻¹) au-delà duquel la cinétique est « lente » (sinon « très lente »). */
  kSlowThreshold: 0.05,
} as const;

/** Version modifiable (nombres) des paramètres cinétiques. */
export type LeachKineticsParams = { -readonly [K in keyof typeof LEACH_KINETICS]: number };

const SLOW_LABEL: Record<LeachKinetics['slowness'], string> = {
  rapide: 'vitesse rapide', modere: 'vitesse modérée', lent: 'vitesse lente', tres_lent: 'vitesse très lente',
};

export function fitLeachKinetics(
  points: LeachPoint[],
  opts: Partial<LeachKineticsParams> = {},
): LeachKinetics | null {
  const P = { ...LEACH_KINETICS, ...opts };
  const pts = points
    .filter(p => p.hours > 0 && Number.isFinite(p.recoveryPct) && p.recoveryPct > 0)
    .sort((a, b) => a.hours - b.hours);
  if (pts.length < 2) return null;

  const maxR = Math.max(...pts.map(p => p.recoveryPct));
  const thr = P.marginalThresholdPtPerH;

  let best: { rInf: number; k: number; sse: number } | null = null;
  // Balayage de R∞ : de juste au-dessus du max observé jusqu'à 100 %.
  for (let rInf = Math.min(99.9, maxR + 0.2); rInf <= 100.0001; rInf += 0.2) {
    // k par moindres carrés à travers l'origine sur y=ln(1−R/R∞) = −k·t.
    let num = 0, den = 0;
    let ok = true;
    for (const p of pts) {
      const frac = 1 - p.recoveryPct / rInf;
      if (frac <= 1e-6) { ok = false; break; }
      const y = Math.log(frac); // négatif
      num += p.hours * y;
      den += p.hours * p.hours;
    }
    if (!ok || den <= 0) continue;
    const k = -num / den;
    if (k <= 0) continue;
    // SSE dans l'espace réel.
    let sse = 0;
    for (const p of pts) sse += (p.recoveryPct - leachAt({ rInf, k }, p.hours)) ** 2;
    if (!best || sse < best.sse) best = { rInf, k, sse };
  }
  if (!best) return null;

  const { rInf, k } = best;
  const meanR = pts.reduce((a, p) => a + p.recoveryPct, 0) / pts.length;
  const ssTot = pts.reduce((a, p) => a + (p.recoveryPct - meanR) ** 2, 0);
  const rSquared = ssTot > 0 ? Math.max(0, 1 - best.sse / ssTot) : 1;

  const t95 = Math.log(1 / 0.05) / k;                     // 1−e^(−k t)=0.95
  // Temps économique : dR/dt = R∞·k·e^(−k t) < seuil → t = ln(R∞·k/seuil)/k.
  const optimalHours = rInf * k > thr ? Math.log((rInf * k) / thr) / k : 0;

  const slowness: LeachKinetics['slowness'] =
    k >= P.kFastThreshold ? 'rapide' : k >= P.kModerateThreshold ? 'modere' : k >= P.kSlowThreshold ? 'lent' : 'tres_lent';

  return {
    rInf: +rInf.toFixed(2),
    k: +k.toFixed(4),
    t95: +t95.toFixed(1),
    optimalHours: +optimalHours.toFixed(1),
    rSquared: +rSquared.toFixed(4),
    slowness,
    message: `R∞ ${rInf.toFixed(1)} % atteint à ${SLOW_LABEL[slowness]} ` +
      `(k=${k.toFixed(3)} h⁻¹). 95 % de R∞ vers ${t95.toFixed(0)} h ; séjour économique ≈ ${optimalHours.toFixed(0)} h. ` +
      (k < P.kSlowThreshold ? 'Cinétique très lente : réfractarité probable — envisager broyage plus fin, O₂/plomb, ou oxydation.' :
       k < P.kModerateThreshold ? 'Cinétique lente : optimiser NaCN/O₂ et temps de séjour.' :
       'Cinétique favorable à la lixiviation directe.'),
  };
}
