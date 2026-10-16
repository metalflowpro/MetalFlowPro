// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers (CAPEX / OPEX) — types partagés des moteurs ciel ouvert et
// souterrain.
//
// Toutes les valeurs monétaires sont en USD (devise de référence de l'app).
// Les tonnages sont en tonnes (t) sauf mention « Mt ». Une « période » est une
// année du plan minier ; les années de pré-production portent preProduction=true
// et leurs coûts sont CAPITALISÉS (règle des deux modèles de référence : Magino
// « Mine Development (PP) » et Eastwood « Capitalized … » sur la période initiale).
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

export type MiningMethod = 'open_pit' | 'underground';

/**
 * Provenance d'une hypothèse — affichée à côté de chaque champ pour qu'aucun
 * chiffre ne soit inexpliqué (même convention que lib/mine/params.ts).
 */
export type InputOrigin =
  | 'projet'      // fiche Projet (débit, disponibilité, densité, teneur…)
  | 'mine'        // Mine & Optimisation (mine_params, phases)
  | 'settings'    // Paramètres projet (project_settings → resolveSettings)
  | 'economie'    // hypothèses partagées de l'Économie (DEFAULT_ASSUMPTIONS)
  | 'reference'   // modèle de référence (Magino / Eastwood), à remplacer par l'étude du projet
  | 'derive'      // calculé à partir d'autres entrées (formule documentée)
  | 'override';   // saisi par l'utilisateur dans le module

export interface Provenance {
  origin: InputOrigin;
  source: string;
}

/** Taux de main-d'œuvre — coût total employeur (CTC) reconstruit par formule. */
export interface LabourRate {
  id: string;
  label: string;
  payBasis: 'hourly' | 'salary';
  /** USD/h — utilisé si payBasis = 'hourly'. */
  hourlyRate: number;
  /** USD/an — utilisé si payBasis = 'salary'. */
  annualSalary: number;
  /** Prime / heures supplémentaires, en % du salaire de base. */
  bonusPct: number;
  /** Charges sociales et avantages, en % du salaire de base. */
  burdenPct: number;
  /** Coûts « site » annuels par personne : camp, EPI, petits outils, voyages de rotation (USD/an). */
  siteCostsUsdYr: number;
}

/** Une ligne d'effectif : un poste × un nombre de personnes. */
export interface StaffLine {
  id: string;
  rateId: string;
  count: number;
  department: string;
}

/**
 * Engin mobile — paramètres du coût horaire (formule Magino « EquipCost ») et
 * de la durée de vie (remplacement en capital de maintien).
 */
export interface MobileEquipmentSpec {
  id: string;
  label: string;
  /** Prix livré (base + transport + montage + mise en service), USD. */
  deliveredPriceUsd: number;
  /** Durée de vie économique (heures moteur). */
  lifeHours: number;
  /** Pièces & réparations : USD/h par k$ de prix (facteur Z de Magino). */
  partsFactorPerKusd: number;
  /** Consommation de carburant (L/h). */
  fuelLph: number;
  /** Puissance électrique moyenne appelée (kW) — engins électriques / batterie. */
  powerKw: number;
  /** Lubrifiants (L/h). */
  lubeLph: number;
  /** Pneus : nombre, prix unitaire catalogue (USD) et durée de vie (h). */
  tireCount: number;
  tireListPriceUsd: number;
  tireLifeHours: number;
  /** Pièces d'usure (godets, dents, lames) : USD/h par k$ de prix. */
  wearPartsFactorPerKusd: number;
  /** Taillants / tiges de forage : USD/h par k$ de prix. */
  bitsSteelFactorPerKusd: number;
  /** Heures de maintenance par heure de marche (avant facteur global). */
  maintHoursPerOpHour: number;
}

/** Facteurs globaux du coût horaire des engins (Magino EquipCost, lignes 31–36). */
export interface EquipmentCostFactors {
  /** Prix du gazole, USD/L. */
  dieselUsdL: number;
  /** Prix de l'électricité, USD/kWh. */
  electricityUsdKwh: number;
  /** Prix des lubrifiants, USD/L. */
  lubeUsdL: number;
  /** Multiplicateur des pièces (×1 = coût US catalogue). */
  partsFactor: number;
  /** Multiplicateur du prix pneus (remise négociée sur le catalogue). */
  tireFactor: number;
  /** Multiplicateur des heures de maintenance. */
  maintLabourFactor: number;
  /** Indice d'abrasivité 1 (très élevée) … 5 (faible) → facteur d'usure. */
  abrasionIndex: number;
}

export interface EquipmentHourlyCost {
  parts: number;
  fuel: number;
  power: number;
  tires: number;
  lube: number;
  wearParts: number;
  bitsSteel: number;
  /** Total pièces & consommables (hors main-d'œuvre de maintenance). */
  partsAndConsumables: number;
  /** Heures de maintenance par heure de marche (après facteur global). */
  maintHoursPerOpHour: number;
}

/** Ligne de CAPEX produite par un moteur, par année. */
export interface CapexItem {
  key: string;
  label: string;
  category: string;
  /** USD par année du plan (même indexation que `periods`). */
  byPeriod: number[];
  initialUsd: number;
  sustainingUsd: number;
}

/** Ligne d'OPEX produite par un moteur (centre de coût), par année. */
export interface OpexItem {
  key: string;
  label: string;
  /** USD par année du plan (0 en pré-production : ces coûts sont capitalisés). */
  byPeriod: number[];
  /** Total sur la période de production (USD). */
  productionUsd: number;
}

export interface PeriodLabel {
  index: number;
  /** Année du plan : ≤ 0 en pré-production, 1…N en production. */
  year: number;
  preProduction: boolean;
}

/** Résultat commun aux deux moteurs. */
export interface MineCostResult {
  method: MiningMethod;
  periods: PeriodLabel[];
  capex: CapexItem[];
  opex: OpexItem[];
  /** Tonnes de minerai envoyées à l'usine par année. */
  oreTonnes: number[];
  /** Tonnes totales déplacées (minerai + stérile) par année. */
  totalTonnes: number[];
  totals: {
    initialCapexUsd: number;
    sustainingCapexUsd: number;
    productionOpexUsd: number;
    productionOreTonnes: number;
    productionTotalTonnes: number;
    /** OPEX minier moyen sur la production, USD/t de minerai. */
    opexUsdPerOreTonne: number;
    /** OPEX minier moyen sur la production, USD/t déplacée. */
    opexUsdPerTotalTonne: number;
    /** Capital de maintien moyen par année de production (USD/an). */
    sustainingUsdPerYear: number;
    productionYears: number;
  };
  /** Avertissements de cohérence (données projet manquantes, flotte saturée…). */
  warnings: string[];
}
