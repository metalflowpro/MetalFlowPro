-- ============================================================
-- Fix: CAPEX / OPEX generation blocked by RLS
-- ------------------------------------------------------------
-- capex_lines and opex_lines shipped with ownership-based RLS policies that
-- reference projects.user_id = auth.uid(). The projects table has NO user_id
-- column and every other table in this app uses a permissive policy
-- (USING(true) / WITH CHECK(true) for anon + authenticated). As a result the
-- ownership subquery never matches, so INSERT/UPDATE/DELETE on capex_lines and
-- opex_lines are denied (Postgres error 42501) and CAPEX/OPEX generation
-- silently produces no lines.
--
-- This migration replaces those policies with the same permissive model used by
-- projects, dc_draft, mass_balance_streams, project_flowsheets, etc.
-- ============================================================

-- capex_lines ------------------------------------------------
DROP POLICY IF EXISTS "select_own_capex" ON capex_lines;
DROP POLICY IF EXISTS "insert_own_capex" ON capex_lines;
DROP POLICY IF EXISTS "update_own_capex" ON capex_lines;
DROP POLICY IF EXISTS "delete_own_capex" ON capex_lines;

DROP POLICY IF EXISTS "app_all_capex" ON capex_lines;
CREATE POLICY "app_all_capex" ON capex_lines
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- opex_lines -------------------------------------------------
DROP POLICY IF EXISTS "select_own_opex" ON opex_lines;
DROP POLICY IF EXISTS "insert_own_opex" ON opex_lines;
DROP POLICY IF EXISTS "update_own_opex" ON opex_lines;
DROP POLICY IF EXISTS "delete_own_opex" ON opex_lines;

DROP POLICY IF EXISTS "app_all_opex" ON opex_lines;
CREATE POLICY "app_all_opex" ON opex_lines
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);
