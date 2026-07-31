// ─────────────────────────────────────────────────────────────────────────────
// Jumeau numérique — confrontation modèle procédé / usine réelle.
//
// Le COS collecte des mesures d'usine (tags historian, débits, teneurs) et la
// Simulation prédit ce que le circuit DEVRAIT produire. Rien ne reliait les
// deux : ce module fait le pont.
//
// Pour chaque grandeur observable, il compare le prédit au mesuré et normalise
// l'écart par la tolérance métier de la grandeur (un écart de 2 °C n'a pas le
// même sens qu'un écart de 2 points de pH). On en tire :
//   • un écart normalisé, comparable d'une grandeur à l'autre ;
//   • une sévérité (conforme / surveillance / dérive / critique) ;
//   • une cause probable, tirée du signe et de la nature de l'écart ;
//   • un indice de santé global du jumeau (0–100).
//
// Module PUR : aucune dépendance Supabase/React, entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

/** Grandeurs comparables entre StreamResult (simulé) et tags d'usine (mesuré). */
export type TwinMetric =
  | 'mass_flow' | 'solids_content' | 'gold_grade' | 'gold_flow'
  | 'dissolved_gold' | 'cyanide_concentration' | 'pH' | 'temperature'
  | 'energy_consumption' | 'recovery';

export interface MetricSpec {
  metric: TwinMetric;
  label: string;
  unit: string;
  /** Écart absolu considéré comme normal (bruit de mesure + variabilité). */
  tolerance: number;
  /** Tolérance exprimée en % de la valeur prédite plutôt qu'en absolu. */
  relative?: boolean;
  /** Explication d'un écart positif (mesuré > prédit) et négatif. */
  causeHigh: string;
  causeLow: string;
}

/**
 * Tolérances métier par grandeur. Elles ne sont PAS arbitraires : elles
 * reflètent la répétabilité usuelle de la mesure en usine et la variabilité
 * acceptable du procédé.
 */
export const METRIC_SPECS: Record<TwinMetric, MetricSpec> = {
  mass_flow: {
    metric: 'mass_flow', label: 'Débit massique', unit: 't/h', tolerance: 5, relative: true,
    causeHigh: 'alimentation supérieure au design — vérifier la consigne d\'extraction et la calibration du peson',
    causeLow: 'sous-alimentation — goulot amont, trémie vide ou convoyeur ralenti',
  },
  solids_content: {
    metric: 'solids_content', label: 'Densité de pulpe', unit: '%solides', tolerance: 3,
    causeHigh: 'pulpe trop épaisse — eau de dilution insuffisante, risque de viscosité et de mauvaise classification',
    causeLow: 'pulpe trop diluée — excès d\'eau, temps de séjour réduit en lixiviation',
  },
  gold_grade: {
    metric: 'gold_grade', label: 'Teneur Au', unit: 'g/t', tolerance: 10, relative: true,
    causeHigh: 'minerai plus riche que prévu — vérifier le plan de mélange et le block model',
    causeLow: 'minerai plus pauvre — dilution minière ou erreur d\'échantillonnage',
  },
  gold_flow: {
    metric: 'gold_flow', label: 'Flux métal', unit: 'kg/h', tolerance: 10, relative: true,
    causeHigh: 'plus de métal alimenté que prévu — teneur ou débit sous-estimés',
    causeLow: 'moins de métal — perte amont ou surestimation de la teneur',
  },
  dissolved_gold: {
    metric: 'dissolved_gold', label: 'Or dissous', unit: 'mg/L', tolerance: 15, relative: true,
    causeHigh: 'dissolution supérieure — cinétique favorable ou charbon saturé qui n\'adsorbe plus',
    causeLow: 'dissolution insuffisante — cyanure libre bas, oxygène limitant ou preg-robbing',
  },
  cyanide_concentration: {
    metric: 'cyanide_concentration', label: 'CN⁻ libre', unit: 'ppm', tolerance: 20, relative: true,
    causeHigh: 'surdosage cyanure — surcoût réactif et risque environnemental',
    causeLow: 'sous-dosage cyanure — lixiviation bridée, récupération en danger',
  },
  pH: {
    metric: 'pH', label: 'pH', unit: '', tolerance: 0.3,
    causeHigh: 'excès de chaux — surcoût et risque de passivation',
    causeLow: 'alcalinité protectrice insuffisante — DANGER : dégagement de HCN sous pH 10',
  },
  temperature: {
    metric: 'temperature', label: 'Température', unit: '°C', tolerance: 4,
    causeHigh: 'échauffement anormal — friction, réaction exothermique ou refroidissement défaillant',
    causeLow: 'température basse — cinétique de lixiviation ralentie',
  },
  energy_consumption: {
    metric: 'energy_consumption', label: 'Énergie spécifique', unit: 'kWh/t', tolerance: 12, relative: true,
    causeHigh: 'surconsommation — minerai plus dur que le BWi retenu, garnissage usé ou charge de boulets inadaptée',
    causeLow: 'sous-consommation — broyeur sous-chargé, débit réel inférieur ou broyage plus grossier qu\'attendu',
  },
  recovery: {
    metric: 'recovery', label: 'Récupération', unit: '%', tolerance: 2,
    causeHigh: 'récupération supérieure au modèle — minerai plus tendre ou libération meilleure que prévu',
    causeLow: 'récupération dégradée — libération insuffisante, preg-robbing ou perte en résidus',
  },
};

export type TwinSeverity = 'conforme' | 'surveillance' | 'derive' | 'critique';

export interface TwinComparison {
  metric: TwinMetric;
  label: string;
  unit: string;
  predicted: number;
  measured: number;
  /** Écart brut mesuré − prédit. */
  deviation: number;
  /** Écart en % de la valeur prédite. */
  deviationPct: number;
  /** Écart rapporté à la tolérance : 1 = à la limite, 3 = trois fois trop. */
  normalized: number;
  severity: TwinSeverity;
  /** Cause probable, selon le sens de l'écart. */
  probableCause: string | null;
}

export interface TwinReport {
  comparisons: TwinComparison[];
  /** Indice de santé 0–100 : 100 = le modèle décrit parfaitement l'usine. */
  healthIndex: number;
  /** Nombre d'écarts par sévérité. */
  counts: Record<TwinSeverity, number>;
  /** Écarts classés du plus grave au moins grave. */
  drifts: TwinComparison[];
  /** Synthèse lisible. */
  summary: string;
  /** Vrai si aucune grandeur comparable n'a été trouvée. */
  empty: boolean;
}

function severityOf(normalized: number): TwinSeverity {
  if (normalized <= 1) return 'conforme';
  if (normalized <= 2) return 'surveillance';
  if (normalized <= 4) return 'derive';
  return 'critique';
}

/** Poids de la sévérité dans l'indice de santé (plus c'est grave, plus ça pèse). */
const SEVERITY_PENALTY: Record<TwinSeverity, number> = {
  conforme: 0, surveillance: 6, derive: 18, critique: 40,
};

/**
 * Confronte un jeu de valeurs prédites par la simulation à un jeu de valeurs
 * mesurées en usine.
 *
 * Seules les grandeurs présentes des DEUX côtés sont comparées : on ne juge
 * jamais sur une valeur absente, on l'ignore et on le signale via `empty`.
 */
export function compareTwin(
  predicted: Partial<Record<TwinMetric, number>>,
  measured: Partial<Record<TwinMetric, number>>,
): TwinReport {
  const comparisons: TwinComparison[] = [];

  for (const key of Object.keys(METRIC_SPECS) as TwinMetric[]) {
    const p = predicted[key];
    const m = measured[key];
    if (p == null || m == null || !Number.isFinite(p) || !Number.isFinite(m)) continue;

    const spec = METRIC_SPECS[key];
    const deviation = m - p;
    const deviationPct = p !== 0 ? (deviation / p) * 100 : 0;

    // Tolérance absolue, dérivée du % quand la spec est relative. On borne par
    // une valeur plancher pour éviter qu'une prédiction quasi nulle rende
    // n'importe quel écart « critique ».
    const tol = spec.relative
      ? Math.max(Math.abs(p) * spec.tolerance / 100, 1e-6)
      : spec.tolerance;
    const normalized = Math.abs(deviation) / tol;
    const severity = severityOf(normalized);

    comparisons.push({
      metric: key,
      label: spec.label,
      unit: spec.unit,
      predicted: +p.toFixed(3),
      measured: +m.toFixed(3),
      deviation: +deviation.toFixed(3),
      deviationPct: +deviationPct.toFixed(2),
      normalized: +normalized.toFixed(2),
      severity,
      probableCause: severity === 'conforme'
        ? null
        : (deviation > 0 ? spec.causeHigh : spec.causeLow),
    });
  }

  if (comparisons.length === 0) {
    return {
      comparisons: [], healthIndex: 0,
      counts: { conforme: 0, surveillance: 0, derive: 0, critique: 0 },
      drifts: [], empty: true,
      summary: 'Aucune grandeur comparable : il faut des valeurs simulées ET mesurées sur au moins un paramètre.',
    };
  }

  const counts: Record<TwinSeverity, number> = { conforme: 0, surveillance: 0, derive: 0, critique: 0 };
  for (const c of comparisons) counts[c.severity]++;

  const penalty = comparisons.reduce((s, c) => s + SEVERITY_PENALTY[c.severity], 0) / comparisons.length;
  const healthIndex = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  const drifts = comparisons
    .filter(c => c.severity !== 'conforme')
    .sort((a, b) => b.normalized - a.normalized);

  let summary: string;
  if (counts.critique > 0) {
    summary = `${counts.critique} écart(s) critique(s) — le modèle ne décrit plus l'usine : ${drifts[0].label} à ${drifts[0].deviationPct >= 0 ? '+' : ''}${drifts[0].deviationPct.toFixed(1)} %.`;
  } else if (counts.derive > 0) {
    summary = `${counts.derive} dérive(s) détectée(s), la plus marquée sur ${drifts[0].label} (${drifts[0].deviationPct >= 0 ? '+' : ''}${drifts[0].deviationPct.toFixed(1)} %).`;
  } else if (counts.surveillance > 0) {
    summary = `${counts.surveillance} grandeur(s) à surveiller, aucune dérive avérée — le jumeau reste représentatif.`;
  } else {
    summary = `Les ${comparisons.length} grandeurs comparées sont dans la tolérance : le modèle décrit fidèlement l'usine.`;
  }

  return { comparisons, healthIndex, counts, drifts, summary, empty: false };
}

// ═══ Extraction des mesures depuis les tags d'usine ══════════════════════════

export interface TagReading {
  tag: string;
  unit?: string;
  value: number | null;
  quality?: string;
}

/**
 * Correspondance entre suffixe de tag historian et grandeur du jumeau.
 * On raisonne sur le SUFFIXE (après le point) car le préfixe identifie
 * l'équipement (SAG01, CIL_A.TANK1…), pas la grandeur.
 */
const TAG_SUFFIX_MAP: Array<{ match: RegExp; metric: TwinMetric }> = [
  { match: /FEED_DRY|FEED_RATE|TPH$/i,        metric: 'mass_flow' },
  { match: /DENSITY_PULP|PCT_SOLIDS|SOLIDS/i, metric: 'solids_content' },
  { match: /CN_FREE|CYANIDE/i,                metric: 'cyanide_concentration' },
  { match: /\bPH$|\.PH$/i,                    metric: 'pH' },
  { match: /TEMP/i,                           metric: 'temperature' },
  { match: /AU_SOL|DISSOLVED/i,               metric: 'dissolved_gold' },
  { match: /GRADE|AU_GT/i,                    metric: 'gold_grade' },
  { match: /PWR|POWER|KWH/i,                  metric: 'energy_consumption' },
];

/**
 * Agrège des lectures de tags en un jeu de mesures exploitable par le jumeau.
 *
 * Les lectures de qualité douteuse (`bad`, `missing`, `frozen`) sont écartées :
 * comparer un modèle à un capteur gelé produirait une fausse dérive. Plusieurs
 * lectures d'une même grandeur sont moyennées.
 */
export function measuredFromTags(readings: TagReading[]): {
  measured: Partial<Record<TwinMetric, number>>;
  used: number;
  skipped: number;
} {
  const buckets = new Map<TwinMetric, number[]>();
  let skipped = 0;

  for (const r of readings) {
    if (r.value == null || !Number.isFinite(r.value)) { skipped++; continue; }
    if (r.quality && ['bad', 'missing', 'frozen'].includes(r.quality)) { skipped++; continue; }

    const hit = TAG_SUFFIX_MAP.find(m => m.match.test(r.tag));
    if (!hit) { skipped++; continue; }

    const list = buckets.get(hit.metric) ?? [];
    list.push(r.value);
    buckets.set(hit.metric, list);
  }

  const measured: Partial<Record<TwinMetric, number>> = {};
  let used = 0;
  for (const [metric, values] of buckets) {
    measured[metric] = values.reduce((a, b) => a + b, 0) / values.length;
    used += values.length;
  }

  return { measured, used, skipped };
}
