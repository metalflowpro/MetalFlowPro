-- ═══════════════════════════════════════════════════════════════════════════
-- bootstrap.sql — reconstitue le minimum de Supabase pour rejouer les migrations
-- et les tests RLS sur un Postgres vanilla (banc local Phase 0/1).
--
-- Fournit : extension pgcrypto (digest/gen_random_uuid), les rôles
-- anon/authenticated/service_role, le schéma auth, la table auth.users et la
-- fonction auth.uid() — implémentée EXACTEMENT comme PostgREST la nourrit, en
-- lisant request.jwt.claim.sub. Les tests basculent en `set local role
-- authenticated` : un test qui tournerait en superutilisateur passerait toujours
-- (RLS contournée) et ne prouverait rien.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Rôles Supabase ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- ── Privilèges par défaut (le superutilisateur applique migrations ET tables →
--    authenticated/anon/service_role reçoivent les droits sur ce qui est créé) ─
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ── Schéma auth minimal ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- auth.uid() : lit le claim `sub` du JWT tel que PostgREST le pose en GUC.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
