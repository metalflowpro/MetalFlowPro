// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — formules élémentaires partagées par les deux moteurs.
//
//   • Coût total employeur d'un poste (CTC) — structure commune à Magino
//     « LaborRates » (base + prime/OT + charges + camp) et à Eastwood
//     « Labour_Input » (base + prime + charges + camp + outils + EPI + voyages).
//   • Coût horaire d'un engin mobile — formule Magino « EquipCost » (colonnes
//     I…W) : pièces, carburant, électricité, pneus, lubrifiants, pièces d'usure,
//     taillants, + heures de maintenance.
//   • Agrégation par année des lignes CAPEX/OPEX (initial vs maintien).
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CapexItem,
  EquipmentCostFactors,
  EquipmentHourlyCost,
  LabourRate,
  MobileEquipmentSpec,
  OpexItem,
  PeriodLabel,
} from './types';

/**
 * Coût total employeur annuel (USD/an) d'un poste.
 *
 *   base   = taux horaire × heures payées/an   (ou salaire annuel)
 *   CTC    = base × (1 + prime% + charges%) + coûts site
 *
 * `paidHoursPerYear` vient du calendrier du moteur (ciel ouvert : heures de
 * poste ÷ équipes ; souterrain : heures payées/ETP des paramètres partagés).
 */
export function labourCostPerYear(rate: LabourRate, paidHoursPerYear: number): number {
  const base = rate.payBasis === 'hourly' ? rate.hourlyRate * paidHoursPerYear : rate.annualSalary;
  return base * (1 + rate.bonusPct / 100 + rate.burdenPct / 100) + rate.siteCostsUsdYr;
}

/** Taux horaire « chargé » (USD/h) — CTC ramené aux heures payées. */
export function labourCostPerHour(rate: LabourRate, paidHoursPerYear: number): number {
  return paidHoursPerYear > 0 ? labourCostPerYear(rate, paidHoursPerYear) / paidHoursPerYear : 0;
}

/**
 * Facteur d'usure selon l'indice d'abrasivité (Magino EquipCost!E36) :
 * 1 = très abrasif (×1,2) … 3 = modéré (×1,0) … 5 = faible (×0,8).
 * Interpolé linéairement entre les paliers pour accepter un indice non entier.
 */
export function abrasionFactor(index: number): number {
  const i = Math.min(5, Math.max(1, index));
  return 1.2 - (i - 1) * 0.1;
}

/**
 * Coût horaire de marche d'un engin (USD par heure de marche), hors
 * main-d'œuvre d'opération. Reproduit Magino EquipCost :
 *   pièces     = facteur pièces × Z × prix/1000
 *   carburant  = L/h × USD/L
 *   électricité= kW × USD/kWh
 *   pneus      = prix catalogue × facteur pneus × nombre / durée de vie
 *   lubrifiants= L/h × USD/L
 *   usure      = facteur pièces × abrasivité × AB × prix/1000
 *   taillants  = facteur pièces × abrasivité × AC × prix/1000
 */
export function equipmentHourlyCost(spec: MobileEquipmentSpec, f: EquipmentCostFactors): EquipmentHourlyCost {
  const kUsd = spec.deliveredPriceUsd / 1000;
  const abr = abrasionFactor(f.abrasionIndex);
  const parts = f.partsFactor * spec.partsFactorPerKusd * kUsd;
  const fuel = spec.fuelLph * f.dieselUsdL;
  const power = spec.powerKw * f.electricityUsdKwh;
  const tires = spec.tireLifeHours > 0
    ? (spec.tireListPriceUsd * f.tireFactor * spec.tireCount) / spec.tireLifeHours
    : 0;
  const lube = spec.lubeLph * f.lubeUsdL;
  const wearParts = f.partsFactor * abr * spec.wearPartsFactorPerKusd * kUsd;
  const bitsSteel = f.partsFactor * abr * spec.bitsSteelFactorPerKusd * kUsd;
  return {
    parts, fuel, power, tires, lube, wearParts, bitsSteel,
    partsAndConsumables: parts + fuel + power + tires + lube + wearParts + bitsSteel,
    maintHoursPerOpHour: f.maintLabourFactor * spec.maintHoursPerOpHour,
  };
}

/**
 * Unités nécessaires pour fournir `hoursRequired` heures de marche quand une
 * unité en offre `hoursPerUnit`. Arrondi supérieur : une fraction d'engin
 * s'achète entière. Une tolérance évite qu'un 3,0000001 ne devienne 4.
 */
export function unitsRequired(hoursRequired: number, hoursPerUnit: number): number {
  if (hoursRequired <= 0 || hoursPerUnit <= 0) return 0;
  return Math.ceil(hoursRequired / hoursPerUnit - 1e-9);
}

/** Construit une ligne CAPEX en séparant initial (pré-production) et maintien. */
export function makeCapexItem(
  key: string,
  label: string,
  category: string,
  byPeriod: number[],
  periods: PeriodLabel[],
): CapexItem {
  let initialUsd = 0;
  let sustainingUsd = 0;
  byPeriod.forEach((v, i) => {
    if (periods[i]?.preProduction) initialUsd += v;
    else sustainingUsd += v;
  });
  return { key, label, category, byPeriod, initialUsd, sustainingUsd };
}

/**
 * Construit une ligne OPEX. Les montants de pré-production sont mis à 0 ici :
 * le moteur les reporte en CAPEX (développement capitalisé).
 */
export function makeOpexItem(key: string, label: string, byPeriod: number[], periods: PeriodLabel[]): OpexItem {
  const masked = byPeriod.map((v, i) => (periods[i]?.preProduction ? 0 : v));
  return { key, label, byPeriod: masked, productionUsd: masked.reduce((s, v) => s + v, 0) };
}

/** Somme élément par élément de plusieurs séries annuelles. */
export function sumSeries(n: number, ...series: number[][]): number[] {
  const out = Array<number>(n).fill(0);
  for (const s of series) for (let i = 0; i < n; i++) out[i] += s[i] ?? 0;
  return out;
}

/** Ne garde que les montants de pré-production d'une série (coûts à capitaliser). */
export function preProductionOnly(series: number[], periods: PeriodLabel[]): number[] {
  return series.map((v, i) => (periods[i]?.preProduction ? v : 0));
}
