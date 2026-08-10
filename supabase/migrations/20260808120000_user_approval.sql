-- ═══════════════════════════════════════════════════════════════════════════
-- Validation des comptes par un administrateur avant tout accès.
--
-- Un nouveau compte s'inscrit toujours en statut « pending » : il obtient une
-- session Supabase mais NE PEUT accéder à AUCUNE donnée tant qu'un administrateur
-- ne l'a pas approuvé. Le verrou est posé au niveau RLS (pas seulement l'écran) :
-- toutes les données du projet pendent de `projects`, donc verrouiller `projects`
-- sur l'approbation rend l'application inutilisable pour un compte non validé.
--
-- Admin initial : contact@metalflow.pro (approuvé + is_admin). Tous les autres
-- comptes existants repassent en « pending » et devront être revalidés.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Table de statut par utilisateur ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_admin    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- ── Fonctions de contrôle (SECURITY DEFINER → contournent la RLS, pas de
--    récursion de politique quand elles sont appelées DANS une politique) ─────
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND status = 'approved');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND is_admin = true AND status = 'approved');
$$;

-- ── Création automatique de la ligne à l'inscription (statut pending) ────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.app_users (id, email, status)
  VALUES (NEW.id, NEW.email, 'pending')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Backfill des comptes existants : tous « pending » sauf l'admin ──────────
INSERT INTO public.app_users (id, email, status)
SELECT id, email, 'pending' FROM auth.users
ON CONFLICT (id) DO NOTHING;

UPDATE public.app_users SET status = 'pending', is_admin = false
WHERE email IS DISTINCT FROM 'contact@metalflow.pro';

UPDATE public.app_users
SET status = 'approved', is_admin = true, approved_at = now()
WHERE email = 'contact@metalflow.pro';

-- ── RLS sur app_users ───────────────────────────────────────────────────────
-- Chaque utilisateur lit SA ligne (pour connaître son statut) ; l'admin lit et
-- met à jour toutes les lignes (approuver / rejeter / promouvoir). Aucun INSERT
-- ni DELETE côté client : le trigger crée la ligne, le CASCADE la supprime.
DROP POLICY IF EXISTS app_users_self_select  ON public.app_users;
DROP POLICY IF EXISTS app_users_admin_select ON public.app_users;
DROP POLICY IF EXISTS app_users_admin_update ON public.app_users;

CREATE POLICY app_users_self_select ON public.app_users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY app_users_admin_select ON public.app_users
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY app_users_admin_update ON public.app_users
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Verrou d'accès : projects exige un compte approuvé ──────────────────────
-- Point de contrôle unique : toutes les tables « enfant » sont déjà bornées à
-- `project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())`, donc un
-- compte non approuvé — incapable de voir ou créer un projet — ne peut rien faire.
-- On retire aussi l'accès anonyme au passage.
DROP POLICY IF EXISTS anon_select_projects ON public.projects;
DROP POLICY IF EXISTS anon_insert_projects ON public.projects;
DROP POLICY IF EXISTS anon_update_projects ON public.projects;
DROP POLICY IF EXISTS anon_delete_projects ON public.projects;

CREATE POLICY projects_approved_select ON public.projects
  FOR SELECT TO authenticated
  USING (public.is_approved());

CREATE POLICY projects_approved_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_approved());

CREATE POLICY projects_approved_update ON public.projects
  FOR UPDATE TO authenticated
  USING (public.is_approved())
  WITH CHECK (public.is_approved());

CREATE POLICY projects_approved_delete ON public.projects
  FOR DELETE TO authenticated
  USING (public.is_approved());
