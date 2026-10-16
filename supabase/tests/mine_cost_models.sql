-- ═══════════════════════════════════════════════════════════════════════════
-- mine_cost_models.sql — Prouve la migration 20261015120000.
-- Le modèle de coûts miniers est protégé par les politiques S1 du domaine
-- « mine » : le propriétaire lit/écrit, un utilisateur non membre ne voit rien
-- et ne peut pas écrire ; une seule ligne par projet ; méthode contrainte.
-- Même convention que projects_soft_delete.sql (as_user / expect_failure / assert).
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on

-- ── Préparation (superutilisateur) ─────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro'),
  ('22222222-2222-2222-2222-222222222222', 'stranger.b@mf.pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_users (id, email, status, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro', 'approved', false),
  ('22222222-2222-2222-2222-222222222222', 'stranger.b@mf.pro', 'approved', false)
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, is_admin = EXCLUDED.is_admin;

INSERT INTO public.projects (id, code, name, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PA', 'Projet A', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

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

-- MCM-T1 — le propriétaire crée puis met à jour le modèle de son projet.
DO $$ DECLARE n int; m text;
BEGIN
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.mine_cost_models (project_id, method, overrides)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open_pit', '{"openPit.haulDistanceKm": 4.2}');
  INSERT INTO public.mine_cost_models (project_id, method, overrides)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'underground', '{}')
  ON CONFLICT (project_id) DO UPDATE SET method = EXCLUDED.method;
  SELECT count(*), max(method) INTO n, m FROM public.mine_cost_models;
  PERFORM pg_temp.assert(n = 1 AND m = 'underground', 'MCM-T1 propriétaire : écriture + upsert, une seule ligne par projet');
END $$;

-- MCM-T2 — un utilisateur non membre ne voit rien et ne peut pas écrire.
DO $$ DECLARE n int;
BEGIN
  PERFORM pg_temp.as_user('22222222-2222-2222-2222-222222222222');
  SELECT count(*) INTO n FROM public.mine_cost_models;
  PERFORM pg_temp.assert(n = 0, 'MCM-T2a non-membre : aucune ligne visible');
  PERFORM pg_temp.expect_failure(
    $q$INSERT INTO public.mine_cost_models (project_id) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$,
    'MCM-T2b non-membre : insertion refusée');
END $$;

-- MCM-T3 — la méthode est contrainte.
DO $$ BEGIN
  PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.expect_failure(
    $q$UPDATE public.mine_cost_models SET method = 'placer' WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$q$,
    'MCM-T3 méthode hors liste refusée');
END $$;

-- MCM-T4 — la table est déclarée au domaine « mine » (couverture S1).
DO $$ DECLARE d text;
BEGIN
  SELECT domain INTO d FROM public.mfp_table_domain WHERE table_name = 'mine_cost_models';
  PERFORM pg_temp.assert(d = 'mine', 'MCM-T4 table déclarée au domaine mine');
END $$;
