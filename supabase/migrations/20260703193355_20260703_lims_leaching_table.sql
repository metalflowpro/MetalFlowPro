/*
# Create lims_test_leaching table

1. New Table: lims_test_leaching
   Full cyanide leaching test table for CIL/CIP/Heap Leach tests with:
   - Feed characteristics: Au grade, P80, % solids, SG
   - Reagent consumption: NaCN, CaO, O2
   - Process conditions: pH, temperature, duration, carbon load
   - Kinetics: recoveries at 2h, 4h, 8h, 12h, 24h, 48h
   - Final residue Au grade

2. Security
   - RLS enabled with anon + authenticated CRUD (single-tenant)
*/

CREATE TABLE IF NOT EXISTS lims_test_leaching (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL,
  sample_id             uuid NOT NULL,
  composite_type        text,
  au_feed_g_t           numeric,
  p80_um                numeric,
  solids_pct            numeric,
  nacn_initial_ppm      numeric,
  nacn_residual_24h_ppm numeric,
  nacn_consumption_kg_t numeric,
  ph_initial            numeric,
  ph_final              numeric,
  cao_consumption_kg_t  numeric,
  o2_dissolved_mg_l     numeric,
  o2_consumption_kg_t   numeric,
  temperature_c         numeric,
  leach_duration_h      numeric,
  carbon_load_g_l       numeric,
  sg_t_m3               numeric,
  leach_rec_2h_pct      numeric,
  leach_rec_4h_pct      numeric,
  leach_rec_8h_pct      numeric,
  leach_rec_12h_pct     numeric,
  leach_rec_24h_pct     numeric,
  leach_rec_48h_pct     numeric,
  au_tail_g_t           numeric,
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE lims_test_leaching ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_leaching" ON lims_test_leaching;
CREATE POLICY "anon_select_leaching" ON lims_test_leaching FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_leaching" ON lims_test_leaching;
CREATE POLICY "anon_insert_leaching" ON lims_test_leaching FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_leaching" ON lims_test_leaching;
CREATE POLICY "anon_update_leaching" ON lims_test_leaching FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_leaching" ON lims_test_leaching;
CREATE POLICY "anon_delete_leaching" ON lims_test_leaching FOR DELETE
  TO anon, authenticated USING (true);
