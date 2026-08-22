-- ═══════════════════════════════════════════════════════════════════════════
-- s2_audit.sql — Tests fonctionnels du chantier S2 (piste d'audit inviolable).
-- Même convention que s1_rls.sql : chaque DO block bascule en role authenticated
-- + claim sub dans la même transaction ; expect_failure pour les écritures
-- devant être refusées.
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on

-- ── Préparation (superutilisateur) ────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro'),
  ('22222222-2222-2222-2222-222222222222', 'viewer.a@mf.pro'),
  ('66666666-6666-6666-6666-666666666666', 'admin@mf.pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_users (id, email, status, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro', 'approved', false),
  ('22222222-2222-2222-2222-222222222222', 'viewer.a@mf.pro', 'approved', false),
  ('66666666-6666-6666-6666-666666666666', 'admin@mf.pro', 'approved', true)
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, is_admin = EXCLUDED.is_admin, email = EXCLUDED.email;

INSERT INTO public.projects (id, code, name, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PA', 'Projet A', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PB', 'Projet B', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.project_members (project_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'viewer')
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO public.risks (project_id, description) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Risque initial')
ON CONFLICT DO NOTHING;

-- ── Helpers ───────────────────────────────────────────────────────────────
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
-- S2-T1 — Un membre journalise via mfp_audit_log et relit son entrée
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int; uid uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  uid := public.mfp_audit_log(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'update_settings',
    'project_settings', 'aaaa', '{"x":1}'::jsonb, '{"x":2}'::jsonb);
  SELECT count(*) INTO n FROM public.audit_logs WHERE id = uid;
  PERFORM pg_temp.assert(n = 1, 'S2-T1 entrée journalisée et relue');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T2 — Le user_id est attribué par le serveur (non falsifiable)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE logged uuid;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  logged := public.mfp_audit_log(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'update_settings',
    'project_settings', NULL, NULL, '{}'::jsonb);
  PERFORM pg_temp.assert(
    (SELECT user_id FROM public.audit_logs WHERE id = logged)
      = '11111111-1111-1111-1111-111111111111'::uuid,
    'S2-T2 user_id = auth.uid() imposé par le serveur');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T3 — Un membre ne voit PAS les logs du projet d'autrui
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  -- le propriétaire de B (viewer.a) journalise dans B
  PERFORM set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',true);
  PERFORM public.mfp_audit_log('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'create', 'project', NULL, NULL, '{}'::jsonb);
  -- revenu en owner.a : ne doit pas voir les logs de B
  PERFORM set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',true);
  SELECT count(*) INTO n FROM public.audit_logs WHERE project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  PERFORM pg_temp.assert(n = 0, 'S2-T3 owner.a ne voit pas les logs du projet B');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T4 — INSERT direct interdit côté client (pas de politique INSERT)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.expect_failure(
    $sql$INSERT INTO public.audit_logs (project_id, user_id, action, entity_type)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'create', 'x')$sql$,
    'S2-T4 INSERT direct refusé (écriture uniquement via mfp_audit_log)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T5 — UPDATE refusé côté client (RLS : 0 ligne, silencieux → piège T3b)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  UPDATE public.audit_logs SET action = 'FORGÉ'
  WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_temp.assert(n = 0, 'S2-T5 UPDATE refusé (0 ligne, piège T3b)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T6 — Immuable même pour service_role (trigger de défense en profondeur)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  PERFORM set_config('role','service_role',true);
  PERFORM pg_temp.expect_failure(
    $sql$DELETE FROM public.audit_logs WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' LIMIT 1$sql$,
    'S2-T6 DELETE refusé même pour service_role (append-only)');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T7 — Journalisation croisée refusée (on ne log pas contre un projet
--         auquel on n'appartient pas)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.expect_failure(
    $sql$SELECT public.mfp_audit_log('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'create', 'project', NULL, NULL, '{}'::jsonb)$sql$,
    'S2-T7 journalisation croisée vers le projet B refusée');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T8 — Capture automatique serveur : un UPDATE sur risks trace les vraies
--         valeurs avant/après (source = trigger), sans intervention client
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ DECLARE n int; prev text;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  UPDATE public.risks SET description = 'Risque modifié'
  WHERE project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) INTO n FROM public.audit_logs
  WHERE entity_type = 'risks' AND source = 'trigger' AND action = 'update';
  PERFORM pg_temp.assert(n >= 1, 'S2-T8 capture automatique serveur (risks update)');
  -- les vraies valeurs avant/après sont bien enregistrées
  SELECT (previous_values->>'description') INTO prev FROM public.audit_logs
  WHERE entity_type = 'risks' AND source = 'trigger' AND action = 'update' LIMIT 1;
  PERFORM pg_temp.assert(prev = 'Risque initial', 'S2-T8 previous_values capturé côté serveur');
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- S2-T9 — Les logs système (project_id NULL) ne sont visibles que de l'admin
-- ═══════════════════════════════════════════════════════════════════════════
-- Insertion d'un log système par le backend (service_role, user_id fourni)
DO $$
BEGIN
  PERFORM set_config('role','service_role',true);
  INSERT INTO public.audit_logs (project_id, user_id, action, entity_type, source)
  VALUES (NULL, '11111111-1111-1111-1111-111111111111', 'system_event', 'system', 'system');
END $$;
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('11111111-1111-1111-1111-111111111111');
  SELECT count(*) INTO n FROM public.audit_logs WHERE project_id IS NULL;
  PERFORM pg_temp.assert(n = 0, 'S2-T9 logs système invisibles pour un non-admin');
END $$;
DO $$ DECLARE n int;
BEGIN PERFORM pg_temp.as_user('66666666-6666-6666-6666-666666666666');
  SELECT count(*) INTO n FROM public.audit_logs WHERE project_id IS NULL;
  PERFORM pg_temp.assert(n >= 1, 'S2-T9 logs système visibles par l''admin');
END $$;

DO $$ BEGIN RAISE NOTICE '═══ S2 : tous les tests sont passés ═══'; END $$;
