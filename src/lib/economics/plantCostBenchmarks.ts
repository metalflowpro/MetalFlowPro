// ─────────────────────────────────────────────────────────────────────────────
// Usine & infrastructures — générateurs CAPEX / OPEX « ordre de grandeur ».
//
// Extrait de la page Économie, où ~40 montants étaient écrits en dur dans le
// corps des fonctions. Les valeurs sont INCHANGÉES (référentiel interne de
// l'app, pour une usine de référence de PLANT_CAPEX_SCALING.referenceTph) ;
// elles sont désormais nommées, documentées et testées, et doivent être
// remplacées par des devis dès qu'on en dispose (lignes éditables à l'écran).
//
// Correction de méthode : la mise à l'échelle était LINÉAIRE et plafonnée
// (facteur = t/h ÷ 200 borné à [0,5 ; 2]) — une usine de 1 500 t/h était
// chiffrée comme une usine de 400 t/h. On applique la loi de capacité usuelle
// (règle des « six-dixièmes », Williams 1947) : C = C_ref × (Q / Q_ref)^n,
// sans plafond.
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS, cadToUsd } from '../config/constants';

export const PLANT_CAPEX_SCALING = {
  /** Débit de l'usine de référence des montants ci-dessous (t/h). */
  referenceTph: 200,
  /**
   * Exposant de capacité (0,6 = règle des six-dixièmes). Typiquement 0,5–0,7
   * pour les usines de traitement ; plus bas = économies d'échelle plus fortes.
   */
  exponent: 0.6,
} as const;

/** Facteur de capacité : (Q / Q_ref)^n. */
export function plantCapexScaleFactor(tph: number, scaling = PLANT_CAPEX_SCALING): number {
  if (!(tph > 0) || !(scaling.referenceTph > 0)) return 0;
  return Math.pow(tph / scaling.referenceTph, scaling.exponent);
}

export interface PlantCapexBenchmark {
  /** Équipements des Critères de conception déclenchant la ligne (au moins un actif) ; vide = ligne toujours présente. */
  equipIds: string[];
  category: string;
  description: string;
  /** M US$ pour l'usine de référence. */
  referenceMusd: number;
  contingencyPct: number;
}

/** Référentiel CAPEX de l'usine (M US$ à 200 t/h). */
export const PLANT_CAPEX_BENCHMARKS: PlantCapexBenchmark[] = [
  { equipIds: ['grizzly', 'apron', 'conveyor', 'stockpile', 'silo', 'sampling', 'dedusting'], category: 'Usine de traitement', description: 'Manutention minerai (grizzly, alimentateur, convoyeurs, stockpile)', referenceMusd: 4.5, contingencyPct: 12 },
  { equipIds: ['jaw'], category: 'Usine de traitement', description: 'Concasseur à mâchoires primaire', referenceMusd: 2.0, contingencyPct: 10 },
  { equipIds: ['gyratory'], category: 'Usine de traitement', description: 'Concasseur giratoire primaire', referenceMusd: 4.5, contingencyPct: 10 },
  { equipIds: ['cone'], category: 'Usine de traitement', description: 'Concasseur à cône secondaire/tertiaire', referenceMusd: 3.2, contingencyPct: 10 },
  { equipIds: ['hpgr'], category: 'Usine de traitement', description: 'HPGR — Broyeur à rouleaux haute pression', referenceMusd: 8.0, contingencyPct: 15 },
  { equipIds: ['pebble_crusher'], category: 'Usine de traitement', description: 'Concasseur à galets (pebble crusher)', referenceMusd: 1.8, contingencyPct: 10 },
  { equipIds: ['sag'], category: 'Usine de traitement', description: 'Broyeur SAG (circuit SAG/Ball)', referenceMusd: 18.0, contingencyPct: 12 },
  { equipIds: ['ag'], category: 'Usine de traitement', description: 'Broyeur autogène (AG)', referenceMusd: 16.0, contingencyPct: 12 },
  { equipIds: ['ball'], category: 'Usine de traitement', description: 'Broyeur à boulets', referenceMusd: 9.0, contingencyPct: 12 },
  { equipIds: ['rod'], category: 'Usine de traitement', description: 'Broyeur à barres', referenceMusd: 6.5, contingencyPct: 12 },
  { equipIds: ['vertimill', 'isamill', 'towermill'], category: 'Usine de traitement', description: 'Rebroyage (Vertimill / IsaMill / Tower Mill)', referenceMusd: 5.5, contingencyPct: 12 },
  { equipIds: ['hydrocyclone'], category: 'Usine de traitement', description: 'Hydrocyclones (classification)', referenceMusd: 1.2, contingencyPct: 10 },
  { equipIds: ['screen'], category: 'Usine de traitement', description: 'Cribles de classification', referenceMusd: 1.5, contingencyPct: 10 },
  { equipIds: ['xrt'], category: 'Usine de traitement', description: 'Tri optique XRT (pré-concentration)', referenceMusd: 4.0, contingencyPct: 15 },
  { equipIds: ['dms'], category: 'Usine de traitement', description: 'Séparation en milieu dense (DMS)', referenceMusd: 5.5, contingencyPct: 15 },
  { equipIds: ['magsep'], category: 'Usine de traitement', description: 'Séparation magnétique', referenceMusd: 1.8, contingencyPct: 10 },
  { equipIds: ['flash_flot', 'column_flot', 'flotation'], category: 'Usine de traitement', description: 'Circuit de flottation (flash / colonnes / cellules)', referenceMusd: 7.5, contingencyPct: 12 },
  { equipIds: ['gravity', 'intensive_leach'], category: 'Usine de traitement', description: 'Gravimétrie & lixiviation intensive (Knelson / ILR)', referenceMusd: 3.5, contingencyPct: 10 },
  { equipIds: ['preleach_thickener'], category: 'Usine de traitement', description: 'Épaississeur pré-lixiviation', referenceMusd: 2.8, contingencyPct: 10 },
  { equipIds: ['cil'], category: 'Usine de traitement', description: 'Cuves CIL (carbone en lixiviation)', referenceMusd: 12.0, contingencyPct: 10 },
  { equipIds: ['adr'], category: 'Usine de traitement', description: 'Circuit ADR (élution / électrolyse / refonte)', referenceMusd: 6.5, contingencyPct: 10 },
  { equipIds: ['o2_plant'], category: 'Usine de traitement', description: 'Usine O₂ (générateur oxygène)', referenceMusd: 3.0, contingencyPct: 12 },
  { equipIds: ['interstage_screens'], category: 'Usine de traitement', description: 'Tamis interstades carbone', referenceMusd: 1.2, contingencyPct: 10 },
  { equipIds: ['acid_wash', 'carbon_reg'], category: 'Usine de traitement', description: 'Lavage acide & régénération charbon', referenceMusd: 2.5, contingencyPct: 10 },
  { equipIds: ['merrill_crowe'], category: 'Usine de traitement', description: 'Circuit Merrill-Crowe (précipitation zinc)', referenceMusd: 4.0, contingencyPct: 12 },
  { equipIds: ['pox'], category: 'Usine de traitement', description: 'Oxydation sous pression (POx)', referenceMusd: 35.0, contingencyPct: 20 },
  { equipIds: ['biox'], category: 'Usine de traitement', description: 'Bio-oxydation (BioX)', referenceMusd: 22.0, contingencyPct: 20 },
  { equipIds: ['roasting'], category: 'Usine de traitement', description: 'Grillage (roaster)', referenceMusd: 28.0, contingencyPct: 20 },
  { equipIds: ['albion'], category: 'Usine de traitement', description: 'Procédé Albion (albion process)', referenceMusd: 18.0, contingencyPct: 20 },
  { equipIds: ['cn_prep', 'lime_prep', 'floculant_prep', 'flot_reagents'], category: 'Usine de traitement', description: 'Préparation réactifs (NaCN, chaux, floculants)', referenceMusd: 2.2, contingencyPct: 10 },
  { equipIds: ['water_sys', 'compressed_air', 'pumps', 'power_supply'], category: 'Services', description: 'Services & utilités (eau, air comprimé, pompes, électrique)', referenceMusd: 5.5, contingencyPct: 12 },
  { equipIds: ['detox'], category: 'Gestion résidus', description: 'Détoxification des résidus (INCO/SO₂-Air)', referenceMusd: 2.5, contingencyPct: 10 },
  { equipIds: ['sart'], category: 'Gestion résidus', description: 'Procédé SART (récupération cuivre/cyanure)', referenceMusd: 4.5, contingencyPct: 15 },
  { equipIds: ['dry_stack'], category: 'Gestion résidus', description: 'Résidus filtrés (dry stack)', referenceMusd: 8.0, contingencyPct: 15 },
  { equipIds: ['effluent'], category: 'Gestion résidus', description: 'Traitement effluents & eau process', referenceMusd: 3.0, contingencyPct: 12 },
  { equipIds: ['thickener'], category: 'Gestion résidus', description: 'Épaississeurs (déchargement résidus)', referenceMusd: 3.5, contingencyPct: 10 },
  { equipIds: ['filter'], category: 'Gestion résidus', description: 'Filtres (presse à filtre / tambour)', referenceMusd: 4.0, contingencyPct: 12 },
  { equipIds: ['tailings'], category: 'Gestion résidus', description: 'Infrastructure parc à résidus & génie civil', referenceMusd: 10.0, contingencyPct: 15 },
  // Lignes fixes (toujours présentes)
  { equipIds: [], category: 'Infrastructure', description: 'Génie civil, bâtiments, camp de construction', referenceMusd: 6.0, contingencyPct: 12 },
  { equipIds: [], category: 'Infrastructure', description: 'Routes, accès, alimentation électrique (ligne HT)', referenceMusd: 4.0, contingencyPct: 15 },
  { equipIds: [], category: 'EPCM', description: 'Frais EPCM (ingénierie, approvisionnement, gestion)', referenceMusd: 5.5, contingencyPct: 5 },
  { equipIds: [], category: 'Contingence', description: 'Contingence projet', referenceMusd: 4.0, contingencyPct: 0 },
];

export interface PlantCapexLine {
  category: string;
  description: string;
  value_musd: number;
  contingency_pct: number;
}

/** Lignes CAPEX de l'usine pour les équipements actifs et le débit donné. */
export function buildPlantCapexLines(equip: Record<string, boolean>, tph: number, scaling = PLANT_CAPEX_SCALING): PlantCapexLine[] {
  const f = plantCapexScaleFactor(tph, scaling);
  return PLANT_CAPEX_BENCHMARKS
    .filter(b => b.equipIds.length === 0 || b.equipIds.some(id => equip[id]))
    .map(b => ({
      category: b.category,
      description: b.description,
      value_musd: +(b.referenceMusd * f).toFixed(2),
      contingency_pct: b.contingencyPct,
    }));
}

// ── OPEX ─────────────────────────────────────────────────────────────────────

/**
 * Référentiel OPEX de l'usine. Coûts unitaires : repères d'ingénierie en C$
 * convertis en US$ (devise des lignes `value_usd_t`). Consommations de repli :
 * utilisées seulement si le bilan massique et les Critères n'en donnent pas.
 */
export const PLANT_OPEX_BENCHMARKS = {
  unitCostUsd: {
    nacnPerKg: cadToUsd(2.80),
    limePerKg: cadToUsd(0.18),
    carbonPerKg: cadToUsd(2.50),
    oxygenPerKg: cadToUsd(0.22),
    flocculantPerKg: cadToUsd(3.0),
    so2PerKg: cadToUsd(0.25),
    h2o2PerKg: cadToUsd(1.20),
    grindingMediaPerKg: cadToUsd(1.25),
    linersPerT: cadToUsd(0.55),
    maintenancePerTFallback: cadToUsd(2.5),
    gaPerT: cadToUsd(1.8),
    staffCostPerYear: cadToUsd(95_000),
  },
  /** Consommations (kg par t alimentée) — repli et procédés sans mesure dédiée. */
  consumptionKgT: {
    nacnFallback: 0.45,
    limeFallback: 1.2,
    carbonMakeUp: 0.03,
    oxygen: 0.80,
    flocculant: 0.020,
    detoxSo2: 0.30,
    detoxH2o2: 0.08,
    grindingMediaFallback: 0.6,
  },
  /** Énergie de repli (kWh par t alimentée). */
  energyKwhTFallback: 18,
  /**
   * Effectif usine : base + pente × log10(t/h ÷ t/h de référence), plancher à
   * la référence. Économie d'échelle sur l'effectif (une usine 10× plus
   * grosse n'a pas 10× plus de personnel).
   */
  staffing: { base: 35, perDecade: 60, referenceTph: 100 },
} as const;

export function plantStaffCount(tph: number, s = PLANT_OPEX_BENCHMARKS.staffing): number {
  return Math.round(s.base + s.perDecade * Math.log10(Math.max(tph, s.referenceTph) / s.referenceTph));
}

export interface PlantOpexInputs {
  equip: Record<string, boolean>;
  tph: number;
  annualTonnes: number;
  /** Consommations mesurées au bilan massique (kg/t, kWh/t) ; null = non disponibles. */
  measured: { nacnKgT: number | null; limeKgT: number | null; energyKwhT: number | null };
  /** Consommations des Critères de conception (kg/t) ; null = non saisies. */
  criteria: { nacnKgT: number | null; limeKgT: number | null; ballKgT: number | null };
  electricityUsdKwh: number;
  totalCapexMusd: number;
}

export interface PlantOpexLine {
  category: string;
  description: string;
  value_usd_t: number;
}

export function buildPlantOpexLines(inp: PlantOpexInputs, b = PLANT_OPEX_BENCHMARKS): PlantOpexLine[] {
  const on = (id: string) => inp.equip[id] === true;
  const grinding = ['sag', 'ag', 'ball', 'rod'].some(on);
  const leach = on('cil') || on('heap_leach');
  const u = b.unitCostUsd;
  const c = b.consumptionKgT;
  const cn = inp.measured.nacnKgT ?? inp.criteria.nacnKgT ?? c.nacnFallback;
  const lime = inp.measured.limeKgT ?? inp.criteria.limeKgT ?? c.limeFallback;
  const kwh = inp.measured.energyKwhT ?? b.energyKwhTFallback;

  const lines: PlantOpexLine[] = [];
  const add = (category: string, description: string, usdT: number) => {
    if (usdT > 0.0005) lines.push({ category, description, value_usd_t: +usdT.toFixed(3) });
  };
  add('Réactifs', 'NaCN (cyanure de sodium)', cn * u.nacnPerKg);
  add('Réactifs', 'CaO (chaux vive)', lime * u.limePerKg);
  if (leach) {
    add('Réactifs', 'Charbon actif (make-up)', c.carbonMakeUp * u.carbonPerKg);
    add('Réactifs', 'Oxygène / aération lixiviation', c.oxygen * u.oxygenPerKg);
  }
  if (on('thickener') || on('preleach_thickener')) add('Réactifs', 'Floculant (épaississeur)', c.flocculant * u.flocculantPerKg);
  if (on('detox')) add('Environnement', 'Détoxification CN (SO₂/H₂O₂)', c.detoxSo2 * u.so2PerKg + c.detoxH2o2 * u.h2o2PerKg);
  if (grinding) {
    add('Broyage', 'Médias de broyage (billes acier)', (inp.criteria.ballKgT ?? c.grindingMediaFallback) * u.grindingMediaPerKg);
    add('Broyage', 'Revêtements broyeurs (liners)', u.linersPerT);
  }
  add('Énergie', 'Électricité (broyage + procédé)', kwh * inp.electricityUsdKwh);
  const staff = plantStaffCount(inp.tph, b.staffing);
  add("Main-d'œuvre", `Main-d'œuvre & supervision (~${staff} pers.)`, inp.annualTonnes > 0 ? (staff * u.staffCostPerYear) / inp.annualTonnes : 0);
  if (inp.totalCapexMusd > 0 && inp.annualTonnes > 0) {
    add('Maintenance', `Maintenance & pièces (${(DEFAULT_ASSUMPTIONS.MAINTENANCE_CAPEX_FRACTION_YR * 100).toFixed(1)}% CAPEX/an)`,
      (inp.totalCapexMusd * 1e6 * DEFAULT_ASSUMPTIONS.MAINTENANCE_CAPEX_FRACTION_YR) / inp.annualTonnes);
  } else {
    add('Maintenance', "Maintenance & pièces d'usure", u.maintenancePerTFallback);
  }
  add('G&A', 'Administration & frais généraux (G&A)', u.gaPerT);
  return lines;
}

// ── Registre de main-d'œuvre ────────────────────────────────────────────────

export interface LabourCostRow {
  n_emp: number;
  sal_base_h: number;
  bonus_pct: number;
  benefits_pct: number;
  ot_pct: number;
}

/**
 * Coût annuel d'une ligne du registre : base + prime + heures sup. + avantages
 * (calculés sur base + prime). Source UNIQUE : la ligne, le pied de tableau et
 * le sommaire OPEX utilisaient trois formules différentes (le pied et le
 * sommaire oubliaient les heures supplémentaires).
 */
export function labourRowAnnualCost(r: LabourCostRow, hoursPerFte = DEFAULT_ASSUMPTIONS.LABOUR_HOURS_PER_FTE_YR) {
  const base = r.sal_base_h * hoursPerFte * r.n_emp;
  const bonus = base * r.bonus_pct / 100;
  const benefits = (base + bonus) * r.benefits_pct / 100;
  const overtime = base * r.ot_pct / 100;
  return { base, bonus, benefits, overtime, total: base + bonus + benefits + overtime };
}

// ── Sommaire OPEX détaillé (onglet OPEX › Sommaire) ─────────────────────────

export interface OpexSummaryInputs {
  labourRows: LabourCostRow[];
  powerRows: { kw_mec: number; eff_elec: number; load_factor: number; dispo: number; h_j: number }[];
  reagentRows: { conso_unit: number; cost_unit: number }[];
  mobileRows: { qty: number; h_an: number; usd_h: number }[];
  /** Lignes OPEX de catégorie Maintenance ($/t). */
  maintenanceUsdT: number;
  annualTonnes: number;
  electricityUsdKwh: number;
  /** CAPEX usine (hors mine), M$ — base des pièces de rechange. */
  plantCapexMusd: number;
  /** Rendement électrique plancher : évite une division par zéro sur une ligne vide. */
  minElectricalEfficiency?: number;
}

/** Puissance : kW méca ÷ rendement × charge × disponibilité × h/j × 365 × $/kWh. */
export function powerRowAnnualCost(r: OpexSummaryInputs['powerRows'][number], usdKwh: number, minEff = 0.01): number {
  return (r.kw_mec / Math.max(r.eff_elec, minEff)) * r.load_factor * (r.dispo / 100) * r.h_j * 365 * usdKwh;
}

/**
 * Lignes du sommaire et total. Le total EST la somme des lignes : l'ancien pied
 * de tableau ajoutait en plus tout l'OPEX des lignes (maintenance comprise, déjà
 * dans une ligne) et les pourcentages se rapportaient à un autre total.
 */
export function opexSummary(inp: OpexSummaryInputs) {
  const rows = [
    { key: 'labour', label: "Main d'oeuvre", value: inp.labourRows.reduce((s, r) => s + labourRowAnnualCost(r).total, 0) },
    { key: 'power', label: 'Puissance électrique', value: inp.powerRows.reduce((s, r) => s + powerRowAnnualCost(r, inp.electricityUsdKwh, inp.minElectricalEfficiency), 0) },
    { key: 'reagents', label: 'Réactifs, médias et consommables', value: inp.reagentRows.reduce((s, r) => s + r.conso_unit * inp.annualTonnes * r.cost_unit, 0) },
    { key: 'wear', label: "Consommables et pièces d'usure", value: inp.maintenanceUsdT * inp.annualTonnes },
    { key: 'mobile', label: 'Manutention', value: inp.mobileRows.reduce((s, r) => s + r.qty * r.h_an * r.usd_h, 0) },
    { key: 'spares', label: 'Pièces de rechange', value: inp.plantCapexMusd * 1e6 * DEFAULT_ASSUMPTIONS.SPARE_PARTS_CAPEX_FRACTION_YR },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  return { rows: rows.map(r => ({ ...r, pct: total > 0 ? (r.value / total) * 100 : 0 })), total };
}
