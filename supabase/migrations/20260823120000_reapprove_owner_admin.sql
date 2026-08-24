-- ═══════════════════════════════════════════════════════════════════════════
-- Ré-approbation de l'administrateur initial : contact@metalflow.pro.
--
-- Le backfill de 20260808120000 (approbation + is_admin) n'agit que sur les lignes
-- PRÉSENTES au moment de son exécution. Un compte propriétaire (re)créé APRÈS cette
-- migration est inséré en « pending » par le trigger handle_new_user() et n'est
-- jamais rattrapé → écran « Compte en attente de validation », personne ne pouvant
-- l'approuver puisqu'aucun admin n'existe encore.
--
-- Cette migration idempotente garantit que le compte propriétaire est approuvé et
-- administrateur, qu'il existe déjà (UPDATE) ou non (INSERT via auth.users).
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.app_users (id, email, status, is_admin, approved_at)
SELECT id, email, 'approved', true, now()
FROM auth.users
WHERE email = 'contact@metalflow.pro'
ON CONFLICT (id) DO UPDATE
  SET status = 'approved', is_admin = true, approved_at = now();
