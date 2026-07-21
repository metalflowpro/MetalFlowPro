/*
# Fix RLS Policies with Always-True Clauses

## Problem
Multiple tables had RLS policies with `USING (true)` or `WITH CHECK (true)`
that effectively bypassed row-level security, allowing any authenticated (and
in some cases anon) user to insert, update, or delete rows without ownership
verification.

## Changes

### 1. fiscal_regimes (shared reference table, read-only from frontend)
- SELECT policy: kept as `TO authenticated USING (true)` — this is a shared
  reference table of country/region tax regimes, intentionally readable by all
  authenticated users.
- INSERT and UPDATE policies: **dropped**. The frontend only reads this table
  (Economics.tsx line 152: `.select('*').eq('is_active', true)`). No client-side
  writes are needed. Management of fiscal regime data is done through the
  Supabase dashboard (service role bypasses RLS).

### 2. LIMS test tables (12 tables)
All have `project_id` → `projects.id` → `projects.user_id`. Replaced the
unrestricted `TO anon, authenticated` INSERT/UPDATE/DELETE policies with
ownership-scoped policies:
- `TO authenticated` only (app has sign-in, anon should not access LIMS data)
- Ownership check: `EXISTS (SELECT 1 FROM projects WHERE projects.id = {table}.project_id AND projects.user_id = auth.uid())`

Tables: lims_test_chem, lims_test_cyanide_detox, lims_test_egrg, lims_test_elution,
lims_test_flotation, lims_test_knelson, lims_test_leaching, lims_test_liberation,
lims_test_mineralogy, lims_test_psd, lims_test_thickening

### 3. mine_design tables (3 tables)
Same ownership pattern through `projects.user_id`.

Tables: mine_design_benches, mine_design_equipment_schedule, mine_design_pits

## Security Impact
- All previously unrestricted INSERT/UPDATE/DELETE policies now require
  ownership verification through the projects table.
- anon role can no longer write to LIMS or mine_design tables.
- fiscal_regimes is read-only from the client.
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. fiscal_regimes: drop unrestricted INSERT and UPDATE policies
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "insert_fiscal_regimes" ON fiscal_regimes;
DROP POLICY IF EXISTS "update_fiscal_regimes" ON fiscal_regimes;

-- ═══════════════════════════════════════════════════════════════
-- 2. LIMS test tables: replace unrestricted policies with ownership checks
-- ═══════════════════════════════════════════════════════════════

-- ── lims_test_chem ──────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_chem" ON lims_test_chem;
DROP POLICY IF EXISTS "anon_insert_lims_test_chem" ON lims_test_chem;
DROP POLICY IF EXISTS "anon_update_lims_test_chem" ON lims_test_chem;
DROP POLICY IF EXISTS "anon_delete_lims_test_chem" ON lims_test_chem;

CREATE POLICY "select_lims_test_chem" ON lims_test_chem FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_chem.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_chem" ON lims_test_chem FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_chem.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_chem" ON lims_test_chem FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_chem.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_chem.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_chem" ON lims_test_chem FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_chem.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_cyanide_detox ────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
DROP POLICY IF EXISTS "anon_insert_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
DROP POLICY IF EXISTS "anon_update_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
DROP POLICY IF EXISTS "anon_delete_lims_test_cyanide_detox" ON lims_test_cyanide_detox;

CREATE POLICY "select_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_cyanide_detox.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_cyanide_detox.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_cyanide_detox.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_cyanide_detox.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_cyanide_detox.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_egrg ─────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_egrg" ON lims_test_egrg;
DROP POLICY IF EXISTS "anon_insert_lims_test_egrg" ON lims_test_egrg;
DROP POLICY IF EXISTS "anon_update_lims_test_egrg" ON lims_test_egrg;
DROP POLICY IF EXISTS "anon_delete_lims_test_egrg" ON lims_test_egrg;

CREATE POLICY "select_lims_test_egrg" ON lims_test_egrg FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_egrg.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_egrg" ON lims_test_egrg FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_egrg.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_egrg" ON lims_test_egrg FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_egrg.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_egrg.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_egrg" ON lims_test_egrg FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_egrg.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_elution ──────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_elution" ON lims_test_elution;
DROP POLICY IF EXISTS "anon_insert_lims_test_elution" ON lims_test_elution;
DROP POLICY IF EXISTS "anon_update_lims_test_elution" ON lims_test_elution;
DROP POLICY IF EXISTS "anon_delete_lims_test_elution" ON lims_test_elution;

CREATE POLICY "select_lims_test_elution" ON lims_test_elution FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_elution.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_elution" ON lims_test_elution FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_elution.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_elution" ON lims_test_elution FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_elution.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_elution.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_elution" ON lims_test_elution FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_elution.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_flotation ────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_flotation" ON lims_test_flotation;
DROP POLICY IF EXISTS "anon_insert_lims_test_flotation" ON lims_test_flotation;
DROP POLICY IF EXISTS "anon_update_lims_test_flotation" ON lims_test_flotation;
DROP POLICY IF EXISTS "anon_delete_lims_test_flotation" ON lims_test_flotation;

CREATE POLICY "select_lims_test_flotation" ON lims_test_flotation FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_flotation.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_flotation" ON lims_test_flotation FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_flotation.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_flotation" ON lims_test_flotation FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_flotation.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_flotation.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_flotation" ON lims_test_flotation FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_flotation.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_knelson ──────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_knelson" ON lims_test_knelson;
DROP POLICY IF EXISTS "anon_insert_lims_test_knelson" ON lims_test_knelson;
DROP POLICY IF EXISTS "anon_update_lims_test_knelson" ON lims_test_knelson;
DROP POLICY IF EXISTS "anon_delete_lims_test_knelson" ON lims_test_knelson;

CREATE POLICY "select_lims_test_knelson" ON lims_test_knelson FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_knelson.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_knelson" ON lims_test_knelson FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_knelson.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_knelson" ON lims_test_knelson FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_knelson.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_knelson.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_knelson" ON lims_test_knelson FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_knelson.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_leaching ─────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_leaching" ON lims_test_leaching;
DROP POLICY IF EXISTS "anon_insert_leaching" ON lims_test_leaching;
DROP POLICY IF EXISTS "anon_update_leaching" ON lims_test_leaching;
DROP POLICY IF EXISTS "anon_delete_leaching" ON lims_test_leaching;

CREATE POLICY "select_lims_test_leaching" ON lims_test_leaching FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_leaching.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_leaching" ON lims_test_leaching FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_leaching.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_leaching" ON lims_test_leaching FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_leaching.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_leaching.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_leaching" ON lims_test_leaching FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_leaching.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_liberation ───────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_liberation" ON lims_test_liberation;
DROP POLICY IF EXISTS "anon_insert_lims_test_liberation" ON lims_test_liberation;
DROP POLICY IF EXISTS "anon_update_lims_test_liberation" ON lims_test_liberation;
DROP POLICY IF EXISTS "anon_delete_lims_test_liberation" ON lims_test_liberation;

CREATE POLICY "select_lims_test_liberation" ON lims_test_liberation FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_liberation.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_liberation" ON lims_test_liberation FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_liberation.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_liberation" ON lims_test_liberation FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_liberation.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_liberation.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_liberation" ON lims_test_liberation FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_liberation.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_mineralogy ───────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_mineralogy" ON lims_test_mineralogy;
DROP POLICY IF EXISTS "anon_insert_lims_test_mineralogy" ON lims_test_mineralogy;
DROP POLICY IF EXISTS "anon_update_lims_test_mineralogy" ON lims_test_mineralogy;
DROP POLICY IF EXISTS "anon_delete_lims_test_mineralogy" ON lims_test_mineralogy;

CREATE POLICY "select_lims_test_mineralogy" ON lims_test_mineralogy FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_mineralogy.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_mineralogy" ON lims_test_mineralogy FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_mineralogy.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_mineralogy" ON lims_test_mineralogy FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_mineralogy.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_mineralogy.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_mineralogy" ON lims_test_mineralogy FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_mineralogy.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_psd ──────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_psd" ON lims_test_psd;
DROP POLICY IF EXISTS "anon_insert_lims_test_psd" ON lims_test_psd;
DROP POLICY IF EXISTS "anon_update_lims_test_psd" ON lims_test_psd;
DROP POLICY IF EXISTS "anon_delete_lims_test_psd" ON lims_test_psd;

CREATE POLICY "select_lims_test_psd" ON lims_test_psd FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_psd.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_psd" ON lims_test_psd FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_psd.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_psd" ON lims_test_psd FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_psd.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_psd.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_psd" ON lims_test_psd FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_psd.project_id AND projects.user_id = auth.uid())
  );

-- ── lims_test_thickening ───────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_lims_test_thickening" ON lims_test_thickening;
DROP POLICY IF EXISTS "anon_insert_lims_test_thickening" ON lims_test_thickening;
DROP POLICY IF EXISTS "anon_update_lims_test_thickening" ON lims_test_thickening;
DROP POLICY IF EXISTS "anon_delete_lims_test_thickening" ON lims_test_thickening;

CREATE POLICY "select_lims_test_thickening" ON lims_test_thickening FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_thickening.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_lims_test_thickening" ON lims_test_thickening FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_thickening.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_lims_test_thickening" ON lims_test_thickening FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_thickening.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_thickening.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_lims_test_thickening" ON lims_test_thickening FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = lims_test_thickening.project_id AND projects.user_id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════
-- 3. mine_design tables: replace unrestricted policies with ownership checks
-- ═══════════════════════════════════════════════════════════════

-- ── mine_design_benches ────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_mine_design_benches" ON mine_design_benches;
DROP POLICY IF EXISTS "anon_insert_mine_design_benches" ON mine_design_benches;
DROP POLICY IF EXISTS "anon_update_mine_design_benches" ON mine_design_benches;
DROP POLICY IF EXISTS "anon_delete_mine_design_benches" ON mine_design_benches;

CREATE POLICY "select_mine_design_benches" ON mine_design_benches FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_benches.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_mine_design_benches" ON mine_design_benches FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_benches.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_mine_design_benches" ON mine_design_benches FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_benches.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_benches.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_mine_design_benches" ON mine_design_benches FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_benches.project_id AND projects.user_id = auth.uid())
  );

-- ── mine_design_equipment_schedule ─────────────────────────────
DROP POLICY IF EXISTS "anon_select_mine_equip" ON mine_design_equipment_schedule;
DROP POLICY IF EXISTS "anon_insert_mine_equip" ON mine_design_equipment_schedule;
DROP POLICY IF EXISTS "anon_update_mine_equip" ON mine_design_equipment_schedule;
DROP POLICY IF EXISTS "anon_delete_mine_equip" ON mine_design_equipment_schedule;

CREATE POLICY "select_mine_equip" ON mine_design_equipment_schedule FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_equipment_schedule.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_mine_equip" ON mine_design_equipment_schedule FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_equipment_schedule.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_mine_equip" ON mine_design_equipment_schedule FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_equipment_schedule.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_equipment_schedule.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_mine_equip" ON mine_design_equipment_schedule FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_equipment_schedule.project_id AND projects.user_id = auth.uid())
  );

-- ── mine_design_pits ───────────────────────────────────────────
DROP POLICY IF EXISTS "anon_select_mine_design_pits" ON mine_design_pits;
DROP POLICY IF EXISTS "anon_insert_mine_design_pits" ON mine_design_pits;
DROP POLICY IF EXISTS "anon_update_mine_design_pits" ON mine_design_pits;
DROP POLICY IF EXISTS "anon_delete_mine_design_pits" ON mine_design_pits;

CREATE POLICY "select_mine_design_pits" ON mine_design_pits FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_pits.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "insert_mine_design_pits" ON mine_design_pits FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_pits.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "update_mine_design_pits" ON mine_design_pits FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_pits.project_id AND projects.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_pits.project_id AND projects.user_id = auth.uid())
  );
CREATE POLICY "delete_mine_design_pits" ON mine_design_pits FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = mine_design_pits.project_id AND projects.user_id = auth.uid())
  );
