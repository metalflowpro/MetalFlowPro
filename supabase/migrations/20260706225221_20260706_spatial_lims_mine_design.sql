/*
# Spatial LIMS + Mine Design Plan

## Changes

### 1. Extended lims_samples — spatial collar fields
Adds coordinate and drillhole fields to lims_samples so the spatial
distribution tab can plot collar maps, cross-sections, and depth histograms.

New nullable columns:
- `hole_id`      — drillhole identifier (e.g. "DDH-001")
- `x_coord`      — easting (m)
- `y_coord`      — northing (m)
- `elevation`    — collar elevation (mRL)
- `dip_deg`      — drillhole dip in degrees (negative = downward)
- `azimuth_deg`  — drillhole azimuth (0–360°)
- `length_m`     — total drillhole length (m)
- `drill_type`   — e.g. "DDH", "RC", "AC", "RAB"

### 2. New table: mine_design_pits
Stores designed pit shells / push-backs per project. Each row represents
one named pit phase with its geometry summary and bench stack.

Columns:
- `id`, `project_id`
- `name`            — e.g. "Phase 1 – Pit Shell A"
- `pit_type`        — 'open_pit' | 'underground'
- `crest_rl`        — crest elevation (mRL)
- `floor_rl`        — pit floor elevation (mRL)
- `bench_height_m`  — individual bench height
- `berm_width_m`    — safety berm width
- `slope_angle_deg` — overall pit wall angle
- `ore_mt`          — ore tonnes (Mt)
- `waste_mt`        — waste tonnes (Mt)
- `grade_g_t`       — average grade (g/t Au)
- `strip_ratio`     — waste:ore ratio
- `status`          — 'planned' | 'active' | 'completed' | 'deferred'
- `sequence_order`  — display/mining order
- `color`           — UI display color
- `notes`
- timestamps

### 3. New table: mine_design_benches
Individual bench rows within a pit design, for the detailed bench stack view.

### 4. New table: mine_design_equipment_schedule
Equipment assignment per pit phase per year.

### Security
All tables use RLS with anon+authenticated policies (no auth required).
*/

-- ── 1. Add spatial columns to lims_samples ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='hole_id') THEN
    ALTER TABLE lims_samples ADD COLUMN hole_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='x_coord') THEN
    ALTER TABLE lims_samples ADD COLUMN x_coord numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='y_coord') THEN
    ALTER TABLE lims_samples ADD COLUMN y_coord numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='elevation') THEN
    ALTER TABLE lims_samples ADD COLUMN elevation numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='dip_deg') THEN
    ALTER TABLE lims_samples ADD COLUMN dip_deg numeric DEFAULT -90;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='azimuth_deg') THEN
    ALTER TABLE lims_samples ADD COLUMN azimuth_deg numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='length_m') THEN
    ALTER TABLE lims_samples ADD COLUMN length_m numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='lims_samples' AND column_name='drill_type') THEN
    ALTER TABLE lims_samples ADD COLUMN drill_type text DEFAULT 'DDH';
  END IF;
END $$;

-- ── 2. mine_design_pits ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mine_design_pits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL,
  name            text NOT NULL DEFAULT 'Pit Phase',
  pit_type        text NOT NULL DEFAULT 'open_pit',
  crest_rl        numeric,
  floor_rl        numeric,
  bench_height_m  numeric NOT NULL DEFAULT 10,
  berm_width_m    numeric NOT NULL DEFAULT 8,
  slope_angle_deg numeric NOT NULL DEFAULT 45,
  ore_mt          numeric NOT NULL DEFAULT 0,
  waste_mt        numeric NOT NULL DEFAULT 0,
  grade_g_t       numeric NOT NULL DEFAULT 0,
  strip_ratio     numeric GENERATED ALWAYS AS (CASE WHEN ore_mt > 0 THEN waste_mt / ore_mt ELSE 0 END) STORED,
  status          text NOT NULL DEFAULT 'planned',
  sequence_order  integer NOT NULL DEFAULT 1,
  color           text NOT NULL DEFAULT '#10B981',
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE mine_design_pits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_mine_design_pits" ON mine_design_pits;
CREATE POLICY "anon_select_mine_design_pits" ON mine_design_pits FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_mine_design_pits" ON mine_design_pits;
CREATE POLICY "anon_insert_mine_design_pits" ON mine_design_pits FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_mine_design_pits" ON mine_design_pits;
CREATE POLICY "anon_update_mine_design_pits" ON mine_design_pits FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_mine_design_pits" ON mine_design_pits;
CREATE POLICY "anon_delete_mine_design_pits" ON mine_design_pits FOR DELETE TO anon, authenticated USING (true);

-- ── 3. mine_design_benches ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mine_design_benches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL,
  pit_id          uuid REFERENCES mine_design_pits(id) ON DELETE CASCADE,
  bench_rl        numeric NOT NULL,
  ore_mt          numeric NOT NULL DEFAULT 0,
  waste_mt        numeric NOT NULL DEFAULT 0,
  grade_g_t       numeric NOT NULL DEFAULT 0,
  width_m         numeric,
  length_m        numeric,
  blast_pattern   text DEFAULT '4x4',
  explosive_type  text DEFAULT 'ANFO',
  powder_factor   numeric DEFAULT 0.35,
  ore_type        text,
  domain          text,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE mine_design_benches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_mine_design_benches" ON mine_design_benches;
CREATE POLICY "anon_select_mine_design_benches" ON mine_design_benches FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_mine_design_benches" ON mine_design_benches;
CREATE POLICY "anon_insert_mine_design_benches" ON mine_design_benches FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_mine_design_benches" ON mine_design_benches;
CREATE POLICY "anon_update_mine_design_benches" ON mine_design_benches FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_mine_design_benches" ON mine_design_benches;
CREATE POLICY "anon_delete_mine_design_benches" ON mine_design_benches FOR DELETE TO anon, authenticated USING (true);

-- ── 4. mine_design_equipment_schedule ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mine_design_equipment_schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL,
  pit_id          uuid REFERENCES mine_design_pits(id) ON DELETE CASCADE,
  year            integer NOT NULL,
  equipment_type  text NOT NULL,
  equipment_name  text NOT NULL,
  quantity        integer NOT NULL DEFAULT 1,
  hours_year      numeric DEFAULT 6000,
  cost_h          numeric DEFAULT 0,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE mine_design_equipment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_mine_equip" ON mine_design_equipment_schedule;
CREATE POLICY "anon_select_mine_equip" ON mine_design_equipment_schedule FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_mine_equip" ON mine_design_equipment_schedule;
CREATE POLICY "anon_insert_mine_equip" ON mine_design_equipment_schedule FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_mine_equip" ON mine_design_equipment_schedule;
CREATE POLICY "anon_update_mine_equip" ON mine_design_equipment_schedule FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_mine_equip" ON mine_design_equipment_schedule;
CREATE POLICY "anon_delete_mine_equip" ON mine_design_equipment_schedule FOR DELETE TO anon, authenticated USING (true);
