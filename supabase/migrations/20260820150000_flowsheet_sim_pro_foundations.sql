-- ─────────────────────────────────────────────────────────────────────────────
-- 20260820150000_flowsheet_sim_pro_foundations.sql
--
-- Flowsheet Simulation Pro — Phase 1 (Fondations & isolation projets).
-- Ajoute le versioning des flowsheets, les snapshots d'entrée IMMUABLES, les
-- hypothèses tracées, le workflow de validation et la persistance des scénarios
-- générés. Toutes les tables sont isolées par project_id (RLS identique aux
-- tables sim_* existantes : accès borné aux projets de l'utilisateur courant).
--
-- IMMUABILITÉ (§8) : les tables de snapshot n'exposent AUCUNE policy UPDATE —
-- une ligne insérée ne peut plus être modifiée, seulement lue ou supprimée avec
-- le projet. C'est ce qui permet de reproduire un résultat des mois plus tard.
--
-- ⚠️ Après application : database.types.ts n'est pas régénéré automatiquement —
-- prévoir `supabase gen types typescript` ou un typage local documenté côté app.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Versions de flowsheet (topologie + paramètres figés) ─────────────────
CREATE TABLE IF NOT EXISTS sim_flowsheet_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flowsheet_id  uuid NOT NULL REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','configured','ready','simulated','review',
                                    'validated','approved','archived')),
  -- Topologie complète (nœuds + arêtes + paramètres) au moment du figeage.
  topology      jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes         text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flowsheet_id, version)
);
CREATE INDEX IF NOT EXISTS idx_sim_fs_versions_fs   ON sim_flowsheet_versions(flowsheet_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_sim_fs_versions_proj ON sim_flowsheet_versions(project_id);

-- ─── 2. Snapshot d'entrée IMMUABLE d'une simulation (§8) ─────────────────────
CREATE TABLE IF NOT EXISTS sim_input_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flowsheet_id       uuid REFERENCES sim_flowsheets(id) ON DELETE SET NULL,
  flowsheet_version  integer,
  run_id             uuid REFERENCES sim_run_results(id) ON DELETE SET NULL,
  engine_version     text,
  -- Versions des sources consommées, pour la reproductibilité.
  criteria_version   text,
  psd_version        text,
  p80_study_version  text,
  -- Instantané des données résolues (bundle tracé) + hypothèses ajoutées.
  data_bundle        jsonb NOT NULL DEFAULT '{}'::jsonb,
  lims_snapshot      jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumptions        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_input_snap_proj ON sim_input_snapshots(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sim_input_snap_run  ON sim_input_snapshots(run_id);

-- ─── 3. Hypothèses tracées ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sim_assumptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flowsheet_id  uuid REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  field         text NOT NULL,
  value         numeric,
  value_text    text,
  unit          text,
  -- Niveau de source (voir lib/simulation/provenance.ts). Défaut : hypothèse.
  tier          text NOT NULL DEFAULT 'user_assumption'
                  CHECK (tier IN ('lims_approved','pilot_validated','testwork_validated',
                                  'design_criteria','template_default','user_assumption')),
  rationale     text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_assumptions_fs ON sim_assumptions(flowsheet_id);

-- ─── 4. Workflow de validation (§11) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sim_validations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flowsheet_id       uuid NOT NULL REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  flowsheet_version  integer,
  state              text NOT NULL
                       CHECK (state IN ('draft','configured','ready','simulated','review',
                                        'validated','approved','archived')),
  role               text,
  decision           text CHECK (decision IN ('approve','reject','comment')),
  comment            text,
  validated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_validations_fs ON sim_validations(flowsheet_id, created_at DESC);

-- ─── 5. Scénarios générés (sortie du générateur) ─────────────────────────────
CREATE TABLE IF NOT EXISTS sim_generated_scenarios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request       jsonb NOT NULL DEFAULT '{}'::jsonb,
  scenarios     jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_log  jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_gen_scen_proj ON sim_generated_scenarios(project_id, created_at DESC);

-- ─── RLS : accès borné aux projets de l'utilisateur courant ──────────────────
-- Les snapshots (versions, input_snapshots, generated_scenarios) sont IMMUABLES :
-- pas de policy UPDATE → une ligne insérée ne peut plus être modifiée.

ALTER TABLE sim_flowsheet_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_input_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_assumptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_validations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_generated_scenarios  ENABLE ROW LEVEL SECURITY;

-- sim_flowsheet_versions (immuable : select/insert/delete, pas d'update)
DROP POLICY IF EXISTS "select_own_sim_fs_versions" ON sim_flowsheet_versions;
CREATE POLICY "select_own_sim_fs_versions" ON sim_flowsheet_versions FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_sim_fs_versions" ON sim_flowsheet_versions;
CREATE POLICY "insert_own_sim_fs_versions" ON sim_flowsheet_versions FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_sim_fs_versions" ON sim_flowsheet_versions;
CREATE POLICY "delete_own_sim_fs_versions" ON sim_flowsheet_versions FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- sim_input_snapshots (immuable)
DROP POLICY IF EXISTS "select_own_sim_input_snap" ON sim_input_snapshots;
CREATE POLICY "select_own_sim_input_snap" ON sim_input_snapshots FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_sim_input_snap" ON sim_input_snapshots;
CREATE POLICY "insert_own_sim_input_snap" ON sim_input_snapshots FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_sim_input_snap" ON sim_input_snapshots;
CREATE POLICY "delete_own_sim_input_snap" ON sim_input_snapshots FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- sim_assumptions (mutable : select/insert/update/delete)
DROP POLICY IF EXISTS "select_own_sim_assumptions" ON sim_assumptions;
CREATE POLICY "select_own_sim_assumptions" ON sim_assumptions FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_sim_assumptions" ON sim_assumptions;
CREATE POLICY "insert_own_sim_assumptions" ON sim_assumptions FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_sim_assumptions" ON sim_assumptions;
CREATE POLICY "update_own_sim_assumptions" ON sim_assumptions FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_sim_assumptions" ON sim_assumptions;
CREATE POLICY "delete_own_sim_assumptions" ON sim_assumptions FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- sim_validations (append-only : select/insert ; jamais modifié/supprimé isolément)
DROP POLICY IF EXISTS "select_own_sim_validations" ON sim_validations;
CREATE POLICY "select_own_sim_validations" ON sim_validations FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_sim_validations" ON sim_validations;
CREATE POLICY "insert_own_sim_validations" ON sim_validations FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- sim_generated_scenarios (immuable)
DROP POLICY IF EXISTS "select_own_sim_gen_scen" ON sim_generated_scenarios;
CREATE POLICY "select_own_sim_gen_scen" ON sim_generated_scenarios FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_sim_gen_scen" ON sim_generated_scenarios;
CREATE POLICY "insert_own_sim_gen_scen" ON sim_generated_scenarios FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_sim_gen_scen" ON sim_generated_scenarios;
CREATE POLICY "delete_own_sim_gen_scen" ON sim_generated_scenarios FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
