-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822080000_projects_user_id_default.sql
-- Rétablit projects.user_id DEFAULT auth.uid().
--
-- Symptôme (prod) : impossible de créer un projet — « new row violates
-- row-level security policy for table projects » — pour TOUS les comptes, y
-- compris l'admin approuvé. La policy INSERT S1 impose
--   WITH CHECK (user_id = auth.uid() AND public.is_approved())
-- L'admin étant approuvé, la seule condition qui pouvait échouer est
-- user_id = auth.uid() : user_id arrivait NULL. Le DEFAULT auth.uid() posé en
-- 20260629185920 avait disparu en prod (dérive : S1 a été réécrit/rejoué). Le
-- banc local ne le voyait pas car ses tests insèrent user_id explicitement.
--
-- Correctif base (défense en profondeur) : on ré-affirme le défaut. Le correctif
-- applicatif (App.tsx envoie désormais user_id explicitement) rend l'app
-- indépendante de ce défaut ; cette migration protège les autres chemins
-- d'écriture et corrige la dérive de schéma.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.projects
  ALTER COLUMN user_id SET DEFAULT auth.uid();
