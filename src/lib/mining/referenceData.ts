// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — RÉFÉRENTIEL des hypothèses par défaut.
//
// Ces valeurs ne sont PAS des constantes : ce sont les valeurs de départ d'un
// projet qui n'a pas encore sa propre étude de coûts miniers. Chacune est
// reprise des deux modèles de référence fournis, avec sa cellule source, et
// l'interface les affiche avec la provenance « Référence » jusqu'à ce que
// l'utilisateur les remplace par les données de son projet.
//
//   • MAGINO  — « MaginoCostSummary_Year1_24May2021.xlsx » : mine à ciel ouvert,
//     modèle de coûts type MineCost (feuilles EqLst, EquipCost, OpParms, Blast,
//     LaborRates, Salary, Hourly, Capital). Montants en US$ (équipement) et C$
//     (main-d'œuvre, sautage : convertis par cadToUsd).
//   • EASTWOOD — « IAMGOLD 2026 Eastwood PFS Integrated TEM Rev05.xlsx » : mine
//     souterraine (CapexDev/OpexDev, Mine Dev-Stoping Cost, Labour_Input, Labour Count,
//     Equipment List, Infra-Mobile Cost, Opex/Capex Summary). Montants en C$,
//     convertis par cadToUsd.
//
// Les grandeurs que l'app possède déjà (densité du minerai, débit, ratio de
// découverture, hauteur de banc, contingence, prix du gazole et de
// l'électricité, heures payées/ETP…) ne sont PAS ici : elles sont lues du
// projet par projectInputs.ts.
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import { cadToUsd } from '../config/constants';
import type { LabourRate, MobileEquipmentSpec, StaffLine } from './types';
import type { HeadingDesign, InfrastructureItem, StopeMethod, UgFleetItem } from './underground';

/** Litres par gallon US — conversion des consommations Magino (gal/h → L/h). */
const L_PER_US_GAL = 3.78541;

// ═════════════════════════════════════════════════════════════════════════════
// CIEL OUVERT — Magino
// ═════════════════════════════════════════════════════════════════════════════

export const OP_REFERENCE_SOURCE = 'Magino (MineCost, mai 2021)';

/**
 * Cadence de régime du modèle Magino : minerai moyen de juillet à décembre 2023
 * (Sched ligne 15, kt/mois) × 12. Sert à signaler qu'un projet s'éloigne de
 * l'échelle pour laquelle les effectifs fixes du référentiel ont été établis.
 */
export const OP_REFERENCE_ANNUAL_ORE_T = ((285.2062 + 285.209 + 275.9962 + 285.199 + 276.7133 + 285.9389) / 6) * 1000 * 12;

/**
 * Catalogue des engins (Magino EqLst / DelivCost / EquipCost lignes 8–20).
 * Prix = coût livré (DelivCost!N), US$. Facteur pièces Z = EquipCost!I ÷ prix
 * de base (k$), recalculé en pleine précision (la feuille l'affiche arrondi). Pneus : prix catalogue = coût pneu ÷
 * facteur pneus 0,75 (EquipCost!N = 0,75 × catalogue). Lubrifiants : AA est en
 * gal/h, converti en L/h.
 */
export const OP_EQUIPMENT_CATALOG: MobileEquipmentSpec[] = [
  { id: 'drill_203', label: 'Foreuse rotative 203 mm (type DR410i)', deliveredPriceUsd: 2_249_470, lifeHours: 60_000, partsFactorPerKusd: 0.0232, fuelLph: 93.8314, powerKw: 0, lubeLph: 1.2305 * L_PER_US_GAL, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0, bitsSteelFactorPerKusd: 0.03, maintHoursPerOpHour: 1.18 },
  { id: 'drill_165', label: 'Foreuse fond-de-trou 165 mm (type DI650)', deliveredPriceUsd: 842_450, lifeHours: 45_000, partsFactorPerKusd: 0.02419, fuelLph: 61.9488, powerKw: 0, lubeLph: 0.868 * L_PER_US_GAL, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0, bitsSteelFactorPerKusd: 0.03, maintHoursPerOpHour: 0.67 },
  { id: 'excavator_15m3', label: 'Pelle hydraulique 15 m³ (type PC3000)', deliveredPriceUsd: 4_845_676, lifeHours: 55_000, partsFactorPerKusd: 111.2827 / 3_942, fuelLph: 156.5928, powerKw: 0, lubeLph: 1.39287 * L_PER_US_GAL, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0.002, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 3.27 },
  { id: 'excavator_7m3', label: 'Pelle hydraulique 7 m³ (type PC1250)', deliveredPriceUsd: 1_581_760, lifeHours: 55_000, partsFactorPerKusd: 48.75 / 1_560, fuelLph: 94.2042, powerKw: 0, lubeLph: 0.716 * L_PER_US_GAL, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0.0032, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 1.19 },
  { id: 'loader_11m3', label: 'Chargeuse sur pneus 11,5 m³ (type WA900)', deliveredPriceUsd: 1_990_792, lifeHours: 60_000, partsFactorPerKusd: 20.5643 / 1_568.6, fuelLph: 94.1086, powerKw: 0, lubeLph: 0.854 * L_PER_US_GAL, tireCount: 4, tireListPriceUsd: 50_000, tireLifeHours: 3_500, wearPartsFactorPerKusd: 0.0005, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.7 },
  { id: 'truck_144t', label: 'Tombereau 144 t (type HD1500)', deliveredPriceUsd: 2_582_168, lifeHours: 90_000, partsFactorPerKusd: 0.00907, fuelLph: 106.9955, powerKw: 0, lubeLph: 1.056 * L_PER_US_GAL, tireCount: 6, tireListPriceUsd: 21_952, tireLifeHours: 3_500, wearPartsFactorPerKusd: 0.00055, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.44 },
  { id: 'truck_92t', label: 'Tombereau 92 t (type HD785)', deliveredPriceUsd: 1_452_599, lifeHours: 90_000, partsFactorPerKusd: 0.00907, fuelLph: 90.0934, powerKw: 0, lubeLph: 0.88534 * L_PER_US_GAL, tireCount: 6, tireListPriceUsd: 14_334, tireLifeHours: 3_500, wearPartsFactorPerKusd: 0.00055, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.34 },
  { id: 'dozer_573kw', label: 'Bouteur sur chenilles 573 kW (type PR766)', deliveredPriceUsd: 1_049_018, lifeHours: 50_000, partsFactorPerKusd: 0.0121, fuelLph: 84.4339, powerKw: 0, lubeLph: 1.078 * L_PER_US_GAL, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0.0107, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.64 },
  { id: 'loader_7m3', label: 'Chargeuse de service 7 m³ (type WA600)', deliveredPriceUsd: 757_425, lifeHours: 40_000, partsFactorPerKusd: 11.2833 / 746.25, fuelLph: 50.5724, powerKw: 0, lubeLph: 0.403 * L_PER_US_GAL, tireCount: 4, tireListPriceUsd: 23_346, tireLifeHours: 6_000, wearPartsFactorPerKusd: 0.0008, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.28 },
  { id: 'grader_216kw', label: 'Niveleuse 216 kW (type 16M3)', deliveredPriceUsd: 1_381_374, lifeHours: 40_000, partsFactorPerKusd: 27.2081 / 1_349.6104, fuelLph: 27.724, powerKw: 0, lubeLph: 0.297 * L_PER_US_GAL, tireCount: 6, tireListPriceUsd: 4_101, tireLifeHours: 4_500, wearPartsFactorPerKusd: 0.0017, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.38 },
  { id: 'water_truck', label: 'Camion-citerne 75 700 L', deliveredPriceUsd: 1_614_952, lifeHours: 90_000, partsFactorPerKusd: 0.00907, fuelLph: 52.5418, powerKw: 0, lubeLph: 0.605 * L_PER_US_GAL, tireCount: 6, tireListPriceUsd: 14_334, tireLifeHours: 5_000, wearPartsFactorPerKusd: 0, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.27 },
  { id: 'utility_excavator', label: 'Pelle de service 3,2 m³ (type PC490)', deliveredPriceUsd: 423_780, lifeHours: 35_000, partsFactorPerKusd: 0.02016, fuelLph: 34.3204, powerKw: 0, lubeLph: 0.329 * L_PER_US_GAL, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0.0045, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0.27 },
];

/** Capacités des engins de chargement / transport (Magino EqLst colonne E). */
export const OP_LOADING_REFERENCE = [
  { equipmentId: 'excavator_7m3', bucketM3: 7.0, share: 0.5 },
  { equipmentId: 'loader_11m3', bucketM3: 11.5, share: 0.5 },
] as const;
export const OP_TRUCK_REFERENCE = { equipmentId: 'truck_144t', payloadT: 144 } as const;
export const OP_DRILL_REFERENCE = { equipmentId: 'drill_165', holeDiameterMm: 165 } as const;

/**
 * Flotte de soutien par unité de chargement : Magino achète en pré-production
 * 1 bouteur, 1 chargeuse de service, 1 niveleuse, 1 citerne et 1 pelle de
 * service pour 2 unités de chargement (Capital!G12–G17 vs G8–G9) → 0,5.
 */
export const OP_SUPPORT_REFERENCE = [
  { equipmentId: 'dozer_573kw', unitsPerLoadingUnit: 0.5 },
  { equipmentId: 'loader_7m3', unitsPerLoadingUnit: 0.5 },
  { equipmentId: 'grader_216kw', unitsPerLoadingUnit: 0.5 },
  { equipmentId: 'water_truck', unitsPerLoadingUnit: 0.5 },
  { equipmentId: 'utility_excavator', unitsPerLoadingUnit: 0.5 },
] as const;

/** Calendrier et temps productif (Magino OpParms). */
export const OP_CALENDAR_REFERENCE = {
  hoursPerShift: 12,             // OpParms!E29
  shiftsPerDay: 2,               // OpParms!E31
  operatingDaysPerYear: 365,     // OpParms!E30
  lostShiftsPerYear: 0,          // OpParms!E33
  crews: 4,                      // OpParms!E36
  // Déplacement/relève/sautage 15 + inspection 0 + repas/pauses 60 + plein 0 (OpParms!H6–H9).
  nonProductiveMinPerShift: 75,
  jobEfficiencyMinPerHour: 50,   // OpParms!D11
} as const;

/**
 * Hypothèses physiques de forage-sautage et de productivité. Magino ne publie
 * pas ses feuilles DrlReq/TrkReq (liens externes) : ce sont donc des règles de
 * dimensionnement usuelles, à remplacer par la conception de tir et l'étude de
 * cycles du projet. Chaque valeur est un RATIO (banquette/diamètre…) pour
 * suivre automatiquement le diamètre et la hauteur de banc du projet.
 */
export const OP_DESIGN_RULES = {
  burdenToDiameter: 30,          // B ≈ 25–35 × D (roche moyenne)
  spacingToBurden: 1.15,         // S ≈ 1,0–1,25 × B
  subdrillToBurden: 0.3,         // J ≈ 0,3 × B
  stemmingToBurden: 0.7,         // T ≈ 0,7 × B
  penetrationMph: 30,            // foration rotative/FDT en roche moyenne
  swellFraction: 0.40,           // foisonnement — Eastwood CapexDev!I14 (40 %)
  bucketFillFactor: 0.9,
  shovelCycleSec: 30,
  loaderCycleSec: 40,
  haulDistanceKm: 3.0,           // profil de roulage à remplacer par le plan minier
  loadedSpeedKmh: 18,
  emptySpeedKmh: 30,
  spotAndDumpMin: 1.7,           // mise en place 0,7 + déversement 1,0
  mechanicalAvailabilityPct: 85,
  useOfAvailabilityPct: 85,
  /** Hauteur de banc quand Mine & Optimisation n'en a pas (même valeur que sa création par défaut). */
  benchHeightM: 10,
} as const;

/** Explosifs (Magino Blast). Émulsion : devis Orica 0,8497 C$/kg (Blast!F24). */
export const OP_BLAST_REFERENCE = {
  emulsionWeightFraction: 1,               // Blast!E19 (100 % émulsion)
  emulsionSg: 1.15,                        // Blast!E15
  emulsionUsdKg: cadToUsd(0.8497),         // Blast!F24
  prillSg: 0.85,                           // Blast!E5
  prillUsdKg: 0.32 * 2.2046,               // Blast!E6 (US$/lb → US$/kg)
  anfoFuelWeightFraction: 0.06,            // Blast!E10
  fuelOilSg: 0.84,                         // Blast!E7
  initiationUsdPerHole: cadToUsd(29.4),    // Blast!F54 (détonateur)
  // Service de tir 1 068 216 + équipements 296 796 + dépôts 54 684 C$/an (Blast!F62–F64).
  blastingFixedUsdPerYear: cadToUsd(1_068_216 + 296_800 + 54_684),
} as const;

/** Facteurs du coût horaire des engins (Magino EquipCost!D29–D36). */
export const OP_COST_FACTOR_REFERENCE = {
  lubeUsdL: 23.7 / L_PER_US_GAL,  // EquipCost!D29 (US$/gal)
  partsFactor: 1,                 // EquipCost!D32
  tireFactor: 0.75,               // EquipCost!D33
  maintLabourFactor: 0.5,         // EquipCost!D34
  abrasionIndex: 3,               // EquipCost!D36 (modérée)
} as const;

/**
 * Taux de main-d'œuvre (Magino LaborRates, C$ convertis). Horaire : base +
 * heures sup. (en % de la base) + charges (en % de la base) ; le camp (C$/h ×
 * 2190 h) est porté en coûts site annuels.
 */
function opHourly(id: string, label: string, base: number, ot: number, burden: number, campPerH: number): LabourRate {
  return {
    id, label, payBasis: 'hourly', hourlyRate: cadToUsd(base), annualSalary: 0,
    bonusPct: (ot / base) * 100, burdenPct: (burden / base) * 100, siteCostsUsdYr: cadToUsd(campPerH * 2190),
  };
}
function opSalary(id: string, label: string, base: number, bonus: number, burden: number, camp: number): LabourRate {
  return {
    id, label, payBasis: 'salary', hourlyRate: 0, annualSalary: cadToUsd(base),
    bonusPct: (bonus / base) * 100, burdenPct: (burden / base) * 100, siteCostsUsdYr: cadToUsd(camp),
  };
}

export const OP_LABOUR_RATES: LabourRate[] = [
  opHourly('op_drill', 'Opérateur de foreuse', 31, 4.78, 12.35, 9.27),
  opHourly('op_loader', 'Opérateur pelle/chargeuse', 34, 5.25, 13.01, 9.27),
  opHourly('op_truck', 'Conducteur de tombereau', 29, 4.48, 11.9, 9.27),
  opHourly('op_support', 'Opérateur engins de soutien', 31, 4.78, 12.35, 9.27),
  opHourly('op_blaster', 'Boutefeu', 31, 4.78, 12.35, 9.27),
  opHourly('op_labourer', 'Manœuvre', 23, 3.55, 10.42, 9.27),
  opHourly('op_mechanic', 'Mécanicien / soudeur', 42, 6.48, 14.75, 9.27),
  opHourly('op_fuel_lube', 'Graisseur', 34, 5.25, 13.01, 9.27),
  opHourly('op_tire', 'Pneumaticien', 26, 4.01, 11.23, 9.27),
  opSalary('st_mine_manager', 'Directeur de mine', 198_360, 49_590, 39_214, 18_600),
  opSalary('st_mine_super', 'Surintendant mine', 156_600, 31_320, 33_554, 18_600),
  opSalary('st_foreman', 'Contremaître (forage-sautage / quart)', 122_291, 12_229.1, 28_662, 18_600),
  opSalary('st_clerk', 'Commis administratif', 52_200, 0, 19_008, 18_600),
  opSalary('st_maint_super', 'Surintendant maintenance', 156_600, 31_320, 33_554, 18_600),
  opSalary('st_planner', 'Planificateur maintenance', 93_960, 0, 24_832, 18_600),
  opSalary('st_chief_eng', 'Ingénieur minier en chef', 146_160, 29_232, 32_287, 18_600),
  opSalary('st_senior_eng', 'Ingénieur minier senior / géologue senior', 122_291, 12_229.1, 28_662, 18_600),
  opSalary('st_engineer', 'Ingénieur / géologue / géotechnicien', 96_180, 0, 25_075, 18_600),
  opSalary('st_surveyor', 'Arpenteur en chef', 93_960, 0, 24_832, 18_600),
  opSalary('st_technician', 'Technicien', 78_030, 0, 22_774, 18_600),
];

/** Rôles horaires (Magino Hourly). */
export const OP_ROLE_RATES = {
  drillOperator: 'op_drill',
  loaderOperator: 'op_loader',
  truckOperator: 'op_truck',
  supportOperator: 'op_support',
  blaster: 'op_blaster',
  labourer: 'op_labourer',
  mechanic: 'op_mechanic',
  fuelLubeTech: 'op_fuel_lube',
  tireTech: 'op_tire',
} as const;

/** Effectifs horaires fixes (Magino Hourly!A10–A11, MaintLabor lignes 78–80). */
export const OP_FIXED_HOURLY = { blasters: 2, labourers: 8, fuelLubeTechs: 4, tireTechs: 2 } as const;

/** Cadres et personnel technique (Magino Salary, colonne A). */
export const OP_STAFF: StaffLine[] = [
  { id: 's1', rateId: 'st_mine_manager', count: 1, department: 'Opérations' },
  { id: 's2', rateId: 'st_mine_super', count: 1, department: 'Opérations' },
  { id: 's3', rateId: 'st_foreman', count: 6, department: 'Opérations' },
  { id: 's4', rateId: 'st_clerk', count: 1, department: 'Opérations' },
  { id: 's5', rateId: 'st_maint_super', count: 1, department: 'Maintenance' },
  { id: 's6', rateId: 'st_foreman', count: 2, department: 'Maintenance' },
  { id: 's7', rateId: 'st_planner', count: 1, department: 'Maintenance' },
  { id: 's8', rateId: 'st_clerk', count: 1, department: 'Maintenance' },
  { id: 's9', rateId: 'st_chief_eng', count: 2, department: 'Services techniques' },
  { id: 's10', rateId: 'st_senior_eng', count: 2, department: 'Services techniques' },
  { id: 's11', rateId: 'st_engineer', count: 5, department: 'Services techniques' },
  { id: 's12', rateId: 'st_surveyor', count: 1, department: 'Services techniques' },
  { id: 's13', rateId: 'st_technician', count: 4, department: 'Services techniques' },
];

export const OP_OVERHEAD_REFERENCE = {
  // Consommables d'administration / salaires cadres : 97,46 / 324,87 (OpCosts!H60 / H59).
  adminConsumablesPctOfSalaries: (97.4606 / 324.8687) * 100,
  // Petits équipements + autres consommables de services (OpCosts!H53–H54, mois type ×12, US$).
  servicesConsumablesUsdPerYear: (8.6035 + 16.667) * 1000 * 12,
  labourContingencyPct: 7,  // OpCosts!E67
  // Capital annexe : % des engins majeurs du capital initial (Capital!G42–G45).
  smallEquipmentPctOfMajor: (6_377.69 / 17_388.0558) * 100,
  initialSparesPctOfMajor: (1_000 / 17_388.0558) * 100,
  shopToolsPctOfMajor: (500 / 17_388.0558) * 100,
  /** Années de pré-production par défaut (Magino : une période « PP »). */
  preProductionYears: 1,
} as const;

// ═════════════════════════════════════════════════════════════════════════════
// SOUTERRAIN — Eastwood
// ═════════════════════════════════════════════════════════════════════════════

export const UG_REFERENCE_SOURCE = 'Eastwood PFS (TEM Rev05, 2026)';

/**
 * Cadence de régime du plan Eastwood : minerai moyen des années 4 à 18 (Opex
 * Summary ligne 5). Sert au calage de la productivité implicite de la flotte de
 * production et à l'avertissement d'échelle des effectifs fixes.
 */
const EASTWOOD_STEADY_YEARS_ORE_T = [715_569, 714_297, 713_330, 717_109, 717_852, 715_762, 715_023, 714_672, 715_222, 715_458, 718_769, 717_658, 719_157, 720_000, 719_239];
export const UG_REFERENCE_ANNUAL_ORE_T = EASTWOOD_STEADY_YEARS_ORE_T.reduce((s, v) => s + v, 0) / EASTWOOD_STEADY_YEARS_ORE_T.length;

/** Calendrier (Eastwood Time Utilization Input / CapexDev!M8–M27). */
export const UG_CALENDAR_REFERENCE = {
  shiftsPerDay: 2,
  hoursPerShift: 12,
  nonOperatingHPerShift: 3.9133,  // somme CapexDev!M11–M19
  equipmentAvailability: 0.7,     // CapexDev!M27
  operatingDaysPerYear: 365,
} as const;

/**
 * Intensités physiques déduites du plan Eastwood (Mine Dev-Stoping Cost,
 * colonnes F = LOM et I…R = période initiale de 10 trimestres) :
 *   minerai total 12,53 Mt, dont développement 2,215 Mt ; latéral capital
 *   36 066 m (dont 15 272 m en période initiale), latéral d'exploitation
 *   53 837 m ; vertical 6 484 m (dont 4 104 m initiaux) ; remblai cimenté
 *   6,55 Mt + stérile 2,27 Mt pour 10,31 Mt abattues.
 */
export const UG_INTENSITY_REFERENCE = {
  devOreFraction: 2_215_161 / 12_530_068,
  opLateralMPerKt: 53_836.6 / (12_530_068 / 1000),
  capLateralMPerKtProduction: (36_066.2 - 15_272.5) / ((12_530_068 - 439_537.5) / 1000),
  preProductionCapLateralM: 15_272.5,
  verticalMPerKtProduction: (6_484.3 - 4_104.1) / ((12_530_068 - 439_537.5) / 1000),
  preProductionVerticalM: 4_104.1,
  verticalUsdPerM: cadToUsd(66_594_830.63 / 6_484.3),
  backfillTPerStopeT: (6_546_520 + 2_271_416) / 10_314_906,
  /** Années de pré-production : 10 trimestres de période initiale → 2,5 ans, arrondi à 2. */
  preProductionYears: 2,
} as const;

/** Paramètres communs des deux galeries types (CapexDev / OpexDev). */
function baseHeading(): Omit<HeadingDesign, 'widthM' | 'heightM' | 'overbreakFraction' | 'advancePerRoundM'
  | 'holesPerRound' | 'reamersPerRound' | 'drilledLengthM' | 'boltsPerRound' | 'boltUsd' | 'meshSheetsPerRound'
  | 'meshSheetUsd' | 'remuckTph' | 'lhdTph' | 'servicesUsdPerM' | 'shotcrete' | 'rockSgTpm3'
  | 'labourBasis' | 'directLabourUsdPerM'> {
  return {
    redrillFraction: 0.05,                     // M45
    drillRateMph: 180,                         // M55 (150 m/h × 120 %)
    reamRateMph: 144,                          // M56
    multiBoomGain: 0.85,                       // M68
    positioningSecPerHole: 42,                 // M69
    drillSetupH: 0.5,                          // M75
    drillSteelUsdPerDrillM: cadToUsd(2.3444),  // M236
    explosiveDensityKgM3: 1000,                // P44
    holeDiameterMm: 45,                        // M37
    unchargedCollarM: 0.75,                    // P49
    // (lifters + ANFO) 607,30 C$ / (346,32 kg × 1,15) → coût moyen de l'explosif chargé.
    explosiveUsdKg: cadToUsd((250.9234 + 356.3718) / (346.3164 * 1.15)),
    // (amorce 4,7998 + Nonel 5,356) C$ par trou.
    initiationUsdPerHole: cadToUsd(4.7998 + 5.356),
    // Détonateurs électriques + cordeau + ligne de tir par volée (P239 + P241 + P242).
    accessoriesUsdPerRound: cadToUsd(1.003 + 38.7899 + 181.2285),
    explosiveWastageFraction: 0.15,            // P228
    loadMinPerHole: 1.2,                       // P62
    blastFixedMin: 30 + 30 + 15 + 30,          // P66–P69
    boltMinPerBolt: (2 * 17 + 2 * 35 + 5 * 12) / 64, // S157–S163 : min de pose moyennes par boulon
    meshMinPerSheet: 2,                        // S164
    groundSupportSetupH: 1,                    // S29 + S30
    jumboUsdH: cadToUsd(214.2533),             // M269
    jumboEnergyUsdH: cadToUsd(11.4001),        // M279
    chargerUsdH: cadToUsd(204.33),             // P268
    chargerEnergyUsdH: cadToUsd(29.7517),      // P278
    bolterUsdH: cadToUsd(657.3735),            // S269
    bolterEnergyUsdH: cadToUsd(14.213),        // S279
    lhdUsdH: cadToUsd(353.415),                // AQ251
    lhdEnergyUsdH: cadToUsd(29.6415),          // AQ273
    jumboMaintHPerOpH: 0.2,                    // M193
    chargerMaintHPerOpH: 0.2,                  // P192
    bolterMaintHPerOpH: 0.15,                  // S193
    lhdMaintHPerOpH: 25.8862 / 103.5447,       // AQ193 ÷ taux mécanicien
    drillers: 1,                               // M178
    blasters: 2,                               // P178
    bolters: 2,                                // S178
    muckers: 1,
    muckFixedMin: 20 + 10,                     // AQ56 + AQ57
    allowancePct: 25,                          // C53
  };
}

/** Galerie de développement capital 5,0 × 5,0 m (CapexDev5.0x5.0). */
export function ugCapitalHeadingReference(rockSgTpm3: number): HeadingDesign {
  return {
    ...baseHeading(),
    widthM: 5, heightM: 5, overbreakFraction: 0.1, advancePerRoundM: 3.9,
    holesPerRound: 65, reamersPerRound: 3, drilledLengthM: 4.1,
    // Dos 17 + parements 35 boulons dynamiques (69,82 C$) + front 12 split-sets (15,18 C$).
    boltsPerRound: 64,
    boltUsd: cadToUsd((17 * 69.8237 + 35 * 69.8237 + 12 * 15.1845) / 64),
    // 26 treillis n° 4 (63,59 C$) + 2 n° 6 (38,69 C$).
    meshSheetsPerRound: 28,
    meshSheetUsd: cadToUsd((26 * 63.5922 + 2 * 38.6868) / 28),
    rockSgTpm3,
    lhdTph: 136.5684,                          // AQ69
    remuckTph: 338.5883 / (4.9272 - 2.9793),   // reprise vers camion (AQ250 − AQ74)
    servicesUsdPerM: { consumables: cadToUsd(282.3078), equipment: cadToUsd(82.464), energy: cadToUsd(10.4096), labour: cadToUsd(180.4628) },
    shotcrete: { allocation: 0.05, consumables: cadToUsd(376.7763), equipment: cadToUsd(217.8707), energy: cadToUsd(16.9197), labour: cadToUsd(676.1717) },
    // Main-d'œuvre du développement capital en production : « Sustaining
    // Capitalized Labour Cost » 23,09 M C$ / 20 794 m capitaux hors période initiale.
    labourBasis: 'unit',
    directLabourUsdPerM: cadToUsd(23_089_510 / (36_066.2 - 15_272.5)),
  };
}

/** Galerie d'exploitation 4,5 × 4,5 m (OpexDev4.5x4.5). */
export function ugOperatingHeadingReference(rockSgTpm3: number): HeadingDesign {
  return {
    ...baseHeading(),
    widthM: 4.5, heightM: 4.5, overbreakFraction: 0, advancePerRoundM: 3.3,
    holesPerRound: 51, reamersPerRound: 2, drilledLengthM: 3.5,
    boltsPerRound: 45,
    boltUsd: cadToUsd((14 * 69.8237 + 25 * 69.8237 + 6 * 15.1845) / 45),
    meshSheetsPerRound: 17,
    meshSheetUsd: cadToUsd((16 * 63.5922 + 1 * 38.6868) / 17),
    rockSgTpm3,
    lhdTph: 139.8994,
    remuckTph: 196.4655 / (3.0077 - (196.4655 / 139.8994 + 0.5)),
    servicesUsdPerM: { consumables: cadToUsd(272.7592), equipment: cadToUsd(97.4575), energy: cadToUsd(12.3023), labour: cadToUsd(213.2742) },
    shotcrete: { allocation: 0, consumables: cadToUsd(308.2715), equipment: cadToUsd(249.4236), energy: cadToUsd(19.37), labour: cadToUsd(778.1701) },
    // Main-d'œuvre du développement d'exploitation : Opex Summary ligne 27
    // (41,56 M C$) / 53 837 m.
    labourBasis: 'unit',
    directLabourUsdPerM: cadToUsd(41_563_124 / 53_836.6),
  };
}

/**
 * Méthodes d'abattage (Mine Dev-Stoping Cost lignes 253–277, « by function »,
 * base de l'OPEX publié — Opex Summary ligne 21), C$/t convertis. La
 * main-d'œuvre directe d'abattage est celle de l'Opex Summary (ligne 28 :
 * 48,08 M C$ / 10,31 Mt abattues). Parts = tonnages LOM de chaque méthode
 * (lignes 66–69).
 */
export function ugStopeReference(): StopeMethod[] {
  const t = cadToUsd;
  const total = 5_602_569 + 3_251_803 + 832_075 + 628_459;
  const labour = t(48_077_644 / 10_314_906);
  return [
    { id: 'slr_lt5', label: 'Chambres longitudinales (< 5 m)', share: 5_602_569 / total, suppliesUsdT: t(28.9938), equipmentUsdT: t(12.7554), energyUsdT: t(2.2841), labourUsdT: labour },
    { id: 'slr_ge5', label: 'Chambres longitudinales (≥ 5 m)', share: 3_251_803 / total, suppliesUsdT: t(20.6574), equipmentUsdT: t(9.3041), energyUsdT: t(1.744), labourUsdT: labour },
    { id: 'tos_p', label: 'Chambres transversales primaires', share: 832_075 / total, suppliesUsdT: t(23.5213), equipmentUsdT: t(9.1224), energyUsdT: t(1.6048), labourUsdT: labour },
    { id: 'tos_s', label: 'Chambres transversales secondaires', share: 628_459 / total, suppliesUsdT: t(5.1645), equipmentUsdT: t(9.9668), energyUsdT: t(1.2994), labourUsdT: labour },
  ];
}

/**
 * Manutention (Opex/Capex Summary + TKM) :
 *   camion 81,20 M C$ (79,46 exploitation + 1,74 capitalisé) / 27,78 M t·km de
 *   minerai ; main-d'œuvre de manutention 27,63 M C$ sur les mêmes t·km ;
 *   extraction 0,92 C$/t ; roulage de surface 2,30 C$/t ; distance moyenne
 *   minerai 27,78 M t·km / 12,53 Mt, stérile 6,35 M t·km / 4,11 Mt ;
 *   stérile remonté 2,99 / 4,11 Mt.
 */
export const UG_HANDLING_REFERENCE = {
  oreHaulKm: 27_775_065 / 12_530_068,
  wasteHaulKm: 6_354_705 / 4_112_798,
  truckUsdPerTkm: cadToUsd((79_463_651 + 1_740_610) / 27_775_065),
  truckLabourUsdPerTkm: cadToUsd(27_629_938 / 27_775_065),
  wasteHoistedFraction: 2_988_235 / 4_112_798,
  oreHoistedFraction: 1,
  hoistingUsdPerT: cadToUsd((11_171_650 + 406_133) / 12_530_068),
  surfaceHaulUsdPerT: cadToUsd((27_808_219 + 1_010_936) / 12_530_068),
  mineServicesUsdPerOreT: cadToUsd(11.85),
  // Services capitalisés de la période initiale : 14,70 M C$ sur 10 trimestres.
  preProductionServicesUsdPerYear: cadToUsd(14_701_174 / 2.5),
  definitionDrillingUsdPerOreT: cadToUsd(0.79),
} as const;

/**
 * Taux (Eastwood Labour_Input) : horaire 48,01 C$/h × 2080 h, prime en C$/h
 * ramenée en % de la base, charges 38 % (horaires) / 35 % (cadres), EPI 200 C$ +
 * voyages 4 200 C$ × 365/28 rotations → 54 950 C$/an de coûts site.
 */
const UG_SITE_COSTS_CAD = 200 + 4_200 * (365 / 28);
function ugHourly(id: string, label: string, rate: number, bonusPerH: number): LabourRate {
  return { id, label, payBasis: 'hourly', hourlyRate: cadToUsd(rate), annualSalary: 0, bonusPct: (bonusPerH / rate) * 100, burdenPct: 38, siteCostsUsdYr: cadToUsd(UG_SITE_COSTS_CAD) };
}
function ugSalary(id: string, label: string, salary: number, bonusPct: number): LabourRate {
  return { id, label, payBasis: 'salary', hourlyRate: 0, annualSalary: cadToUsd(salary), bonusPct, burdenPct: 35, siteCostsUsdYr: cadToUsd(UG_SITE_COSTS_CAD) };
}

export const UG_LABOUR_RATES: LabourRate[] = [
  ugHourly('ug_dev_miner', 'Mineur de développement (jumbo, boulonneuse)', 48.01, 26),
  ugHourly('ug_blaster', 'Boutefeu', 48.01, 17.5),
  ugHourly('ug_lhd', 'Opérateur chargeuse-navette / camion', 48.01, 10.5),
  ugHourly('ug_services', 'Mineur de services (réhabilitation, brise-roche, routes, pompage)', 48.01, 10.5),
  ugHourly('ug_mechanic', 'Mécanicien / électricien mobile', 48.28, 10.5),
  ugHourly('ug_instrument', 'Instrumentiste', 48.74, 10.5),
  ugSalary('ug_superintendent', 'Surintendant mine', 185_000, 25),
  ugSalary('ug_captain', 'Capitaine de mine', 160_000, 20),
  ugSalary('ug_senior_sup', 'Superviseur senior', 145_000, 20),
  ugSalary('ug_shiftboss', 'Chef de quart', 125_000, 15),
  ugSalary('ug_safety', 'Agent santé-sécurité / formateur', 125_000, 15),
  ugSalary('ug_maint_super', 'Surintendant maintenance', 190_000, 25),
  ugSalary('ug_maint_sup', 'Superviseur maintenance / électrique', 124_000, 15),
  ugSalary('ug_maint_planner', 'Planificateur maintenance', 98_000, 15),
  ugSalary('ug_senior_eng', 'Ingénieur senior (planification, géotechnique)', 131_000, 20),
  ugSalary('ug_engineer', 'Ingénieur de production / ventilation / planification', 112_000, 15),
  ugSalary('ug_chief_geol', 'Géologue en chef', 166_000, 25),
  ugSalary('ug_geologist', 'Géologue / géotechnicien', 108_000, 15),
  ugSalary('ug_surveyor', 'Arpenteur', 84_000, 10),
  ugSalary('ug_technician', 'Technicien (mine, géologie, commis)', 78_000, 10),
];

export const UG_ROLE_RATES = {
  driller: 'ug_dev_miner',
  blaster: 'ug_blaster',
  bolter: 'ug_dev_miner',
  mucker: 'ug_lhd',
  mechanic: 'ug_mechanic',
} as const;

/**
 * Personnel indirect — effectif complet de la colonne C de « Labour Count »
 * (lignes 370–416). La main-d'œuvre directe (développement, abattage,
 * maintenance des engins) est déjà dans les coûts unitaires « labour included ».
 */
export const UG_STAFF: StaffLine[] = [
  { id: 'u1', rateId: 'ug_superintendent', count: 1, department: 'Encadrement' },
  { id: 'u2', rateId: 'ug_captain', count: 2, department: 'Encadrement' },
  { id: 'u3', rateId: 'ug_senior_sup', count: 4, department: 'Encadrement' },
  { id: 'u4', rateId: 'ug_shiftboss', count: 8, department: 'Encadrement' },
  { id: 'u5', rateId: 'ug_technician', count: 5, department: 'Encadrement' },         // commis 1 + opérations à distance 4
  { id: 'u6', rateId: 'ug_safety', count: 2, department: 'Santé-sécurité & formation' },
  { id: 'u7', rateId: 'ug_services', count: 17, department: 'Services généraux' },      // lignes 380–388
  { id: 'u8', rateId: 'ug_maint_super', count: 1, department: 'Maintenance' },
  { id: 'u9', rateId: 'ug_maint_sup', count: 2, department: 'Maintenance' },
  { id: 'u10', rateId: 'ug_maint_planner', count: 2, department: 'Maintenance' },
  { id: 'u11', rateId: 'ug_mechanic', count: 6, department: 'Maintenance' },          // électriciens 2, soudeur, mécaniciens 3
  { id: 'u12', rateId: 'ug_instrument', count: 1, department: 'Maintenance' },
  { id: 'u13', rateId: 'ug_technician', count: 1, department: 'Maintenance' },        // commis
  { id: 'u14', rateId: 'ug_senior_eng', count: 2, department: 'Services techniques' },
  { id: 'u15', rateId: 'ug_engineer', count: 3, department: 'Services techniques' },
  { id: 'u16', rateId: 'ug_technician', count: 2, department: 'Services techniques' },
  { id: 'u17', rateId: 'ug_chief_geol', count: 1, department: 'Services techniques' },
  { id: 'u18', rateId: 'ug_geologist', count: 4, department: 'Services techniques' },
  { id: 'u19', rateId: 'ug_surveyor', count: 2, department: 'Services techniques' },
];

/**
 * Flotte mobile (Eastwood Equipment List : prix C$, durée de vie et usage
 * annuel). Les engins de développement et de production sont DIMENSIONNÉS par
 * le moteur ; la productivité des chargeuses de production, des foreuses
 * long-trou et des camions est celle implicite du plan Eastwood (flotte ×
 * usage annuel vs tonnages et t·km annuels moyens).
 */
export function ugFleetReference(): UgFleetItem[] {
  const t = cadToUsd;
  // Cadence de régime Eastwood : abattage = minerai × (1 − part du développement) ;
  // t·km de minerai = minerai × distance moyenne de roulage.
  const stopeTPerYear = UG_REFERENCE_ANNUAL_ORE_T * (1 - UG_INTENSITY_REFERENCE.devOreFraction);
  const oreTkmPerYear = UG_REFERENCE_ANNUAL_ORE_T * UG_HANDLING_REFERENCE.oreHaulKm;
  return [
    { id: 'jumbo', label: 'Jumbo 2 bras', deliveredPriceUsd: t(3_118_000), lifeHours: 10_500, annualUsageHours: 1_500, driver: 'jumbo_hours', fixedQty: 0, productivityPerHour: 0 },
    { id: 'bolter', label: 'Boulonneuse mécanisée', deliveredPriceUsd: t(2_132_000), lifeHours: 19_000, annualUsageHours: 2_500, driver: 'bolter_hours', fixedQty: 0, productivityPerHour: 0 },
    { id: 'dev_lhd', label: 'Chargeuse-navette de développement 15 t', deliveredPriceUsd: t(1_896_000), lifeHours: 27_000, annualUsageHours: 2_200, driver: 'dev_lhd_hours', fixedQty: 0, productivityPerHour: 0 },
    { id: 'dev_charger', label: "Chargeur d'explosifs (développement)", deliveredPriceUsd: t(1_312_000), lifeHours: 25_000, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 2, productivityPerHour: 0 },
    { id: 'prod_lhd', label: 'Chargeuse-navette de production 15 t', deliveredPriceUsd: t(1_896_000), lifeHours: 27_000, annualUsageHours: 3_500, driver: 'stope_tonnes', fixedQty: 0, productivityPerHour: stopeTPerYear / (3 * 3_500) },
    { id: 'truck_45t', label: 'Camion souterrain 45 t', deliveredPriceUsd: t(2_021_000), lifeHours: 30_000, annualUsageHours: 3_500, driver: 'ore_tkm', fixedQty: 0, productivityPerHour: oreTkmPerYear / (8 * 3_500) },
    { id: 'lh_drill', label: 'Foreuse long-trou', deliveredPriceUsd: t(2_788_000), lifeHours: 10_000, annualUsageHours: 1_500, driver: 'stope_tonnes', fixedQty: 0, productivityPerHour: stopeTPerYear / (5 * 1_500) },
    { id: 'emulsion_loader', label: "Chargeur d'émulsion (production)", deliveredPriceUsd: t(1_049_000), lifeHours: 25_000, annualUsageHours: 2_000, driver: 'fixed', fixedQty: 3, productivityPerHour: 0 },
    { id: 'scissor_lift', label: 'Nacelle à ciseaux', deliveredPriceUsd: t(1_184_000), lifeHours: 25_000, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 4, productivityPerHour: 0 },
    { id: 'boom_truck', label: 'Camion-grue', deliveredPriceUsd: t(1_096_000), lifeHours: 25_000, annualUsageHours: 2_000, driver: 'fixed', fixedQty: 2, productivityPerHour: 0 },
    { id: 'fuel_lube', label: 'Camion carburant-lubrifiants', deliveredPriceUsd: t(1_097_000), lifeHours: 25_000, annualUsageHours: 2_000, driver: 'fixed', fixedQty: 1, productivityPerHour: 0 },
    { id: 'ug_grader', label: 'Niveleuse souterraine', deliveredPriceUsd: t(1_420_000), lifeHours: 25_000, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 1, productivityPerHour: 0 },
    { id: 'shotcrete', label: 'Projeteuse de béton', deliveredPriceUsd: t(1_444_000), lifeHours: 25_000, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 2, productivityPerHour: 0 },
    { id: 'transmixer', label: 'Camion malaxeur', deliveredPriceUsd: t(1_325_000), lifeHours: 25_000, annualUsageHours: 1_800, driver: 'fixed', fixedQty: 4, productivityPerHour: 0 },
    { id: 'rock_breaker', label: 'Brise-roche mobile', deliveredPriceUsd: t(1_873_000 + 321_000), lifeHours: 25_000, annualUsageHours: 1_800, driver: 'fixed', fixedQty: 1, productivityPerHour: 0 },
    { id: 'forklift', label: 'Chariot élévateur souterrain', deliveredPriceUsd: t(242_000), lifeHours: 5 * 1_500, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 1, productivityPerHour: 0 },
    { id: 'tire_handler', label: 'Manipulateur de pneus', deliveredPriceUsd: t(290_000), lifeHours: 5 * 1_500, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 1, productivityPerHour: 0 },
    { id: 'utility_vehicle', label: 'Véhicule utilitaire 4×4', deliveredPriceUsd: t(166_000), lifeHours: 3 * 1_500, annualUsageHours: 1_500, driver: 'fixed', fixedQty: 12, productivityPerHour: 0 },
  ];
}

/**
 * Infrastructures fixes génériques d'une mine souterraine (Eastwood
 * Infra-Mobile Cost lignes 45–97). Les postes propres au site Eastwood
 * (mise à niveau de l'usine, bâtiments de surface, cheminées à minerai
 * existantes, refroidissement de mine profonde) sont exclus ou mis à 0.
 */
export function ugInfrastructureReference(): InfrastructureItem[] {
  const t = cadToUsd;
  return [
    { id: 'paste_plant', label: 'Usine de remblai en pâte (réfection / mise à niveau)', category: 'Remblai', qty: 1, unitCostUsd: t(10_597_000), timing: 'initial' },
    { id: 'uds_initial', label: 'Réseau de distribution du remblai (initial)', category: 'Remblai', qty: 1, unitCostUsd: t(5_990_000), timing: 'initial' },
    { id: 'uds_sustaining', label: 'Réseau de distribution du remblai (maintien)', category: 'Remblai', qty: 1, unitCostUsd: t(14_056_400), timing: 'sustaining' },
    { id: 'main_fan', label: 'Ventilateur principal', category: 'Ventilation', qty: 1, unitCostUsd: t(4_150_923), timing: 'initial' },
    { id: 'vent_other', label: 'Autres ventilateurs et infrastructures de ventilation', category: 'Ventilation', qty: 1, unitCostUsd: t(16_300_820), timing: 'sustaining' },
    { id: 'cooling', label: 'Refroidissement de surface (mine profonde)', category: 'Ventilation', qty: 0, unitCostUsd: t(28_050_000), timing: 'initial' },
    { id: 'egress_raise', label: 'Seconde issue : cheminée alésée + échelles (par m)', category: 'Refuges & issues', qty: 1_195, unitCostUsd: t(2_356 + 3_703.24), timing: 'initial' },
    { id: 'refuge_large', label: 'Refuge avec salle de repas et latrines', category: 'Refuges & issues', qty: 6, unitCostUsd: t(177_000), timing: 'sustaining' },
    { id: 'refuge_small', label: 'Refuge avec latrines', category: 'Refuges & issues', qty: 10, unitCostUsd: t(121_000), timing: 'sustaining' },
    { id: 'level_sump', label: 'Puisard de niveau', category: 'Exhaure', qty: 43, unitCostUsd: t(6_000), timing: 'sustaining' },
    { id: 'pump_station', label: 'Station de pompage de zone', category: 'Exhaure', qty: 2, unitCostUsd: t(1_090_000), timing: 'sustaining' },
    { id: 'switchroom', label: 'Poste électrique souterrain', category: 'Électricité', qty: 4, unitCostUsd: t(318_120), timing: 'initial' },
    { id: 'substation', label: 'Sous-station (construction)', category: 'Électricité', qty: 82, unitCostUsd: t(8_000), timing: 'sustaining' },
    { id: 'level_electrical', label: 'Distribution électrique de niveau', category: 'Électricité', qty: 17, unitCostUsd: t(289_077.05), timing: 'sustaining' },
    { id: 'automation', label: 'Automatisation & communications (par niveau)', category: 'Électricité', qty: 17, unitCostUsd: t(190_275.20), timing: 'sustaining' },
    { id: 'charging', label: 'Bornes de recharge des engins électriques', category: 'Électricité', qty: 20, unitCostUsd: t(7_600), timing: 'initial' },
    { id: 'fuel_transfer', label: 'Station de transfert carburant-lubrifiants', category: 'Carburant', qty: 1, unitCostUsd: t(500_000), timing: 'initial' },
    { id: 'fuel_bay', label: 'Baie de ravitaillement principale', category: 'Carburant', qty: 1, unitCostUsd: t(800_000), timing: 'initial' },
    { id: 'fuel_bay_mobile', label: 'Baie de ravitaillement mobile', category: 'Carburant', qty: 3, unitCostUsd: t(280_000), timing: 'sustaining' },
    { id: 'magazine', label: "Poudrière / dépôt d'amorces souterrain", category: 'Explosifs', qty: 3, unitCostUsd: t(188_000), timing: 'initial' },
    { id: 'main_storage', label: 'Magasin principal', category: 'Magasins', qty: 1, unitCostUsd: t(168_000), timing: 'initial' },
    { id: 'level_storage', label: 'Magasins des nouvelles zones', category: 'Magasins', qty: 7, unitCostUsd: t(63_000), timing: 'sustaining' },
    { id: 'ug_shop', label: 'Atelier souterrain, entrepôt et bureau', category: 'Maintenance', qty: 1, unitCostUsd: t(2_010_000), timing: 'initial' },
    { id: 'wash_tire_weld', label: 'Baie de lavage, baie à pneus, atelier de soudure', category: 'Maintenance', qty: 1, unitCostUsd: t(60_000 + 62_000 + 121_000), timing: 'initial' },
    { id: 'special_tools', label: 'Outillage et équipements spécialisés', category: 'Maintenance', qty: 1, unitCostUsd: t(500_000), timing: 'initial' },
    { id: 'def_drill_station', label: 'Station de forage de définition', category: 'Divers', qty: 21, unitCostUsd: t(88_000), timing: 'sustaining' },
    { id: 'microseismic', label: 'Système microsismique', category: 'Divers', qty: 1, unitCostUsd: t(1_500_000), timing: 'initial' },
    { id: 'detail_engineering', label: 'Ingénierie de détail (brise-roche, cheminées…)', category: 'Divers', qty: 2, unitCostUsd: t(421_000), timing: 'initial' },
  ];
}
