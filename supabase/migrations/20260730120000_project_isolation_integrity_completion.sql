/*
# Project isolation integrity — completion

Complements 20260727010000_project_isolation_integrity.sql, which added composite
parent/child foreign keys for most modules. Two parent/child boundaries were left
out and are covered here:

  1. lims_psd_fractions.granulometry_id → lims_granulometry(id, project_id)
  2. cos_operator_actions.recommendation_id → cos_recommendations(id, project_id)

Both use the same defensive strategy as the earlier migration:
  - Add a UNIQUE (id, project_id) candidate key on each parent (cannot conflict:
    id is already a primary key).
  - Add the composite foreign key NOT VALID so all NEW writes are protected
    immediately; existing rows are validated only when the precheck is clean.
  - Composite FKs use MATCH SIMPLE (default): a row whose parent column is NULL
    is always accepted, so nullable optional references keep working.

## cos_operator_actions specifics
recommendation_id is nullable and originally used ON DELETE SET NULL. A plain
composite ON DELETE SET NULL would try to null project_id too (which is NOT NULL),
so we use the column-scoped ON DELETE SET NULL (recommendation_id) form
(PostgreSQL 15+, available on Supabase). This preserves the original semantics:
deleting a recommendation keeps the operator action and only clears its link.
*/

-- ── Helpers (re-created; the earlier migration dropped them at its end) ───────

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
  on_delete_clause text DEFAULT 'ON DELETE CASCADE'
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_rows bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = child_table AND conname = constraint_name
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I, project_id) REFERENCES %s (id, project_id) %s NOT VALID',
      child_table,
      constraint_name,
      child_parent_column,
      parent_table,
      on_delete_clause
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

-- Parent composite candidate keys (id is already a PK, so cannot conflict).
SELECT public._mf_add_parent_project_unique('public.lims_granulometry', 'lims_granulometry_id_project_key');
SELECT public._mf_add_parent_project_unique('public.cos_recommendations', 'cos_recommendations_id_project_key');

-- 1. lims_psd_fractions → lims_granulometry (granulometry_id, required, CASCADE).
SELECT public._mf_add_project_composite_fk(
  'public.lims_psd_fractions',
  'public.lims_granulometry',
  'granulometry_id',
  'lims_psd_fractions_granulo_project_fkey',
  'ON DELETE CASCADE'
);

-- 2. cos_operator_actions → cos_recommendations (recommendation_id, nullable).
--    Column-scoped SET NULL preserves the original ON DELETE SET NULL behaviour
--    without touching the NOT NULL project_id.
SELECT public._mf_add_project_composite_fk(
  'public.cos_operator_actions',
  'public.cos_recommendations',
  'recommendation_id',
  'cos_operator_actions_reco_project_fkey',
  'ON DELETE SET NULL (recommendation_id)'
);

DROP FUNCTION public._mf_add_project_composite_fk(regclass, regclass, text, text, text);
DROP FUNCTION public._mf_add_parent_project_unique(regclass, text);
