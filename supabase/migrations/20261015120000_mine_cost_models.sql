-- ═══════════════════════════════════════════════════════════════════════════
-- Coûts miniers (CAPEX / OPEX) — modèle par projet
--
-- Le module « Coûts miniers » de l'onglet Économie calcule le capital et les
-- coûts d'exploitation de la mine (ciel ouvert ou souterrain) à partir des
-- données du projet (débit, densité, durée de vie, paramètres de Mine &
-- Optimisation) et d'un référentiel documenté (src/lib/mining/referenceData.ts).
--
-- Une ligne par projet. On ne stocke que :
--   • `method`     — méthode retenue (open_pit | underground) ;
--   • `overrides`  — les SEULES hypothèses saisies par l'utilisateur (chemin
--                    pointé → valeur). Les valeurs non surchargées sont relues
--                    du projet à chaque ouverture : un changement de débit ou de
--                    densité se propage sans recopie figée ;
--   • `result_summary` — KPIs du dernier calcul injecté dans le modèle
--                    économique (traçabilité : ce qui a été écrit dans
--                    capex_lines / opex_lines, et quand) ;
--   • `applied_sustaining_musd_yr` — part minière ajoutée au capital de maintien
--                    du projet, pour pouvoir la remplacer sans toucher à la part
--                    usine lors d'une ré-application.
--
-- Sécurité : conforme S1 dès la création (domaine « mine », 4 politiques
-- canoniques mfp_can_read / mfp_can_write) — pas de politique héritée à retirer.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.mine_cost_models (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  method                     text NOT NULL DEFAULT 'open_pit'
                               CHECK (method IN ('open_pit', 'underground')),
  overrides                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary             jsonb,
  applied_sustaining_musd_yr numeric,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- ── S1 : déclaration table → domaine ────────────────────────────────────────
INSERT INTO public.mfp_table_domain (table_name, domain)
VALUES ('mine_cost_models', 'mine')
ON CONFLICT (table_name) DO UPDATE SET domain = EXCLUDED.domain;

-- ── S1 : politiques canoniques ──────────────────────────────────────────────
DO $mine_cost_s1$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mine_cost_models'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.mine_cost_models', pol.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.mine_cost_models ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.mine_cost_models FORCE ROW LEVEL SECURITY';

  EXECUTE 'CREATE POLICY mine_cost_models_s1_read ON public.mine_cost_models '
       || 'FOR SELECT TO authenticated USING (public.mfp_can_read(project_id, ''mine''))';
  EXECUTE 'CREATE POLICY mine_cost_models_s1_insert ON public.mine_cost_models '
       || 'FOR INSERT TO authenticated WITH CHECK (public.mfp_can_write(project_id, ''mine''))';
  EXECUTE 'CREATE POLICY mine_cost_models_s1_update ON public.mine_cost_models '
       || 'FOR UPDATE TO authenticated USING (public.mfp_can_write(project_id, ''mine'')) '
       || 'WITH CHECK (public.mfp_can_write(project_id, ''mine''))';
  EXECUTE 'CREATE POLICY mine_cost_models_s1_delete ON public.mine_cost_models '
       || 'FOR DELETE TO authenticated USING (public.mfp_can_write(project_id, ''mine''))';
END
$mine_cost_s1$;
