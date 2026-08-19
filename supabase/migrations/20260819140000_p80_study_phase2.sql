/*
# Module d'étude P80 — Phase 2

Ajoute : signature électronique (21 CFR Part 11), essais GRG étagés et
locked-cycle, et configuration d'ingestion webhook LIMS. Aucune table LIMS n'est
modifiée et AUCUN trigger n'est posé sur les tables lims_* (un import LIMS ne
doit jamais pouvoir être bloqué par ce module).

## Tables
1. p80_signature        — signatures électroniques APPEND-ONLY (pas d'UPDATE/DELETE)
2. p80_grg_test         — essai GRG étagé (Gravity Recoverable Gold)
3. p80_locked_cycle     — locked-cycle test (régime permanent)
4. p80_ingestion_config — secret + étude cible pour le webhook LIMS entrant

## Sécurité
RLS : propriétaire du projet ET approuvé. p80_signature n'expose QUE SELECT+INSERT
(les signatures ne peuvent être ni modifiées ni supprimées — exigence Part 11).
*/

-- ── 1. p80_signature (append-only) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_signature (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id          uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES p80_recommendation(id) ON DELETE SET NULL,
  signer            text NOT NULL,          -- identité (email) issue de la session
  signer_role       text NOT NULL DEFAULT 'analyst'
                      CHECK (signer_role IN ('analyst','responsible')),
  meaning           text NOT NULL,          -- « Approbation », « Publication », « Revue »
  content_hash      text NOT NULL,          -- SHA-256 du contenu signé (liaison au dossier)
  signed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_sig_study ON p80_signature (study_id, signed_at DESC);

ALTER TABLE p80_signature ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p80_signature_owner_select ON p80_signature;
DROP POLICY IF EXISTS p80_signature_owner_insert ON p80_signature;
-- Volontairement AUCUNE policy UPDATE/DELETE : signatures inaltérables (Part 11).
CREATE POLICY p80_signature_owner_select ON p80_signature FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()));
CREATE POLICY p80_signature_owner_insert ON p80_signature FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()));

-- ── 2/3/4. Tables à politiques CRUD standard ─────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_grg_test (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id           uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  study_sample_id    uuid REFERENCES p80_study_sample(id) ON DELETE SET NULL,
  stages             jsonb NOT NULL DEFAULT '[]',   -- [{stage,p80Um,stageRecoveryPct,massYieldPct}]
  cumulative_grg_pct numeric,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_grg_study ON p80_grg_test (study_id);

CREATE TABLE IF NOT EXISTS p80_locked_cycle (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id                  uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  study_sample_id           uuid REFERENCES p80_study_sample(id) ON DELETE SET NULL,
  inputs                    jsonb NOT NULL DEFAULT '{}',
  converged_recovery_pct    numeric,
  circulating_load_fraction numeric,
  cycles                    integer,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_lct_study ON p80_locked_cycle (study_id);

CREATE TABLE IF NOT EXISTS p80_ingestion_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id         uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT false,
  secret           text NOT NULL,           -- secret partagé vérifié par l'edge function
  source_family    text NOT NULL DEFAULT 'psd',
  last_triggered_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id)
);
CREATE INDEX IF NOT EXISTS idx_p80_ingest_project ON p80_ingestion_config (project_id);

DO $p80_p2_rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['p80_grg_test','p80_locked_cycle','p80_ingestion_config'] LOOP
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
$p80_p2_rls$;
