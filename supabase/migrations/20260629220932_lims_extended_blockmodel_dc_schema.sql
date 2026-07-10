
-- ============================================================
-- 1. LIMS EXTENDED — test families as separate tables
-- ============================================================

-- Extend lims_samples with new columns (non-destructive)
ALTER TABLE lims_samples
  ADD COLUMN IF NOT EXISTS sample_id_display text,
  ADD COLUMN IF NOT EXISTS zone              text,
  ADD COLUMN IF NOT EXISTS ore_type         text,
  ADD COLUMN IF NOT EXISTS depth_from       numeric,
  ADD COLUMN IF NOT EXISTS depth_to         numeric,
  ADD COLUMN IF NOT EXISTS notes            text;

-- Back-fill sample_id_display from sample_id
UPDATE lims_samples SET sample_id_display = sample_id WHERE sample_id_display IS NULL;

-- ── Characterisation Head (a1/a2/a3) ───────────────────────
CREATE TABLE IF NOT EXISTS lims_test_head (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id   uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  test_code   text NOT NULL CHECK (test_code IN ('a1','a2','a3')),
  au_g_t      numeric CHECK (au_g_t BETWEEN 0 AND 50000),
  s_total_pct numeric CHECK (s_total_pct BETWEEN 0 AND 100),
  s_sulfide_pct numeric CHECK (s_sulfide_pct BETWEEN 0 AND 100),
  c_organic_pct numeric CHECK (c_organic_pct BETWEEN 0 AND 100),
  fe_pct      numeric CHECK (fe_pct BETWEEN 0 AND 100),
  cu_pct      numeric CHECK (cu_pct BETWEEN 0 AND 100),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE lims_test_head ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_lims_test_head" ON lims_test_head FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_lims_test_head" ON lims_test_head FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_lims_test_head" ON lims_test_head FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_lims_test_head" ON lims_test_head FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── Comminution (b1) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lims_test_comminution (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id   uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  test_code   text NOT NULL DEFAULT 'b1',
  bwi_kwh_t   numeric CHECK (bwi_kwh_t BETWEEN 4 AND 30),
  ai_index    numeric CHECK (ai_index >= 0),
  spi_min     numeric CHECK (spi_min >= 0),
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE lims_test_comminution ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_lims_comminution" ON lims_test_comminution FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_lims_comminution" ON lims_test_comminution FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_lims_comminution" ON lims_test_comminution FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_lims_comminution" ON lims_test_comminution FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── Gravity (c2/c2b/c2c) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lims_test_gravity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id     uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL,
  test_code     text NOT NULL CHECK (test_code IN ('c2','c2b','c2c')),
  grg_recovery_pct  numeric CHECK (grg_recovery_pct BETWEEN 0 AND 100),
  mass_pull_pct     numeric CHECK (mass_pull_pct BETWEEN 0 AND 100),
  p80_feed_um   numeric CHECK (p80_feed_um > 0),
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE lims_test_gravity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_lims_gravity" ON lims_test_gravity FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_lims_gravity" ON lims_test_gravity FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_lims_gravity" ON lims_test_gravity FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_lims_gravity" ON lims_test_gravity FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── Leach (d1) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lims_test_leach (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id       uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL,
  test_code       text NOT NULL DEFAULT 'd1',
  recovery_pct    numeric CHECK (recovery_pct BETWEEN 0 AND 100),
  nacn_kg_t       numeric CHECK (nacn_kg_t >= 0),
  cao_kg_t        numeric CHECK (cao_kg_t >= 0),
  retention_h     numeric CHECK (retention_h > 0),
  residue_au_g_t  numeric CHECK (residue_au_g_t >= 0),
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE lims_test_leach ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_lims_leach" ON lims_test_leach FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_lims_leach" ON lims_test_leach FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_lims_leach" ON lims_test_leach FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_lims_leach" ON lims_test_leach FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ── Import log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lims_import_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL,
  user_id     uuid,
  import_type text,
  rows_ok     integer DEFAULT 0,
  rows_err    integer DEFAULT 0,
  errors      jsonb,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE lims_import_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_lims_log" ON lims_import_log FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_lims_log" ON lims_import_log FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_lims_log" ON lims_import_log FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_lims_log" ON lims_import_log FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 2. BLOCK MODEL
-- ============================================================

CREATE TABLE IF NOT EXISTS bm_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  origin_x    numeric NOT NULL DEFAULT 0,
  origin_y    numeric NOT NULL DEFAULT 0,
  origin_z    numeric NOT NULL DEFAULT 0,
  block_x     numeric NOT NULL DEFAULT 10 CHECK (block_x > 0),
  block_y     numeric NOT NULL DEFAULT 10 CHECK (block_y > 0),
  block_z     numeric NOT NULL DEFAULT 10 CHECK (block_z > 0),
  rotation_deg numeric NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE bm_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_bm_configs" ON bm_configs FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_bm_configs" ON bm_configs FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_bm_configs" ON bm_configs FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_bm_configs" ON bm_configs FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS bm_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id   uuid NOT NULL REFERENCES bm_configs(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL,
  i           integer NOT NULL,
  j           integer NOT NULL,
  k           integer NOT NULL,
  cx          numeric NOT NULL,
  cy          numeric NOT NULL,
  cz          numeric NOT NULL,
  density     numeric NOT NULL DEFAULT 2.7,
  volume_m3   numeric NOT NULL DEFAULT 500,
  au_g_t      numeric NOT NULL DEFAULT 0 CHECK (au_g_t >= 0),
  rock_type   text,
  attributes  jsonb,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (config_id, i, j, k)
);
CREATE INDEX IF NOT EXISTS idx_bm_blocks_config ON bm_blocks(config_id);
CREATE INDEX IF NOT EXISTS idx_bm_blocks_au ON bm_blocks(config_id, au_g_t);
ALTER TABLE bm_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_bm_blocks" ON bm_blocks FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_bm_blocks" ON bm_blocks FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_bm_blocks" ON bm_blocks FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_bm_blocks" ON bm_blocks FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 3. DESIGN CRITERIA — snapshots & DC lines
-- ============================================================

CREATE TABLE IF NOT EXISTS dc_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       text NOT NULL,
  content     jsonb NOT NULL,
  content_hash text NOT NULL,
  frozen_by   uuid,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE dc_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_dc_snapshots" ON dc_snapshots FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_dc_snapshots" ON dc_snapshots FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_dc_snapshots" ON dc_snapshots FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_dc_snapshots" ON dc_snapshots FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS dc_draft (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  content     jsonb NOT NULL DEFAULT '{}',
  pipeline_step text,
  circuit_flags jsonb,
  updated_at  timestamptz DEFAULT now()
);
ALTER TABLE dc_draft ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_own_dc_draft" ON dc_draft FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "insert_own_dc_draft" ON dc_draft FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "update_own_dc_draft" ON dc_draft FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
CREATE POLICY "delete_own_dc_draft" ON dc_draft FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
