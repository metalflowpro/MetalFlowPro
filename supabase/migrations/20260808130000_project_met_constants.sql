-- ═══════════════════════════════════════════════════════════════════════════
-- Surcharges de constantes métallurgiques par projet.
--
-- Stocke, par projet, les valeurs qui surchargent les constantes par défaut
-- (voir src/lib/config/constants.ts). Une seule ligne par projet, un objet JSON
-- `overrides` partiel — le code applique défauts ⊕ overrides (resolveMetConstants).
--
-- Owner-scoped comme les autres tables enfant. Le verrou d'approbation est déjà
-- assuré en amont par la RLS sur `projects` (un compte non approuvé n'a aucun
-- projet), donc on borne simplement à la propriété du projet ici.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.project_met_constants (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  overrides  jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_met_constants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pmc_owner_all ON public.project_met_constants;
CREATE POLICY pmc_owner_all ON public.project_met_constants
  FOR ALL TO authenticated
  USING      (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
