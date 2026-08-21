-- ═══════════════════════════════════════════════════════════════════════════
-- Écrans de support de l'Intelligence Géométallurgique (plan §14 et §9/§11).
--
-- Deux tables de gouvernance, jusqu'ici absentes :
--
--  1. geomet_reconciliation — confronte la récupération PRÉDITE d'un domaine à
--     la récupération OBSERVÉE à l'usine sur une campagne. C'est la boucle
--     prévision → opération → réconciliation : sans persistance, l'écart n'est
--     ni tracé ni comparable d'une campagne à l'autre.
--
--  2. geomet_model_version — fige un instantané complet du modèle de domaines
--     (mappings GID, coefficients, récupérations, BWi…) sous forme de version
--     approuvable. Une prédiction publiée doit être REPRODUCTIBLE : on doit
--     pouvoir dire « telle prévision provient de la version v3 du 2026-08-21 ».
--
-- Isolation par project_id + RLS propriétaire-ET-approuvé, comme les tables
-- p80_* (migration 20260819120000) : la fonction public.is_approved() existe
-- déjà (migration 20260808120000_user_approval).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. geomet_reconciliation ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS geomet_reconciliation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Domaine réconcilié. ON DELETE SET NULL : supprimer un domaine ne doit pas
  -- effacer l'historique de réconciliation (on garde la trace, orpheline).
  domain_id         uuid REFERENCES geomet_domains(id) ON DELETE SET NULL,
  -- Libellé du domaine figé au moment de la saisie (survit à la suppression du domaine).
  domain_name       text,
  campaign_label    text NOT NULL DEFAULT 'Campagne',
  period_label      text,
  predicted_recovery_pct numeric CHECK (predicted_recovery_pct IS NULL OR predicted_recovery_pct BETWEEN 0 AND 100),
  observed_recovery_pct  numeric CHECK (observed_recovery_pct  IS NULL OR observed_recovery_pct  BETWEEN 0 AND 100),
  observed_tonnage  numeric CHECK (observed_tonnage IS NULL OR observed_tonnage >= 0),
  observed_grade_gt numeric CHECK (observed_grade_gt IS NULL OR observed_grade_gt >= 0),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geomet_recon_project ON geomet_reconciliation (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_geomet_recon_domain  ON geomet_reconciliation (domain_id);

-- ── 2. geomet_model_version ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS geomet_model_version (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_label  text NOT NULL DEFAULT 'v1',
  note           text,
  -- Instantané figé : { domains: [...], assumptions: {...} } — tout ce qu'il
  -- faut pour reproduire la prédiction, sans dépendre de l'état courant.
  snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,
  domain_count   integer NOT NULL DEFAULT 0,
  -- KPIs figés pour comparer deux versions sans re-parser le snapshot.
  weighted_recovery_pct numeric,
  weighted_p80_um       numeric,
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','published')),
  created_by     text,
  approved_by    text,
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_geomet_version_project ON geomet_model_version (project_id, created_at DESC);

-- ── RLS : propriétaire du projet ET approuvé, pour les 2 tables ───────────────

DO $geomet_support_rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['geomet_reconciliation','geomet_model_version'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved())) WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_delete', t);
  END LOOP;
END
$geomet_support_rls$;
