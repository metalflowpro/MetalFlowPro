-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822070000_projects_soft_delete.sql
-- Suppression de projet = archivage (soft-delete), pas destruction.
--
-- Le problème (mesuré en production) :
--   • projects → audit_logs portait `ON DELETE CASCADE` (migration
--     20260820120000). Supprimer un projet tentait donc de DELETE ses
--     audit_logs.
--   • Depuis S2 (20260822020000), audit_logs est APPEND-ONLY : le trigger
--     audit_logs_immutable_delete lève une exception sur tout DELETE, même en
--     cascade, même pour service_role. Résultat : la suppression d'un projet
--     échouait avec « audit_logs est inviolable… ».
--   • Un `ON DELETE SET NULL` ne réglerait rien : il ferait un UPDATE de
--     project_id → bloqué par audit_logs_immutable_update.
--
-- La décision (conformité 43-101 / Part 11) : une piste d'audit réellement
-- inviolable doit survivre à son projet. On ne détruit donc plus un projet ;
-- on l'archive. La piste d'audit — et toutes les données enfants — restent
-- intactes ; le projet disparaît simplement des listes de l'application.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Colonne d'archivage ─────────────────────────────────────────────────
-- NULL = actif ; horodaté = archivé (soft-deleted).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.projects.archived_at IS
  'Soft-delete : horodatage d''archivage. NULL = projet actif. Un projet '
  'archivé est masqué de l''application mais conserve toutes ses données et sa '
  'piste d''audit inviolable (S2). Voir 20260822070000_projects_soft_delete.';

CREATE INDEX IF NOT EXISTS idx_projects_active
  ON public.projects (created_at DESC)
  WHERE archived_at IS NULL;

-- ── 2. Défense en profondeur : bloquer la suppression dure des projets ──────
-- Même hors application, on empêche un DELETE physique qui déclencherait la
-- cascade contre audit_logs (et détruirait la piste). La voie normale est
-- l'archivage (UPDATE archived_at). Une migration exceptionnelle peut
-- désactiver ce trigger si une purge délibérée est un jour décidée.
CREATE OR REPLACE FUNCTION public.mfp_projects_no_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'projects: suppression dure interdite (la piste d''audit S2 est inviolable). Archivez le projet à la place : UPDATE projects SET archived_at = now().';
END $$;

DROP TRIGGER IF EXISTS projects_no_hard_delete ON public.projects;
CREATE TRIGGER projects_no_hard_delete
  BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.mfp_projects_no_hard_delete();
