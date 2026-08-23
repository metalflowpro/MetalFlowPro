-- Prouve que le secret webhook n'est jamais persisté en clair.

\set QUIET on

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.app_users (id, email, status, is_admin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner.a@mf.pro', 'approved', false)
ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, is_admin = EXCLUDED.is_admin;

INSERT INTO public.projects (id, code, name, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PA', 'Projet A', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.p80_study (id, project_id, study_name)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Étude secret')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.assert(cond boolean, msg text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS — %', msg;
  ELSE RAISE EXCEPTION 'ÉCHEC — %', msg; END IF;
END $$;

DO $$
DECLARE
  stored_secret text;
  stored_hash text;
  expected text := encode(digest('super-secret-webhook', 'sha256'), 'hex');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='p80_ingestion_config') THEN
    RAISE NOTICE 'SKIP — p80_ingestion_config absente';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p80_study WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') THEN
    RAISE NOTICE 'SKIP — p80_study introuvable (schéma incomplet)';
    RETURN;
  END IF;

  INSERT INTO public.p80_ingestion_config (project_id, study_id, enabled, secret)
  VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    true,
    'super-secret-webhook'
  )
  ON CONFLICT (study_id) DO UPDATE SET secret = EXCLUDED.secret, enabled = true;

  SELECT secret, secret_hash INTO stored_secret, stored_hash
  FROM public.p80_ingestion_config
  WHERE study_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  PERFORM pg_temp.assert(stored_secret IS NULL, 'SEC-T1 secret en clair absent après INSERT');
  PERFORM pg_temp.assert(stored_hash = expected, 'SEC-T1 secret_hash = SHA-256 du clair');
END $$;
