/*
# Cognitive Operating System (COS) Schema

## Purpose
Stores real-time plant operating data for the COS module: equipment health,
ore blending, metallurgical reconciliation (AMIRA P754), alerts, and
recommendation workflow.

## New Tables

1. **cos_equipment_status** — per-equipment real-time state, health index, RUL
2. **cos_ore_lots** — ore parcels with grade, hardness, mineralogy
3. **cos_stockpiles** — stockpile composition and tonnage
4. **cos_blend_plans** — shift-level blend plans with predictions
5. **cos_blend_sources** — source proportions within a blend plan
6. **cos_streams** — process flow graph nodes (mass, grade, flow)
7. **cos_reconciliation_periods** — shift/day/campaign reconciliation runs
8. **cos_reconciliation_lines** — per-stream reconciliation data
9. **cos_alerts** — prioritized, grouped alerts with escalation
10. **cos_recommendations** — optimization recommendations with approval workflow
11. **cos_operator_actions** — executed actions linked to recommendations

## Security
- RLS enabled on all tables, scoped to authenticated users via project ownership
  (EXISTS check against projects.user_id = auth.uid())
- 4 CRUD policies per table (SELECT, INSERT, UPDATE, DELETE)
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. cos_equipment_status
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_equipment_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  equipment_tag text NOT NULL,
  equipment_name text NOT NULL,
  section text NOT NULL DEFAULT 'general',
  state text NOT NULL DEFAULT 'idle',  -- running, idle, maintenance, fault
  load_pct numeric DEFAULT 0,
  availability_pct numeric DEFAULT 0,
  utilization_pct numeric DEFAULT 0,
  mtbf_h numeric DEFAULT 0,
  mttr_h numeric DEFAULT 0,
  oee_pct numeric DEFAULT 0,
  health_index numeric DEFAULT 100,    -- 0-100 composite
  rul_h numeric,                       -- remaining useful life in hours
  failure_prob_24h numeric DEFAULT 0,
  failure_prob_72h numeric DEFAULT 0,
  failure_prob_168h numeric DEFAULT 0,
  is_bottleneck boolean DEFAULT false,
  downtime_reason text,
  health_components jsonb DEFAULT '{}', -- {vibration, temperature, current, lubrication, flow_pressure}
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, equipment_tag)
);

ALTER TABLE cos_equipment_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_equipment_status" ON cos_equipment_status;
CREATE POLICY "select_cos_equipment_status" ON cos_equipment_status FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_status.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_equipment_status" ON cos_equipment_status;
CREATE POLICY "insert_cos_equipment_status" ON cos_equipment_status FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_status.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_equipment_status" ON cos_equipment_status;
CREATE POLICY "update_cos_equipment_status" ON cos_equipment_status FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_status.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_status.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_equipment_status" ON cos_equipment_status;
CREATE POLICY "delete_cos_equipment_status" ON cos_equipment_status FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_status.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 2. cos_ore_lots
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_ore_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lot_id text NOT NULL,                -- source/panel identifier
  source_name text NOT NULL,
  au_g_t numeric NOT NULL DEFAULT 0,
  spi numeric,                         -- SAG Power Index
  bwi numeric,                         -- Bond Work Index
  sulfides_pct numeric DEFAULT 0,
  arsenic_ppm numeric DEFAULT 0,
  organic_carbon_pct numeric DEFAULT 0, -- PRC indicator
  clay_pct numeric DEFAULT 0,
  tonnage_t numeric NOT NULL DEFAULT 0,
  stockpile_id text,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, lot_id)
);

ALTER TABLE cos_ore_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_ore_lots" ON cos_ore_lots;
CREATE POLICY "select_cos_ore_lots" ON cos_ore_lots FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_lots.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_ore_lots" ON cos_ore_lots;
CREATE POLICY "insert_cos_ore_lots" ON cos_ore_lots FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_lots.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_ore_lots" ON cos_ore_lots;
CREATE POLICY "update_cos_ore_lots" ON cos_ore_lots FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_lots.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_lots.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_ore_lots" ON cos_ore_lots;
CREATE POLICY "delete_cos_ore_lots" ON cos_ore_lots FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_lots.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 3. cos_stockpiles
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_stockpiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  current_tonnage_t numeric DEFAULT 0,
  blended_au_g_t numeric DEFAULT 0,
  blended_bwi numeric,
  blended_sulfides_pct numeric DEFAULT 0,
  blended_prc_pct numeric DEFAULT 0,
  reclaim_rate_tph numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id, name)
);

ALTER TABLE cos_stockpiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_stockpiles" ON cos_stockpiles;
CREATE POLICY "select_cos_stockpiles" ON cos_stockpiles FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_stockpiles.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_stockpiles" ON cos_stockpiles;
CREATE POLICY "insert_cos_stockpiles" ON cos_stockpiles FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_stockpiles.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_stockpiles" ON cos_stockpiles;
CREATE POLICY "update_cos_stockpiles" ON cos_stockpiles FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_stockpiles.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_stockpiles.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_stockpiles" ON cos_stockpiles;
CREATE POLICY "delete_cos_stockpiles" ON cos_stockpiles FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_stockpiles.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 4. cos_blend_plans
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_blend_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shift_label text NOT NULL,           -- e.g. "2026-07-22 Matin"
  target_tph numeric NOT NULL,
  target_au_g_t numeric NOT NULL,
  predicted_au_g_t numeric,
  predicted_recovery_pct numeric,
  predicted_throughput_tph numeric,
  predicted_nacn_kg_t numeric,
  predicted_cao_kg_t numeric,
  status text NOT NULL DEFAULT 'proposed', -- proposed, approved, executed, reconciled
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cos_blend_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_blend_plans" ON cos_blend_plans;
CREATE POLICY "select_cos_blend_plans" ON cos_blend_plans FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_plans.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_blend_plans" ON cos_blend_plans;
CREATE POLICY "insert_cos_blend_plans" ON cos_blend_plans FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_plans.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_blend_plans" ON cos_blend_plans;
CREATE POLICY "update_cos_blend_plans" ON cos_blend_plans FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_plans.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_plans.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_blend_plans" ON cos_blend_plans;
CREATE POLICY "delete_cos_blend_plans" ON cos_blend_plans FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_plans.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 5. cos_blend_sources
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_blend_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  blend_plan_id uuid NOT NULL REFERENCES cos_blend_plans(id) ON DELETE CASCADE,
  ore_lot_id uuid REFERENCES cos_ore_lots(id) ON DELETE SET NULL,
  lot_id text NOT NULL,
  source_name text NOT NULL,
  proportion_pct numeric NOT NULL,
  tph numeric NOT NULL,
  au_g_t numeric NOT NULL,
  bwi numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cos_blend_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_blend_sources" ON cos_blend_sources;
CREATE POLICY "select_cos_blend_sources" ON cos_blend_sources FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_sources.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_blend_sources" ON cos_blend_sources;
CREATE POLICY "insert_cos_blend_sources" ON cos_blend_sources FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_sources.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_blend_sources" ON cos_blend_sources;
CREATE POLICY "update_cos_blend_sources" ON cos_blend_sources FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_sources.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_sources.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_blend_sources" ON cos_blend_sources;
CREATE POLICY "delete_cos_blend_sources" ON cos_blend_sources FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_blend_sources.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 6. cos_streams
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stream_id text NOT NULL,             -- e.g. "FEED", "TAIL", "CONC", "DORE"
  name text NOT NULL,
  section text NOT NULL DEFAULT 'general',
  stream_type text NOT NULL DEFAULT 'intermediate', -- feed, intermediate, product, tail, reagent
  mass_tph numeric DEFAULT 0,
  solids_pct numeric DEFAULT 100,
  au_g_t numeric DEFAULT 0,
  moisture_pct numeric DEFAULT 0,
  density_t_m3 numeric,
  data_quality text DEFAULT 'good',    -- good, suspect, missing, frozen, out_of_range
  confidence_score numeric DEFAULT 1.0,
  is_provisional boolean DEFAULT false,
  last_updated timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, stream_id)
);

ALTER TABLE cos_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_streams" ON cos_streams;
CREATE POLICY "select_cos_streams" ON cos_streams FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_streams.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_streams" ON cos_streams;
CREATE POLICY "insert_cos_streams" ON cos_streams FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_streams.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_streams" ON cos_streams;
CREATE POLICY "update_cos_streams" ON cos_streams FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_streams.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_streams.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_streams" ON cos_streams;
CREATE POLICY "delete_cos_streams" ON cos_streams FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_streams.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 7. cos_reconciliation_periods
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_reconciliation_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period_type text NOT NULL,           -- shift, day, campaign
  period_label text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  feed_mass_t numeric DEFAULT 0,
  feed_au_g_t numeric DEFAULT 0,
  product_mass_t numeric DEFAULT 0,
  product_au_g_t numeric DEFAULT 0,
  tail_mass_t numeric DEFAULT 0,
  tail_au_g_t numeric DEFAULT 0,
  feed_metal_g numeric DEFAULT 0,
  product_metal_g numeric DEFAULT 0,
  tail_metal_g numeric DEFAULT 0,
  delta_stock_g numeric DEFAULT 0,
  unaccounted_metal_pct numeric DEFAULT 0,
  recovery_pct numeric DEFAULT 0,
  variance_pct numeric DEFAULT 0,
  bias_flag boolean DEFAULT false,
  has_provisional_data boolean DEFAULT false,
  status text DEFAULT 'draft',         -- draft, validated, published
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cos_reconciliation_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_recon_periods" ON cos_reconciliation_periods;
CREATE POLICY "select_cos_recon_periods" ON cos_reconciliation_periods FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_periods.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_recon_periods" ON cos_reconciliation_periods;
CREATE POLICY "insert_cos_recon_periods" ON cos_reconciliation_periods FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_periods.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_recon_periods" ON cos_reconciliation_periods;
CREATE POLICY "update_cos_recon_periods" ON cos_reconciliation_periods FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_periods.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_periods.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_recon_periods" ON cos_reconciliation_periods;
CREATE POLICY "delete_cos_recon_periods" ON cos_reconciliation_periods FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_periods.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 8. cos_reconciliation_lines
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_reconciliation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reconciliation_id uuid NOT NULL REFERENCES cos_reconciliation_periods(id) ON DELETE CASCADE,
  stream_id text NOT NULL,
  stream_name text NOT NULL,
  mass_t numeric DEFAULT 0,
  au_g_t numeric DEFAULT 0,
  metal_g numeric DEFAULT 0,
  is_provisional boolean DEFAULT false,
  uncertainty_pct numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cos_reconciliation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_recon_lines" ON cos_reconciliation_lines;
CREATE POLICY "select_cos_recon_lines" ON cos_reconciliation_lines FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_lines.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_recon_lines" ON cos_reconciliation_lines;
CREATE POLICY "insert_cos_recon_lines" ON cos_reconciliation_lines FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_lines.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_recon_lines" ON cos_reconciliation_lines;
CREATE POLICY "update_cos_recon_lines" ON cos_reconciliation_lines FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_lines.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_lines.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_recon_lines" ON cos_reconciliation_lines;
CREATE POLICY "delete_cos_recon_lines" ON cos_reconciliation_lines FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reconciliation_lines.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 9. cos_alerts
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alert_type text NOT NULL,            -- bottleneck, anomaly, drift, threshold, predictive
  severity text NOT NULL DEFAULT 'medium', -- urgent, high, medium, low
  entity text NOT NULL,                -- equipment tag or stream id
  entity_name text,
  domain text,                         -- grinding, leaching, blending, etc.
  cause text,
  description text,
  status text NOT NULL DEFAULT 'active', -- active, acknowledged, resolved, suppressed
  escalated_to text,                   -- operator, shift_boss, metallurgist, maintenance
  evidence jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz
);

ALTER TABLE cos_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_alerts" ON cos_alerts;
CREATE POLICY "select_cos_alerts" ON cos_alerts FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_alerts.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_alerts" ON cos_alerts;
CREATE POLICY "insert_cos_alerts" ON cos_alerts FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_alerts.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_alerts" ON cos_alerts;
CREATE POLICY "update_cos_alerts" ON cos_alerts FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_alerts.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_alerts.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_alerts" ON cos_alerts;
CREATE POLICY "delete_cos_alerts" ON cos_alerts FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_alerts.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 10. cos_recommendations
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  domain text NOT NULL,                -- grinding, leaching, blending, adsorption, elution
  objective text NOT NULL,
  description text,
  actions jsonb DEFAULT '[]',           -- [{setpoint, value, unit, within_corridor: [min, max]}]
  expected_delta jsonb DEFAULT '{}',    -- {throughput: "+3.2%", recovery: "+0.1%"}
  confidence numeric DEFAULT 0.5,
  evidence jsonb DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending_approval', -- pending_approval, approved, rejected, applied, verified, expired
  approved_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  verified_at timestamptz,
  result_notes text,
  priority integer DEFAULT 3,          -- 1 (highest) to 5 (lowest)
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cos_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_reco" ON cos_recommendations;
CREATE POLICY "select_cos_reco" ON cos_recommendations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_recommendations.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_reco" ON cos_recommendations;
CREATE POLICY "insert_cos_reco" ON cos_recommendations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_recommendations.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_reco" ON cos_recommendations;
CREATE POLICY "update_cos_reco" ON cos_recommendations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_recommendations.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_recommendations.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_reco" ON cos_recommendations;
CREATE POLICY "delete_cos_reco" ON cos_recommendations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_recommendations.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 11. cos_operator_actions
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_operator_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES cos_recommendations(id) ON DELETE SET NULL,
  operator_name text NOT NULL,
  setpoints_applied jsonb DEFAULT '[]',
  result text,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE cos_operator_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_actions" ON cos_operator_actions;
CREATE POLICY "select_cos_actions" ON cos_operator_actions FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_operator_actions.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_actions" ON cos_operator_actions;
CREATE POLICY "insert_cos_actions" ON cos_operator_actions FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_operator_actions.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_actions" ON cos_operator_actions;
CREATE POLICY "update_cos_actions" ON cos_operator_actions FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_operator_actions.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_operator_actions.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_actions" ON cos_operator_actions;
CREATE POLICY "delete_cos_actions" ON cos_operator_actions FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_operator_actions.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_cos_eq_status_proj ON cos_equipment_status(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_ore_lots_proj ON cos_ore_lots(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_stockpiles_proj ON cos_stockpiles(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_blend_plans_proj ON cos_blend_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_blend_sources_proj ON cos_blend_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_streams_proj ON cos_streams(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_recon_periods_proj ON cos_reconciliation_periods(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_recon_lines_proj ON cos_reconciliation_lines(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_alerts_proj ON cos_alerts(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_reco_proj ON cos_recommendations(project_id);
CREATE INDEX IF NOT EXISTS idx_cos_actions_proj ON cos_operator_actions(project_id);
