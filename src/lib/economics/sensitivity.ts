// ─────────────────────────────────────────────────────────────────────────────
// Analyse de sensibilité — moteur PUR (tornado + spider).
//
// Générique : ne connaît rien à l'économie minière. On lui donne un jeu de
// paramètres de base, une liste de variables (borne basse / haute) et une
// fonction d'évaluation ; il renvoie la contribution de chaque variable à la
// variation de la sortie (NPV, TRI, AISC…). C'est l'outil qui répond à « qu'est-
// ce qui bouge le plus mon NPV ? » — une question qu'un modèle ponctuel ne peut
// pas trancher.
//
// Aucune dépendance. Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface SensitivityVariable<T> {
  /** Champ de l'objet de base à faire varier. */
  key: keyof T;
  label: string;
  /** Valeur basse et haute de la variable (unités du champ). */
  low: number;
  high: number;
  unit?: string;
}

export interface TornadoBar {
  key: string;
  label: string;
  unit?: string;
  /** Sortie quand la variable est à sa borne basse / haute. */
  lowOutput: number;
  highOutput: number;
  /** Écart à la sortie de base. */
  lowDelta: number;
  highDelta: number;
  /** Amplitude totale |haut − bas| — critère de tri du tornado. */
  swing: number;
}

/**
 * Diagramme tornado : effet, une variable à la fois, sur la sortie. Les barres
 * sont triées par amplitude décroissante (la variable la plus déterminante en
 * haut) — la convention d'un tornado.
 *
 * @param base      jeu de paramètres de référence.
 * @param variables variables à tester (borne basse/haute chacune).
 * @param evaluate  fonction sortie = f(paramètres).
 */
export function tornado<T>(
  base: T,
  variables: SensitivityVariable<T>[],
  evaluate: (x: T) => number,
): { baseOutput: number; bars: TornadoBar[] } {
  const baseOutput = evaluate(base);
  const bars = variables.map(v => {
    const lowOutput = evaluate({ ...base, [v.key]: v.low });
    const highOutput = evaluate({ ...base, [v.key]: v.high });
    return {
      key: String(v.key),
      label: v.label,
      unit: v.unit,
      lowOutput,
      highOutput,
      lowDelta: lowOutput - baseOutput,
      highDelta: highOutput - baseOutput,
      swing: Math.abs(highOutput - lowOutput),
    };
  });
  bars.sort((a, b) => b.swing - a.swing);
  return { baseOutput, bars };
}

export interface SpiderLine {
  key: string;
  label: string;
  /** Sortie à chaque variation relative de `steps`. */
  outputs: number[];
}

/**
 * Analyse « spider » : chaque variable est balayée sur une même échelle de
 * variations relatives (ex. −20 %…+20 %), la sortie tracée pour chacune. Les
 * pentes comparées montrent d'un coup d'œil les leviers les plus raides.
 *
 * @param steps variations relatives (ex. [-0.2, -0.1, 0, 0.1, 0.2]).
 */
export function spider<T>(
  base: T,
  variables: { key: keyof T; label: string }[],
  steps: number[],
  evaluate: (x: T) => number,
): { steps: number[]; lines: SpiderLine[] } {
  const lines = variables.map(v => {
    const baseVal = base[v.key] as unknown as number;
    return {
      key: String(v.key),
      label: v.label,
      outputs: steps.map(s => evaluate({ ...base, [v.key]: baseVal * (1 + s) })),
    };
  });
  return { steps, lines };
}
