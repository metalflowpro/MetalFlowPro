-- ═══════════════════════════════════════════════════════════════════════════
-- Durcissement — tables de configuration du socle sans RLS
--
-- `mfp_lifecycle_status` (S3 : statuts, verrouillage des versions publiées) et
-- `mfp_project_consistency_rule` (S5 : règles d'étanchéité inter-projets) ont
-- été créées sans RLS. Avec les privilèges par défaut de Supabase, les rôles
-- `anon` ET `authenticated` pouvaient y écrire via l'API REST : un visiteur
-- muni de la clé publique pouvait déverrouiller un statut publié ou désactiver
-- une règle d'étanchéité, neutralisant S3/S5.
--
-- Correctif :
--   • RLS activée ; lecture seule pour `authenticated` (les triggers S3/S5
--     s'exécutent avec les droits de l'appelant et doivent lire ces règles) ;
--   • aucune politique d'écriture + REVOKE des droits d'écriture : seules les
--     migrations (rôle propriétaire / service_role) modifient la configuration ;
--   • `anon` perd aussi la lecture (aucun usage côté visiteur).
-- Pas de FORCE ROW LEVEL SECURITY : les fonctions SECURITY DEFINER du socle,
-- propriétaires des tables, doivent continuer à les lire.
-- ═══════════════════════════════════════════════════════════════════════════

DO $harden$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mfp_lifecycle_status', 'mfp_project_consistency_rule'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_read', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('REVOKE SELECT ON public.%I FROM anon', t);
  END LOOP;
END
$harden$;
