/*
# COS — Tables d'ingestion manquantes (L2 → L3)

## Purpose
The COS input-data templates (onglet Ingestion) documented eleven payload
families, but six of them had no table to land in. This migration closes that
gap so plant data can actually be imported rather than only described.

## New Tables
1. **cos_tag_readings**        — §1  real-time OPC-UA / SCADA / historian tags
2. **cos_ore_movements**       — §3.2 weighbridge truck movements mine → stockpile
3. **cos_reagent_consumption** — §5  reagent and utility consumption per period
4. **cos_equipment_events**    — §6  downtime / performance-loss events (CMMS)
5. **cos_work_orders**         — §6.1 corrective / preventive work orders
6. **cos_shifts**              — §7  shift window, crew and targets (+ campaign)

## Conventions
- Timestamps are UTC timestamptz; canonical units per the ingestion contract
  (t dry, m3 pulp, t/h, g/t, mg/L, kWh, kg, kg/t).
- Every measured value carries a quality flag (good | suspect | bad | missing |
  frozen | substitute); `substitute` requires sign-off before financial use
  (AMIRA P754 principle 6).
- Natural keys (tag+ts, movement_id, wo_id, shift_id) are unique per project so
  re-importing the same file is idempotent rather than duplicating rows.

## Security
- RLS enabled on all six tables, scoped to authenticated users via project
  ownership (EXISTS check against projects.user_id = auth.uid())
- 4 CRUD policies per table (SELECT, INSERT, UPDATE, DELETE)
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. cos_tag_readings — §1 tags temps réel
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_tag_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT '',
  asset_path text NOT NULL DEFAULT '',
  tag text NOT NULL,
  unit text NOT NULL DEFAULT '',
  ts timestamptz NOT NULL,
  value numeric,
  quality text NOT NULL DEFAULT 'good',
  confidence numeric,
  lineage text,
  note text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, tag, ts)
);

CREATE INDEX IF NOT EXISTS idx_cos_tag_readings_lookup
  ON cos_tag_readings(project_id, tag, ts DESC);

ALTER TABLE cos_tag_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_tag_readings" ON cos_tag_readings;
CREATE POLICY "select_cos_tag_readings" ON cos_tag_readings FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_tag_readings.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_tag_readings" ON cos_tag_readings;
CREATE POLICY "insert_cos_tag_readings" ON cos_tag_readings FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_tag_readings.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_tag_readings" ON cos_tag_readings;
CREATE POLICY "update_cos_tag_readings" ON cos_tag_readings FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_tag_readings.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_tag_readings.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_tag_readings" ON cos_tag_readings;
CREATE POLICY "delete_cos_tag_readings" ON cos_tag_readings FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_tag_readings.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 2. cos_ore_movements — §3.2 ponts-bascules
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_ore_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  movement_id text NOT NULL,
  ts timestamptz NOT NULL,
  from_location text NOT NULL DEFAULT '',
  to_location text NOT NULL DEFAULT '',
  lot_id text,
  tonnage_wet_t numeric,
  moisture_pct numeric,
  tonnage_dry_t numeric,
  truck_id text,
  operator text,
  quality text NOT NULL DEFAULT 'good',
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, movement_id)
);

CREATE INDEX IF NOT EXISTS idx_cos_ore_movements_lookup
  ON cos_ore_movements(project_id, ts DESC);

ALTER TABLE cos_ore_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_ore_movements" ON cos_ore_movements;
CREATE POLICY "select_cos_ore_movements" ON cos_ore_movements FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_movements.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_ore_movements" ON cos_ore_movements;
CREATE POLICY "insert_cos_ore_movements" ON cos_ore_movements FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_movements.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_ore_movements" ON cos_ore_movements;
CREATE POLICY "update_cos_ore_movements" ON cos_ore_movements FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_movements.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_movements.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_ore_movements" ON cos_ore_movements;
CREATE POLICY "delete_cos_ore_movements" ON cos_ore_movements FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ore_movements.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 3. cos_reagent_consumption — §5 réactifs & utilités
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_reagent_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT '',
  asset_path text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'reagent',      -- reagent | utility
  name text NOT NULL,                        -- NaCN, CaO_lime, electricity, ...
  period_from timestamptz,
  period_to timestamptz,
  consumed_qty numeric,
  consumed_unit text NOT NULL DEFAULT 'kg',  -- kg | Nm3 | kWh | m3
  dose_kg_t numeric,
  stock_t numeric,
  quality text NOT NULL DEFAULT 'good',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cos_reagent_consumption_lookup
  ON cos_reagent_consumption(project_id, name, period_to DESC);

ALTER TABLE cos_reagent_consumption ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_reagent_consumption" ON cos_reagent_consumption;
CREATE POLICY "select_cos_reagent_consumption" ON cos_reagent_consumption FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reagent_consumption.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_reagent_consumption" ON cos_reagent_consumption;
CREATE POLICY "insert_cos_reagent_consumption" ON cos_reagent_consumption FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reagent_consumption.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_reagent_consumption" ON cos_reagent_consumption;
CREATE POLICY "update_cos_reagent_consumption" ON cos_reagent_consumption FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reagent_consumption.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reagent_consumption.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_reagent_consumption" ON cos_reagent_consumption;
CREATE POLICY "delete_cos_reagent_consumption" ON cos_reagent_consumption FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_reagent_consumption.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 4. cos_equipment_events — §6 événements & arrêts (CMMS)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_equipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT '',
  event_id text NOT NULL,
  asset_path text NOT NULL DEFAULT '',
  equipment_tag text,
  event_type text NOT NULL DEFAULT 'downtime',  -- downtime | performance_loss | other
  severity text NOT NULL DEFAULT 'low',         -- urgent | high | medium | low
  reason_code text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_min numeric,
  description text,
  work_order_id text,
  operator text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_cos_equipment_events_lookup
  ON cos_equipment_events(project_id, started_at DESC);

ALTER TABLE cos_equipment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_equipment_events" ON cos_equipment_events;
CREATE POLICY "select_cos_equipment_events" ON cos_equipment_events FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_events.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_equipment_events" ON cos_equipment_events;
CREATE POLICY "insert_cos_equipment_events" ON cos_equipment_events FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_events.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_equipment_events" ON cos_equipment_events;
CREATE POLICY "update_cos_equipment_events" ON cos_equipment_events FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_events.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_events.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_equipment_events" ON cos_equipment_events;
CREATE POLICY "delete_cos_equipment_events" ON cos_equipment_events FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_equipment_events.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 5. cos_work_orders — §6.1 ordres de travail
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT '',
  wo_id text NOT NULL,
  asset_path text NOT NULL DEFAULT '',
  wo_type text NOT NULL DEFAULT 'corrective',   -- corrective | preventive | predictive
  priority numeric,
  created_at_src timestamptz,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'planned',       -- planned | in_progress | closed | cancelled
  assignee text,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, wo_id)
);

CREATE INDEX IF NOT EXISTS idx_cos_work_orders_lookup
  ON cos_work_orders(project_id, scheduled_at DESC);

ALTER TABLE cos_work_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_work_orders" ON cos_work_orders;
CREATE POLICY "select_cos_work_orders" ON cos_work_orders FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_work_orders.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_work_orders" ON cos_work_orders;
CREATE POLICY "insert_cos_work_orders" ON cos_work_orders FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_work_orders.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_work_orders" ON cos_work_orders;
CREATE POLICY "update_cos_work_orders" ON cos_work_orders FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_work_orders.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_work_orders.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_work_orders" ON cos_work_orders;
CREATE POLICY "delete_cos_work_orders" ON cos_work_orders FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_work_orders.project_id AND projects.user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- 6. cos_shifts — §7 contexte opérationnel (quarts / campagnes)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shift_id text NOT NULL,
  shift_type text NOT NULL DEFAULT 'day',       -- day | night
  tz text NOT NULL DEFAULT 'UTC',
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  campaign_id text,
  campaign_strategy text,
  supervisor text,
  crew jsonb NOT NULL DEFAULT '[]',
  target_throughput_t_h numeric,
  target_recovery_pct numeric,
  target_au_oz numeric,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, shift_id)
);

CREATE INDEX IF NOT EXISTS idx_cos_shifts_lookup
  ON cos_shifts(project_id, start_time DESC);

ALTER TABLE cos_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_shifts" ON cos_shifts;
CREATE POLICY "select_cos_shifts" ON cos_shifts FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_shifts.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_shifts" ON cos_shifts;
CREATE POLICY "insert_cos_shifts" ON cos_shifts FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_shifts.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_shifts" ON cos_shifts;
CREATE POLICY "update_cos_shifts" ON cos_shifts FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_shifts.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_shifts.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_shifts" ON cos_shifts;
CREATE POLICY "delete_cos_shifts" ON cos_shifts FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_shifts.project_id AND projects.user_id = auth.uid()));
