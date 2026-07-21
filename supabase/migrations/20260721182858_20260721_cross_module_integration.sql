/*
# Cross-Module Integration: P80 Push, GeoMet Clusters, Sim Feed Link

This migration adds infrastructure for the 6 target modules to share data
bidirectionally, closing the loop between Granulométrie → Criteria →
CircuitAI → Economics → Risks.

## New Tables

### `p80_optimum` (one row per project)
Stores the economically optimal P80 computed by Granulométrie's P80 engine,
so Criteria and MineOpt can read it without re-deriving it.
- `project_id` (uuid FK → projects, UNIQUE)
- `optimal_p80_um` (real) — optimal grind size in µm
- `bwi_kwh_t`, `f80_um`, `recovery_pct`, `energy_kwh_t`, `net_value_usd_t`
- `engine_source` (text) — which module computed it
- `updated_at` (timestamptz)

### `geomet_clusters` (domain clustering results)
Stores domain similarity clusters from the GeoMet module for reuse by
Analytics and CircuitAI.
- `cluster_label` (text)
- `domain_names` (text[])
- `cluster_centroid` (jsonb)
- `silhouette_score` (real)

### `sim_feed_link` (simulation feed → LIMS/GeoMet)
Links the Simulation Pro feed inputs to actual LIMS testwork and GeoMet
domain data.
- `p80_source` (text) — 'lims' | 'geomet' | 'manual'
- `p80_um`, `bwi_kwh_t`, `f80_um`, `recovery_pct`, `gold_grade_g_t`

## Security
All tables have RLS enabled with `TO authenticated` policies scoped to
project ownership via `project_id IN (SELECT id FROM projects WHERE
user_id = auth.uid())`.
*/

-- p80_optimum: shared optimal grind size
CREATE TABLE IF NOT EXISTS p80_optimum (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  optimal_p80_um real NOT NULL,
  bwi_kwh_t real,
  f80_um real,
  recovery_pct real,
  energy_kwh_t real,
  net_value_usd_t real,
  engine_source text DEFAULT 'granulometry',
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE p80_optimum ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_p80_optimum" ON p80_optimum;
CREATE POLICY "select_own_p80_optimum" ON p80_optimum FOR SELECT
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_p80_optimum" ON p80_optimum;
CREATE POLICY "insert_own_p80_optimum" ON p80_optimum FOR INSERT
  TO authenticated WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_p80_optimum" ON p80_optimum;
CREATE POLICY "update_own_p80_optimum" ON p80_optimum FOR UPDATE
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_p80_optimum" ON p80_optimum;
CREATE POLICY "delete_own_p80_optimum" ON p80_optimum FOR DELETE
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- geomet_clusters: domain clustering results
CREATE TABLE IF NOT EXISTS geomet_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cluster_label text NOT NULL,
  domain_names text[] NOT NULL DEFAULT '{}',
  cluster_centroid jsonb DEFAULT '{}',
  silhouette_score real,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE geomet_clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_geomet_clusters" ON geomet_clusters;
CREATE POLICY "select_own_geomet_clusters" ON geomet_clusters FOR SELECT
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_geomet_clusters" ON geomet_clusters;
CREATE POLICY "insert_own_geomet_clusters" ON geomet_clusters FOR INSERT
  TO authenticated WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_geomet_clusters" ON geomet_clusters;
CREATE POLICY "update_own_geomet_clusters" ON geomet_clusters FOR UPDATE
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_geomet_clusters" ON geomet_clusters;
CREATE POLICY "delete_own_geomet_clusters" ON geomet_clusters FOR DELETE
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- sim_feed_link: simulation feed linked to LIMS/GeoMet
CREATE TABLE IF NOT EXISTS sim_feed_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  p80_source text DEFAULT 'manual',
  p80_um real,
  bwi_kwh_t real,
  f80_um real,
  recovery_pct real,
  gold_grade_g_t real,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE sim_feed_link ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sim_feed_link" ON sim_feed_link;
CREATE POLICY "select_own_sim_feed_link" ON sim_feed_link FOR SELECT
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_sim_feed_link" ON sim_feed_link;
CREATE POLICY "insert_own_sim_feed_link" ON sim_feed_link FOR INSERT
  TO authenticated WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_sim_feed_link" ON sim_feed_link;
CREATE POLICY "update_own_sim_feed_link" ON sim_feed_link FOR UPDATE
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_sim_feed_link" ON sim_feed_link;
CREATE POLICY "delete_own_sim_feed_link" ON sim_feed_link FOR DELETE
  TO authenticated USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- Indexes for frequent lookups
CREATE INDEX IF NOT EXISTS idx_geomet_clusters_project ON geomet_clusters(project_id);
