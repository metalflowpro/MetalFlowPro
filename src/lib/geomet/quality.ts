// ─────────────────────────────────────────────────────────────────────────────
// Qualité & couverture des données géométallurgiques — module PUR.
//
// Un modèle géométallurgique ne vaut que ce que valent les données qui le
// nourrissent. Avant de PUBLIER une prédiction, il faut savoir : quels domaines
// sont réellement caractérisés, quelle proportion du tonnage minerai est couverte
// par un modèle fiable, et quels contrôles QA/QC échouent. Ce module calcule ces
// diagnostics à partir des domaines déjà agrégés (LIMS + Block Model), sans
// aucune dépendance Supabase/React — entièrement testable.
//
// La couverture est le KPI central du plan (§13) :
//   Couverture = tonnage des blocs couverts par un modèle validé / tonnage total.
// ─────────────────────────────────────────────────────────────────────────────

import { GEOMET_GOVERNANCE } from '../config/constants';

/** Niveau de confiance d'un domaine, du plus fort au plus faible. */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'none';

export interface DomainQualityInput {
  /** Nombre d'essais métallurgiques approuvés rattachés au domaine. */
  sampleCount: number;
  /** Récupération de conception présente (le domaine a une métallurgie). */
  hasRecovery: boolean;
  /** Indice de broyage (BWi) présent. */
  hasBwi: boolean;
  /** Bornes de récupération mesurées, si disponibles (points de %). */
  recoveryMin: number | null;
  recoveryMax: number | null;
}

export type VariabilityClass =
  | 'stable'
  | 'variable'
  | 'very_variable'
  | 'undercharacterized';

export interface DomainQuality {
  confidence: ConfidenceLevel;
  variability: VariabilityClass;
  /** Écart P90−P10 de récupération (points de %), null si non mesurable. */
  recoverySpread: number | null;
}

type SampleThresholds = { medium: number; high: number };
type SpreadThresholds = { variable: number; veryVariable: number };

/**
 * Classe la variabilité d'un domaine à partir de l'étendue de récupération
 * mesurée. Sans au moins deux essais on ne peut RIEN dire de la dispersion :
 * le domaine est « insuffisamment caractérisé », jamais « stable » par défaut
 * (une moyenne unique ne prouve pas l'homogénéité).
 */
export function variabilityClass(
  input: DomainQualityInput,
  spread: SpreadThresholds = GEOMET_GOVERNANCE.VARIABILITY_SPREAD_PT,
): { klass: VariabilityClass; spread: number | null } {
  const { sampleCount, recoveryMin, recoveryMax } = input;
  const range =
    recoveryMin != null && recoveryMax != null && recoveryMax >= recoveryMin
      ? recoveryMax - recoveryMin
      : null;
  if (sampleCount < 2 || range == null) {
    return { klass: 'undercharacterized', spread: range };
  }
  if (range >= spread.veryVariable) return { klass: 'very_variable', spread: range };
  if (range >= spread.variable) return { klass: 'variable', spread: range };
  return { klass: 'stable', spread: range };
}

/**
 * Confiance d'un domaine : combine le nombre d'essais (base) et la variabilité
 * (une dispersion excessive dégrade la confiance même avec beaucoup d'essais).
 * Un domaine sans métallurgie est `none` — pas `low` — pour le distinguer d'un
 * domaine testé mais faiblement couvert.
 */
export function domainConfidence(
  input: DomainQualityInput,
  thresholds: SampleThresholds = GEOMET_GOVERNANCE.CONFIDENCE_SAMPLE_THRESHOLDS,
  spread: SpreadThresholds = GEOMET_GOVERNANCE.VARIABILITY_SPREAD_PT,
): DomainQuality {
  const { klass, spread: recoverySpread } = variabilityClass(input, spread);

  if (!input.hasRecovery || input.sampleCount === 0) {
    return { confidence: 'none', variability: klass, recoverySpread };
  }

  let level: ConfidenceLevel;
  if (input.sampleCount >= thresholds.high && input.hasBwi) level = 'high';
  else if (input.sampleCount >= thresholds.medium) level = 'medium';
  else level = 'low';

  // Une variabilité « très variable » plafonne la confiance à « moyenne » :
  // beaucoup d'essais dispersés ne font pas une prédiction fiable.
  if (klass === 'very_variable' && level === 'high') level = 'medium';

  return { confidence: level, variability: klass, recoverySpread };
}

export interface CoverageDomainInput {
  tonnage: number;
  confidence: ConfidenceLevel;
}

export interface CoverageBreakdown {
  total: number;
  high: number;
  medium: number;
  low: number;
  none: number;
  highPct: number;
  mediumPct: number;
  lowPct: number;
  nonePct: number;
  /** Part du tonnage couverte par un modèle « validé » = confiance ≥ moyenne. */
  validatedPct: number;
}

/**
 * Ventile le tonnage minerai par niveau de confiance. Le KPI publié est
 * `validatedPct` (high + medium) — la fraction du gisement pour laquelle une
 * prédiction peut appuyer une décision.
 */
export function coverageBreakdown(rows: CoverageDomainInput[]): CoverageBreakdown {
  const acc = { high: 0, medium: 0, low: 0, none: 0 };
  for (const r of rows) {
    const t = r.tonnage > 0 ? r.tonnage : 0;
    acc[r.confidence] += t;
  }
  const total = acc.high + acc.medium + acc.low + acc.none;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  return {
    total,
    ...acc,
    highPct: pct(acc.high),
    mediumPct: pct(acc.medium),
    lowPct: pct(acc.low),
    nonePct: pct(acc.none),
    validatedPct: pct(acc.high + acc.medium),
  };
}

export type QaSeverity = 'error' | 'warning' | 'info';

export interface QaFinding {
  code: string;
  severity: QaSeverity;
  domain: string | null;
  message: string;
}

export interface QaDomainRow {
  name: string;
  gidCode: string | null;
  sampleCount: number;
  hasRecovery: boolean;
  hasBwi: boolean;
  hasP80: boolean;
  variability: VariabilityClass;
  tonnage: number | null;
}

/**
 * Contrôles QA/QC avant publication (plan §4 « Règles de contrôle » et §13).
 * Chaque anomalie est renvoyée comme un `QaFinding` typé — la page se contente
 * de les afficher, triés par sévérité.
 *
 * `blockDomainCanons` = canons des lithologies présentes dans le Block Model,
 * pour repérer les blocs non caractérisés (une lithologie du BM sans domaine
 * géométallurgique correspondant).
 */
export function qaChecks(
  domains: QaDomainRow[],
  mappedCanons: Set<string>,
  blockDomains: { canon: string; label: string }[],
  thresholds: SampleThresholds = GEOMET_GOVERNANCE.CONFIDENCE_SAMPLE_THRESHOLDS,
): QaFinding[] {
  const findings: QaFinding[] = [];

  for (const d of domains) {
    if (!d.gidCode || !d.gidCode.trim()) {
      findings.push({ code: 'gid_missing', severity: 'warning', domain: d.name,
        message: 'Domaine sans code GID — l\'association au modèle de blocs est ambiguë.' });
    }
    if (!d.hasRecovery || d.sampleCount === 0) {
      findings.push({ code: 'no_sample', severity: 'error', domain: d.name,
        message: 'Domaine sans essai métallurgique : aucune récupération ne peut être publiée.' });
    } else if (d.sampleCount < thresholds.medium) {
      findings.push({ code: 'few_samples', severity: 'warning', domain: d.name,
        message: `Trop peu d'essais (${d.sampleCount} < ${thresholds.medium}) — confiance faible.` });
    }
    if (d.variability === 'very_variable') {
      findings.push({ code: 'high_variability', severity: 'warning', domain: d.name,
        message: 'Variabilité excessive de récupération — envisager de scinder le domaine ou d\'ajouter des essais.' });
    }
    if (!d.hasP80 && !d.hasBwi) {
      findings.push({ code: 'no_p80', severity: 'info', domain: d.name,
        message: 'Aucun P80 recommandé ni BWi — le broyage optimal du domaine n\'est pas contraint.' });
    }
    if (d.tonnage == null || d.tonnage === 0) {
      findings.push({ code: 'no_tonnage', severity: 'info', domain: d.name,
        message: 'Aucun tonnage Block Model rattaché — le domaine ne pèse pas dans la couverture.' });
    }
  }

  // Blocs non caractérisés : lithologie présente au Block Model sans domaine.
  for (const b of blockDomains) {
    if (!mappedCanons.has(b.canon)) {
      findings.push({ code: 'uncovered_blocks', severity: 'warning', domain: b.label,
        message: 'Lithologie du modèle de blocs sans domaine géométallurgique — blocs non couverts.' });
    }
  }

  const order: Record<QaSeverity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
