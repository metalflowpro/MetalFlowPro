-- ─────────────────────────────────────────────────────────────────────────────
-- 20260820120000_audit_trail_schema.sql
-- Table audit_logs pour la traçabilité globale des actions et paramètres du projet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  previous_values JSONB,
  new_values JSONB,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour requêtes rapides par projet et date
CREATE INDEX IF NOT EXISTS idx_audit_logs_project_date ON audit_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Activation RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Politique RLS : seul l'utilisateur ayant accès au projet peut lire/écrire ses logs d'audit
DROP POLICY IF EXISTS "audit_logs_owner_access" ON audit_logs;
CREATE POLICY "audit_logs_owner_access" ON audit_logs
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      project_id IS NULL 
      OR EXISTS (
        SELECT 1 FROM projects p WHERE p.id = audit_logs.project_id AND p.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (
      project_id IS NULL 
      OR EXISTS (
        SELECT 1 FROM projects p WHERE p.id = audit_logs.project_id AND p.user_id = auth.uid()
      )
    )
  );
