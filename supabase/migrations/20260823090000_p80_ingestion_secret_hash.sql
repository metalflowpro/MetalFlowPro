-- ═══════════════════════════════════════════════════════════════════════════
-- 20260823090000_p80_ingestion_secret_hash.sql
-- Le secret du webhook LIMS ne doit plus être stocké ni relisible en clair.
-- Tout membre (y compris viewer) pouvait SELECT p80_ingestion_config.secret.
-- On conserve uniquement SHA-256 ; le clair n'existe qu'à la génération côté client.
-- ═══════════════════════════════════════════════════════════════════════════

-- digest() est fourni par pgcrypto ; les environnements Supabase existants ne
-- l'activent pas nécessairement, contrairement au banc local.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Sur Supabase, pgcrypto est installé dans le schéma `extensions`, pas `public` ;
-- en local il va dans `public`. On inclut les deux dans le search_path pour que
-- digest() soit résolu dans les deux environnements (un schéma absent est ignoré).
SET search_path = public, extensions, pg_temp;

ALTER TABLE public.p80_ingestion_config
  ADD COLUMN IF NOT EXISTS secret_hash text;

ALTER TABLE public.p80_ingestion_config
  ALTER COLUMN secret DROP NOT NULL;

UPDATE public.p80_ingestion_config
SET secret_hash = encode(digest(secret, 'sha256'), 'hex')
WHERE secret IS NOT NULL AND secret <> ''
  AND (secret_hash IS NULL OR secret_hash = '');

UPDATE public.p80_ingestion_config
SET secret = NULL
WHERE secret IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mfp_hash_p80_ingestion_secret()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.secret IS NOT NULL AND NEW.secret <> '' THEN
    NEW.secret_hash := encode(digest(NEW.secret, 'sha256'), 'hex');
    NEW.secret := NULL;
  END IF;
  IF NEW.secret_hash IS NULL OR NEW.secret_hash = '' THEN
    RAISE EXCEPTION 'p80_ingestion_config: un secret est requis à la création (il est haché, jamais stocké en clair).';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS p80_ingestion_hash_secret ON public.p80_ingestion_config;
CREATE TRIGGER p80_ingestion_hash_secret
  BEFORE INSERT OR UPDATE ON public.p80_ingestion_config
  FOR EACH ROW EXECUTE FUNCTION public.mfp_hash_p80_ingestion_secret();

COMMENT ON COLUMN public.p80_ingestion_config.secret_hash IS
  'SHA-256 hex du secret webhook. La colonne secret est vidée par trigger après hachage.';

REVOKE SELECT (secret, secret_hash) ON public.p80_ingestion_config FROM authenticated, anon;
