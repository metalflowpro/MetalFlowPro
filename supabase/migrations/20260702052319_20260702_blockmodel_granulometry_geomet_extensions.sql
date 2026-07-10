
/*
# Block Model + Granulometry + GeoMet Extensions

## Title
Add resource classification, granulometry params, and geometallurgical domains tables.

## Changes

### 1. bm_blocks — add resource_category column
Adds a `resource_category` column (Mesuré / Indiqué / Inféré) to support
NI 43-101 mineral resource classification per lithotype.

### 2. granulometry_params (new table)
Stores per-project PSD circuit parameters for the Granulometry module:
active equipment flags (jaw, gyratory, cone, SAG, ball, HPGR, regrind, etc.),
F80/P80 values, BWI, cyclone cut, density, % solids. One row per project.

### 3. geomet_domains (new table)
Stores geometallurgical domain definitions: lithotype name, GID code,
average GRG/CIL/BWI values, LOM proportion, design recovery, and
whether the row was imported from LIMS or entered manually.

## Security
All new tables/columns follow the existing RLS pattern:
project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()).
*/

-- ── 1. Add resource_category to bm_blocks ─────────────────────────────────────
ALTER TABLE bm_blocks
  ADD COLUMN IF NOT EXISTS resource_category text
    CHECK (resource_category IN ('Mesuré','Indiqué','Inféré') OR resource_category IS NULL);

-- ── 2. granulometry_params ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS granulometry_params (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,

  -- Equipment active flags
  jaw_active          boolean NOT NULL DEFAULT false,
  gyratory_active     boolean NOT NULL DEFAULT true,
  cone_active         boolean NOT NULL DEFAULT true,
  pebble_active       boolean NOT NULL DEFAULT false,
  hpgr_active         boolean NOT NULL DEFAULT false,
  ag_active           boolean NOT NULL DEFAULT false,
  sag_active          boolean NOT NULL DEFAULT true,
  ball_active         boolean NOT NULL DEFAULT true,
  rod_active          boolean NOT NULL DEFAULT false,
  regrind_ball_active boolean NOT NULL DEFAULT true,
  isamill_active      boolean NOT NULL DEFAULT false,
  vertimill_active    boolean NOT NULL DEFAULT false,
  smd_active          boolean NOT NULL DEFAULT false,

  -- F80/P80 values (mm or µm as noted)
  f80_rom_mm          numeric,
  p80_gyratory_mm     numeric,
  p80_cone_mm         numeric,
  p80_sag_um          numeric,
  p80_ball_um         numeric,
  cyclone_cut_um      numeric,
  p80_regrind_um      numeric,

  -- Grinding parameters
  bwi_kwh_t           numeric,
  feed_rate_tph       numeric DEFAULT 1500,
  density_sg          numeric,
  pct_solids          numeric,
  spi_kwh_t           numeric,
  abrasion_index      numeric,
  sag_specific_energy numeric,

  updated_at          timestamptz DEFAULT now()
);
ALTER TABLE granulometry_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_granulometry_params" ON granulometry_params;
CREATE POLICY "select_own_granulometry_params" ON granulometry_params FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_granulometry_params" ON granulometry_params;
CREATE POLICY "insert_own_granulometry_params" ON granulometry_params FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_granulometry_params" ON granulometry_params;
CREATE POLICY "update_own_granulometry_params" ON granulometry_params FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_granulometry_params" ON granulometry_params;
CREATE POLICY "delete_own_granulometry_params" ON granulometry_params FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── 3. geomet_domains ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geomet_domains (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  name            text NOT NULL,
  gid_code        text,
  color           text DEFAULT '#F59E0B',
  sample_count    integer DEFAULT 0,
  lom_pct         numeric CHECK (lom_pct BETWEEN 0 AND 100),

  avg_grg_pct     numeric CHECK (avg_grg_pct BETWEEN 0 AND 100),
  avg_cil_pct     numeric CHECK (avg_cil_pct BETWEEN 0 AND 100),
  avg_bwi_kwh_t   numeric CHECK (avg_bwi_kwh_t > 0),
  recovery_design numeric CHECK (recovery_design BETWEEN 0 AND 100),

  bwi_min         numeric,
  bwi_max         numeric,
  recovery_min    numeric,
  recovery_max    numeric,

  is_imported     boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE geomet_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_geomet_domains" ON geomet_domains;
CREATE POLICY "select_own_geomet_domains" ON geomet_domains FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_geomet_domains" ON geomet_domains;
CREATE POLICY "insert_own_geomet_domains" ON geomet_domains FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_geomet_domains" ON geomet_domains;
CREATE POLICY "update_own_geomet_domains" ON geomet_domains FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_geomet_domains" ON geomet_domains;
CREATE POLICY "delete_own_geomet_domains" ON geomet_domains FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
