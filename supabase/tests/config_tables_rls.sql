-- ═══════════════════════════════════════════════════════════════════════════
-- config_tables_rls.sql — Prouve la migration 20261016090000 : les tables de
-- configuration S3/S5 ne sont plus modifiables par anon / authenticated, mais
-- restent lisibles par un utilisateur connecté (triggers du socle).
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on

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

-- CFG-T1 — anon ne peut ni modifier ni supprimer, ni même lire.
DO $$ BEGIN
  PERFORM set_config('role', 'anon', true);
  PERFORM pg_temp.expect_failure($q$UPDATE public.mfp_lifecycle_status SET is_locked = false$q$, 'CFG-T1a anon : modification des statuts refusée');
  PERFORM pg_temp.expect_failure($q$DELETE FROM public.mfp_project_consistency_rule$q$, 'CFG-T1b anon : suppression des règles refusée');
  PERFORM pg_temp.expect_failure($q$SELECT 1 FROM public.mfp_lifecycle_status$q$, 'CFG-T1c anon : lecture refusée');
END $$;

-- CFG-T2 — authenticated lit, mais n'écrit pas.
DO $$ DECLARE n int;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  SELECT count(*) INTO n FROM public.mfp_lifecycle_status;
  PERFORM pg_temp.assert(n > 0, 'CFG-T2a authenticated : lecture des statuts (triggers S3)');
  PERFORM pg_temp.expect_failure($q$UPDATE public.mfp_lifecycle_status SET is_locked = false$q$, 'CFG-T2b authenticated : modification refusée');
  PERFORM pg_temp.expect_failure($q$INSERT INTO public.mfp_project_consistency_rule (child_table) VALUES ('x')$q$, 'CFG-T2c authenticated : insertion refusée');
END $$;
