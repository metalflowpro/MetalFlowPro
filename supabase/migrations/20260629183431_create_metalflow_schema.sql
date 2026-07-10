
/*
# MetalFlow Pro — Initial Schema

## Overview
Creates the core data tables for a metallurgical project management platform.

## Tables Created

### `projects`
Stores mining/metallurgical projects with process parameters.
- `id` — UUID primary key
- `code` — Short project code (e.g., "KMG-001")
- `name` — Full project name
- `country` — Country of operation
- `phase` — Current project phase (SCOPING, PRE-FEASIBILITY, FEASIBILITY, BFS, DFS)
- `target_tph` — Target throughput in tonnes per hour
- `gold_grade_g_t` — Head grade in g/t Au
- `availability_pct` — Plant availability percentage
- `recovery_pct` — Overall gold recovery percentage
- `ore_sg` — Ore specific gravity
- `gold_price_usd` — Assumed gold price USD/oz
- `created_at`, `updated_at` — Timestamps

### `risks`
Risk register for each project.
- `id`, `project_id` — identifiers
- `description`, `category`, `mitigation` — risk details
- `probability`, `impact` — 1–5 scoring
- `status` — open | mitigated | closed

### `lims_samples`
LIMS sample records linked to a project.
- `id`, `project_id`
- `sample_id`, `campaign`, `domain`
- `test_type` — GRG, CIL, CIP, BWI, SAG, FLOAT
- `result_value`, `result_unit`
- `status` — pending | passed | failed | flagged

### `equipment_items`
Equipment catalog entries per project.
- `id`, `project_id`
- `tag`, `name`, `category`, `sub_category`
- `capacity`, `capacity_unit`, `power_kw`
- `status` — proposed | ordered | installed | operating

## Security
- RLS enabled on all tables.
- All tables use `TO anon, authenticated` policies (no login required — single-tenant app).
*/

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  country text NOT NULL DEFAULT 'Ghana',
  phase text NOT NULL DEFAULT 'SCOPING',
  target_tph numeric NOT NULL DEFAULT 200,
  gold_grade_g_t numeric NOT NULL DEFAULT 2.5,
  availability_pct numeric NOT NULL DEFAULT 92,
  recovery_pct numeric NOT NULL DEFAULT 89,
  ore_sg numeric NOT NULL DEFAULT 2.75,
  gold_price_usd numeric NOT NULL DEFAULT 2340,
  annual_tonnes numeric GENERATED ALWAYS AS (target_tph * availability_pct / 100 * 8760) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_projects" ON projects;
CREATE POLICY "anon_select_projects" ON projects FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_projects" ON projects;
CREATE POLICY "anon_insert_projects" ON projects FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_projects" ON projects;
CREATE POLICY "anon_update_projects" ON projects FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_projects" ON projects;
CREATE POLICY "anon_delete_projects" ON projects FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- RISKS
-- ============================================================
CREATE TABLE IF NOT EXISTS risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'Technical',
  mitigation text,
  probability smallint NOT NULL DEFAULT 3 CHECK (probability BETWEEN 1 AND 5),
  impact smallint NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigated','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE risks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_risks" ON risks;
CREATE POLICY "anon_select_risks" ON risks FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_risks" ON risks;
CREATE POLICY "anon_insert_risks" ON risks FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_risks" ON risks;
CREATE POLICY "anon_update_risks" ON risks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_risks" ON risks;
CREATE POLICY "anon_delete_risks" ON risks FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- LIMS SAMPLES
-- ============================================================
CREATE TABLE IF NOT EXISTS lims_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sample_id text NOT NULL,
  campaign text NOT NULL DEFAULT 'C1',
  domain text,
  test_type text NOT NULL DEFAULT 'CIL',
  result_value numeric,
  result_unit text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','passed','failed','flagged')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lims_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_lims" ON lims_samples;
CREATE POLICY "anon_select_lims" ON lims_samples FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_lims" ON lims_samples;
CREATE POLICY "anon_insert_lims" ON lims_samples FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_lims" ON lims_samples;
CREATE POLICY "anon_update_lims" ON lims_samples FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_lims" ON lims_samples;
CREATE POLICY "anon_delete_lims" ON lims_samples FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- EQUIPMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS equipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Comminution',
  sub_category text,
  capacity numeric,
  capacity_unit text,
  power_kw numeric,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','ordered','installed','operating')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE equipment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_equip" ON equipment_items;
CREATE POLICY "anon_select_equip" ON equipment_items FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_equip" ON equipment_items;
CREATE POLICY "anon_insert_equip" ON equipment_items FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_equip" ON equipment_items;
CREATE POLICY "anon_update_equip" ON equipment_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_equip" ON equipment_items;
CREATE POLICY "anon_delete_equip" ON equipment_items FOR DELETE TO anon, authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_risks_project ON risks(project_id);
CREATE INDEX IF NOT EXISTS idx_lims_project ON lims_samples(project_id);
CREATE INDEX IF NOT EXISTS idx_equip_project ON equipment_items(project_id);
