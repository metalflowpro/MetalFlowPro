// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — moteur SOUTERRAIN.
//
// Reprend la structure du modèle de référence Eastwood (PFS intégré) :
//   CapexDev5.0x5.0 / OpexDev4.5x4.5 → coût d'une galerie par activité
//       (foration, sautage, soutènement, marinage, béton projeté, services,
//        allocation 25 %) : consommables, engins, énergie, main-d'œuvre — $/m
//   SLR / TOS        → coût d'abattage par méthode et par fonction — $/t
//   TKM / Hoisting   → manutention : t·km camion, extraction au puits, roulage
//   Labour Count     → personnel indirect (encadrement, technique, services)
//   Equipment List   → flotte mobile (achat + remplacement en fin de vie)
//   Infra-Mobile Cost→ infrastructures fixes
//   Capex Summary    → capitalisation de TOUTE la dépense de pré-production,
//                      développement capital (code CAPEX), contingence.
//
// Les tonnages et les mètres viennent du calendrier de production du projet
// (débit usine) multiplié par des intensités documentées et modifiables
// (m de développement par kt, répartition des méthodes, remblai…).
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import {
  labourCostPerHour,
  labourCostPerYear,
  makeCapexItem,
  makeOpexItem,
  preProductionOnly,
  sumSeries,
  unitsRequired,
} from './costFormulas';
import type { CapexItem, LabourRate, MineCostResult, OpexItem, PeriodLabel, StaffLine } from './types';

export interface UndergroundPeriod {
  year: number;
  preProduction: boolean;
  /** Minerai envoyé à l'usine (t). */
  oreTonnes: number;
}

/** Paramètres d'une galerie type (un « round » = une volée). */
export interface HeadingDesign {
  widthM: number;
  heightM: number;
  /** Hors-profil (fraction), appliqué en largeur ET en hauteur. */
  overbreakFraction: number;
  advancePerRoundM: number;

  // Foration (jumbo)
  holesPerRound: number;
  reamersPerRound: number;
  drilledLengthM: number;
  redrillFraction: number;
  /** Vitesse de foration (m/h) d'un bras, trous de tir. */
  drillRateMph: number;
  /** Vitesse d'alésage (m/h). */
  reamRateMph: number;
  /** Gain de productivité des bras supplémentaires (fraction). */
  multiBoomGain: number;
  /** Positionnement par trou (s). */
  positioningSecPerHole: number;
  /** Mise en place + repli (h par volée). */
  drillSetupH: number;
  /** Aciers de foration (tiges, emmanchements, manchons, taillants) USD par m foré. */
  drillSteelUsdPerDrillM: number;

  // Sautage
  /** Densité de chargement de l'explosif (kg/m³). */
  explosiveDensityKgM3: number;
  holeDiameterMm: number;
  /** Collet non chargé (m). */
  unchargedCollarM: number;
  explosiveUsdKg: number;
  /** Amorçage par trou (amorce + détonateur), USD. */
  initiationUsdPerHole: number;
  /** Accessoires par volée (cordeau, ligne de tir, détonateurs électriques), USD. */
  accessoriesUsdPerRound: number;
  /** Gaspillage d'explosifs (fraction). */
  explosiveWastageFraction: number;
  loadMinPerHole: number;
  /** Temps fixes de sautage (installation, déplacements, raccordement, services) — min. */
  blastFixedMin: number;

  // Soutènement
  boltsPerRound: number;
  boltUsd: number;
  meshSheetsPerRound: number;
  meshSheetUsd: number;
  boltMinPerBolt: number;
  meshMinPerSheet: number;
  /** Mise en place + repli (h par volée). */
  groundSupportSetupH: number;

  // Marinage
  /** Densité de la roche en place (t/m³). */
  rockSgTpm3: number;
  lhdTph: number;
  /** Reprise vers camion (t/h) ; 0 = pas de reprise. */
  remuckTph: number;
  muckFixedMin: number;

  // Coûts horaires des engins (pièces/composants/pneus) et énergie
  jumboUsdH: number;
  jumboEnergyUsdH: number;
  chargerUsdH: number;
  chargerEnergyUsdH: number;
  bolterUsdH: number;
  bolterEnergyUsdH: number;
  lhdUsdH: number;
  lhdEnergyUsdH: number;

  // Heures de maintenance par heure de marche
  jumboMaintHPerOpH: number;
  chargerMaintHPerOpH: number;
  bolterMaintHPerOpH: number;
  lhdMaintHPerOpH: number;

  // Opérateurs par activité
  drillers: number;
  blasters: number;
  bolters: number;
  muckers: number;

  // Activités exprimées directement en $/m
  servicesUsdPerM: { consumables: number; equipment: number; energy: number; labour: number };
  shotcrete: { allocation: number; consumables: number; equipment: number; energy: number; labour: number };

  /** Allocation (%) sur consommables + engins + énergie (Eastwood : 25 %). */
  allowancePct: number;

  /**
   * Base de la main-d'œuvre directe de la galerie :
   *   'unit'     — coût unitaire `directLabourUsdPerM` (base de l'OPEX publié
   *                Eastwood : main-d'œuvre par effectif, Opex Summary ligne 27) ;
   *   'activity' — calcul par activité, opérateurs payés au poste (vue
   *                « Full Cost Summary » de CapexDev, plus conservatrice).
   */
  labourBasis: 'unit' | 'activity';
  directLabourUsdPerM: number;
}

export interface StopeMethod {
  id: string;
  label: string;
  /** Part du minerai d'abattage (fraction ; normalisée). */
  share: number;
  /** Coûts par tonne abattue, par fonction (USD/t) — base de l'OPEX publié Eastwood. */
  suppliesUsdT: number;
  equipmentUsdT: number;
  energyUsdT: number;
  /** Main-d'œuvre directe d'abattage (USD/t). */
  labourUsdT: number;
}

export type FleetDriver =
  | 'fixed'
  | 'jumbo_hours'
  | 'bolter_hours'
  | 'charger_hours'
  | 'dev_lhd_hours'
  | 'stope_tonnes'
  | 'ore_tkm';

export interface UgFleetItem {
  id: string;
  label: string;
  deliveredPriceUsd: number;
  lifeHours: number;
  annualUsageHours: number;
  driver: FleetDriver;
  /** Quantité si driver = 'fixed'. */
  fixedQty: number;
  /** Productivité par heure de marche pour les drivers 'stope_tonnes' (t/h) et 'ore_tkm' (t·km/h). */
  productivityPerHour: number;
}

export interface InfrastructureItem {
  id: string;
  label: string;
  category: string;
  qty: number;
  unitCostUsd: number;
  timing: 'initial' | 'sustaining';
}

export interface UndergroundInputs {
  periods: UndergroundPeriod[];

  // ── Calendrier (Eastwood Time Utilization Input) ──
  shiftsPerDay: number;
  hoursPerShift: number;
  nonOperatingHPerShift: number;
  equipmentAvailability: number;
  operatingDaysPerYear: number;
  /** Heures payées par ETP et par an. */
  paidHoursPerYear: number;

  // ── Intensités physiques (par kt de minerai) ──
  /** Part du minerai issue du développement (fraction). */
  devOreFraction: number;
  /** Développement latéral d'exploitation (m par kt de minerai). */
  opLateralMPerKt: number;
  /** Développement latéral capital pendant la production (m par kt de minerai). */
  capLateralMPerKtProduction: number;
  /** Développement latéral capital de pré-production (m, total). */
  preProductionCapLateralM: number;
  /** Développement vertical pendant la production (m par kt). */
  verticalMPerKtProduction: number;
  /** Développement vertical de pré-production (m, total). */
  preProductionVerticalM: number;
  /** Coût moyen du développement vertical (USD/m) — montées alésées / cheminées. */
  verticalUsdPerM: number;
  /** Remblai (t par t abattue). */
  backfillTPerStopeT: number;

  // ── Galeries ──
  capitalHeading: HeadingDesign;
  operatingHeading: HeadingDesign;

  // ── Abattage ──
  stopes: StopeMethod[];

  // ── Manutention ──
  oreHaulKm: number;
  wasteHaulKm: number;
  truckUsdPerTkm: number;
  truckLabourUsdPerTkm: number;
  /** Fraction du stérile remontée au jour (le reste reste au fond comme remblai). */
  wasteHoistedFraction: number;
  /** Part du minerai extraite par puits (0 = rampe uniquement). */
  oreHoistedFraction: number;
  hoistingUsdPerT: number;
  surfaceHaulUsdPerT: number;

  // ── Services & divers ──
  mineServicesUsdPerOreT: number;
  /** Services miniers annuels pendant la pré-production (USD/an). */
  preProductionServicesUsdPerYear: number;
  definitionDrillingUsdPerOreT: number;

  // ── Main-d'œuvre ──
  rates: LabourRate[];
  roleRates: { driller: string; blaster: string; bolter: string; mucker: string; mechanic: string };
  staff: StaffLine[];

  // ── Capital ──
  fleet: UgFleetItem[];
  infrastructure: InfrastructureItem[];
  contingencyPct: number;
}

export interface HeadingCostBreakdown {
  /** Durées par volée (h). */
  hours: { drilling: number; blasting: number; groundSupport: number; mucking: number };
  perRound: { consumables: number; equipment: number; energy: number; labour: number; allowance: number };
  perMetre: { consumables: number; equipment: number; energy: number; labour: number; allowance: number; total: number;
    /** Main-d'œuvre calculée par activité (affichée en contrôle quel que soit `labourBasis`). */
    labourActivity: number };
  muckTonnesPerRound: number;
  explosiveKgPerRound: number;
}

/**
 * Coût d'une galerie par volée puis par mètre (Eastwood CapexDev, lignes
 * 39–101 et blocs « LABOUR REQUIREMENTS » / « CONSUMABLES » / « MOBILE
 * EQUIPMENT » de chaque activité).
 *
 * Main-d'œuvre d'une activité : les opérateurs sont payés au poste. Une
 * activité qui tient dans une demi-plage de travail effectif est facturée une
 * demi-poste, sinon le nombre de postes entiers nécessaires (règle Eastwood
 * M181/P181/S181). S'y ajoute la maintenance (h de maintenance/h de marche ×
 * taux mécanicien × durée de marche).
 */
export function headingCost(
  h: HeadingDesign,
  cal: { hoursPerShift: number; availableEquipHPerShift: number },
  rates: { driller: number; blaster: number; bolter: number; mucker: number; mechanic: number },
): HeadingCostBreakdown {
  const adv = h.advancePerRoundM;
  const blastHoles = h.holesPerRound;
  const drillM = blastHoles * h.drilledLengthM * (1 + h.redrillFraction) + h.reamersPerRound * h.drilledLengthM;
  const boomFactor = 1 + h.multiBoomGain;
  const drillH = (h.drillRateMph > 0 ? (blastHoles * h.drilledLengthM * (1 + h.redrillFraction)) / (h.drillRateMph * boomFactor) : 0)
    + (h.reamRateMph > 0 ? (h.reamersPerRound * h.drilledLengthM) / (h.reamRateMph * boomFactor) : 0)
    + ((blastHoles + h.reamersPerRound) * h.positioningSecPerHole) / 3600
    + h.drillSetupH;

  const D = h.holeDiameterMm / 1000;
  const kgPerM = h.explosiveDensityKgM3 * Math.PI * D * D / 4;
  const explosiveKg = Math.max(0, h.drilledLengthM - h.unchargedCollarM) * blastHoles * kgPerM;
  const wastage = 1 + h.explosiveWastageFraction;
  const blastConsumables = explosiveKg * wastage * h.explosiveUsdKg
    + blastHoles * wastage * h.initiationUsdPerHole
    + h.accessoriesUsdPerRound;
  const blastH = (blastHoles * h.loadMinPerHole + h.blastFixedMin) / 60;

  const gsConsumables = h.boltsPerRound * h.boltUsd + h.meshSheetsPerRound * h.meshSheetUsd;
  const gsH = (h.boltsPerRound * h.boltMinPerBolt + h.meshSheetsPerRound * h.meshMinPerSheet) / 60 + h.groundSupportSetupH;

  const muckT = h.widthM * (1 + h.overbreakFraction) * h.heightM * (1 + h.overbreakFraction) * adv * h.rockSgTpm3;
  const muckH = (h.lhdTph > 0 ? muckT / h.lhdTph : 0) + h.muckFixedMin / 60 + (h.remuckTph > 0 ? muckT / h.remuckTph : 0);

  const avail = cal.availableEquipHPerShift;
  const shiftsFor = (activityH: number) => (activityH <= 0 ? 0 : activityH < avail / 2 ? 0.5 : Math.ceil(activityH / avail - 1e-9));
  const crewCost = (operators: number, rateH: number, activityH: number) => operators * rateH * cal.hoursPerShift * shiftsFor(activityH);
  const maintCost = (maintHPerOpH: number, opH: number) => maintHPerOpH * rates.mechanic * opH;

  const labour =
    crewCost(h.drillers, rates.driller, drillH) + maintCost(h.jumboMaintHPerOpH, drillH)
    + crewCost(h.blasters, rates.blaster, blastH) + maintCost(h.chargerMaintHPerOpH, blastH)
    + crewCost(h.bolters, rates.bolter, gsH) + maintCost(h.bolterMaintHPerOpH, gsH)
    + crewCost(h.muckers, rates.mucker, muckH) + maintCost(h.lhdMaintHPerOpH, muckH)
    + (h.servicesUsdPerM.labour + h.shotcrete.allocation * h.shotcrete.labour) * adv;

  const consumables = drillM * h.drillSteelUsdPerDrillM + blastConsumables + gsConsumables
    + (h.servicesUsdPerM.consumables + h.shotcrete.allocation * h.shotcrete.consumables) * adv;
  const equipment = drillH * h.jumboUsdH + blastH * h.chargerUsdH + gsH * h.bolterUsdH + muckH * h.lhdUsdH
    + (h.servicesUsdPerM.equipment + h.shotcrete.allocation * h.shotcrete.equipment) * adv;
  const energy = drillH * h.jumboEnergyUsdH + blastH * h.chargerEnergyUsdH + gsH * h.bolterEnergyUsdH + muckH * h.lhdEnergyUsdH
    + (h.servicesUsdPerM.energy + h.shotcrete.allocation * h.shotcrete.energy) * adv;
  const allowance = (consumables + equipment + energy) * h.allowancePct / 100;

  const perM = (v: number) => (adv > 0 ? v / adv : 0);
  const labourPerM = h.labourBasis === 'unit' ? h.directLabourUsdPerM : perM(labour);
  return {
    hours: { drilling: drillH, blasting: blastH, groundSupport: gsH, mucking: muckH },
    perRound: { consumables, equipment, energy, labour: labourPerM * adv, allowance },
    perMetre: {
      consumables: perM(consumables),
      equipment: perM(equipment),
      energy: perM(energy),
      labour: labourPerM,
      allowance: perM(allowance),
      total: perM(consumables + equipment + energy + allowance) + labourPerM,
      labourActivity: perM(labour),
    },
    muckTonnesPerRound: muckT,
    explosiveKgPerRound: explosiveKg,
  };
}

/** Coût d'abattage par tonne d'une méthode (fonctions + main-d'œuvre directe). */
export function stopeUnitCost(s: StopeMethod): number {
  return s.suppliesUsdT + s.equipmentUsdT + s.energyUsdT + s.labourUsdT;
}

export interface UgFleetRow {
  id: string;
  label: string;
  units: number[];
  purchases: number[];
  hours: number[];
}

export interface UndergroundResult extends MineCostResult {
  method: 'underground';
  capitalHeadingCost: HeadingCostBreakdown;
  operatingHeadingCost: HeadingCostBreakdown;
  physicals: {
    stopeOreT: number[];
    devOreT: number[];
    capLateralM: number[];
    opLateralM: number[];
    verticalM: number[];
    devWasteT: number[];
    backfillT: number[];
    oreTkm: number[];
    wasteTkm: number[];
    hoistedT: number[];
  };
  stopeUnitCostUsdT: number;
  fleet: UgFleetRow[];
  headcount: { label: string; byPeriod: number[] }[];
}

export function computeUndergroundCost(inp: UndergroundInputs): UndergroundResult {
  const warnings: string[] = [];
  const periods: PeriodLabel[] = inp.periods.map((p, index) => ({ index, year: p.year, preProduction: p.preProduction }));
  const n = periods.length;
  const ore = inp.periods.map(p => Math.max(0, p.oreTonnes));
  const preCount = periods.filter(p => p.preProduction).length;
  const prodActive = periods.map((p, i) => !p.preProduction && ore[i] > 0);
  const anyActive = periods.map((p, i) => p.preProduction || ore[i] > 0);

  // ── Calendrier ────────────────────────────────────────────────────────────
  const operatingH = Math.max(0, inp.hoursPerShift - inp.nonOperatingHPerShift);
  const availableEquipHPerShift = inp.hoursPerShift * (inp.hoursPerShift > 0 ? operatingH / inp.hoursPerShift : 0) * inp.equipmentAvailability;
  const rateOf = (id: string) => inp.rates.find(r => r.id === id);
  const hourly = (id: string) => { const r = rateOf(id); return r ? labourCostPerHour(r, inp.paidHoursPerYear) : 0; };
  const roleH = {
    driller: hourly(inp.roleRates.driller),
    blaster: hourly(inp.roleRates.blaster),
    bolter: hourly(inp.roleRates.bolter),
    mucker: hourly(inp.roleRates.mucker),
    mechanic: hourly(inp.roleRates.mechanic),
  };
  const cal = { hoursPerShift: inp.hoursPerShift, availableEquipHPerShift };
  const capH = headingCost(inp.capitalHeading, cal, roleH);
  const opH = headingCost(inp.operatingHeading, cal, roleH);

  // ── Physique ──────────────────────────────────────────────────────────────
  const kt = ore.map(o => o / 1000);
  const devOreT = ore.map(o => o * inp.devOreFraction);
  const stopeOreT = ore.map((o, i) => o - devOreT[i]);
  const opLateralM = kt.map((k, i) => (prodActive[i] ? k * inp.opLateralMPerKt : 0));
  const capLateralM = periods.map((p, i) => (p.preProduction
    ? (preCount > 0 ? inp.preProductionCapLateralM / preCount : 0)
    : (prodActive[i] ? kt[i] * inp.capLateralMPerKtProduction : 0)));
  const verticalM = periods.map((p, i) => (p.preProduction
    ? (preCount > 0 ? inp.preProductionVerticalM / preCount : 0)
    : (prodActive[i] ? kt[i] * inp.verticalMPerKtProduction : 0)));
  const rockPerM = (h: HeadingDesign) => h.widthM * (1 + h.overbreakFraction) * h.heightM * (1 + h.overbreakFraction) * h.rockSgTpm3;
  const devRockT = periods.map((_, i) => capLateralM[i] * rockPerM(inp.capitalHeading) + opLateralM[i] * rockPerM(inp.operatingHeading));
  const devWasteT = devRockT.map((r, i) => Math.max(0, r - devOreT[i]));
  if (devRockT.some((r, i) => devOreT[i] > r + 1e-6 && r > 0)) {
    warnings.push("Le minerai de développement dépasse la roche excavée en galerie : réduire la part de minerai de développement ou augmenter les mètres.");
  }
  const backfillT = stopeOreT.map(s => s * inp.backfillTPerStopeT);
  const oreTkm = ore.map(o => o * inp.oreHaulKm);
  const wasteTkm = devWasteT.map(w => w * inp.wasteHaulKm);
  const hoistedT = ore.map((o, i) => o * inp.oreHoistedFraction + devWasteT[i] * inp.wasteHoistedFraction);
  const surfaceT = hoistedT.map((h, i) => h + ore[i] * (1 - inp.oreHoistedFraction));

  // ── Coûts d'exploitation par catégorie ───────────────────────────────────
  const shareSum = inp.stopes.reduce((s, m) => s + Math.max(0, m.share), 0) || 1;
  const stopeUnit = inp.stopes.reduce((s, m) => s + (Math.max(0, m.share) / shareSum) * stopeUnitCost(m), 0);
  const opDev = opLateralM.map(m => m * opH.perMetre.total);
  const stoping = stopeOreT.map(t => t * stopeUnit);
  const truck = sumSeries(n, oreTkm, wasteTkm).map(tkm => tkm * (inp.truckUsdPerTkm + inp.truckLabourUsdPerTkm));
  const hoisting = hoistedT.map(t => t * inp.hoistingUsdPerT);
  const surface = surfaceT.map(t => t * inp.surfaceHaulUsdPerT);
  const services = periods.map((p, i) => (p.preProduction ? inp.preProductionServicesUsdPerYear : ore[i] * inp.mineServicesUsdPerOreT));
  const defDrilling = ore.map(o => o * inp.definitionDrillingUsdPerOreT);
  const staffPerYear = inp.staff.reduce((s, l) => { const r = rateOf(l.rateId); return s + (r ? l.count * labourCostPerYear(r, inp.paidHoursPerYear) : 0); }, 0);
  const indirect = anyActive.map(a => (a ? staffPerYear : 0));

  const categories: { key: string; label: string; series: number[] }[] = [
    { key: 'op_development', label: "Développement latéral d'exploitation", series: opDev },
    { key: 'stoping', label: 'Abattage (chantiers)', series: stoping },
    { key: 'ug_trucking', label: 'Manutention — camionnage souterrain', series: truck },
    { key: 'hoisting', label: 'Manutention — extraction au puits', series: hoisting },
    { key: 'surface_haul', label: 'Manutention — roulage en surface', series: surface },
    { key: 'mine_services', label: 'Services miniers', series: services },
    { key: 'indirect_labour', label: 'Encadrement, technique & services (personnel indirect)', series: indirect },
    { key: 'definition_drilling', label: 'Forage de définition', series: defDrilling },
  ];
  const opexAll = sumSeries(n, ...categories.map(c => c.series));
  const opex: OpexItem[] = categories.map(c => makeOpexItem(c.key, c.label, c.series, periods));

  // ── Flotte mobile ─────────────────────────────────────────────────────────
  const capRounds = capLateralM.map(m => (inp.capitalHeading.advancePerRoundM > 0 ? m / inp.capitalHeading.advancePerRoundM : 0));
  const opRounds = opLateralM.map(m => (inp.operatingHeading.advancePerRoundM > 0 ? m / inp.operatingHeading.advancePerRoundM : 0));
  const actH = (k: keyof HeadingCostBreakdown['hours']) => periods.map((_, i) => capRounds[i] * capH.hours[k] + opRounds[i] * opH.hours[k]);
  const driverHours: Record<Exclude<FleetDriver, 'fixed' | 'stope_tonnes' | 'ore_tkm'>, number[]> = {
    jumbo_hours: actH('drilling'),
    bolter_hours: actH('groundSupport'),
    charger_hours: actH('blasting'),
    dev_lhd_hours: actH('mucking'),
  };
  const fleetRows: UgFleetRow[] = inp.fleet.map(f => {
    let hours: number[];
    let units: number[];
    if (f.driver === 'fixed') {
      units = anyActive.map(a => (a ? f.fixedQty : 0));
      hours = units.map(u => u * f.annualUsageHours);
    } else {
      hours = f.driver === 'stope_tonnes'
        ? stopeOreT.map(t => (f.productivityPerHour > 0 ? t / f.productivityPerHour : 0))
        : f.driver === 'ore_tkm'
          ? oreTkm.map(t => (f.productivityPerHour > 0 ? t / f.productivityPerHour : 0))
          : driverHours[f.driver];
      units = hours.map(h => unitsRequired(h, f.annualUsageHours));
    }
    return { id: f.id, label: f.label, units, hours, purchases: [] };
  });
  // Achats : la flotte maximale de la première année de production est achetée
  // en pré-production ; ensuite complément + remplacements en fin de vie.
  const firstProd = periods.findIndex(p => !p.preProduction);
  const lastActive = anyActive.lastIndexOf(true);
  for (const row of fleetRows) {
    const spec = inp.fleet.find(f => f.id === row.id)!;
    let owned = 0;
    let cum = 0;
    row.purchases = Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let need = row.units[i];
      if (periods[i].preProduction && firstProd >= 0) need = Math.max(need, row.units[firstProd]);
      const added = Math.max(0, need - owned);
      owned += added;
      const before = cum;
      cum += row.hours[i];
      const replaced = spec.lifeHours > 0 && i !== lastActive
        ? Math.floor(cum / spec.lifeHours) - Math.floor(before / spec.lifeHours)
        : 0;
      row.purchases[i] = added + Math.max(0, replaced);
    }
  }

  // ── Capital ───────────────────────────────────────────────────────────────
  const capex: CapexItem[] = [];
  capex.push(makeCapexItem('cap_lateral', 'Développement latéral capital', 'Développement souterrain', capLateralM.map(m => m * capH.perMetre.total), periods));
  capex.push(makeCapexItem('vertical', 'Développement vertical (montées, cheminées)', 'Développement souterrain', verticalM.map(m => m * inp.verticalUsdPerM), periods));
  capex.push(makeCapexItem('capitalised_preprod', "Dépenses d'exploitation capitalisées (pré-production)", 'Développement souterrain', preProductionOnly(opexAll, periods), periods));
  for (const row of fleetRows) {
    const spec = inp.fleet.find(f => f.id === row.id)!;
    const series = row.purchases.map(u => u * spec.deliveredPriceUsd);
    if (series.some(v => v > 0)) capex.push(makeCapexItem(`fleet_${row.id}`, `Engins — ${spec.label}`, 'Équipement minier', series, periods));
  }
  const prodCount = prodActive.filter(Boolean).length;
  for (const it of inp.infrastructure) {
    const amount = it.qty * it.unitCostUsd;
    if (amount <= 0) continue;
    const series = periods.map((p, i) => (it.timing === 'initial'
      ? (p.preProduction ? (preCount > 0 ? amount / preCount : 0) : (preCount === 0 && i === firstProd ? amount : 0))
      : (prodActive[i] && prodCount > 0 ? amount / prodCount : 0)));
    capex.push(makeCapexItem(`infra_${it.id}`, it.label, `Infrastructure souterraine — ${it.category}`, series, periods));
  }
  // Contingence sur l'ensemble du capital (Eastwood Capex Summary!E52, 30 %).
  const contingencySeries = periods.map((_, i) => capex.reduce((s, c) => s + c.byPeriod[i], 0) * inp.contingencyPct / 100);
  capex.push(makeCapexItem('contingency', 'Contingence', 'Contingence', contingencySeries, periods));

  // ── Totaux ────────────────────────────────────────────────────────────────
  const prodIdx = periods.map((p, i) => (!p.preProduction ? i : -1)).filter(i => i >= 0);
  const totalT = ore.map((o, i) => o + devWasteT[i]);
  const productionOre = prodIdx.reduce((s, i) => s + ore[i], 0);
  const productionTotal = prodIdx.reduce((s, i) => s + totalT[i], 0);
  const productionOpex = opex.reduce((s, o) => s + o.productionUsd, 0);
  const sustaining = capex.reduce((s, c) => s + c.sustainingUsd, 0);
  const staffCount = inp.staff.reduce((s, l) => s + l.count, 0);
  if (productionOre <= 0) warnings.push('Aucun minerai en production : vérifier le débit et la durée de vie du projet.');

  return {
    method: 'underground',
    periods,
    capex,
    opex,
    oreTonnes: ore,
    totalTonnes: totalT,
    totals: {
      initialCapexUsd: capex.reduce((s, c) => s + c.initialUsd, 0),
      sustainingCapexUsd: sustaining,
      productionOpexUsd: productionOpex,
      productionOreTonnes: productionOre,
      productionTotalTonnes: productionTotal,
      opexUsdPerOreTonne: productionOre > 0 ? productionOpex / productionOre : 0,
      opexUsdPerTotalTonne: productionTotal > 0 ? productionOpex / productionTotal : 0,
      sustainingUsdPerYear: prodCount > 0 ? sustaining / prodCount : 0,
      productionYears: prodCount,
    },
    warnings,
    capitalHeadingCost: capH,
    operatingHeadingCost: opH,
    physicals: { stopeOreT, devOreT, capLateralM, opLateralM, verticalM, devWasteT, backfillT, oreTkm, wasteTkm, hoistedT },
    stopeUnitCostUsdT: stopeUnit,
    fleet: fleetRows,
    headcount: [
      { label: 'Personnel indirect (encadrement, technique, services)', byPeriod: anyActive.map(a => (a ? staffCount : 0)) },
    ],
  };
}
