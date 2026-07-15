import { ProcessNode, StreamEdge, FeedInput, OptimizationVariable, Constraint, OptimizationResults, OptimizationObjective } from './types';
import { solveFlowsheet } from './engine';
import { DEFAULT_ASSUMPTIONS, HOURS_PER_YEAR, kgToTroyOz } from '../config/constants';

// ─── Economic assumptions used by the `maximize_npv` objective ────────────────

/**
 * Economic context for NPV optimisation. Callers should pass the project's
 * resolved assumptions (see `resolveSettings`) so the optimiser ranks candidates
 * on the same numbers the Economics module reports; each field falls back to the
 * documented code default when omitted.
 */
export interface OptimizationEconomics {
  /** Plant availability as a fraction (0–1). */
  availability?: number;
  /** Calendar hours per year. */
  hoursPerYear?: number;
  /** Gold price ($/oz). */
  goldPriceUsdOz?: number;
  /** Discount rate as a fraction (0–1). */
  discountRate?: number;
  /** Cash-flow horizon (years). */
  lomYears?: number;
}

// ─── Objective evaluation ─────────────────────────────────────────────────────

function evaluate(
  nodes: ProcessNode[],
  edges: StreamEdge[],
  feed: FeedInput,
  objective: OptimizationObjective,
  economics: OptimizationEconomics,
): number {
  const result = solveFlowsheet(nodes, edges, feed, { maxIterations: 50, tolerance: 1e-3, mode: 'steady_state' });
  const g = result.globalResults;
  switch (objective) {
    case 'maximize_recovery': return g.overall_recovery;
    case 'minimize_opex': return -g.total_opex_per_t;
    case 'maximize_npv': {
      const availability = economics.availability ?? DEFAULT_ASSUMPTIONS.AVAILABILITY_FRACTION;
      const hoursPerYear = economics.hoursPerYear ?? HOURS_PER_YEAR;
      const goldPrice = economics.goldPriceUsdOz ?? DEFAULT_ASSUMPTIONS.GOLD_PRICE_USD_OZ;
      const discountRate = economics.discountRate ?? DEFAULT_ASSUMPTIONS.DISCOUNT_RATE;
      const lomYears = economics.lomYears ?? DEFAULT_ASSUMPTIONS.LOM_YEARS;

      const operatingHours = hoursPerYear * availability;
      const annualOz = kgToTroyOz(g.dore_production_kg_h * operatingHours);
      const annualRevenue = annualOz * goldPrice;
      const annualOpex = g.total_opex_per_t * feed.feed_rate * operatingHours;
      const annualCashflow = annualRevenue - annualOpex;

      // Discounted cash flow over the LOM horizon. CAPEX is excluded on purpose:
      // it is invariant across the flowsheet parameters being optimised here, so
      // it would shift every candidate by the same constant without changing the
      // ranking. This is a relative objective, not a reportable project NPV.
      let value = 0;
      for (let year = 1; year <= lomYears; year++) {
        value += annualCashflow / Math.pow(1 + discountRate, year);
      }
      return value;
    }
    default: return g.overall_recovery;
  }
}

// ─── Apply variable values to node parameters ────────────────────────────────

function applyVariables(
  nodes: ProcessNode[],
  variables: OptimizationVariable[],
  values: number[],
): ProcessNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, { ...n, parameters: { ...n.parameters } }]));
  for (let i = 0; i < variables.length; i++) {
    const v = variables[i];
    const node = nodeMap.get(v.node_id);
    if (node) node.parameters[v.parameter] = values[i];
  }
  return Array.from(nodeMap.values());
}

// ─── Genetic algorithm ────────────────────────────────────────────────────────

interface Individual { values: number[]; fitness: number }

function randomIndividual(variables: OptimizationVariable[]): number[] {
  return variables.map(v => v.min + Math.random() * (v.max - v.min));
}

function mutate(individual: number[], variables: OptimizationVariable[], rate = 0.2): number[] {
  return individual.map((val, i) => {
    if (Math.random() < rate) {
      const range = variables[i].max - variables[i].min;
      const delta = (Math.random() - 0.5) * range * 0.3;
      return Math.max(variables[i].min, Math.min(variables[i].max, val + delta));
    }
    return val;
  });
}

function crossover(a: number[], b: number[]): number[] {
  const cut = Math.floor(Math.random() * a.length);
  return [...a.slice(0, cut), ...b.slice(cut)];
}

function satisfiesConstraints(values: number[], variables: OptimizationVariable[], constraints: Constraint[]): boolean {
  for (const c of constraints) {
    const varIdx = variables.findIndex(v => v.node_id === c.node_id && v.parameter === c.parameter);
    if (varIdx < 0) continue;
    const val = values[varIdx];
    switch (c.operator) {
      case '<': if (!(val < c.value)) return false; break;
      case '>': if (!(val > c.value)) return false; break;
      case '<=': if (!(val <= c.value)) return false; break;
      case '>=': if (!(val >= c.value)) return false; break;
      case '=': if (Math.abs(val - c.value) > 1e-6) return false; break;
    }
  }
  return true;
}

export function runOptimization(
  nodes: ProcessNode[],
  edges: StreamEdge[],
  feed: FeedInput,
  variables: OptimizationVariable[],
  constraints: Constraint[],
  objective: OptimizationObjective,
  populationSize = 20,
  generations = 30,
  economics: OptimizationEconomics = {},
): OptimizationResults {
  if (variables.length === 0) {
    const base = evaluate(nodes, edges, feed, objective, economics);
    return {
      optimal_parameters: {},
      base_value: base,
      optimal_value: base,
      improvement_pct: 0,
      convergence_history: [base],
    };
  }

  // Baseline with current values
  const baseValues = variables.map(v => v.current ?? (v.min + v.max) / 2);
  const baseNodes = applyVariables(nodes, variables, baseValues);
  const baseValue = evaluate(baseNodes, edges, feed, objective, economics);

  // Initialize population
  let population: Individual[] = [];
  for (let i = 0; i < populationSize; i++) {
    let vals = i === 0 ? baseValues : randomIndividual(variables);
    if (!satisfiesConstraints(vals, variables, constraints)) {
      vals = randomIndividual(variables);
    }
    const modifiedNodes = applyVariables(nodes, variables, vals);
    population.push({ values: vals, fitness: evaluate(modifiedNodes, edges, feed, objective, economics) });
  }

  const convergenceHistory: number[] = [Math.max(...population.map(p => p.fitness))];

  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.fitness - a.fitness);
    const elite = population.slice(0, Math.max(2, Math.floor(populationSize * 0.2)));
    const newPop: Individual[] = [...elite];

    while (newPop.length < populationSize) {
      const parentA = elite[Math.floor(Math.random() * elite.length)];
      const parentB = elite[Math.floor(Math.random() * elite.length)];
      let childVals = crossover(parentA.values, parentB.values);
      childVals = mutate(childVals, variables);
      if (!satisfiesConstraints(childVals, variables, constraints)) continue;
      const childNodes = applyVariables(nodes, variables, childVals);
      newPop.push({ values: childVals, fitness: evaluate(childNodes, edges, feed, objective, economics) });
    }

    population = newPop;
    convergenceHistory.push(Math.max(...population.map(p => p.fitness)));
  }

  population.sort((a, b) => b.fitness - a.fitness);
  const best = population[0];

  const optimalParams: Record<string, number> = {};
  for (let i = 0; i < variables.length; i++) {
    optimalParams[`${variables[i].node_id}.${variables[i].parameter}`] = best.values[i];
  }

  const improvement = Math.abs(baseValue) > 1e-10
    ? ((best.fitness - baseValue) / Math.abs(baseValue)) * 100
    : 0;

  return {
    optimal_parameters: optimalParams,
    base_value: baseValue,
    optimal_value: best.fitness,
    improvement_pct: improvement,
    convergence_history: convergenceHistory,
  };
}

// ─── Sensitivity analysis ─────────────────────────────────────────────────────

export interface SensitivityResult {
  variable: string;
  node_id: string;
  parameter: string;
  base_value: number;
  range: { value: number; recovery: number; opex: number }[];
  elasticity: number;
}

export function runSensitivityAnalysis(
  nodes: ProcessNode[],
  edges: StreamEdge[],
  feed: FeedInput,
  variable: OptimizationVariable,
  steps = 10,
): SensitivityResult {
  const range: { value: number; recovery: number; opex: number }[] = [];
  const step = (variable.max - variable.min) / steps;

  for (let i = 0; i <= steps; i++) {
    const val = variable.min + i * step;
    const modNodes = applyVariables(nodes, variable ? [variable] : [], [val]);
    const result = solveFlowsheet(modNodes, edges, feed, { maxIterations: 30, tolerance: 1e-3, mode: 'steady_state' });
    range.push({
      value: val,
      recovery: result.globalResults.overall_recovery,
      opex: result.globalResults.total_opex_per_t,
    });
  }

  // Elasticity: %Δrecovery / %Δparam at midpoint
  const mid = Math.floor(steps / 2);
  const deltaRecovery = range[mid + 1]?.recovery - range[mid]?.recovery;
  const deltaParam = range[mid + 1]?.value - range[mid]?.value;
  const baseRecovery = range[mid]?.recovery || 1;
  const baseParam = range[mid]?.value || 1;
  const elasticity = (deltaRecovery / baseRecovery) / (deltaParam / baseParam);

  return {
    variable: `${variable.node_id}.${variable.parameter}`,
    node_id: variable.node_id,
    parameter: variable.parameter,
    base_value: variable.current ?? (variable.min + variable.max) / 2,
    range,
    elasticity,
  };
}
