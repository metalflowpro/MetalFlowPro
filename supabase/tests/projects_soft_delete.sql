-- ═══════════════════════════════════════════════════════════════════════════
-- projects_soft_delete.sql — Prouve le correctif 20260822070000.
-- Contexte : supprimer un projet cascadait vers audit_logs (ON DELETE CASCADE),
-- bloqué par l'immuabilité S2. Le projet s'archive désormais au lieu d'être
-- détruit ; la piste d'audit et les données enfants survivent.
-- Même convention que s2_audit.sql (as_user / expect_failure / assert).
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on

-- ── Préparation (superutilisateur) ─────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_users (id, email, status, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro', 'approved', false)
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, is_admin = EXCLUDED.is_admin;

INSERT INTO public.projects (id, code, name, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PA', 'Projet A', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.risks (project_id, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Risque enfant')
ON CONFLICT DO NOTHING;

-- ── Helpers (base neuve par fichier → on les recrée) ───────────────────────
CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS — %', msg;
  ELSE RAISE EXCEPTION 'ÉCHEC — %', msg; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_failure(p_sql text, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE failed boolean := false;
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN failed := true; END;
  PERFORM pg_temp.assert(failed, p_msg);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.as_user(uid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub', uid, true);
END $$;

-- On sème une entrée d'audit sur le projet, comme en production.
DO $$ BEGIN
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  PERFORM public.mfp_audit_log(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'update_settings',
    'project_settings', 'aaaa', '{"x":1}'::jsonb, '{"x":2}'::jsonb);
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PSD-T1 — Le bug d'origine : le hard-delete du projet est refusé
-- (la cascade vers audit_logs heurte l'immuabilité S2, et le trigger
--  projects_no_hard_delete refuse la suppression physique en amont).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.expect_failure(
    $q$DELETE FROM public.projects WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$,
    'PSD-T1 suppression dure du projet refusée');
END $$;

-- Le projet, la piste d'audit et le risque sont toujours là après l'échec.
DO $$ DECLARE np int; na int; nr int;
BEGIN
  SELECT count(*) INTO np FROM public.projects WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) INTO na FROM public.audit_logs WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) INTO nr FROM public.risks WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM pg_temp.assert(np = 1 AND na >= 1 AND nr = 1,
    'PSD-T1b projet, audit et risque intacts après refus');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PSD-T2 — L'archivage (soft-delete) réussit pour l'owner
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE arch timestamptz;
BEGIN
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  UPDATE public.projects SET archived_at = now()
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT archived_at INTO arch FROM public.projects
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM pg_temp.assert(arch IS NOT NULL, 'PSD-T2 projet archivé (archived_at posé)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- PSD-T3 — Après archivage : piste d'audit + données enfants préservées,
-- et le projet est exclu de la liste active (filtre archived_at IS NULL).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE na int; nr int; nactive int;
BEGIN
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  SELECT count(*) INTO na FROM public.audit_logs WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) INTO nr FROM public.risks WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) INTO nactive FROM public.projects
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND archived_at IS NULL;
  PERFORM pg_temp.assert(na >= 1 AND nr = 1 AND nactive = 0,
    'PSD-T3 audit+enfants conservés, projet hors liste active');
END $$;
