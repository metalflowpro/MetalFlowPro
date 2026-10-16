// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — construction des entrées à partir des DONNÉES DU PROJET.
//
// Carte de propriété des grandeurs (aucune n'est recopiée en dur ici) :
//   débit usine, disponibilité, densité du minerai → Projet
//   heures/an, durée de vie, contingence            → Paramètres (resolveSettings)
//   méthode, ratio de découverture, hauteur de banc,
//   réserves, durée de vie, montée en cadence       → Mine & Optimisation (mine_params)
//   ore/stérile par année                           → Mine & Optimisation (mine_phases)
//   prix du gazole / de l'électricité, heures/ETP   → hypothèses partagées (DEFAULT_ASSUMPTIONS)
//   tout le reste (catalogue d'engins, taux, coûts unitaires) → référentiel
//                                                     documenté (referenceData.ts)
//
// Le modèle persistant ne stocke que les SURCHARGES de l'utilisateur : à chaque
// ouverture, les valeurs non surchargées sont relues du projet, donc une
// modification du débit ou de la densité se propage sans recopie.
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS, computeProductionMetrics, type ResolvedAssumptions } from '../config/constants';
import { formatDecimalGrouped } from '../format/number';
import { computeOpenPitCost, type OpenPitInputs, type OpenPitPeriod, type OpenPitResult } from './openPit';
import { computeUndergroundCost, type UndergroundInputs, type UndergroundPeriod, type UndergroundResult } from './underground';
import {
  OP_BLAST_REFERENCE,
  OP_CALENDAR_REFERENCE,
  OP_COST_FACTOR_REFERENCE,
  OP_DESIGN_RULES,
  OP_DRILL_REFERENCE,
  OP_EQUIPMENT_CATALOG,
  OP_FIXED_HOURLY,
  OP_LABOUR_RATES,
  OP_LOADING_REFERENCE,
  OP_OVERHEAD_REFERENCE,
  OP_REFERENCE_ANNUAL_ORE_T,
  OP_REFERENCE_SOURCE,
  OP_ROLE_RATES,
  OP_STAFF,
  OP_SUPPORT_REFERENCE,
  OP_TRUCK_REFERENCE,
  UG_CALENDAR_REFERENCE,
  UG_HANDLING_REFERENCE,
  UG_INTENSITY_REFERENCE,
  UG_LABOUR_RATES,
  UG_REFERENCE_ANNUAL_ORE_T,
  UG_REFERENCE_SOURCE,
  UG_ROLE_RATES,
  UG_STAFF,
  ugCapitalHeadingReference,
  ugFleetReference,
  ugInfrastructureReference,
  ugOperatingHeadingReference,
  ugStopeReference,
} from './referenceData';
import type { InputOrigin, MiningMethod, Provenance } from './types';

/** Sous-ensemble de mine_params lu par le module (toutes colonnes facultatives). */
export interface MineParamsSource {
  method?: string | null;
  stripping_ratio?: number | string | null;
  bench_height_m?: number | string | null;
  reserves_mt?: number | string | null;
  lom_years?: number | null;
  ramp_up_y1_pct?: number | null;
  ramp_up_y2_pct?: number | null;
}

export interface MinePhaseSource {
  year_start: number;
  year_end: number;
  ore_mt: number | string;
  waste_mt: number | string;
}

export interface MiningSourceData {
  project: { target_tph: number; availability_pct: number; ore_sg: number; gold_grade_g_t: number };
  assumptions: Pick<ResolvedAssumptions, 'hoursPerYear' | 'lomYears' | 'contingencyFraction'>;
  /** Valeurs brutes de project_settings, pour savoir si une hypothèse est saisie ou par défaut. */
  settings: { lom_years?: number | null; contingency_pct?: number | null } | null;
  mineParams: MineParamsSource | null;
  phases: MinePhaseSource[];
}

export interface ScheduleInputs {
  annualOreTonnes: number;
  lomYears: number;
  /** Réserves (t) — 0 = non plafonné. */
  reservesTonnes: number;
  rampUpY1Pct: number;
  rampUpY2Pct: number;
  strippingRatio: number;
  preProductionYearsOpenPit: number;
  preProductionYearsUnderground: number;
  /** Utiliser les phases de Mine & Optimisation (ratio de découverture annuel) si elles existent. */
  useMinePhases: boolean;
}

export interface MiningModel {
  method: MiningMethod;
  schedule: ScheduleInputs;
  openPit: Omit<OpenPitInputs, 'periods'>;
  underground: Omit<UndergroundInputs, 'periods'>;
}

/** Surcharges persistées : chemin pointé (« openPit.haulDistanceKm ») → valeur. */
export type MiningOverrides = Record<string, unknown>;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Méthode suggérée par Mine & Optimisation (« Open pit », « Souterrain »…). */
export function methodFromMineParams(method: string | null | undefined): MiningMethod | null {
  if (!method) return null;
  const m = method.toLowerCase();
  if (/(under|souterr|ug\b|stop|sublevel|cut)/.test(m)) return 'underground';
  if (/(open|ciel|pit|fosse)/.test(m)) return 'open_pit';
  return null;
}

/**
 * Construit le modèle par défaut à partir du projet, et la provenance de
 * chaque champ (clé = chemin pointé, comme pour les surcharges).
 */
export function defaultMiningModel(src: MiningSourceData): { model: MiningModel; provenance: Record<string, Provenance> } {
  const prov: Record<string, Provenance> = {};
  const set = (path: string, origin: InputOrigin, source: string) => { prov[path] = { origin, source }; };
  const mp = src.mineParams;
  const p = src.project;

  // ── Calendrier de production ─────────────────────────────────────────────
  const annualOre = computeProductionMetrics(p, src.assumptions, 0).annualTonnes;
  set('schedule.annualOreTonnes', 'projet', `Projet — ${p.target_tph} t/h × ${p.availability_pct} % × ${src.assumptions.hoursPerYear} h/an`);

  const reservesMt = num(mp?.reserves_mt);
  const reserves = reservesMt != null && reservesMt > 0 ? reservesMt * 1e6 : 0;
  if (reserves > 0) set('schedule.reservesTonnes', 'mine', 'Mine & Optimisation — réserves');
  else set('schedule.reservesTonnes', 'derive', 'Aucune réserve saisie — durée de vie seule');

  let lom: number;
  if (mp?.lom_years != null && mp.lom_years > 0) { lom = mp.lom_years; set('schedule.lomYears', 'mine', 'Mine & Optimisation — durée de vie'); }
  else if (src.settings?.lom_years != null) { lom = src.assumptions.lomYears; set('schedule.lomYears', 'settings', 'Paramètres — durée de vie de la mine'); }
  else if (reserves > 0 && annualOre > 0) { lom = Math.max(1, Math.ceil(reserves / annualOre - 1e-9)); set('schedule.lomYears', 'derive', 'Réserves ÷ débit annuel'); }
  else { lom = src.assumptions.lomYears; set('schedule.lomYears', 'settings', 'Paramètres — durée de vie (valeur par défaut)'); }

  const r1 = mp?.ramp_up_y1_pct ?? null;
  const r2 = mp?.ramp_up_y2_pct ?? null;
  set('schedule.rampUpY1Pct', r1 != null ? 'mine' : 'derive', r1 != null ? 'Mine & Optimisation — montée en cadence an 1' : 'Aucun paramètre mine — pleine cadence');
  set('schedule.rampUpY2Pct', r2 != null ? 'mine' : 'derive', r2 != null ? 'Mine & Optimisation — montée en cadence an 2' : 'Aucun paramètre mine — pleine cadence');

  const sr = num(mp?.stripping_ratio);
  set('schedule.strippingRatio', sr != null ? 'mine' : 'derive', sr != null ? 'Mine & Optimisation — ratio de découverture' : 'Non renseigné dans Mine & Optimisation');
  set('schedule.preProductionYearsOpenPit', 'reference', `${OP_REFERENCE_SOURCE} — période de pré-production`);
  set('schedule.preProductionYearsUnderground', 'reference', `${UG_REFERENCE_SOURCE} — période initiale de 10 trimestres`);
  set('schedule.useMinePhases', 'mine', src.phases.length ? `Mine & Optimisation — ${src.phases.length} phase(s)` : 'Aucune phase saisie');

  const method = methodFromMineParams(mp?.method) ?? 'open_pit';
  set('method', mp?.method ? 'mine' : 'derive', mp?.method ? `Mine & Optimisation — « ${mp.method} »` : 'Aucune méthode saisie — ciel ouvert par défaut');

  const contingencyPct = src.assumptions.contingencyFraction * 100;
  const contSource = src.settings?.contingency_pct != null ? 'Paramètres — contingence' : 'Paramètres — contingence (valeur par défaut)';
  const diesel = DEFAULT_ASSUMPTIONS.DIESEL_COST_USD_L;
  const elec = DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH;

  // ── Ciel ouvert ──────────────────────────────────────────────────────────
  const bench = num(mp?.bench_height_m);
  const openPit: MiningModel['openPit'] = {
    ...OP_CALENDAR_REFERENCE,
    mechanicalAvailabilityPct: OP_DESIGN_RULES.mechanicalAvailabilityPct,
    useOfAvailabilityPct: OP_DESIGN_RULES.useOfAvailabilityPct,
    oreSgTpm3: p.ore_sg,
    wasteSgTpm3: p.ore_sg,
    swellFraction: OP_DESIGN_RULES.swellFraction,
    benchHeightM: bench ?? OP_DESIGN_RULES.benchHeightM,
    drillEquipmentId: OP_DRILL_REFERENCE.equipmentId,
    holeDiameterMm: OP_DRILL_REFERENCE.holeDiameterMm,
    burdenToDiameter: OP_DESIGN_RULES.burdenToDiameter,
    spacingToBurden: OP_DESIGN_RULES.spacingToBurden,
    subdrillToBurden: OP_DESIGN_RULES.subdrillToBurden,
    stemmingToBurden: OP_DESIGN_RULES.stemmingToBurden,
    penetrationMph: OP_DESIGN_RULES.penetrationMph,
    ...OP_BLAST_REFERENCE,
    loading: OP_LOADING_REFERENCE.map(l => ({
      equipmentId: l.equipmentId,
      bucketM3: l.bucketM3,
      fillFactor: OP_DESIGN_RULES.bucketFillFactor,
      cycleSec: l.equipmentId.startsWith('excavator') ? OP_DESIGN_RULES.shovelCycleSec : OP_DESIGN_RULES.loaderCycleSec,
      share: l.share,
    })),
    truckEquipmentId: OP_TRUCK_REFERENCE.equipmentId,
    truckPayloadT: OP_TRUCK_REFERENCE.payloadT,
    haulDistanceKm: OP_DESIGN_RULES.haulDistanceKm,
    loadedSpeedKmh: OP_DESIGN_RULES.loadedSpeedKmh,
    emptySpeedKmh: OP_DESIGN_RULES.emptySpeedKmh,
    spotAndDumpMin: OP_DESIGN_RULES.spotAndDumpMin,
    support: OP_SUPPORT_REFERENCE.map(s => ({ ...s })),
    equipment: OP_EQUIPMENT_CATALOG.map(e => ({ ...e })),
    costFactors: { dieselUsdL: diesel, electricityUsdKwh: elec, ...OP_COST_FACTOR_REFERENCE },
    rates: OP_LABOUR_RATES.map(r => ({ ...r })),
    roleRates: { ...OP_ROLE_RATES },
    fixedHourly: { ...OP_FIXED_HOURLY },
    staff: OP_STAFF.map(s => ({ ...s })),
    adminConsumablesPctOfSalaries: OP_OVERHEAD_REFERENCE.adminConsumablesPctOfSalaries,
    servicesConsumablesUsdPerYear: OP_OVERHEAD_REFERENCE.servicesConsumablesUsdPerYear,
    labourContingencyPct: OP_OVERHEAD_REFERENCE.labourContingencyPct,
    smallEquipmentPctOfMajor: OP_OVERHEAD_REFERENCE.smallEquipmentPctOfMajor,
    initialSparesPctOfMajor: OP_OVERHEAD_REFERENCE.initialSparesPctOfMajor,
    shopToolsPctOfMajor: OP_OVERHEAD_REFERENCE.shopToolsPctOfMajor,
    contingencyPct,
  };
  for (const k of Object.keys(openPit)) set(`openPit.${k}`, 'reference', OP_REFERENCE_SOURCE);
  set('openPit.oreSgTpm3', 'projet', 'Projet — densité du minerai');
  set('openPit.wasteSgTpm3', 'projet', 'Projet — densité du minerai (stérile non caractérisé)');
  set('openPit.benchHeightM', bench != null ? 'mine' : 'reference', bench != null ? 'Mine & Optimisation — hauteur de banc' : 'Règle par défaut de Mine & Optimisation — hauteur de banc');
  set('openPit.costFactors', 'economie', 'Hypothèses partagées — gazole & électricité ; facteurs Magino EquipCost');
  set('openPit.contingencyPct', 'settings', contSource);
  set('openPit.staff', 'reference', `${OP_REFERENCE_SOURCE} — effectif établi pour ~${formatDecimalGrouped(OP_REFERENCE_ANNUAL_ORE_T / 1e6, 1)} Mt/an de minerai`);
  set('openPit.swellFraction', 'reference', `${UG_REFERENCE_SOURCE} — foisonnement 40 %`);
  for (const k of ['burdenToDiameter', 'spacingToBurden', 'subdrillToBurden', 'stemmingToBurden', 'penetrationMph', 'haulDistanceKm', 'loadedSpeedKmh', 'emptySpeedKmh', 'spotAndDumpMin', 'mechanicalAvailabilityPct', 'useOfAvailabilityPct']) {
    set(`openPit.${k}`, 'reference', 'Règle de dimensionnement usuelle — à remplacer par la conception du projet');
  }

  // ── Souterrain ───────────────────────────────────────────────────────────
  const underground: MiningModel['underground'] = {
    ...UG_CALENDAR_REFERENCE,
    paidHoursPerYear: DEFAULT_ASSUMPTIONS.LABOUR_HOURS_PER_FTE_YR,
    devOreFraction: UG_INTENSITY_REFERENCE.devOreFraction,
    opLateralMPerKt: UG_INTENSITY_REFERENCE.opLateralMPerKt,
    capLateralMPerKtProduction: UG_INTENSITY_REFERENCE.capLateralMPerKtProduction,
    preProductionCapLateralM: UG_INTENSITY_REFERENCE.preProductionCapLateralM,
    verticalMPerKtProduction: UG_INTENSITY_REFERENCE.verticalMPerKtProduction,
    preProductionVerticalM: UG_INTENSITY_REFERENCE.preProductionVerticalM,
    verticalUsdPerM: UG_INTENSITY_REFERENCE.verticalUsdPerM,
    backfillTPerStopeT: UG_INTENSITY_REFERENCE.backfillTPerStopeT,
    capitalHeading: ugCapitalHeadingReference(p.ore_sg),
    operatingHeading: ugOperatingHeadingReference(p.ore_sg),
    stopes: ugStopeReference(),
    ...UG_HANDLING_REFERENCE,
    rates: UG_LABOUR_RATES.map(r => ({ ...r })),
    roleRates: { ...UG_ROLE_RATES },
    staff: UG_STAFF.map(s => ({ ...s })),
    fleet: ugFleetReference(),
    infrastructure: ugInfrastructureReference(),
    contingencyPct,
  };
  for (const k of Object.keys(underground)) set(`underground.${k}`, 'reference', UG_REFERENCE_SOURCE);
  set('underground.paidHoursPerYear', 'economie', 'Hypothèses partagées — heures payées par ETP');
  set('underground.contingencyPct', 'settings', contSource);
  set('underground.staff', 'reference', `${UG_REFERENCE_SOURCE} — effectif établi pour ~${formatDecimalGrouped(UG_REFERENCE_ANNUAL_ORE_T / 1e6, 2)} Mt/an de minerai`);
  set('underground.infrastructure', 'reference', `${UG_REFERENCE_SOURCE} — quantités du plan Eastwood, à adapter au projet`);
  set('underground.capitalHeading', 'reference', `${UG_REFERENCE_SOURCE} — densité de roche = densité du minerai du projet`);
  set('underground.operatingHeading', 'reference', `${UG_REFERENCE_SOURCE} — densité de roche = densité du minerai du projet`);

  return {
    model: {
      method,
      schedule: {
        annualOreTonnes: annualOre,
        lomYears: lom,
        reservesTonnes: reserves,
        rampUpY1Pct: r1 ?? 100,
        rampUpY2Pct: r2 ?? 100,
        strippingRatio: sr ?? 0,
        preProductionYearsOpenPit: OP_OVERHEAD_REFERENCE.preProductionYears,
        preProductionYearsUnderground: UG_INTENSITY_REFERENCE.preProductionYears,
        useMinePhases: src.phases.length > 0,
      },
      openPit,
      underground,
    },
    provenance: prov,
  };
}

// ── Surcharges ───────────────────────────────────────────────────────────────

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (next == null || typeof next !== 'object') return; // chemin obsolète : ignoré
    cur = next as Record<string, unknown>;
  }
  if (keys[keys.length - 1] in cur) cur[keys[keys.length - 1]] = value;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o != null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Applique les surcharges utilisateur au modèle par défaut (copie profonde). */
export function applyOverrides(model: MiningModel, overrides: MiningOverrides): MiningModel {
  const copy = JSON.parse(JSON.stringify(model)) as MiningModel;
  for (const [path, value] of Object.entries(overrides)) setPath(copy as unknown as Record<string, unknown>, path, value);
  return copy;
}

/** Provenance effective : une surcharge prime sur la provenance par défaut. */
export function effectiveProvenance(base: Record<string, Provenance>, overrides: MiningOverrides): Record<string, Provenance> {
  const out = { ...base };
  for (const path of Object.keys(overrides)) out[path] = { origin: 'override', source: 'Saisi dans le module Coûts miniers' };
  return out;
}

// ── Calendrier annuel ────────────────────────────────────────────────────────

/** Rapport stérile/minerai de l'année `year` d'après les phases qui la couvrent. */
function phaseStripRatio(phases: MinePhaseSource[], year: number): number | null {
  let ore = 0;
  let waste = 0;
  for (const ph of phases) {
    if (year < ph.year_start || year > ph.year_end) continue;
    const span = Math.max(1, ph.year_end - ph.year_start + 1);
    ore += (num(ph.ore_mt) ?? 0) / span;
    waste += (num(ph.waste_mt) ?? 0) / span;
  }
  return ore > 0 ? waste / ore : null;
}

/** Minerai envoyé à l'usine par année de production (montée en cadence + plafond des réserves). */
export function productionOre(s: ScheduleInputs): number[] {
  const out: number[] = [];
  let cum = 0;
  for (let y = 1; y <= Math.max(0, Math.round(s.lomYears)); y++) {
    const ramp = y === 1 ? s.rampUpY1Pct : y === 2 ? s.rampUpY2Pct : 100;
    let t = s.annualOreTonnes * ramp / 100;
    if (s.reservesTonnes > 0) t = Math.max(0, Math.min(t, s.reservesTonnes - cum));
    cum += t;
    out.push(t);
  }
  return out;
}

export function openPitPeriods(model: MiningModel, phases: MinePhaseSource[]): OpenPitPeriod[] {
  const s = model.schedule;
  const ore = productionOre(s);
  const srOf = (y: number) => (s.useMinePhases ? phaseStripRatio(phases, y) : null) ?? s.strippingRatio;
  const pp = Math.max(0, Math.round(s.preProductionYearsOpenPit));
  // Pré-découverture : chaque année de pré-production déplace le stérile de la
  // première année de production (la flotte achetée tourne à sa cadence nominale).
  const prestrip = (ore[0] ?? 0) * srOf(1);
  const periods: OpenPitPeriod[] = [];
  for (let k = pp; k >= 1; k--) periods.push({ year: 1 - k, preProduction: true, oreTonnes: 0, wasteTonnes: prestrip });
  ore.forEach((o, i) => periods.push({ year: i + 1, preProduction: false, oreTonnes: o, wasteTonnes: o * srOf(i + 1) }));
  return periods;
}

export function undergroundPeriods(model: MiningModel): UndergroundPeriod[] {
  const s = model.schedule;
  const ore = productionOre(s);
  const pp = Math.max(0, Math.round(s.preProductionYearsUnderground));
  const periods: UndergroundPeriod[] = [];
  for (let k = pp; k >= 1; k--) periods.push({ year: 1 - k, preProduction: true, oreTonnes: 0 });
  ore.forEach((o, i) => periods.push({ year: i + 1, preProduction: false, oreTonnes: o }));
  return periods;
}

export type MiningCostResult = OpenPitResult | UndergroundResult;

/**
 * Écart d'échelle au-delà duquel on signale que les effectifs fixes et les
 * infrastructures du référentiel (dimensionnés pour la mine de référence) ne
 * suivent pas la cadence du projet : facteur 2 dans un sens ou dans l'autre.
 */
export const REFERENCE_SCALE_TOLERANCE = 2;

function scaleWarning(annualOre: number, referenceOre: number, what: string): string | null {
  if (annualOre <= 0 || referenceOre <= 0) return null;
  const ratio = annualOre / referenceOre;
  if (ratio <= REFERENCE_SCALE_TOLERANCE && ratio >= 1 / REFERENCE_SCALE_TOLERANCE) return null;
  return `Le projet alimente ${formatDecimalGrouped(annualOre / 1e6, 2)} Mt/an, contre ~${formatDecimalGrouped(referenceOre / 1e6, 2)} Mt/an pour la mine de référence : ${what} ne suivent pas la cadence — adaptez-les dans les hypothèses.`;
}

/** Calcule le coût minier du modèle (méthode active) sur le calendrier du projet. */
export function computeMiningCost(model: MiningModel, phases: MinePhaseSource[]): MiningCostResult {
  if (model.method === 'underground') {
    const res = computeUndergroundCost({ ...model.underground, periods: undergroundPeriods(model) });
    const w = scaleWarning(model.schedule.annualOreTonnes, UG_REFERENCE_ANNUAL_ORE_T, 'le personnel indirect et les infrastructures fixes');
    if (w) res.warnings.push(w);
    return res;
  }
  const res = computeOpenPitCost({ ...model.openPit, periods: openPitPeriods(model, phases) });
  if (model.schedule.strippingRatio <= 0 && !(model.schedule.useMinePhases && phases.length)) {
    res.warnings.unshift('Ratio de découverture nul : renseignez-le dans Mine & Optimisation ou ici — sinon seul le minerai est miné.');
  }
  const w = scaleWarning(model.schedule.annualOreTonnes, OP_REFERENCE_ANNUAL_ORE_T, 'les cadres et les effectifs horaires fixes');
  if (w) res.warnings.push(w);
  return res;
}
