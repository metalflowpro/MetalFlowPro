-- ═══════════════════════════════════════════════════════════════════════════
-- Plant Optimizer — Scénarios d'optimisation d'usine (module RAM/DES)
--
-- Le module « Plant Optimizer » identifie les goulots macro d'une usine par
-- simulation Monte-Carlo à événements discrets. Un SCÉNARIO fige, pour un projet :
--   • le modèle d'usine (aires, flux, tampons, modes de défaillance, arrêts,
--     causes communes, scénario d'alimentation) — colonne `model` (jsonb) ;
--   • les réglages Monte-Carlo (itérations, graine, rodage, pas, horizon)
--     — colonne `config` (jsonb) ;
--   • un résumé de résultat (P10/P50/P90, dispo, coût/t, goulot dominant)
--     — colonne `result_summary` (jsonb), pour comparer deux scénarios sans
--     relancer le calcul.
--
-- Reproductibilité : (`model`, `config`) suffisent à rejouer un run à l'identique
-- (graine fixe ⇒ résultat identique). L'exécution et l'enregistrement émettent en
-- plus un événement `audit_logs` (action run_plant_optimization / entity
-- plant_opt_scenario) — voir src/lib/plantopt/scenarioStore.ts.
--
-- Isolation par project_id + RLS propriétaire-ET-approuvé, identique aux tables
-- p80_* (20260819120000) et geomet_* (20260821130000). public.is_approved()
-- existe déjà (20260808120000_user_approval).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plantopt_scenarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name           text NOT NULL DEFAULT 'Scénario',
  -- Modèle d'usine complet (sérialisé) — tout ce qu'il faut pour rejouer.
  model          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Réglages d'exécution Monte-Carlo.
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Résumé de résultat figé (KPIs) — nullable tant qu'aucun run n'a été enregistré.
  result_summary jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plantopt_scenarios_project
  ON plantopt_scenarios (project_id, created_at DESC);

-- ── RLS : propriétaire du projet ET compte approuvé ───────────────────────────

DO $plantopt_rls$
DECLARE t text := 'plantopt_scenarios';
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_insert', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_update', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_delete', t);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
    t || '_owner_select', t);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
    t || '_owner_insert', t);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved())) WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
    t || '_owner_update', t);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
    t || '_owner_delete', t);
END
$plantopt_rls$;
