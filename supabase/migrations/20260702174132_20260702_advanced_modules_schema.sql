/*
# Advanced Modules Schema — CircuitAI, Simulation Pro, GeoMet, MineOpt

## Summary
Adds 5 new tables to support the advanced rewrite of 4 modules:
SimulationPro, CircuitAI, Intelligence GéoMet, and Mine & Optimisation.
All data is scoped per project_id with RLS via authenticated user ownership check.

## New Tables

### sim_circuits
Saved circuit configurations (equipment blocks + parameters) per project.
Each circuit can be activated for simulation runs.

### sim_runs
Persisted simulation run results including all input parameters and computed outputs
(recovery, energy, reagents, annual production, revenue).

### mine_params
Per-project mine design parameters entered by the user:
stripping ratio, slope angles, fleet, costs, reserves, grade, cut-off grade.
UNIQUE on project_id — one active mine param set per project.

### mine_phases
Sequential mining phases per project with ore type, tonnage, grade, years.
Used for LOM scheduling and sequencing visualization.

### circuit_recommendations
AI-scored circuit recommendations generated from LIMS data.
Stores the data snapshot used for scoring and the resulting scores.

## Security
All tables use authenticated-only RLS scoped via:
  project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
*/

-- ── sim_circuits ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sim_circuits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  blocks      jsonb NOT NULL DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_circuits_project_id_idx ON sim_circuits(project_id);
ALTER TABLE sim_circuits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sel_sim_circuits" ON sim_circuits;
CREATE POLICY "sel_sim_circuits" ON sim_circuits FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "ins_sim_circuits" ON sim_circuits;
CREATE POLICY "ins_sim_circuits" ON sim_circuits FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "upd_sim_circuits" ON sim_circuits;
CREATE POLICY "upd_sim_circuits" ON sim_circuits FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "del_sim_circuits" ON sim_circuits;
CREATE POLICY "del_sim_circuits" ON sim_circuits FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── sim_runs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sim_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  circuit_id     uuid REFERENCES sim_circuits(id) ON DELETE SET NULL,
  scenario_name  text NOT NULL,
  p80_um         numeric,
  nacn_kg_t      numeric,
  cao_kg_t       numeric,
  retention_h    numeric,
  recovery_pct   numeric,
  throughput_tph numeric,
  energy_kwh_t   numeric,
  reagent_kg_t   numeric,
  annual_oz      numeric,
  annual_rev_musd numeric,
  notes          text,
  params         jsonb,
  status         text NOT NULL DEFAULT 'completed',
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_runs_project_id_idx ON sim_runs(project_id);
ALTER TABLE sim_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sel_sim_runs" ON sim_runs;
CREATE POLICY "sel_sim_runs" ON sim_runs FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "ins_sim_runs" ON sim_runs;
CREATE POLICY "ins_sim_runs" ON sim_runs FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "del_sim_runs" ON sim_runs;
CREATE POLICY "del_sim_runs" ON sim_runs FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── mine_params ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mine_params (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  method                text NOT NULL DEFAULT 'Open pit',
  stripping_ratio       numeric,
  slope_angle_deg       numeric,
  bench_height_m        numeric,
  trucks                text,
  shovel                text,
  drill                 text,
  lom_years             integer,
  reserves_mt           numeric,
  grade_g_t             numeric,
  cutoff_g_t            numeric,
  mining_cost_t         numeric,
  process_cost_t        numeric,
  ga_cost_t             numeric,
  sustaining_capex_musd_yr numeric,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
ALTER TABLE mine_params ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sel_mine_params" ON mine_params;
CREATE POLICY "sel_mine_params" ON mine_params FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "ins_mine_params" ON mine_params;
CREATE POLICY "ins_mine_params" ON mine_params FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "upd_mine_params" ON mine_params;
CREATE POLICY "upd_mine_params" ON mine_params FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "del_mine_params" ON mine_params;
CREATE POLICY "del_mine_params" ON mine_params FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── mine_phases ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mine_phases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_no     integer NOT NULL,
  name         text NOT NULL,
  area         text,
  ore_type     text,
  year_start   integer,
  year_end     integer,
  ore_mt       numeric,
  waste_mt     numeric,
  grade_g_t    numeric,
  recovery_pct numeric,
  color        text DEFAULT '#F59E0B',
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mine_phases_project_id_idx ON mine_phases(project_id);
ALTER TABLE mine_phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sel_mine_phases" ON mine_phases;
CREATE POLICY "sel_mine_phases" ON mine_phases FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "ins_mine_phases" ON mine_phases;
CREATE POLICY "ins_mine_phases" ON mine_phases FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "upd_mine_phases" ON mine_phases;
CREATE POLICY "upd_mine_phases" ON mine_phases FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "del_mine_phases" ON mine_phases;
CREATE POLICY "del_mine_phases" ON mine_phases FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── circuit_recommendations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS circuit_recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  circuit_code    text NOT NULL,
  circuit_label   text NOT NULL,
  ai_score        numeric,
  recovery_pct    numeric,
  opex_usd_t      numeric,
  co2_t_oz        numeric,
  confidence      text,
  basis           text,
  is_recommended  boolean NOT NULL DEFAULT false,
  data_snapshot   jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS circuit_recs_project_id_idx ON circuit_recommendations(project_id);
ALTER TABLE circuit_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sel_circuit_recs" ON circuit_recommendations;
CREATE POLICY "sel_circuit_recs" ON circuit_recommendations FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "ins_circuit_recs" ON circuit_recommendations;
CREATE POLICY "ins_circuit_recs" ON circuit_recommendations FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "del_circuit_recs" ON circuit_recommendations;
CREATE POLICY "del_circuit_recs" ON circuit_recommendations FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
