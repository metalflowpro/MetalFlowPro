-- ═══════════════════════════════════════════════════════════════════════════
-- s1_rls.sql — Tests fonctionnels du chantier S1 (RBAC multi-projets).
-- Même convention que s2_audit.sql / s3_lifecycle.sql : chaque DO block bascule
-- en role authenticated + claim sub dans la même transaction ; expect_failure
-- pour les écritures devant être refusées par la RLS/le WITH CHECK.
--
-- Domaines exercés : simulation (métallurgiste écrit), drilling (géologue écrit),
-- risks (économiste écrit), reports (qp seul). La lecture est large ; l'écriture
-- est bornée au domaine du rôle.
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on

-- ── Préparation (superutilisateur) ─────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro'),
  ('22222222-2222-2222-2222-222222222222', 'viewer.a@mf.pro'),
  ('33333333-3333-3333-3333-333333333333', 'geologist.a@mf.pro'),
  ('44444444-4444-4444-4444-444444444444', 'metallurgist.a@mf.pro'),
  ('55555555-5555-5555-5555-555555555555', 'pm.a@mf.pro'),
  ('99999999-9999-9999-9999-999999999999', 'owner.b@mf.pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_users (id, email, status, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro', 'approved', false),
  ('22222222-2222-2222-2222-222222222222', 'viewer.a@mf.pro', 'approved', false),
  ('33333333-3333-3333-3333-333333333333', 'geologist.a@mf.pro', 'approved', false),
  ('44444444-4444-4444-4444-444444444444', 'metallurgist.a@mf.pro', 'approved', false),
  ('55555555-5555-5555-5555-555555555555', 'pm.a@mf.pro', 'approved', false),
  ('99999999-9999-9999-9999-999999999999', 'owner.b@mf.pro', 'approved', false)
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, email = EXCLUDED.email;

-- projects (le trigger projects_owner_sync crée le membre owner automatiquement)
INSERT INTO public.projects (id, code, name, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PA', 'Projet A', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PB', 'Projet B', '99999999-9999-9999-9999-999999999999')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'viewer'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'geologist'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'metallurgist'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '55555555-5555-5555-5555-555555555555', 'project_manager')
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO public.risks (project_id, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Risque initial A')
ON CONFLICT DO NOTHING;

-- ── Helpers ─────────────────────────────────────────────────────────────────
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
-- S1-T1 — Un membre lit les données de son projet
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('44444444-4444-4444-4444-444444444444');
  SELECT count(*) INTO n FROM public.risks WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM pg_temp.assert(n >= 1, 'S1-T1 un membre lit les risques de son projet');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T2 — Invisibilité totale du projet d'autrui
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('99999999-9999-9999-9999-999999999999'); -- owner de B
  SELECT count(*) INTO n FROM public.risks WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM pg_temp.assert(n = 0, 'S1-T2 owner.b ne voit rien du projet A');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T3 — viewer en lecture seule (UPDATE → 0 ligne, piège T3b)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- viewer
  UPDATE public.risks SET description = 'FORGÉ' WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert(n = 0, 'S1-T3 viewer ne peut pas écrire (0 ligne, piège T3b)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T4 — Écriture limitée au domaine du rôle (métallurgiste écrit simulation)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE fs uuid;
BEGIN PERFORM pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- metallurgist
  INSERT INTO public.sim_flowsheets (project_id, name)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-S1-T4') RETURNING id INTO fs;
  PERFORM pg_temp.assert(fs IS NOT NULL, 'S1-T4 métallurgiste écrit dans le domaine simulation');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T5 — Écriture hors domaine refusée
--   • géologue ne peut pas écrire simulation
--   • métallurgiste ne peut pas écrire risks
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN PERFORM pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- geologist
  PERFORM pg_temp.expect_failure(
    $sql$INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FS-GEO')$sql$,
    'S1-T5a géologue ne peut pas écrire dans simulation');
  PERFORM pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- metallurgist
  PERFORM pg_temp.expect_failure(
    $sql$INSERT INTO public.risks (project_id, description) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'X')$sql$,
    'S1-T5b métallurgiste ne peut pas écrire dans risks');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T6 — Écriture croisée entre projets refusée
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN PERFORM pg_temp.as_user('44444444-4444-4444-4444-444444444444'); -- metallurgist de A
  PERFORM pg_temp.expect_failure(
    $sql$INSERT INTO public.sim_flowsheets (project_id, name) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'FS-CROSS')$sql$,
    'S1-T6 écriture dans le projet B (non membre) refusée');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T7 — Perte d'accès d'un membre révoqué
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  UPDATE public.project_members SET revoked_at = now()
   WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND user_id = '33333333-3333-3333-3333-333333333333';
END $$;
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('33333333-3333-3333-3333-333333333333'); -- geologist révoqué
  SELECT count(*) INTO n FROM public.risks WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM pg_temp.assert(n = 0, 'S1-T7 un membre révoqué perd tout accès');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T8 — Compte non approuvé bloqué, même membre
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  UPDATE public.app_users SET status = 'pending'
   WHERE id = '22222222-2222-2222-2222-222222222222';
END $$;
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('22222222-2222-2222-2222-222222222222'); -- viewer non approuvé
  SELECT count(*) INTO n FROM public.risks WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM pg_temp.assert(n = 0, 'S1-T8 compte non approuvé ne voit rien, même membre');
END $$;
-- on restaure l'approbation pour ne pas polluer les tests suivants
DO $$ BEGIN
  UPDATE public.app_users SET status = 'approved'
   WHERE id = '22222222-2222-2222-2222-222222222222';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T9 — Refus d'escalade de privilège
--   Un project_manager gère l'équipe MAIS ne peut pas nommer un owner.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN PERFORM pg_temp.as_user('55555555-5555-5555-5555-555555555555'); -- project_manager
  -- nommer un viewer : autorisé
  INSERT INTO public.project_members (project_id, user_id, role)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999', 'viewer')
  ON CONFLICT (project_id, user_id) DO NOTHING;
  -- nommer un owner : refusé (anti-escalade)
  PERFORM pg_temp.expect_failure(
    $sql$UPDATE public.project_members SET role='owner'
         WHERE project_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND user_id='55555555-5555-5555-5555-555555555555'$sql$,
    'S1-T9 un project_manager ne peut pas se nommer owner (anti-escalade)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T10 — Création automatique du propriétaire à la création du projet
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.project_members
   WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND user_id = '11111111-1111-1111-1111-111111111111' AND role = 'owner' AND revoked_at IS NULL;
  PERFORM pg_temp.assert(n = 1, 'S1-T10 le propriétaire est créé automatiquement comme membre owner');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S1-T11 — Couverture RLS complète : aucun trou de domaine
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.mfp_rls_coverage_gaps;
  PERFORM pg_temp.assert(n = 0, 'S1-T11 aucune table projetée sans domaine déclaré');
END $$;

DO $$ BEGIN RAISE NOTICE '═══ S1 : tous les tests sont passés ═══'; END $$;
