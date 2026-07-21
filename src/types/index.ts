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
  | 'flowsheet'
  | 'massbalance'
  | 'equipment'
  | 'circuitai'
  | 'simulation'
  | 'geomet'
  | 'mineopt'
  | 'economics'
  | 'risks'
  | 'ni43101'
  | 'reports';

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

export interface FlowsheetNode {
  id: string;
  op_code: string;
  label: string;
  parent: string | null;
  x?: number;
  y?: number;
}

export interface FlowsheetTemplate {
  code: string;
  family: string;
  name: string;
  description?: string;
  nodes: FlowsheetNode[];
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
