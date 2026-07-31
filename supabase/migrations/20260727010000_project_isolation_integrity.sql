/*
# Project isolation integrity

Strengthens project boundaries without deleting or rewriting existing data.

- Prevents new duplicate LIMS sample identifiers within a project.
- Adds missing leaching foreign keys.
- Adds composite parent/child foreign keys so a child cannot claim one project
  while referencing a parent from another project.
- Composite foreign keys are created NOT VALID: they protect all new writes
  immediately. Existing rows are validated only when the precheck is clean.
*/

-- ── LIMS sample natural key ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.validate_lims_sample_project_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.lims_samples existing
    WHERE existing.project_id = NEW.project_id
      AND existing.sample_id = NEW.sample_id
      AND existing.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Duplicate LIMS sample_id % in project %', NEW.sample_id, NEW.project_id
      USING ERRCODE = '23505',
            CONSTRAINT = 'lims_samples_project_sample_unique';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_lims_sample_project_key_trigger ON public.lims_samples;
CREATE TRIGGER validate_lims_sample_project_key_trigger
BEFORE INSERT OR UPDATE OF project_id, sample_id ON public.lims_samples
FOR EACH ROW EXECUTE FUNCTION public.validate_lims_sample_project_key();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.lims_samples'::regclass
      AND conname = 'lims_samples_project_sample_unique'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.lims_samples
      GROUP BY project_id, sample_id
      HAVING count(*) > 1
    ) THEN
      ALTER TABLE public.lims_samples
        ADD CONSTRAINT lims_samples_project_sample_unique
        UNIQUE (project_id, sample_id);
    ELSE
      RAISE NOTICE 'Existing duplicate lims_samples(project_id, sample_id) rows retained; trigger protects new writes.';
    END IF;
  END IF;
END;
$$;

-- ── Helpers used only by this migration ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public._mf_add_parent_project_unique(
  parent_table regclass,
  constraint_name text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = parent_table AND conname = constraint_name
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I UNIQUE (id, project_id)',
      parent_table,
      constraint_name
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._mf_add_project_composite_fk(
  child_table regclass,
  parent_table regclass,
  child_parent_column text,
  constraint_name text,
  delete_action text DEFAULT 'CASCADE'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_rows bigint;
BEGIN
  IF delete_action NOT IN ('CASCADE', 'RESTRICT', 'NO ACTION') THEN
    RAISE EXCEPTION 'Unsupported delete action: %', delete_action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = child_table AND conname = constraint_name
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I, project_id) REFERENCES %s (id, project_id) ON DELETE %s NOT VALID',
      child_table,
      constraint_name,
      child_parent_column,
      parent_table,
      delete_action
    );
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %s child WHERE child.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s parent WHERE parent.id = child.%I AND parent.project_id = child.project_id)',
    child_table,
    child_parent_column,
    parent_table,
    child_parent_column
  ) INTO invalid_rows;

  IF invalid_rows = 0 AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = child_table
      AND conname = constraint_name
      AND NOT convalidated
  ) THEN
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', child_table, constraint_name);
  ELSIF invalid_rows > 0 THEN
    RAISE NOTICE '% existing mismatched row(s) retained for constraint %; new writes are protected.', invalid_rows, constraint_name;
  END IF;
END;
$$;

-- Parent composite candidate keys. Since id is already a primary key, these
-- constraints cannot conflict with existing row values.
SELECT public._mf_add_parent_project_unique('public.lims_samples', 'lims_samples_id_project_key');
SELECT public._mf_add_parent_project_unique('public.bm_configs', 'bm_configs_id_project_key');
SELECT public._mf_add_parent_project_unique('public.sim_flowsheets', 'sim_flowsheets_id_project_key');
SELECT public._mf_add_parent_project_unique('public.ni43101_reports', 'ni43101_reports_id_project_key');
SELECT public._mf_add_parent_project_unique('public.mine_design_pits', 'mine_design_pits_id_project_key');
SELECT public._mf_add_parent_project_unique('public.cos_blend_plans', 'cos_blend_plans_id_project_key');
SELECT public._mf_add_parent_project_unique('public.cos_reconciliation_periods', 'cos_reconciliation_periods_id_project_key');

-- LIMS tests → sample. These constraints also cover lims_test_leaching, which
-- previously had no sample foreign key at all.
SELECT public._mf_add_project_composite_fk('public.lims_test_head', 'public.lims_samples', 'sample_id', 'lims_test_head_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_comminution', 'public.lims_samples', 'sample_id', 'lims_test_comminution_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_gravity', 'public.lims_samples', 'sample_id', 'lims_test_gravity_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_leach', 'public.lims_samples', 'sample_id', 'lims_test_leach_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_chem', 'public.lims_samples', 'sample_id', 'lims_test_chem_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_mineralogy', 'public.lims_samples', 'sample_id', 'lims_test_mineralogy_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_liberation', 'public.lims_samples', 'sample_id', 'lims_test_liberation_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_psd', 'public.lims_samples', 'sample_id', 'lims_test_psd_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_knelson', 'public.lims_samples', 'sample_id', 'lims_test_knelson_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_egrg', 'public.lims_samples', 'sample_id', 'lims_test_egrg_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_flotation', 'public.lims_samples', 'sample_id', 'lims_test_flotation_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_thickening', 'public.lims_samples', 'sample_id', 'lims_test_thickening_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_elution', 'public.lims_samples', 'sample_id', 'lims_test_elution_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_cyanide_detox', 'public.lims_samples', 'sample_id', 'lims_test_cyanide_detox_sample_project_fkey');
SELECT public._mf_add_project_composite_fk('public.lims_test_leaching', 'public.lims_samples', 'sample_id', 'lims_test_leaching_sample_project_fkey');

-- Missing direct project FK on leaching. NOT VALID preserves any historical
-- orphan while enforcing the relationship for new rows.
DO $$
DECLARE
  invalid_rows bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lims_test_leaching'::regclass
      AND conname = 'lims_test_leaching_project_fkey'
  ) THEN
    ALTER TABLE public.lims_test_leaching
      ADD CONSTRAINT lims_test_leaching_project_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  SELECT count(*) INTO invalid_rows
  FROM public.lims_test_leaching child
  WHERE NOT EXISTS (
    SELECT 1 FROM public.projects parent WHERE parent.id = child.project_id
  );

  IF invalid_rows = 0 AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lims_test_leaching'::regclass
      AND conname = 'lims_test_leaching_project_fkey'
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.lims_test_leaching
      VALIDATE CONSTRAINT lims_test_leaching_project_fkey;
  ELSIF invalid_rows > 0 THEN
    RAISE NOTICE '% existing leaching row(s) have no project; retained while new writes are protected.', invalid_rows;
  END IF;
END;
$$;

-- Other high-value parent/child boundaries.
SELECT public._mf_add_project_composite_fk('public.bm_blocks', 'public.bm_configs', 'config_id', 'bm_blocks_config_project_fkey');
SELECT public._mf_add_project_composite_fk('public.sim_nodes', 'public.sim_flowsheets', 'flowsheet_id', 'sim_nodes_flowsheet_project_fkey');
SELECT public._mf_add_project_composite_fk('public.sim_edges', 'public.sim_flowsheets', 'flowsheet_id', 'sim_edges_flowsheet_project_fkey');
SELECT public._mf_add_project_composite_fk('public.sim_run_results', 'public.sim_flowsheets', 'flowsheet_id', 'sim_run_results_flowsheet_project_fkey');
SELECT public._mf_add_project_composite_fk('public.sim_expansion_scenarios', 'public.sim_flowsheets', 'flowsheet_id', 'sim_expansion_flowsheet_project_fkey');
SELECT public._mf_add_project_composite_fk('public.ni43101_sections', 'public.ni43101_reports', 'report_id', 'ni43101_sections_report_project_fkey');
SELECT public._mf_add_project_composite_fk('public.mine_design_benches', 'public.mine_design_pits', 'pit_id', 'mine_design_benches_pit_project_fkey');
SELECT public._mf_add_project_composite_fk('public.mine_design_equipment_schedule', 'public.mine_design_pits', 'pit_id', 'mine_design_equipment_pit_project_fkey');
SELECT public._mf_add_project_composite_fk('public.cos_blend_sources', 'public.cos_blend_plans', 'blend_plan_id', 'cos_blend_sources_plan_project_fkey');
SELECT public._mf_add_project_composite_fk('public.cos_reconciliation_lines', 'public.cos_reconciliation_periods', 'reconciliation_id', 'cos_reconciliation_lines_period_project_fkey');

DROP FUNCTION public._mf_add_project_composite_fk(regclass, regclass, text, text, text);
DROP FUNCTION public._mf_add_parent_project_unique(regclass, text);
