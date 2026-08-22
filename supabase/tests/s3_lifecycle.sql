-- ═══════════════════════════════════════════════════════════════════════════
-- s3_lifecycle.sql — Tests du chantier S3 (cycle de vie + immuabilité du publié).
-- Même convention que s1_rls.sql / s2_audit.sql.
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on

-- ── Préparation ──────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro'),
  ('22222222-2222-2222-2222-222222222222', 'viewer.a@mf.pro'),
  ('77777777-7777-7777-7777-777777777777', 'metallurgist.a@mf.pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_users (id, email, status, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro', 'approved', false),
  ('22222222-2222-2222-2222-222222222222', 'viewer.a@mf.pro', 'approved', false),
  ('77777777-7777-7777-7777-777777777777', 'metallurgist.a@mf.pro', 'approved', false)
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, email = EXCLUDED.email;

INSERT INTO public.projects (id, code, name, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PA', 'Projet A', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '77777777-7777-7777-7777-777777777777', 'metallurgist')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── Helpers ────────────────────────────────────────────────────────────────
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

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T1 — Cycle de vie linéaire valide : draft → calibrated → validated → archived
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name, description)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-LIN', 'desc')
  RETURNING id INTO fs;
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='archived'   WHERE id=fs;
  PERFORM pg_temp.assert(
    (SELECT status FROM public.sim_flowsheets WHERE id=fs) = 'archived',
    'S3-T1 cycle de vie linéaire draft->calibrated->validated->archived');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T2 — Transition interdite : draft -> validated (calibration obligatoire)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-SKIP') RETURNING id INTO fs;
  PERFORM pg_temp.expect_failure(
    $sql$UPDATE public.sim_flowsheets SET status='validated' WHERE id = (SELECT id FROM public.sim_flowsheets WHERE name='FS-SKIP' LIMIT 1)$sql$,
    'S3-T2 draft->validated refusé (calibration obligatoire)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T3 — Downgrade interdit : validated -> draft
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-DW') RETURNING id INTO fs;
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  PERFORM pg_temp.expect_failure(
    $sql$UPDATE public.sim_flowsheets SET status='draft' WHERE name='FS-DW'$sql$,
    'S3-T3 downgrade validated->draft refusé');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T4 — Données publiées immuables : modifier description sur validated
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-IMM') RETURNING id INTO fs;
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  PERFORM pg_temp.expect_failure(
    $sql$UPDATE public.sim_flowsheets SET description='FORGÉ' WHERE name='FS-IMM'$sql$,
    'S3-T4 mutation d''un flowsheet publié refusée (erreur explicite, non 0 ligne)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T5 — Nœuds immuables sous flowsheet publié (INSERT/UPDATE/DELETE)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-NODES') RETURNING id INTO fs;
  -- un nœud en draft : autorisé
  INSERT INTO public.sim_nodes (flowsheet_id, project_id, unit_type, label)
    VALUES (fs, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'crusher', 'C1');
  -- on valide le flowsheet → ses nœuds deviennent immuables
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  PERFORM pg_temp.expect_failure(
    $sql$INSERT INTO public.sim_nodes (flowsheet_id, project_id, unit_type, label) VALUES ((SELECT id FROM public.sim_flowsheets WHERE name='FS-NODES'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mill', 'M1')$sql$,
    'S3-T5a INSERT de nœud sous flowsheet publié refusé');
  PERFORM pg_temp.expect_failure(
    $sql$UPDATE public.sim_nodes SET label='M-FORGÉ' WHERE label='C1'$sql$,
    'S3-T5b UPDATE de nœud sous flowsheet publié refusé');
  PERFORM pg_temp.expect_failure(
    $sql$DELETE FROM public.sim_nodes WHERE label='C1'$sql$,
    'S3-T5c DELETE de nœud sous flowsheet publié refusé');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T6 — DELETE d'un flowsheet publié refusé
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-DEL') RETURNING id INTO fs;
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  PERFORM pg_temp.expect_failure(
    $sql$DELETE FROM public.sim_flowsheets WHERE name='FS-DEL'$sql$,
    'S3-T6 suppression d''un flowsheet publié refusée');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T7 — Fork refusé si le source n'est pas publié (draft)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-NOPUB') RETURNING id INTO fs;
  PERFORM pg_temp.expect_failure(
    $sql$SELECT public.mfp_fork_flowsheet_version((SELECT id FROM public.sim_flowsheets WHERE name='FS-NOPUB'))$sql$,
    'S3-T7 fork d''un flowsheet non publié refusé');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T8 — Fork autorisé : crée une nouvelle version draft, l'original reste
--          validé et immuable
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid; new_id uuid; v int;
BEGIN PERFORM pg_temp.as_user('77777777-7777-7777-7777-777777777777');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-FORK') RETURNING id INTO fs;
  INSERT INTO public.sim_nodes (flowsheet_id, project_id, unit_type, label) VALUES (fs, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'crusher', 'C1');
  INSERT INTO public.sim_nodes (flowsheet_id, project_id, unit_type, label) VALUES (fs, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'screen', 'S1');
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  SELECT public.mfp_fork_flowsheet_version(fs) INTO new_id;
  SELECT version INTO v FROM public.sim_flowsheets WHERE id=new_id;
  PERFORM pg_temp.assert(v = 2, 'S3-T8a fork crée la version 2');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.sim_flowsheets WHERE id=new_id) = 'draft',
    'S3-T8b nouvelle version à l''état draft (modifiable)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.sim_nodes WHERE flowsheet_id=new_id) = 2,
    'S3-T8c nœuds copiés dans la nouvelle version');
  -- l'original reste validé et immuable
  PERFORM pg_temp.assert(
    (SELECT status FROM public.sim_flowsheets WHERE id=fs) = 'validated',
    'S3-T8d original reste validé');
  PERFORM pg_temp.expect_failure(
    $sql$UPDATE public.sim_flowsheets SET description='X' WHERE id = (SELECT id FROM public.sim_flowsheets WHERE name='FS-FORK' AND version=1)$sql$,
    'S3-T8e original toujours immuable après fork');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S3-T9 — Fork contrôlé par droit d'écriture (viewer refusé)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-ACL') RETURNING id INTO fs;
  UPDATE public.sim_flowsheets SET status='calibrated' WHERE id=fs;
  UPDATE public.sim_flowsheets SET status='validated'  WHERE id=fs;
  PERFORM pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- viewer
  PERFORM pg_temp.expect_failure(
    $sql$SELECT public.mfp_fork_flowsheet_version((SELECT id FROM public.sim_flowsheets WHERE name='FS-ACL'))$sql$,
    'S3-T9 viewer sans droit d''écriture ne peut pas forker');
END $$;

DO $$ BEGIN RAISE NOTICE '═══ S3 : tous les tests sont passés ═══'; END $$;
