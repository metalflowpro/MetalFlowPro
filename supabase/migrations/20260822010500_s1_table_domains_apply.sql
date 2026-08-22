-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822010500_s1_table_domains_apply.sql
-- S1 (2/2) — Déclaration table→domaine + génération des politiques canoniques.
--
-- Auteur : reconstruit à partir de la spécification « Phase 0 — Socle industriel ».
--
-- 1. Peuple mfp_table_domain pour TOUTE table portant project_id (défaut fermé
--    'core' si non classée), par familles de noms (cf. audit des 114 tables).
-- 2. Pour chaque table métier projetée : FORCE RLS, retire les politiques
--    héritées (recopie manuelle de projects.user_id = auth.uid()), et pose 4
--    politiques canoniques SANS logique :
--       select  → mfp_can_read(project_id, <domaine>)
--       insert  → mfp_can_write(project_id, <domaine>)  (WITH CHECK)
--       update  → mfp_can_write(project_id, <domaine>)  (USING + WITH CHECK)
--       delete  → mfp_can_write(project_id, <domaine>)
-- 3. Vue mfp_rls_coverage_gaps : tables projetées sans domaine déclaré. La
--    migration lève une exception si elle n'est pas vide — garde-fou F4 : toute
--    table métier future doit être déclarée pour que sa migration passe.
--
-- Exclusions (gérées ailleurs, ou racine / config) :
--   projects (racine, politiques posées en 010000), audit_logs (S2),
--   project_members + mfp_* (config, RLS propre en 010000).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Déclaration table → domaine (data-driven, par familles de noms) ──────
INSERT INTO public.mfp_table_domain (table_name, domain)
SELECT c.table_name,
  CASE
    -- granulométrie / P80 (attention : certaines tables commencent par lims_)
    WHEN c.table_name IN ('lims_granulometry','lims_psd_fractions','lims_liberation') THEN 'granulometry'
    WHEN c.table_name LIKE 'p80\_%' ESCAPE '\' THEN 'granulometry'
    WHEN c.table_name = 'granulometry_params' THEN 'granulometry'
    -- LIMS / essais
    WHEN c.table_name LIKE 'lims\_%' ESCAPE '\' THEN 'lims'
    -- forages
    WHEN c.table_name LIKE 'dh\_%' ESCAPE '\' THEN 'drilling'
    -- modèle de blocs
    WHEN c.table_name LIKE 'bm\_%' ESCAPE '\' THEN 'block_model'
    -- ressource
    WHEN c.table_name = 'resource_estimation_runs' THEN 'resource'
    -- critères de conception
    WHEN c.table_name IN ('dc_draft','dc_snapshots') THEN 'criteria'
    -- paramètres métallurgiques
    WHEN c.table_name IN ('process_factors','sim_feed_link','project_met_constants') THEN 'parameters'
    -- flowsheet ingénierie
    WHEN c.table_name = 'project_flowsheets' THEN 'flowsheet'
    -- bilan massique & carbone
    WHEN c.table_name IN ('mass_balance_streams','carbon_footprint_items') THEN 'mass_balance'
    -- équipements
    WHEN c.table_name = 'equipment_items' THEN 'equipment'
    -- simulation
    WHEN c.table_name LIKE 'sim\_%' ESCAPE '\' OR c.table_name = 'circuit_recommendations' THEN 'simulation'
    -- géométallurgie
    WHEN c.table_name LIKE 'geomet\_%' ESCAPE '\' THEN 'geometallurgy'
    -- mine
    WHEN c.table_name LIKE 'mine\_%' ESCAPE '\' THEN 'mine'
    -- système d'exploitation cognitif
    WHEN c.table_name LIKE 'cos\_%' ESCAPE '\' THEN 'cognitive_ops'
    -- économie / Monte-Carlo / fiscalité
    WHEN c.table_name IN ('capex_lines','opex_lines','monte_carlo_configs','project_fiscal_selection') THEN 'economic_model'
    -- risques
    WHEN c.table_name IN ('risks','risk_auto_sources') THEN 'risks'
    -- rapports / NI 43-101 / conformité
    WHEN c.table_name IN ('report_documents','ni43101_reports','ni43101_sections',
                          'qualified_persons','report_section_signoffs') THEN 'reports'
    -- gouvernance / stage-gates / snapshots
    WHEN c.table_name IN ('stage_gate_items','module_status','project_snapshots') THEN 'governance'
    -- socle projet
    WHEN c.table_name IN ('project_settings','project_metals') THEN 'core'
    -- défaut fermé
    ELSE 'core'
  END AS domain
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
WHERE c.column_name = 'project_id' AND c.table_schema = 'public'
  AND c.table_name NOT IN ('projects','audit_logs','project_members')
  AND c.table_name NOT LIKE 'mfp\_%' ESCAPE '\'
ON CONFLICT (table_name) DO UPDATE SET domain = EXCLUDED.domain;

-- ── 2. Génération des politiques canoniques ─────────────────────────────────
DO $$
DECLARE
  r        record;
  v_domain text;
  pol      record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    WHERE c.column_name = 'project_id' AND c.table_schema = 'public'
      AND c.table_name NOT IN ('projects','audit_logs','project_members')
      AND c.table_name NOT LIKE 'mfp\_%' ESCAPE '\'
    ORDER BY c.table_name
  LOOP
    SELECT domain INTO v_domain FROM public.mfp_table_domain WHERE table_name = r.table_name;
    v_domain := COALESCE(v_domain, 'core');  -- défaut fermé (filet de sécurité)

    -- Retire TOUTES les politiques héritées (prédicats recopiés à la main) :
    -- une politique permissive résiduelle élargirait l'accès (combinaison OR).
    FOR pol IN SELECT policyname FROM pg_policies
               WHERE schemaname = 'public' AND tablename = r.table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, r.table_name);
    END LOOP;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.mfp_can_read(project_id, %L))',
      r.table_name || '_s1_read', r.table_name, v_domain);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
      'WITH CHECK (public.mfp_can_write(project_id, %L))',
      r.table_name || '_s1_insert', r.table_name, v_domain);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
      'USING (public.mfp_can_write(project_id, %L)) WITH CHECK (public.mfp_can_write(project_id, %L))',
      r.table_name || '_s1_update', r.table_name, v_domain, v_domain);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
      'USING (public.mfp_can_write(project_id, %L))',
      r.table_name || '_s1_delete', r.table_name, v_domain);
  END LOOP;
END $$;

-- ── 3. Vue de couverture + garde-fou ────────────────────────────────────────
CREATE OR REPLACE VIEW public.mfp_rls_coverage_gaps AS
SELECT c.table_name
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
WHERE c.column_name = 'project_id' AND c.table_schema = 'public'
  AND c.table_name NOT IN ('projects','audit_logs','project_members')
  AND c.table_name NOT LIKE 'mfp\_%' ESCAPE '\'
  AND NOT EXISTS (SELECT 1 FROM public.mfp_table_domain d WHERE d.table_name = c.table_name);

COMMENT ON VIEW public.mfp_rls_coverage_gaps IS
  'Tables portant project_id sans domaine S1 déclaré. Doit toujours être vide : toute table métier future doit être déclarée dans mfp_table_domain.';

DO $$
DECLARE v_gaps text;
BEGIN
  SELECT string_agg(table_name, ', ') INTO v_gaps FROM public.mfp_rls_coverage_gaps;
  IF v_gaps IS NOT NULL THEN
    RAISE EXCEPTION 'S1 : tables projetées non déclarées dans mfp_table_domain : %. Ajoutez-les avant de rejouer la migration.', v_gaps;
  END IF;
END $$;
