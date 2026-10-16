// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — moteur CIEL OUVERT.
//
// Reprend la structure du modèle de référence Magino (« MaginoCostSummary ») :
//   OpParms   → calendrier d'exploitation, temps productif par poste
//   Drl/Shv/TrkReq → heures de marche requises par classe d'engin → flotte
//   EquipCost → coût horaire pièces & consommables + heures de maintenance
//   Blast     → coût de l'explosif (mélange ANFO / émulsion) + amorçage + fixe
//   Hourly / Salary / MaintLabor → main-d'œuvre horaire, cadres, maintenance
//   OpCosts   → OPEX par centre de coût, par t déplacée et par t de minerai
//   Capital   → achats d'engins (initial + maintien), petits équipements,
//               pièces de rechange initiales, outillage, contingence,
//               pré-découverture capitalisée (« Mine Development »)
//
// Toutes les entrées viennent du projet (calendrier de production, densité,
// ratio de découverture, hauteur de banc…) ou d'un référentiel documenté et
// modifiable (voir referenceData.ts). Aucune valeur n'est figée ici.
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import {
  equipmentHourlyCost,
  labourCostPerHour,
  labourCostPerYear,
  makeCapexItem,
  makeOpexItem,
  preProductionOnly,
  sumSeries,
  unitsRequired,
} from './costFormulas';
import type {
  CapexItem,
  EquipmentCostFactors,
  LabourRate,
  MineCostResult,
  MobileEquipmentSpec,
  OpexItem,
  PeriodLabel,
  StaffLine,
} from './types';

export interface OpenPitPeriod {
  /** Année du plan : ≤ 0 en pré-production. */
  year: number;
  preProduction: boolean;
  oreTonnes: number;
  wasteTonnes: number;
}

export interface LoadingUnitInput {
  equipmentId: string;
  /** Capacité du godet (m³). */
  bucketM3: number;
  /** Coefficient de remplissage du godet. */
  fillFactor: number;
  /** Cycle de chargement d'un godet (s). */
  cycleSec: number;
  /** Part des tonnes chargées par ce type d'engin (fraction ; normalisée). */
  share: number;
}

export interface SupportUnitInput {
  equipmentId: string;
  /** Unités par unité de chargement principale (ratio de flotte). */
  unitsPerLoadingUnit: number;
}

export interface OpenPitInputs {
  periods: OpenPitPeriod[];

  // ── Calendrier (Magino OpParms) ──
  hoursPerShift: number;
  shiftsPerDay: number;
  operatingDaysPerYear: number;
  lostShiftsPerYear: number;
  crews: number;
  /** Temps non productif programmé par poste (déplacements, relève, sautage, repas, plein) — min. */
  nonProductiveMinPerShift: number;
  /** Efficacité de travail : minutes productives par heure. */
  jobEfficiencyMinPerHour: number;
  /** Disponibilité mécanique (%). */
  mechanicalAvailabilityPct: number;
  /** Utilisation de la disponibilité (%). */
  useOfAvailabilityPct: number;

  // ── Matériau ──
  oreSgTpm3: number;
  wasteSgTpm3: number;
  /** Foisonnement (fraction) : densité foisonnée = densité en place / (1 + foisonnement). */
  swellFraction: number;
  benchHeightM: number;

  // ── Forage ──
  drillEquipmentId: string;
  holeDiameterMm: number;
  /** Banquette / diamètre (B = ratio × D). */
  burdenToDiameter: number;
  /** Espacement / banquette. */
  spacingToBurden: number;
  /** Surforation / banquette. */
  subdrillToBurden: number;
  /** Bourrage / banquette. */
  stemmingToBurden: number;
  /** Vitesse de foration nette (m par heure de marche). */
  penetrationMph: number;

  // ── Sautage (Magino Blast) ──
  /** Part massique d'émulsion dans le mélange (le reste = ANFO). */
  emulsionWeightFraction: number;
  emulsionSg: number;
  emulsionUsdKg: number;
  prillSg: number;
  prillUsdKg: number;
  /** Part massique de gazole dans l'ANFO. */
  anfoFuelWeightFraction: number;
  fuelOilSg: number;
  /** Amorçage (détonateur + booster + bourrage), USD par trou. */
  initiationUsdPerHole: number;
  /** Frais fixes de l'artificier (service de tir, équipements, dépôts), USD/an. */
  blastingFixedUsdPerYear: number;

  // ── Chargement & transport ──
  loading: LoadingUnitInput[];
  truckEquipmentId: string;
  truckPayloadT: number;
  /** Distance de roulage aller (km). */
  haulDistanceKm: number;
  loadedSpeedKmh: number;
  emptySpeedKmh: number;
  /** Mise en place sous la pelle + déversement (min par cycle). */
  spotAndDumpMin: number;

  // ── Engins de soutien ──
  support: SupportUnitInput[];

  equipment: MobileEquipmentSpec[];
  costFactors: EquipmentCostFactors;

  // ── Main-d'œuvre ──
  rates: LabourRate[];
  /** Poste (rateId) des opérateurs de chaque classe et du personnel horaire fixe. */
  roleRates: {
    drillOperator: string;
    loaderOperator: string;
    truckOperator: string;
    supportOperator: string;
    blaster: string;
    labourer: string;
    mechanic: string;
    fuelLubeTech: string;
    tireTech: string;
  };
  /** Effectifs horaires fixes (personnes) — présents dès que la mine tourne. */
  fixedHourly: {
    blasters: number;
    labourers: number;
    fuelLubeTechs: number;
    tireTechs: number;
  };
  /** Cadres & personnel technique (salariés). */
  staff: StaffLine[];
  /** Consommables d'administration, en % de la masse salariale cadres. */
  adminConsumablesPctOfSalaries: number;
  /** Consommables des services miniers (éclairage, pompage, petits outils…), USD/an. */
  servicesConsumablesUsdPerYear: number;
  /** Contingence main-d'œuvre (%) appliquée à toute la masse salariale. */
  labourContingencyPct: number;

  // ── Capital ──
  smallEquipmentPctOfMajor: number;
  initialSparesPctOfMajor: number;
  shopToolsPctOfMajor: number;
  /** Contingence (%) appliquée au capital initial. */
  contingencyPct: number;
}

export interface FleetRow {
  id: string;
  label: string;
  role: 'drill' | 'loader' | 'truck' | 'support';
  hours: number[];
  units: number[];
  purchases: number[];
  hourlyPartsConsumables: number;
}

export interface OpenPitResult extends MineCostResult {
  method: 'open_pit';
  fleet: FleetRow[];
  headcount: { label: string; byPeriod: number[] }[];
  derived: {
    scheduledHoursPerYear: number;
    unitOperatingHoursPerYear: number;
    paidHoursPerOperator: number;
    burdenM: number;
    spacingM: number;
    holeLengthM: number;
    tonnesPerHoleOre: number;
    powderFactorKgT: number;
    blendExplosiveUsdKg: number;
    truckCycleMin: number;
    truckTph: number;
    loaderTph: { id: string; tph: number }[];
  };
}

function findSpec(eq: MobileEquipmentSpec[], id: string): MobileEquipmentSpec | undefined {
  return eq.find(e => e.id === id);
}

function findRate(rates: LabourRate[], id: string): LabourRate | undefined {
  return rates.find(r => r.id === id);
}

/** Densité et coût du mélange explosif (Magino Blast, lignes 4–21). */
export function explosiveBlend(inp: Pick<OpenPitInputs,
  'emulsionWeightFraction' | 'emulsionSg' | 'emulsionUsdKg' | 'prillSg' | 'prillUsdKg'
  | 'anfoFuelWeightFraction' | 'fuelOilSg'> & { dieselUsdL: number }) {
  const f = inp.anfoFuelWeightFraction;
  const fuelUsdKg = inp.fuelOilSg > 0 ? inp.dieselUsdL / inp.fuelOilSg : 0;
  const anfoSg = 1 / ((1 - f) / inp.prillSg + f / inp.fuelOilSg);
  const anfoUsdKg = f * fuelUsdKg + (1 - f) * inp.prillUsdKg;
  const wE = Math.min(1, Math.max(0, inp.emulsionWeightFraction));
  const wA = 1 - wE;
  const sg = 1 / ((wA > 0 ? wA / anfoSg : 0) + (wE > 0 ? wE / inp.emulsionSg : 0));
  return { sg, usdKg: wA * anfoUsdKg + wE * inp.emulsionUsdKg, anfoSg, anfoUsdKg };
}

export function computeOpenPitCost(inp: OpenPitInputs): OpenPitResult {
  const warnings: string[] = [];
  const periods: PeriodLabel[] = inp.periods.map((p, index) => ({ index, year: p.year, preProduction: p.preProduction }));
  const n = periods.length;
  const ore = inp.periods.map(p => Math.max(0, p.oreTonnes));
  const waste = inp.periods.map(p => Math.max(0, p.wasteTonnes));
  const total = ore.map((o, i) => o + waste[i]);
  const active = total.map(t => t > 0);

  // ── Calendrier ────────────────────────────────────────────────────────────
  const shiftMin = inp.hoursPerShift * 60;
  const meteredFraction = shiftMin > 0 ? Math.max(0, shiftMin - inp.nonProductiveMinPerShift) / shiftMin : 0;
  const jobEff = inp.jobEfficiencyMinPerHour / 60;
  const scheduledHours = Math.max(0, inp.operatingDaysPerYear * inp.shiftsPerDay - inp.lostShiftsPerYear) * inp.hoursPerShift;
  const unitHours = scheduledHours * meteredFraction * (inp.mechanicalAvailabilityPct / 100) * (inp.useOfAvailabilityPct / 100);
  // Heures payées par opérateur : chaque poste de la journée est tenu par une
  // des `crews` équipes en rotation (Magino : 12 h × 2 postes × 365 j / 4 = 2190 h).
  const paidHours = inp.crews > 0 ? (inp.operatingDaysPerYear * inp.shiftsPerDay * inp.hoursPerShift) / inp.crews : 0;
  if (unitHours <= 0) warnings.push("Calendrier d'exploitation nul : aucune heure de marche disponible par engin.");

  const factors = inp.costFactors;
  const hourly = (id: string) => {
    const spec = findSpec(inp.equipment, id);
    return spec ? equipmentHourlyCost(spec, factors) : null;
  };

  // ── Forage ────────────────────────────────────────────────────────────────
  const D = inp.holeDiameterMm / 1000;
  const burden = inp.burdenToDiameter * D;
  const spacing = inp.spacingToBurden * burden;
  const subdrill = inp.subdrillToBurden * burden;
  const stemming = inp.stemmingToBurden * burden;
  const holeLength = inp.benchHeightM + subdrill;
  const sgBlasted = ore.map((o, i) => (total[i] > 0 ? (o * inp.oreSgTpm3 + waste[i] * inp.wasteSgTpm3) / total[i] : inp.oreSgTpm3));
  const tonnesPerHole = sgBlasted.map(sg => burden * spacing * inp.benchHeightM * sg);
  const holes = total.map((t, i) => (tonnesPerHole[i] > 0 ? t / tonnesPerHole[i] : 0));
  const drillMetres = holes.map(h => h * holeLength);
  const drillHours = drillMetres.map(m => (inp.penetrationMph > 0 && jobEff > 0 ? m / (inp.penetrationMph * jobEff) : 0));

  // ── Sautage ───────────────────────────────────────────────────────────────
  const blend = explosiveBlend({ ...inp, dieselUsdL: factors.dieselUsdL });
  const linearChargeKgM = blend.sg * 1000 * Math.PI * D * D / 4;
  const kgPerHole = Math.max(0, holeLength - stemming) * linearChargeKgM;
  const explosiveKg = holes.map(h => h * kgPerHole);
  const blastConsumables = explosiveKg.map((kg, i) => kg * blend.usdKg + holes[i] * inp.initiationUsdPerHole);
  const blastFixed = active.map(a => (a ? inp.blastingFixedUsdPerYear : 0));

  // ── Chargement ────────────────────────────────────────────────────────────
  const shareSum = inp.loading.reduce((s, l) => s + Math.max(0, l.share), 0) || 1;
  const looseOreSg = inp.oreSgTpm3 / (1 + inp.swellFraction);
  const looseSg = sgBlasted.map(sg => sg / (1 + inp.swellFraction));
  const loaderRows = inp.loading.map(l => {
    const share = Math.max(0, l.share) / shareSum;
    const bucketT = (sg: number) => l.bucketM3 * l.fillFactor * sg;
    const tph = (sg: number) => (l.cycleSec > 0 ? bucketT(sg) * (3600 / l.cycleSec) * jobEff : 0);
    const hours = total.map((t, i) => (tph(looseSg[i]) > 0 ? (t * share) / tph(looseSg[i]) : 0));
    return { l, share, bucketT, tph, hours };
  });

  // ── Transport ─────────────────────────────────────────────────────────────
  // Temps de chargement d'un camion = nombre de godets × cycle, pondéré par la
  // part de chaque engin de chargement.
  const loadMin = (sg: number) => loaderRows.reduce((s, r) => {
    const bt = r.bucketT(sg);
    const passes = bt > 0 ? Math.ceil(inp.truckPayloadT / bt - 1e-9) : 0;
    return s + r.share * passes * r.l.cycleSec / 60;
  }, 0);
  const travelMin = (inp.loadedSpeedKmh > 0 ? (inp.haulDistanceKm / inp.loadedSpeedKmh) * 60 : 0)
    + (inp.emptySpeedKmh > 0 ? (inp.haulDistanceKm / inp.emptySpeedKmh) * 60 : 0);
  const truckCycle = looseSg.map(sg => loadMin(sg) + inp.spotAndDumpMin + travelMin);
  const truckTph = truckCycle.map(c => (c > 0 ? (inp.truckPayloadT * 60 / c) * jobEff : 0));
  const truckHours = total.map((t, i) => (truckTph[i] > 0 ? t / truckTph[i] : 0));

  // ── Flotte ────────────────────────────────────────────────────────────────
  const fleet: FleetRow[] = [];
  const pushFleet = (id: string, role: FleetRow['role'], hours: number[]) => {
    const spec = findSpec(inp.equipment, id);
    if (!spec) { warnings.push(`Engin « ${id} » introuvable dans la liste d'équipements.`); return; }
    const units = hours.map(h => unitsRequired(h, unitHours));
    fleet.push({ id, label: spec.label, role, hours, units, purchases: [], hourlyPartsConsumables: hourly(id)?.partsAndConsumables ?? 0 });
  };
  pushFleet(inp.drillEquipmentId, 'drill', drillHours);
  for (const r of loaderRows) pushFleet(r.l.equipmentId, 'loader', r.hours);
  pushFleet(inp.truckEquipmentId, 'truck', truckHours);

  const loadingUnits = Array.from({ length: n }, (_, i) =>
    fleet.filter(f => f.role === 'loader').reduce((s, f) => s + f.units[i], 0));
  for (const s of inp.support) {
    const units = loadingUnits.map((lu, i) => (active[i] ? Math.max(1, Math.ceil(s.unitsPerLoadingUnit * lu - 1e-9)) : 0));
    pushFleet(s.equipmentId, 'support', units.map(u => u * unitHours));
    const row = fleet[fleet.length - 1];
    if (row && row.id === s.equipmentId) row.units = units;
  }

  // Achats : la flotte de la 1re année de production est achetée en
  // pré-production ; ensuite, complément de flotte + remplacements en fin de vie
  // (heures cumulées de la classe ÷ durée de vie). Pas de remplacement la
  // dernière année : un engin neuf ne servirait plus.
  const firstProd = periods.findIndex(p => !p.preProduction);
  const lastActive = active.lastIndexOf(true);
  for (const f of fleet) {
    const spec = findSpec(inp.equipment, f.id)!;
    let owned = 0;
    let cumHours = 0;
    f.purchases = Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let need = f.units[i];
      if (periods[i].preProduction && firstProd >= 0) need = Math.max(need, f.units[firstProd]);
      const added = Math.max(0, need - owned);
      owned += added;
      const before = cumHours;
      cumHours += f.hours[i];
      const replaced = spec.lifeHours > 0 && i !== lastActive
        ? Math.floor(cumHours / spec.lifeHours) - Math.floor(before / spec.lifeHours)
        : 0;
      f.purchases[i] = added + Math.max(0, replaced);
    }
  }

  // ── Coûts d'exploitation des engins (P&C + main-d'œuvre de maintenance) ──
  const mechanicRate = findRate(inp.rates, inp.roleRates.mechanic);
  const mechanicUsdH = mechanicRate ? labourCostPerHour(mechanicRate, paidHours) : 0;
  const roleSeries = (role: FleetRow['role']) => {
    const rows = fleet.filter(f => f.role === role);
    const pc = Array<number>(n).fill(0);
    const maint = Array<number>(n).fill(0);
    const maintHours = Array<number>(n).fill(0);
    for (const f of rows) {
      const h = hourly(f.id);
      if (!h) continue;
      for (let i = 0; i < n; i++) {
        pc[i] += f.hours[i] * h.partsAndConsumables;
        maintHours[i] += f.hours[i] * h.maintHoursPerOpHour;
        maint[i] += f.hours[i] * h.maintHoursPerOpHour * mechanicUsdH;
      }
    }
    return { pc, maint, maintHours };
  };
  const drillC = roleSeries('drill');
  const loadC = roleSeries('loader');
  const truckC = roleSeries('truck');
  const supC = roleSeries('support');

  // ── Main-d'œuvre ──────────────────────────────────────────────────────────
  const ctc = (rateId: string) => {
    const r = findRate(inp.rates, rateId);
    if (!r) { warnings.push(`Taux de main-d'œuvre « ${rateId} » introuvable.`); return 0; }
    return labourCostPerYear(r, paidHours);
  };
  const operatorCount = (role: FleetRow['role']) => Array.from({ length: n }, (_, i) =>
    fleet.filter(f => f.role === role).reduce((s, f) => s + f.units[i], 0) * inp.crews);
  const drillOps = operatorCount('drill');
  const loaderOps = operatorCount('loader');
  const truckOps = operatorCount('truck');
  const supportOps = operatorCount('support');
  const fixed = (count: number) => active.map(a => (a ? count : 0));
  const blasters = fixed(inp.fixedHourly.blasters);
  const labourers = fixed(inp.fixedHourly.labourers);
  const fuelLube = fixed(inp.fixedHourly.fuelLubeTechs);
  const tires = fixed(inp.fixedHourly.tireTechs);
  const mechanics = sumSeries(n, drillC.maintHours, loadC.maintHours, truckC.maintHours, supC.maintHours)
    .map(h => (paidHours > 0 ? h / paidHours : 0));

  const cost = (counts: number[], rateId: string) => { const c = ctc(rateId); return counts.map(x => x * c); };
  const drillLab = cost(drillOps, inp.roleRates.drillOperator);
  const loaderLab = cost(loaderOps, inp.roleRates.loaderOperator);
  const truckLab = cost(truckOps, inp.roleRates.truckOperator);
  const supportLab = cost(supportOps, inp.roleRates.supportOperator);
  const blasterLab = cost(blasters, inp.roleRates.blaster);
  const labourerLab = cost(labourers, inp.roleRates.labourer);
  const servicesMaintLab = sumSeries(n, cost(fuelLube, inp.roleRates.fuelLubeTech), cost(tires, inp.roleRates.tireTech));

  const salaryPerYear = inp.staff.reduce((s, l) => {
    const r = findRate(inp.rates, l.rateId);
    return s + (r ? l.count * labourCostPerYear(r, paidHours) : 0);
  }, 0);
  const salaries = active.map(a => (a ? salaryPerYear : 0));
  const staffCount = inp.staff.reduce((s, l) => s + l.count, 0);
  const adminConsumables = salaries.map(s => s * inp.adminConsumablesPctOfSalaries / 100);
  const servicesConsumables = active.map(a => (a ? inp.servicesConsumablesUsdPerYear : 0));

  const allLabour = sumSeries(n,
    drillLab, loaderLab, truckLab, supportLab, blasterLab, labourerLab, servicesMaintLab,
    drillC.maint, loadC.maint, truckC.maint, supC.maint, salaries);
  const labourContingency = allLabour.map(v => v * inp.labourContingencyPct / 100);

  // ── Centres de coût (Magino OpCosts, lignes 75–83) ───────────────────────
  const centres: { key: string; label: string; series: number[] }[] = [
    { key: 'drilling', label: 'Forage', series: sumSeries(n, drillC.pc, drillLab, drillC.maint) },
    { key: 'blasting', label: 'Sautage', series: sumSeries(n, blastConsumables, blastFixed, blasterLab) },
    { key: 'loading', label: 'Chargement', series: sumSeries(n, loadC.pc, loaderLab, loadC.maint) },
    { key: 'hauling', label: 'Transport', series: sumSeries(n, truckC.pc, truckLab, truckC.maint) },
    { key: 'roads_dumps', label: 'Routes & haldes (engins de soutien)', series: sumSeries(n, supC.pc, supportLab, supC.maint) },
    { key: 'mine_services', label: 'Services miniers', series: sumSeries(n, servicesConsumables, labourerLab, servicesMaintLab) },
    { key: 'mine_admin', label: 'Administration minière', series: sumSeries(n, salaries, adminConsumables) },
    { key: 'labour_contingency', label: "Contingence main-d'œuvre", series: labourContingency },
  ];
  const opexTotalByPeriod = sumSeries(n, ...centres.map(c => c.series));
  const opex: OpexItem[] = centres.map(c => makeOpexItem(c.key, c.label, c.series, periods));

  // ── Capital (Magino Capital) ──────────────────────────────────────────────
  const major = Array<number>(n).fill(0);
  const capex: CapexItem[] = [];
  for (const f of fleet) {
    const spec = findSpec(inp.equipment, f.id)!;
    const series = f.purchases.map(u => u * spec.deliveredPriceUsd);
    series.forEach((v, i) => { major[i] += v; });
    capex.push(makeCapexItem(`equip_${f.id}`, `Engins — ${spec.label}`, 'Équipement minier', series, periods));
  }
  const pct = (series: number[], p: number) => series.map(v => v * p / 100);
  capex.push(makeCapexItem('small_equipment', 'Petits équipements & véhicules légers', 'Équipement minier', pct(major, inp.smallEquipmentPctOfMajor), periods));
  capex.push(makeCapexItem('initial_spares', 'Pièces de rechange', 'Équipement minier', pct(major, inp.initialSparesPctOfMajor), periods));
  capex.push(makeCapexItem('shop_tools', "Outillage d'atelier", 'Équipement minier', pct(major, inp.shopToolsPctOfMajor), periods));
  capex.push(makeCapexItem('prestrip', 'Développement minier — pré-découverture capitalisée', 'Développement minier',
    preProductionOnly(opexTotalByPeriod, periods), periods));
  const initialBase = capex.reduce((s, c) => s + c.initialUsd, 0);
  capex.push(makeCapexItem('contingency', 'Contingence (capital initial)', 'Contingence',
    periods.map((p, i) => (p.preProduction ? capex.reduce((s, c) => s + c.byPeriod[i], 0) * inp.contingencyPct / 100 : 0)), periods));
  if (initialBase <= 0 && periods.some(p => p.preProduction)) warnings.push('Aucun capital initial calculé : vérifier le calendrier de pré-production.');

  // ── Totaux ────────────────────────────────────────────────────────────────
  const prodIdx = periods.map((p, i) => (!p.preProduction ? i : -1)).filter(i => i >= 0);
  const productionOre = prodIdx.reduce((s, i) => s + ore[i], 0);
  const productionTotal = prodIdx.reduce((s, i) => s + total[i], 0);
  const productionOpex = opex.reduce((s, o) => s + o.productionUsd, 0);
  const productionYears = prodIdx.filter(i => active[i]).length;
  const sustaining = capex.reduce((s, c) => s + c.sustainingUsd, 0);

  const headcount = [
    { label: 'Opérateurs de foreuse', byPeriod: drillOps },
    { label: 'Opérateurs de chargement', byPeriod: loaderOps },
    { label: 'Conducteurs de camion', byPeriod: truckOps },
    { label: 'Opérateurs engins de soutien', byPeriod: supportOps },
    { label: 'Boutefeux', byPeriod: blasters },
    { label: 'Manœuvres', byPeriod: labourers },
    { label: 'Mécaniciens (heures de maintenance)', byPeriod: mechanics.map(m => Math.ceil(m - 1e-9)) },
    { label: 'Graisseurs & pneumaticiens', byPeriod: sumSeries(n, fuelLube, tires) },
    { label: 'Cadres & personnel technique', byPeriod: active.map(a => (a ? staffCount : 0)) },
  ];

  const firstActive = active.indexOf(true);
  const refIdx = firstProd >= 0 ? firstProd : Math.max(0, firstActive);
  return {
    method: 'open_pit',
    periods,
    capex,
    opex,
    oreTonnes: ore,
    totalTonnes: total,
    totals: {
      initialCapexUsd: capex.reduce((s, c) => s + c.initialUsd, 0),
      sustainingCapexUsd: sustaining,
      productionOpexUsd: productionOpex,
      productionOreTonnes: productionOre,
      productionTotalTonnes: productionTotal,
      opexUsdPerOreTonne: productionOre > 0 ? productionOpex / productionOre : 0,
      opexUsdPerTotalTonne: productionTotal > 0 ? productionOpex / productionTotal : 0,
      sustainingUsdPerYear: productionYears > 0 ? sustaining / productionYears : 0,
      productionYears,
    },
    warnings,
    fleet,
    headcount,
    derived: {
      scheduledHoursPerYear: scheduledHours,
      unitOperatingHoursPerYear: unitHours,
      paidHoursPerOperator: paidHours,
      burdenM: burden,
      spacingM: spacing,
      holeLengthM: holeLength,
      tonnesPerHoleOre: burden * spacing * inp.benchHeightM * inp.oreSgTpm3,
      powderFactorKgT: tonnesPerHole[refIdx] > 0 ? kgPerHole / tonnesPerHole[refIdx] : 0,
      blendExplosiveUsdKg: blend.usdKg,
      truckCycleMin: truckCycle[refIdx] ?? 0,
      truckTph: truckTph[refIdx] ?? 0,
      loaderTph: loaderRows.map(r => ({ id: r.l.equipmentId, tph: r.tph(looseSg[refIdx] ?? looseOreSg) })),
    },
  };
}
