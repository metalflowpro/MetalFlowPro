-- ═══════════════════════════════════════════════════════════════════════════
-- Plant Optimizer — Mise en conformité S1 (RBAC par domaine) de plantopt_scenarios
--
-- La migration 20260828120000 a créé `plantopt_scenarios` avec des politiques
-- « propriétaire seul » (projects.user_id = auth.uid()) recopiées du gabarit
-- geomet, ANTÉRIEUR au socle S1. Or S1 (20260822010500) impose que toute table
-- portant project_id soit :
--   1. déclarée dans mfp_table_domain (sinon mfp_rls_coverage_gaps la signale et
--      le test S1-T11 échoue) ;
--   2. protégée par les 4 politiques canoniques mfp_can_read / mfp_can_write,
--      les politiques héritées faites main étant retirées (une politique
--      permissive résiduelle élargirait l'accès par combinaison OR).
--
-- Comme 120000 est déjà appliquée en prod, on ne réécrit pas son historique :
-- cette migration corrective, IDEMPOTENTE, amène aussi bien une base fraîche
-- (CI) qu'une base déjà migrée (prod) à l'état S1 correct.
--
-- Domaine retenu : « simulation » — Plant Optimizer est un module de simulation/
-- optimisation ; dans la matrice de rôles S1, owner et metallurgist y écrivent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Déclaration table → domaine ──────────────────────────────────────────
INSERT INTO public.mfp_table_domain (table_name, domain)
VALUES ('plantopt_scenarios', 'simulation')
ON CONFLICT (table_name) DO UPDATE SET domain = EXCLUDED.domain;

-- ── 2. Retrait des politiques héritées (owner-only de 120000) + toute autre ──
DO $plantopt_s1$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'plantopt_scenarios'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.plantopt_scenarios', pol.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.plantopt_scenarios ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.plantopt_scenarios FORCE ROW LEVEL SECURITY';

  -- ── 3. Politiques canoniques S1 (aucune logique recopiée) ─────────────────
  EXECUTE 'CREATE POLICY plantopt_scenarios_s1_read ON public.plantopt_scenarios '
       || 'FOR SELECT TO authenticated USING (public.mfp_can_read(project_id, ''simulation''))';
  EXECUTE 'CREATE POLICY plantopt_scenarios_s1_insert ON public.plantopt_scenarios '
       || 'FOR INSERT TO authenticated WITH CHECK (public.mfp_can_write(project_id, ''simulation''))';
  EXECUTE 'CREATE POLICY plantopt_scenarios_s1_update ON public.plantopt_scenarios '
       || 'FOR UPDATE TO authenticated USING (public.mfp_can_write(project_id, ''simulation'')) '
       || 'WITH CHECK (public.mfp_can_write(project_id, ''simulation''))';
  EXECUTE 'CREATE POLICY plantopt_scenarios_s1_delete ON public.plantopt_scenarios '
       || 'FOR DELETE TO authenticated USING (public.mfp_can_write(project_id, ''simulation''))';
END
$plantopt_s1$;
