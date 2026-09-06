export interface MineFeedScenario { name: string; tonnesPerHour: number; gradeGpt: number; recoveryPct: number; availabilityPct: number; }
export interface PlantScenarioResult { throughputTph: number; recoveryPct: number; utilizationPct: number; annualContainedOz: number; }

/** Deterministic bridge used to evaluate mine feed scenarios against plant limits. */
export function evaluateMinePlantScenario(mine: MineFeedScenario, plantCapacityTph: number, hoursPerYear: number, gramsPerOunce = 31.1034768): PlantScenarioResult {
  const throughputTph = Math.max(0, Math.min(mine.tonnesPerHour, plantCapacityTph));
  const utilizationPct = plantCapacityTph > 0 ? throughputTph / plantCapacityTph * 100 : 0;
  const annualTonnes = throughputTph * Math.max(0, hoursPerYear) * Math.max(0, Math.min(100, mine.availabilityPct)) / 100;
  const annualContainedOz = annualTonnes * Math.max(0, mine.gradeGpt) * Math.max(0, Math.min(100, mine.recoveryPct)) / 100 / gramsPerOunce;
  return { throughputTph, recoveryPct: Math.max(0, Math.min(100, mine.recoveryPct)), utilizationPct, annualContainedOz };
}

