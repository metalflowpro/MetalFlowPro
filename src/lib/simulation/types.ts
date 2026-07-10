// ─── Core domain types for the simulation engine ────────────────────────────

export type OreType = 'free_milling' | 'refractory' | 'sulphide' | 'oxide';
export type FlowsheetStatus = 'draft' | 'calibrated' | 'validated' | 'archived';
export type SimMode = 'steady_state' | 'dynamic';
export type RunStatus = 'running' | 'completed' | 'failed' | 'converged' | 'diverged';
export type StreamType = 'solid' | 'liquid' | 'pulp' | 'gas' | 'solution';
export type UnitCategory =
  | 'Comminution'
  | 'Lixiviation'
  | 'ADR'
  | 'Électrométallurgie'
  | 'Séparation S/L'
  | 'Effluents'
  | 'Utilitaires';

// ─── Flowsheet & nodes ───────────────────────────────────────────────────────

export interface SimFlowsheet {
  id: string;
  project_id: string;
  name: string;
  version: number;
  status: FlowsheetStatus;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessNode {
  id: string;
  flowsheet_id: string;
  project_id: string;
  unit_type: string;
  label: string;
  position_x: number;
  position_y: number;
  parameters: Record<string, number | string>;
  design_capacity?: number;
  availability_pct?: number;
  results?: NodeResult | null;
}

export interface StreamEdge {
  id: string;
  flowsheet_id: string;
  project_id: string;
  source_node_id: string;
  target_node_id: string;
  stream_type: StreamType;
  stream_label?: string;
  results?: StreamResult | null;
}

// ─── Simulation inputs & outputs ─────────────────────────────────────────────

export interface FeedInput {
  feed_rate: number;        // t/h
  gold_grade: number;       // g/t
  silver_grade: number;     // g/t
  p80: number;              // µm
  hardness_bwi: number;     // kWh/t
  ore_type: OreType;
  sulphide_content: number; // %
  carbon_content: number;   // %
  moisture: number;         // %
}

export interface StreamResult {
  edge_id: string;
  mass_flow: number;           // t/h
  volume_flow: number;         // m³/h
  solids_content: number;      // %
  gold_grade: number;          // g/t
  gold_flow: number;           // kg/h
  dissolved_gold: number;      // mg/L
  cyanide_concentration: number; // ppm
  pH: number;
  temperature: number;         // °C
}

export interface NodeResult {
  node_id: string;
  feed_rate: number;
  product_rate: number;
  recovery: number;
  energy_consumption: number;
  reagent_consumptions: Record<string, number>;
  utilization_rate: number;
  is_bottleneck: boolean;
  kpis: Record<string, number>;
}

export interface GlobalResults {
  overall_recovery: number;
  dore_production_kg_h: number;
  total_opex_per_t: number;
  total_energy_kwh_t: number;
  cyanide_consumption: number;
  lime_consumption: number;
  tails_grade: number;
  cn_in_tailings: number;
  bottleneck_node_id: string | null;
  capacity_utilization: Record<string, number>;
}

export interface SimRunResult {
  id: string;
  flowsheet_id: string;
  project_id: string;
  mode: SimMode;
  feed_input: FeedInput;
  status: RunStatus;
  iterations: number;
  convergence_error: number;
  scenario_label?: string;
  global_results?: GlobalResults;
  node_results?: Record<string, NodeResult>;
  stream_results?: Record<string, StreamResult>;
  created_at: string;
}

// ─── Unit library types ───────────────────────────────────────────────────────

export interface ParameterDef {
  label: string;
  unit?: string;
  default: number | string;
  min?: number;
  max?: number;
  type: 'number' | 'select' | 'text';
  options?: string[];
  description?: string;
}

export interface UnitOutput {
  outStreams: Partial<StreamResult>[];
  nodeResult: Partial<NodeResult>;
}

export interface UnitDefinition {
  unitType: string;
  displayName: string;
  category: UnitCategory;
  icon: string;
  color: string;
  defaultParameters: Record<string, ParameterDef>;
  maxInputs: number;
  maxOutputs: number;
  calculate(inputs: StreamResult[], params: Record<string, number | string>, design_capacity?: number): UnitOutput;
}

// ─── Optimization types ───────────────────────────────────────────────────────

export type OptimizationObjective =
  | 'maximize_recovery'
  | 'minimize_opex'
  | 'maximize_npv'
  | 'pareto';

export interface OptimizationVariable {
  node_id: string;
  parameter: string;
  min: number;
  max: number;
  current?: number;
}

export interface Constraint {
  type: string;
  node_id: string;
  parameter: string;
  operator: '<' | '>' | '<=' | '>=' | '=';
  value: number;
}

export interface OptimizationResults {
  optimal_parameters: Record<string, number>;
  base_value: number;
  optimal_value: number;
  improvement_pct: number;
  convergence_history: number[];
  pareto_front?: { recovery: number; opex: number }[];
}

// ─── Expansion scenarios ──────────────────────────────────────────────────────

export interface ScenarioModification {
  node_id?: string;
  modification_type: 'upsize' | 'add_unit' | 'change_param';
  parameter?: string;
  new_value?: number;
  capex_estimate: number;
  description: string;
}

export interface ScenarioEconomics {
  capex_total: number;
  opex_delta_per_tonne: number;
  additional_oz_per_year: number;
  npv_8pct: number;
  irr: number;
  payback_years: number;
  aisc_per_oz: number;
  gold_price_sensitivity: Record<string, number>;
}

export interface ExpansionScenario {
  id: string;
  flowsheet_id: string;
  project_id: string;
  label: string;
  target_increase_pct: number;
  modifications: ScenarioModification[];
  economics?: ScenarioEconomics;
  run_id?: string;
  created_at: string;
}

// ─── Bottleneck analysis ──────────────────────────────────────────────────────

export interface BottleneckResult {
  node_id: string;
  node_label: string;
  utilization_pct: number;
  is_bottleneck: boolean;
  severity: 'ok' | 'warning' | 'critical';
  max_throughput_constraint: number;
  recommended_action: string;
}
