/*
# Granulométrie — Historique des optimisations P80

## Purpose
Audit trail for the P80 Optimization section: every simulation run stores the
full input parameters and the computed outputs (lab target, plant P80,
selected scenario, per-circuit recommendations), satisfying the acceptance
criterion "conserve l'historique et l'audit des paramètres utilisés".

## New Tables
1. **p80_optimization_runs** — one row per simulation run

## Security
- RLS enabled, scoped to authenticated users via project ownership
  (EXISTS check against projects.user_id = auth.uid())
- 4 CRUD policies (SELECT, INSERT, UPDATE, DELETE)
*/

CREATE TABLE IF NOT EXISTS p80_optimization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  p80_lims_um numeric,
  p80_target_lab_um numeric NOT NULL,
  p80_optimal_plant_um numeric NOT NULL,
  k_indus numeric NOT NULL,
  k_indus_mode text NOT NULL DEFAULT 'default',
  specific_energy_kwh_t numeric NOT NULL,
  total_power_kw numeric,
  scenario_selected text NOT NULL,
  confidence_level text NOT NULL DEFAULT 'low',
  inputs jsonb NOT NULL DEFAULT '{}',
  results jsonb NOT NULL DEFAULT '{}',
  comment text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_p80_runs_project ON p80_optimization_runs(project_id, created_at DESC);

ALTER TABLE p80_optimization_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_p80_optimization_runs" ON p80_optimization_runs;
CREATE POLICY "select_p80_optimization_runs" ON p80_optimization_runs FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = p80_optimization_runs.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_p80_optimization_runs" ON p80_optimization_runs;
CREATE POLICY "insert_p80_optimization_runs" ON p80_optimization_runs FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = p80_optimization_runs.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_p80_optimization_runs" ON p80_optimization_runs;
CREATE POLICY "update_p80_optimization_runs" ON p80_optimization_runs FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = p80_optimization_runs.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = p80_optimization_runs.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_p80_optimization_runs" ON p80_optimization_runs;
CREATE POLICY "delete_p80_optimization_runs" ON p80_optimization_runs FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = p80_optimization_runs.project_id AND projects.user_id = auth.uid()));
