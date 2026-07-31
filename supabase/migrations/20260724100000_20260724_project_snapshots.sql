/*
# Snapshots de scénarios projet (T4)

## Purpose
Mémoire décisionnelle : figer un état complet du projet (paramètres procédé +
hypothèses économiques + KPI dérivés au moment de la capture) sous un nom, pour
le comparer plus tard ou y revenir. Répond au manque « ni snapshots, ni
versioning » identifié dans ROADMAP.md. Base aussi de la traçabilité NI 43-101.

## New Tables
1. **project_snapshots** — une ligne par capture
   - `label`         : nom lisible du scénario (« Cas de base v3 »)
   - `project_state` : jsonb figé de la ligne projects au moment T
   - `settings_state`: jsonb figé de project_settings au moment T
   - `kpi_snapshot`  : jsonb des KPI calculés (annualOz, revenus, CAPEX, AISC…)
   - `note`          : commentaire libre

## Security
- RLS activée, périmètre par propriété du projet (projects.user_id = auth.uid())
- 4 politiques CRUD (SELECT, INSERT, UPDATE, DELETE), même patron que les autres tables.
*/

CREATE TABLE IF NOT EXISTS project_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label text NOT NULL,
  project_state jsonb NOT NULL DEFAULT '{}',
  settings_state jsonb NOT NULL DEFAULT '{}',
  kpi_snapshot jsonb NOT NULL DEFAULT '{}',
  note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_snapshots_project ON project_snapshots(project_id, created_at DESC);

ALTER TABLE project_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_project_snapshots" ON project_snapshots;
CREATE POLICY "select_project_snapshots" ON project_snapshots FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_snapshots.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_project_snapshots" ON project_snapshots;
CREATE POLICY "insert_project_snapshots" ON project_snapshots FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_snapshots.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_project_snapshots" ON project_snapshots;
CREATE POLICY "update_project_snapshots" ON project_snapshots FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_snapshots.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_snapshots.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_project_snapshots" ON project_snapshots;
CREATE POLICY "delete_project_snapshots" ON project_snapshots FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = project_snapshots.project_id AND projects.user_id = auth.uid()));
