-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822010000_s1_project_members_rbac.sql
-- S1 — Collaboration multi-projets par rôles métier. Corrige F3.
--
-- Auteur : reconstruit à partir de la spécification « Phase 0 — Socle industriel »
-- (le SQL S1 d'origine n'était pas fourni au dépôt). S2→S7 dépendent de ce
-- fichier : project_members, mfp_can_read/write, mfp_role_permission, etc.
--
-- Le problème :
--   L'appartenance reposait sur la seule colonne projects.user_id ; toutes les
--   politiques RLS recopiaient à la main le prédicat
--   `EXISTS (SELECT 1 FROM projects WHERE id=project_id AND user_id=auth.uid())`.
--   Conséquences : un projet = une seule personne (l'équipe partage un compte,
--   la piste d'audit devient sans valeur) ; aucune granularité (quiconque a
--   accès écrit tout, y compris signer) ; prédicat recopié ~111 fois (dette).
--
-- La solution : un modèle PILOTÉ PAR LES DONNÉES.
--   project_members     qui, dans quel projet, avec quel rôle
--   mfp_domain          les 19 domaines métier
--   mfp_role_permission quel rôle lit / écrit quel domaine
--   mfp_table_domain    quelle table relève de quel domaine (peuplée en 010500)
--   mfp_can_read/write  décident l'autorisation (SECURITY DEFINER, STABLE)
--   mfp_project_role    rôle courant de auth.uid() dans un projet
--
-- Décisions techniques :
--   • SECURITY DEFINER + search_path figé : mfp_can_read lit project_members,
--     elle-même sous RLS → sans DEFINER, récursion infinie. search_path fermé
--     contre l'attaque par table homonyme.
--   • STABLE : mémoïsable dans une requête (lecture de bm_blocks = millions de
--     lignes).
--   • Lecture large, écriture étroite : tout membre non révoqué lit tout le
--     projet ; l'écriture est bornée au domaine du rôle.
--   • Le défaut est fermé : une table non déclarée bascule en 'core'.
--   • projects.user_id conservée (héritée) et synchronisée avec le membre owner
--     par trigger — le code non migré continue de voir une valeur juste.
--   • Verrou anti-escalade : un project_manager gère l'équipe mais ne peut pas
--     nommer un owner (WITH CHECK).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Les 9 rôles métier ───────────────────────────────────────────────────
-- owner, project_manager, geologist, metallurgist, mining_engineer, economist,
-- qp (personne qualifiée — signe, n'écrit que les rapports), operator, viewer.

CREATE TABLE IF NOT EXISTS public.project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN (
                'owner','project_manager','geologist','metallurgist',
                'mining_engineer','economist','qp','operator','viewer')),
  invited_by  uuid REFERENCES auth.users(id),
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user    ON public.project_members (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members (project_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.project_members IS
  'Appartenance projet par rôle métier (S1). Une ligne révoquée (revoked_at) perd tout accès sans être supprimée (traçabilité).';

-- ── 2. Domaines métier (19) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfp_domain (
  domain      text PRIMARY KEY,
  label       text NOT NULL
);

INSERT INTO public.mfp_domain (domain, label) VALUES
  ('core',           'Socle projet'),
  ('governance',     'Gouvernance / stage-gates / snapshots'),
  ('drilling',       'Forages'),
  ('resource',       'Estimation de ressource'),
  ('block_model',    'Modèle de blocs'),
  ('geometallurgy',  'Géométallurgie'),
  ('lims',           'LIMS / essais'),
  ('granulometry',   'Granulométrie / Étude P80'),
  ('criteria',       'Critères de conception'),
  ('parameters',     'Paramètres métallurgiques'),
  ('flowsheet',      'Flowsheet ingénierie'),
  ('mass_balance',   'Bilan massique & eau'),
  ('equipment',      'Équipements'),
  ('simulation',     'Simulation'),
  ('mine',           'Mine & optimisation'),
  ('economic_model', 'Modèle économique'),
  ('risks',          'Registre des risques'),
  ('reports',        'Rapports / NI 43-101 / conformité'),
  ('cognitive_ops',  'Système d''exploitation cognitif')
ON CONFLICT (domain) DO UPDATE SET label = EXCLUDED.label;

-- ── 3. Table de correspondance table → domaine (peuplée en 010500) ──────────
CREATE TABLE IF NOT EXISTS public.mfp_table_domain (
  table_name  text PRIMARY KEY,
  domain      text NOT NULL REFERENCES public.mfp_domain(domain)
);

COMMENT ON TABLE public.mfp_table_domain IS
  'Quelle table métier relève de quel domaine S1. Le défaut (table absente) est ''core'' — défaut fermé.';

-- ── 4. Matrice de droits rôle × domaine ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfp_role_permission (
  role       text NOT NULL,
  domain     text NOT NULL REFERENCES public.mfp_domain(domain),
  can_read   boolean NOT NULL DEFAULT false,
  can_write  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, domain)
);

COMMENT ON TABLE public.mfp_role_permission IS
  'Droits data-driven : changer un droit = UPDATE d''une ligne, aucune politique à réécrire (S1).';

-- Lecture large : tout rôle lit tous les domaines (un métallurgiste doit voir le
-- modèle économique, un économiste les récupérations). L'écriture est réglée
-- ensuite, domaine par domaine.
INSERT INTO public.mfp_role_permission (role, domain, can_read, can_write)
SELECT r.role, d.domain, true, false
FROM (VALUES
  ('owner'),('project_manager'),('geologist'),('metallurgist'),
  ('mining_engineer'),('economist'),('qp'),('operator'),('viewer')
) AS r(role)
CROSS JOIN public.mfp_domain d
ON CONFLICT (role, domain) DO UPDATE SET can_read = EXCLUDED.can_read;

-- Écriture, par rôle (cf. tableau S1). owner écrit partout ; viewer nulle part.
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'owner';
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'project_manager'
  AND domain IN ('core','governance','reports','risks');
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'geologist'
  AND domain IN ('drilling','resource','block_model','geometallurgy');
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'metallurgist'
  AND domain IN ('lims','granulometry','criteria','parameters','flowsheet',
                 'mass_balance','equipment','simulation','geometallurgy');
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'mining_engineer'
  AND domain IN ('mine','block_model','geometallurgy');
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'economist'
  AND domain IN ('economic_model','mass_balance','risks');
-- La personne qualifiée n'écrit QUE les rapports (indépendance du signataire).
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'qp'
  AND domain IN ('reports');
UPDATE public.mfp_role_permission SET can_write = true WHERE role = 'operator'
  AND domain IN ('cognitive_ops');
-- viewer : aucune écriture (rien à faire).

-- ── 5. Fonctions de décision (SECURITY DEFINER, STABLE, search_path figé) ────
CREATE OR REPLACE FUNCTION public.mfp_project_role(p_project uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT role FROM public.project_members
  WHERE project_id = p_project AND user_id = auth.uid() AND revoked_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mfp_can_read(p_project uuid, p_domain text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_role text;
BEGIN
  IF p_project IS NULL THEN RETURN false; END IF;
  IF NOT public.is_approved() THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.project_members
   WHERE project_id = p_project AND user_id = auth.uid() AND revoked_at IS NULL
   LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.mfp_role_permission
                 WHERE role = v_role AND domain = p_domain AND can_read);
END $$;

CREATE OR REPLACE FUNCTION public.mfp_can_write(p_project uuid, p_domain text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_role text;
BEGIN
  IF p_project IS NULL THEN RETURN false; END IF;
  IF NOT public.is_approved() THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.project_members
   WHERE project_id = p_project AND user_id = auth.uid() AND revoked_at IS NULL
   LIMIT 1;
  IF v_role IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.mfp_role_permission
                 WHERE role = v_role AND domain = p_domain AND can_write);
END $$;

GRANT EXECUTE ON FUNCTION public.mfp_project_role(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfp_can_read(uuid, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.mfp_can_write(uuid, text)   TO authenticated;

-- ── 6. Synchronisation projects.user_id ↔ membre owner ──────────────────────
-- À la création d'un projet, le propriétaire devient automatiquement membre
-- 'owner' (test T10 : « création automatique du propriétaire »). La colonne
-- projects.user_id reste maintenue pour le code non encore migré.
CREATE OR REPLACE FUNCTION public.mfp_project_owner_sync()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.project_members (project_id, user_id, role, invited_by)
    VALUES (NEW.id, NEW.user_id, 'owner', NEW.user_id)
    ON CONFLICT (project_id, user_id)
      DO UPDATE SET role = 'owner', revoked_at = NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_owner_sync ON public.projects;
CREATE TRIGGER projects_owner_sync
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.mfp_project_owner_sync();

-- Backfill : chaque projet existant obtient son membre owner.
INSERT INTO public.project_members (project_id, user_id, role, invited_by)
SELECT p.id, p.user_id, 'owner', p.user_id
FROM public.projects p
WHERE p.user_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── 7. RLS sur project_members (lecture par appartenance, verrou anti-escalade)
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_members_read   ON public.project_members;
DROP POLICY IF EXISTS project_members_insert ON public.project_members;
DROP POLICY IF EXISTS project_members_update ON public.project_members;
DROP POLICY IF EXISTS project_members_delete ON public.project_members;

-- Lecture : tout membre approuvé lit la liste des membres de son projet.
CREATE POLICY project_members_read ON public.project_members
  FOR SELECT TO authenticated
  USING (public.mfp_can_read(project_id, 'core'));

-- Gestion d'équipe : réservée à owner / project_manager. Anti-escalade : on ne
-- peut créer/mettre un membre 'owner' que si l'on est soi-même owner.
CREATE POLICY project_members_insert ON public.project_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.mfp_project_role(project_id) IN ('owner','project_manager')
    AND (role <> 'owner' OR public.mfp_project_role(project_id) = 'owner')
  );

CREATE POLICY project_members_update ON public.project_members
  FOR UPDATE TO authenticated
  USING (public.mfp_project_role(project_id) IN ('owner','project_manager'))
  WITH CHECK (
    public.mfp_project_role(project_id) IN ('owner','project_manager')
    AND (role <> 'owner' OR public.mfp_project_role(project_id) = 'owner')
  );

CREATE POLICY project_members_delete ON public.project_members
  FOR DELETE TO authenticated
  USING (
    public.mfp_project_role(project_id) IN ('owner','project_manager')
    AND (role <> 'owner' OR public.mfp_project_role(project_id) = 'owner')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;

-- ── 8. RLS des tables de configuration (référentiels globaux, lecture seule) ─
-- Elles sont lisibles par tout utilisateur authentifié (matrice de droits
-- consultable par un chef de projet) ; l'écriture reste réservée au backend
-- (service_role, BYPASSRLS) et aux migrations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mfp_domain','mfp_table_domain','mfp_role_permission'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ── 9. Politiques canoniques sur projects (membership-based) ────────────────
-- On remplace les politiques héritées (approved-based / owner-based) par des
-- politiques d'appartenance. INSERT reste user_id = auth.uid() (volontaire) :
-- un projet neuf n'a pas encore de membre, donc mfp_can_write échouerait
-- (poule/œuf) ; le trigger projects_owner_sync crée le membre owner ensuite.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='projects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.projects', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_s1_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.mfp_can_read(id, 'core'));

CREATE POLICY projects_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_approved());

CREATE POLICY projects_s1_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.mfp_can_write(id, 'core'))
  WITH CHECK (public.mfp_can_write(id, 'core'));

CREATE POLICY projects_s1_delete ON public.projects
  FOR DELETE TO authenticated
  USING (public.mfp_project_role(id) = 'owner');
