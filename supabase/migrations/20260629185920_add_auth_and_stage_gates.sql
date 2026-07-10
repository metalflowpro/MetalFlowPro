
/*
# Add Authentication + Stage Gate Tracking

## Changes

### 1. Add user_id to projects
- Adds `user_id` (uuid, references auth.users) so each project is owned by an authenticated user.
- Uses `DEFAULT auth.uid()` so inserts from the frontend work without passing user_id explicitly.
- Updates RLS policies to owner-scoped (authenticated users only).

### 2. New table: stage_gate_items
- Tracks checklist item completion per project per stage gate.
- `gate_num` (1–6), `item_key` (stable string id), `completed`, `completed_at`.
- UNIQUE(project_id, gate_num, item_key) prevents duplicate rows.
- RLS: owner-scoped through the projects table.

### 3. Other sub-tables (risks, lims_samples, equipment_items)
- Their RLS already scopes through project_id FK; no change needed since project access is now auth-gated.
*/

-- ── Projects: add user_id ──────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Back-fill existing rows to avoid null-uuid FK violations (assigns them to no user — they'll be invisible)
-- New rows will use DEFAULT auth.uid()
ALTER TABLE projects
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Replace open policies with owner-scoped ones
DROP POLICY IF EXISTS "anon_select_projects" ON projects;
DROP POLICY IF EXISTS "anon_insert_projects" ON projects;
DROP POLICY IF EXISTS "anon_update_projects" ON projects;
DROP POLICY IF EXISTS "anon_delete_projects" ON projects;

DROP POLICY IF EXISTS "select_own_projects" ON projects;
CREATE POLICY "select_own_projects" ON projects FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_projects" ON projects;
CREATE POLICY "insert_own_projects" ON projects FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_projects" ON projects;
CREATE POLICY "update_own_projects" ON projects FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_projects" ON projects;
CREATE POLICY "delete_own_projects" ON projects FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ── Stage gate items ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage_gate_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gate_num    smallint NOT NULL CHECK (gate_num BETWEEN 1 AND 6),
  item_key    text NOT NULL,
  completed   boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE (project_id, gate_num, item_key)
);

ALTER TABLE stage_gate_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sgi" ON stage_gate_items;
CREATE POLICY "select_own_sgi" ON stage_gate_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects WHERE projects.id = stage_gate_items.project_id
      AND projects.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "insert_own_sgi" ON stage_gate_items;
CREATE POLICY "insert_own_sgi" ON stage_gate_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects WHERE projects.id = stage_gate_items.project_id
      AND projects.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "update_own_sgi" ON stage_gate_items;
CREATE POLICY "update_own_sgi" ON stage_gate_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects WHERE projects.id = stage_gate_items.project_id
      AND projects.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "delete_own_sgi" ON stage_gate_items;
CREATE POLICY "delete_own_sgi" ON stage_gate_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects WHERE projects.id = stage_gate_items.project_id
      AND projects.user_id = auth.uid()
  ));

-- Also update child-table policies to authenticated only (they inherit project ownership via FK)
-- risks
DROP POLICY IF EXISTS "anon_select_risks" ON risks;
DROP POLICY IF EXISTS "anon_insert_risks" ON risks;
DROP POLICY IF EXISTS "anon_update_risks" ON risks;
DROP POLICY IF EXISTS "anon_delete_risks" ON risks;

DROP POLICY IF EXISTS "auth_select_risks" ON risks;
CREATE POLICY "auth_select_risks" ON risks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = risks.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_insert_risks" ON risks;
CREATE POLICY "auth_insert_risks" ON risks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = risks.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_update_risks" ON risks;
CREATE POLICY "auth_update_risks" ON risks FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = risks.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_delete_risks" ON risks;
CREATE POLICY "auth_delete_risks" ON risks FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = risks.project_id AND projects.user_id = auth.uid()));

-- lims_samples
DROP POLICY IF EXISTS "anon_select_lims" ON lims_samples;
DROP POLICY IF EXISTS "anon_insert_lims" ON lims_samples;
DROP POLICY IF EXISTS "anon_update_lims" ON lims_samples;
DROP POLICY IF EXISTS "anon_delete_lims" ON lims_samples;

DROP POLICY IF EXISTS "auth_select_lims" ON lims_samples;
CREATE POLICY "auth_select_lims" ON lims_samples FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_samples.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_insert_lims" ON lims_samples;
CREATE POLICY "auth_insert_lims" ON lims_samples FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_samples.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_update_lims" ON lims_samples;
CREATE POLICY "auth_update_lims" ON lims_samples FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_samples.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_delete_lims" ON lims_samples;
CREATE POLICY "auth_delete_lims" ON lims_samples FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_samples.project_id AND projects.user_id = auth.uid()));

-- equipment_items
DROP POLICY IF EXISTS "anon_select_equip" ON equipment_items;
DROP POLICY IF EXISTS "anon_insert_equip" ON equipment_items;
DROP POLICY IF EXISTS "anon_update_equip" ON equipment_items;
DROP POLICY IF EXISTS "anon_delete_equip" ON equipment_items;

DROP POLICY IF EXISTS "auth_select_equip" ON equipment_items;
CREATE POLICY "auth_select_equip" ON equipment_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = equipment_items.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_insert_equip" ON equipment_items;
CREATE POLICY "auth_insert_equip" ON equipment_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = equipment_items.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_update_equip" ON equipment_items;
CREATE POLICY "auth_update_equip" ON equipment_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = equipment_items.project_id AND projects.user_id = auth.uid()));

DROP POLICY IF EXISTS "auth_delete_equip" ON equipment_items;
CREATE POLICY "auth_delete_equip" ON equipment_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = equipment_items.project_id AND projects.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_sgi_project ON stage_gate_items(project_id);
