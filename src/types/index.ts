export type ProjectPhase =
  | 'SCOPING'
  | 'PRE-FEASIBILITY'
  | 'FEASIBILITY'
  | 'BFS'
  | 'DFS'
  | 'CONSTRUCTION'
  | 'COMMISSIONING';

export interface Project {
  id: string;
  code: string;
  name: string;
  country: string;
  phase: ProjectPhase;
  target_tph: number;
  gold_grade_g_t: number;
  availability_pct: number;
  recovery_pct: number;
  ore_sg: number;
  gold_price_usd: number;
  annual_tonnes: number;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface Risk {
  id: string;
  project_id: string;
  description: string;
  category: string;
  mitigation?: string;
  probability: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  status: 'open' | 'mitigated' | 'closed';
  created_at: string;
}

export interface LimsSample {
  id: string;
  project_id: string;
  sample_id: string;
  campaign: string;
  domain?: string;
  test_type: string;
  result_value?: number;
  result_unit?: string;
  status: 'pending' | 'passed' | 'failed' | 'flagged';
  created_at: string;
}

export interface EquipmentItem {
  id: string;
  project_id: string;
  tag: string;
  name: string;
  category: string;
  sub_category?: string;
  capacity?: number;
  capacity_unit?: string;
  power_kw?: number;
  status: 'proposed' | 'ordered' | 'installed' | 'operating';
  created_at: string;
}

export type Page =
  | 'dashboard'
  | 'stagegates'
  | 'lims'
  | 'blockmodel'
  | 'analytics'
  | 'granulometry'
  | 'criteria'
  | 'metparams'
  | 'flowsheet'
  | 'massbalance'
  | 'equipment'
  | 'simulation'
  | 'geomet'
  | 'mineopt'
  | 'plantopt'
  | 'economics'
  | 'risks'
  | 'ni43101'
  | 'reports'
  | 'drilling'
  | 'resource'
  | 'montecarlo';

// ─── Forages (Phase A : ingestion terrain) ──────────────────────────────────
// Lignes Supabase des 4 tables de forage (voir migration 20260805180000).

export interface DhCollarRow {
  id: string;
  project_id: string;
  hole_id: string;
  x: number;
  y: number;
  z: number;
  max_depth: number | null;
  hole_type: string;
  diameter: string | null;
  drilled_on: string | null;
  notes: string | null;
  created_at: string;
}

export interface DhSurveyRow {
  id: string;
  project_id: string;
  hole_id: string;
  depth: number;
  azimuth: number;
  dip: number;
  created_at: string;
}

export interface DhLithoRow {
  id: string;
  project_id: string;
  hole_id: string;
  from_m: number;
  to_m: number;
  lithology: string | null;
  alteration: string | null;
  mineralization: string | null;
  created_at: string;
}

export interface DhAssayRow {
  id: string;
  project_id: string;
  hole_id: string;
  from_m: number;
  to_m: number;
  element: string;
  value: number | null;
  unit: string;
  lab_job: string | null;
  qaqc_type: string;
  created_at: string;
}

export interface ProjectMetalRow {
  id: string;
  project_id: string;
  symbol: string;
  name: string | null;
  grade: number | null;
  grade_unit: string;
  price_usd: number | null;
  price_unit: string;
  recovery_pct: number | null;
  payable_pct: number;
  is_primary: boolean;
  is_payable: boolean;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceRunRow {
  id: string;
  project_id: string;
  name: string;
  element: string;
  method: string;
  composite_length_m: number;
  block_x: number;
  block_y: number;
  block_z: number;
  search_radius_m: number;
  max_samples: number;
  min_samples: number;
  variogram: { type: string; nugget: number; sill: number; range: number } | null;
  classification: unknown | null;
  summary: {
    nBlocks: number;
    classCounts: Record<string, number>;
    gradeTonnage: { cutoff: number; tonnes: number; meanGrade: number; metal: number }[];
    crossValidation: { n: number; meanError: number; rmse: number; correlation: number | null } | null;
    /** Absent sur les runs enregistrés avant l'ajout de la traçabilité des seuils/écart-type. */
    compositeStats?: { n: number; mean: number; stdev: number; cv: number };
    thresholds?: { measured: { maxDistance: number; minSamples: number; minHoles: number }; indicated: { maxDistance: number; minSamples: number; minHoles: number }; inferred: { maxDistance: number } };
    cutoffs?: number[];
  } | null;
  is_effective: boolean;
  effective_date: string | null;
  created_at: string;
}

export interface NavItem {
  id: Page;
  label: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface MassBalanceStream {
  id: string;
  name: string;
  source: string;
  destination: string;
  mass_tph: number;
  solids_pct: number;
  au_g_t: number;
  cu_pct?: number;
  recovery_pct?: number;
}

export interface SimRun {
  id: string;
  timestamp: string;
  scenario: string;
  recovery_pct: number;
  throughput_tph: number;
  energy_kwh_t: number;
  reagent_kg_t: number;
  annual_oz: number;
  status: 'completed' | 'running' | 'failed';
}

export interface CapexLine {
  category: string;
  description: string;
  value_musd: number;
  pct: number;
}

export interface OpexLine {
  category: string;
  value_usd_t: number;
  pct: number;
  color: string;
}

export interface StageGate {
  id: string;
  name: string;
  phase: ProjectPhase;
  status: 'completed' | 'active' | 'locked';
  completion_pct: number;
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  required: boolean;
}

export interface FiscalRegime {
  id: string;
  country: string;
  region: string | null;
  regime_group: string;
  corp_tax_pct: number;
  mining_tax_pct: number;
  royalty_pct: number;
  depletion_pct: number;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface ReportDocument {
  id: string;
  project_id: string;
  title: string;
  report_type: 'ni43101' | 'internal' | 'monthly' | 'technical' | 'budget' | 'water' | 'lims' | 'risk' | 'flowsheet' | 'economics';
  status: 'draft' | 'generated' | 'validated' | 'published';
  sections_total: number;
  sections_completed: number;
  pages_estimated: number;
  author_name: string | null;
  content_snapshot: Record<string, unknown> | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonteCarloConfig {
  id: string;
  project_id: string;
  iterations: number;
  bins: number;
  seed: number | null;
  distribution_method: 'empirical' | 'fitted' | 'triangular';
}
