// ─────────────────────────────────────────────────────────────────────────────
// Gates de conformité NI 43-101 — points de contrôle bloquants.
//
// Un rapport 43-101 est un livrable réglementaire : certaines règles ne sont pas
// négociables. Ce module les encode en contrôles évaluables, groupés en « gates »
// correspondant aux étapes du plan (V3 ressource, V5 réserve, V6 économie,
// V7 rapport). La règle la plus dure — une ressource INFÉRÉE ne peut JAMAIS
// devenir réserve ni entrer dans l'étude économique (définitions CIM) — est un
// échec systématique, pas un avertissement.
//
// Fonctions PURES — aucun import React/Supabase. La page assemble l'entrée depuis
// les modules ; les données absentes produisent un warn/fail explicite.
// ─────────────────────────────────────────────────────────────────────────────

export type GateStatus = 'pass' | 'warn' | 'fail';

/** Un contrôle unitaire. */
export interface Check {
  id: string;
  label: string;
  status: GateStatus;
  detail?: string;
}

/** Résultat d'un gate = agrégat de ses contrôles. */
export interface GateResult {
  gateId: string;
  label: string;
  status: GateStatus;
  checks: Check[];
}

/** Données de conformité assemblées par la page depuis les modules. */
export interface ComplianceInput {
  resource: {
    /** Existe-t-il un run d'estimation marqué « d'effet » ? */
    hasEffectiveRun: boolean;
    /** Date d'effet de la ressource (exigence 43-101). */
    effectiveDate: string | null;
    /** Biais de validation croisée (erreur moyenne), null si non calculée. */
    crossValMeanError: number | null;
    /** Écart-type des composites (pour juger la tolérance de biais). */
    crossValStdev?: number | null;
    /** Le grade-tonnage (donc le cut-off) est-il documenté ? */
    hasGradeTonnage: boolean;
    /** QP assigné à l'estimation de ressource ? */
    qpAssigned: boolean;
  };
  reserve: {
    /** Nombre de blocs INFÉRÉS présents dans le plan minier (doit être 0). */
    inferredBlocksInPlan: number;
    dilutionApplied: boolean;
    miningRecoveryApplied: boolean;
    /** Tonnage de réserve (t). */
    reserveTonnes: number;
    /** Tonnage de ressource Mesuré+Indiqué contraint par la fosse (t). */
    resourceMITonnes: number;
    qpAssigned: boolean;
  };
  economics: {
    /** Les hypothèses de prix proviennent-elles de la source unique partagée ? */
    pricesFromSingleSource: boolean;
    /** Une analyse de sensibilité existe-t-elle ? */
    hasSensitivity: boolean;
  };
  report: {
    /** Nombre d'items du Form 43-101F1 renseignés. */
    itemsComplete: number;
    /** Nombre total d'items attendus. */
    itemsTotal: number;
    /** Chaque item renseigné a-t-il un QP et une date ? */
    allItemsSignedOff: boolean;
  };
}

/** Statut agrégé = le pire des contrôles (fail > warn > pass). */
function worst(checks: Check[]): GateStatus {
  if (checks.some(c => c.status === 'fail')) return 'fail';
  if (checks.some(c => c.status === 'warn')) return 'warn';
  return 'pass';
}

function check(id: string, label: string, ok: boolean, failStatus: GateStatus = 'fail', detail?: string): Check {
  return { id, label, status: ok ? 'pass' : failStatus, detail };
}

/**
 * Tolérance de biais de validation croisée, en fraction de l'écart-type des
 * composites. 10 % est une règle de bon sens (pas une norme CIM chiffrée) : un
 * biais bien en deçà de la dispersion naturelle des données n'est pas
 * significatif. Un QP peut légitimement resserrer ou desserrer ce seuil selon
 * le gisement — d'où la constante nommée et documentée plutôt qu'un « 0.1 »
 * muet dans le calcul.
 */
export const BIAS_TOLERANCE_FRACTION_OF_STDEV = 0.1;

/** V3 — Gate Ressource. */
export function gateResource(input: ComplianceInput['resource']): GateResult {
  const tolerance = input.crossValStdev != null ? BIAS_TOLERANCE_FRACTION_OF_STDEV * input.crossValStdev : null;
  const biasOk = input.crossValMeanError == null
    ? false
    : tolerance == null
      ? true // pas d'écart-type disponible : on ne peut pas juger la tolérance, donc on n'échoue pas dessus
      : Math.abs(input.crossValMeanError) <= tolerance;

  const checks: Check[] = [
    check('effective_run', 'Un run d\'estimation est marqué « d\'effet »', input.hasEffectiveRun),
    check('effective_date', 'Date d\'effet de la ressource renseignée', !!input.effectiveDate),
    check('grade_tonnage', 'Cut-off documenté (courbe grade-tonnage)', input.hasGradeTonnage),
    check('cross_val', 'Validation croisée disponible', input.crossValMeanError != null, 'warn'),
    check('bias', 'Biais de validation croisée dans la tolérance (≤ 10 % σ)', biasOk, 'warn',
      input.crossValMeanError != null ? `biais = ${input.crossValMeanError.toFixed(4)}` : undefined),
    check('qp', 'Qualified Person assigné à la ressource', input.qpAssigned),
  ];
  return { gateId: 'V3', label: 'Ressource', status: worst(checks), checks };
}

/** V5 — Gate Réserve (contient la règle dure CIM). */
export function gateReserve(input: ComplianceInput['reserve']): GateResult {
  const checks: Check[] = [
    // Règle DURE : aucun bloc inféré dans le plan minier.
    check('no_inferred', 'Aucune ressource inférée dans le plan minier (règle CIM)',
      input.inferredBlocksInPlan === 0, 'fail',
      input.inferredBlocksInPlan > 0 ? `${input.inferredBlocksInPlan} bloc(s) inféré(s) détecté(s)` : undefined),
    check('dilution', 'Dilution minière appliquée et documentée', input.dilutionApplied),
    check('recovery', 'Récupération minière appliquée et documentée', input.miningRecoveryApplied),
    check('tonnage', 'Tonnage de réserve ≤ ressource M+I contrainte par la fosse',
      input.resourceMITonnes <= 0 ? false : input.reserveTonnes <= input.resourceMITonnes, 'fail',
      `réserve ${Math.round(input.reserveTonnes)} t vs M+I ${Math.round(input.resourceMITonnes)} t`),
    check('qp', 'Qualified Person assigné à la réserve', input.qpAssigned),
  ];
  return { gateId: 'V5', label: 'Réserve', status: worst(checks), checks };
}

/** V6 — Gate Économie. */
export function gateEconomics(input: ComplianceInput['economics']): GateResult {
  const checks: Check[] = [
    check('single_source', 'Hypothèses de prix issues de la source unique', input.pricesFromSingleSource, 'warn'),
    check('sensitivity', 'Analyse de sensibilité présente', input.hasSensitivity, 'warn'),
  ];
  return { gateId: 'V6', label: 'Économie', status: worst(checks), checks };
}

/** V7 — Gate Rapport (Form 43-101F1). */
export function gateReport(input: ComplianceInput['report']): GateResult {
  const complete = input.itemsTotal > 0 && input.itemsComplete >= input.itemsTotal;
  const checks: Check[] = [
    check('items', `Tous les items du Form 43-101F1 renseignés (${input.itemsComplete}/${input.itemsTotal})`, complete),
    check('signoff', 'Chaque item a un QP et une date', input.allItemsSignedOff),
  ];
  return { gateId: 'V7', label: 'Rapport', status: worst(checks), checks };
}

/** Évalue tous les gates. */
export function evaluateGates(input: ComplianceInput): GateResult[] {
  return [
    gateResource(input.resource),
    gateReserve(input.reserve),
    gateEconomics(input.economics),
    gateReport(input.report),
  ];
}

/** Vrai si aucun gate n'est en échec (bloquant pour l'export du rapport). */
export function canExportReport(gates: GateResult[]): boolean {
  return !gates.some(g => g.status === 'fail');
}
