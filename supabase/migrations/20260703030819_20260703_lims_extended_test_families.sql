/*
# LIMS — 11 Extended Test Family Tables

## Summary
Adds 10 new test tables covering all standard metallurgical laboratory families,
and extends the existing comminution table with Bond Rod Mill, JK Drop Weight,
Morrell Mi, and physical property columns.

## New Tables
1. lims_test_chem — Full chemical analysis (Fire Assay + ICP-MS/OES + XRF + LECO)
   Au, Ag, Cu, Fe, S, As, Sb, Hg, major oxides, LOI

2. lims_test_mineralogy — Quantitative mineralogy (QEMSCAN/MLA)
   K80, modal mineralogy percentages, Au free gold

3. lims_test_liberation — Gold liberation analysis (MLA)
   P80, Au associations: free/sulphides/silicates/oxides/occluded/preg-rob

4. lims_test_psd — Particle size distribution + gold distribution
   P80, D50, sieve fractions, Au head grade, Au by fraction

5. lims_test_knelson — Knelson/Falcon gravity concentrator tests
   Feed conditions, GRG recovery, mass pull

6. lims_test_egrg — Extended Gravity Recoverable Gold (3 stages)
   K80, grade, recovery, cumulative recovery per stage

7. lims_test_flotation — Batch flotation kinetics
   Feed, concentrate weight, Au recovery, reagents

8. lims_test_thickening — Thickening / liquid-solid separation
   Unit area, flocculant, underflow density, overflow quality

9. lims_test_elution — ADR elution (AARL/Zadra)
   Carbon loading, eluant conditions, Au recovery

10. lims_test_cyanide_detox — Cyanide detoxification
    CN WAD/total/free, metals, reagent consumptions, rebound tests

## Modified Tables
- lims_test_comminution: added Bond Rod Mill WI, JK parameters, Morrell Mi
  specific energies, UCS, feed/product sizes, SG, bulk density

## Security
- RLS enabled on all new tables
- anon + authenticated read/write (single-tenant application)
*/

-- ─── 1. Analyse chimique élémentaire ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_chem (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id      uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  au_g_t         decimal(10,3),
  ag_g_t         decimal(10,3),
  cu_pct         decimal(8,4),
  fe_pct         decimal(8,3),
  s_total_pct    decimal(8,3),
  s_sulfide_pct  decimal(8,3),
  as_ppm         decimal(10,1),
  c_organic_pct  decimal(8,3),
  sb_ppm         decimal(10,1),
  hg_ppm         decimal(10,3),
  sio2_pct       decimal(8,3),
  al2o3_pct      decimal(8,3),
  cao_pct        decimal(8,3),
  mgo_pct        decimal(8,3),
  na2o_pct       decimal(8,3),
  k2o_pct        decimal(8,3),
  tio2_pct       decimal(8,3),
  mno_pct        decimal(8,3),
  loi_950_pct    decimal(8,3),
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE lims_test_chem ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_chem"  ON lims_test_chem;
DROP POLICY IF EXISTS "anon_insert_lims_test_chem"  ON lims_test_chem;
DROP POLICY IF EXISTS "anon_update_lims_test_chem"  ON lims_test_chem;
DROP POLICY IF EXISTS "anon_delete_lims_test_chem"  ON lims_test_chem;
CREATE POLICY "anon_select_lims_test_chem" ON lims_test_chem FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_chem" ON lims_test_chem FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_chem" ON lims_test_chem FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_chem" ON lims_test_chem FOR DELETE TO anon, authenticated USING (true);

-- ─── 2. Minéralogie quantitative ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_mineralogy (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id           uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  k80_um              decimal(10,2),
  pyrite_pct          decimal(8,3),
  pyrrhotite_pct      decimal(8,3),
  other_sulphides_pct decimal(8,3),
  quartz_pct          decimal(8,3),
  plagioclase_pct     decimal(8,3),
  k_feldspar_pct      decimal(8,3),
  argilite_pct        decimal(8,3),
  other_silicates_pct decimal(8,3),
  k_other_pct         decimal(8,3),
  muscovite_pct       decimal(8,3),
  ca_minerals_pct     decimal(8,3),
  fe_oxides_pct       decimal(8,3),
  ilmenite_pct        decimal(8,3),
  ti_oxides_pct       decimal(8,3),
  other_oxides_pct    decimal(8,3),
  carbonates_pct      decimal(8,3),
  apatite_pct         decimal(8,3),
  other_pct           decimal(8,3),
  au_free_pct         decimal(8,3),
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE lims_test_mineralogy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_mineralogy" ON lims_test_mineralogy;
DROP POLICY IF EXISTS "anon_insert_lims_test_mineralogy" ON lims_test_mineralogy;
DROP POLICY IF EXISTS "anon_update_lims_test_mineralogy" ON lims_test_mineralogy;
DROP POLICY IF EXISTS "anon_delete_lims_test_mineralogy" ON lims_test_mineralogy;
CREATE POLICY "anon_select_lims_test_mineralogy" ON lims_test_mineralogy FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_mineralogy" ON lims_test_mineralogy FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_mineralogy" ON lims_test_mineralogy FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_mineralogy" ON lims_test_mineralogy FOR DELETE TO anon, authenticated USING (true);

-- ─── 3. Libération Au ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_liberation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id         uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  p80_um            decimal(10,2),
  au_free_pct       decimal(8,3),
  au_sulphides_pct  decimal(8,3),
  au_silicates_pct  decimal(8,3),
  au_oxides_pct     decimal(8,3),
  au_occluded_pct   decimal(8,3),
  au_preg_rob_pct   decimal(8,3),
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE lims_test_liberation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_liberation" ON lims_test_liberation;
DROP POLICY IF EXISTS "anon_insert_lims_test_liberation" ON lims_test_liberation;
DROP POLICY IF EXISTS "anon_update_lims_test_liberation" ON lims_test_liberation;
DROP POLICY IF EXISTS "anon_delete_lims_test_liberation" ON lims_test_liberation;
CREATE POLICY "anon_select_lims_test_liberation" ON lims_test_liberation FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_liberation" ON lims_test_liberation FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_liberation" ON lims_test_liberation FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_liberation" ON lims_test_liberation FOR DELETE TO anon, authenticated USING (true);

-- ─── 4. Analyse granulométrique / PSD ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_psd (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id            uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  p80_um               decimal(10,2),
  d50_um               decimal(10,2),
  plus_500um_pct       decimal(8,3),
  plus_212um_pct       decimal(8,3),
  plus_150um_pct       decimal(8,3),
  plus_106um_pct       decimal(8,3),
  plus_75um_pct        decimal(8,3),
  plus_53um_pct        decimal(8,3),
  plus_38um_pct        decimal(8,3),
  minus_38um_pct       decimal(8,3),
  au_head_g_t          decimal(10,3),
  au_plus212_g_t       decimal(10,3),
  au_plus75_g_t        decimal(10,3),
  au_minus38_g_t       decimal(10,3),
  dist_au_plus212_pct  decimal(8,3),
  dist_au_plus75_pct   decimal(8,3),
  dist_au_minus38_pct  decimal(8,3),
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE lims_test_psd ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_psd" ON lims_test_psd;
DROP POLICY IF EXISTS "anon_insert_lims_test_psd"  ON lims_test_psd;
DROP POLICY IF EXISTS "anon_update_lims_test_psd"  ON lims_test_psd;
DROP POLICY IF EXISTS "anon_delete_lims_test_psd"  ON lims_test_psd;
CREATE POLICY "anon_select_lims_test_psd" ON lims_test_psd FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_psd" ON lims_test_psd FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_psd" ON lims_test_psd FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_psd" ON lims_test_psd FOR DELETE TO anon, authenticated USING (true);

-- ─── 5. Extend lims_test_comminution ─────────────────────────────────────────

ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS brwi_kwh_t   decimal(8,2);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS cwi_kwh_t    decimal(8,2);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS axb_jk       decimal(10,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS ta_jk        decimal(10,4);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS dwi_kwh_m3   decimal(10,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS mia_kwh_t    decimal(8,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS mib_kwh_t    decimal(8,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS mic_kwh_t    decimal(8,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS mih_kwh_t    decimal(8,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS scse_kwh_t   decimal(8,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS ucs_mpa      decimal(10,2);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS f80_um       decimal(10,2);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS p80_um       decimal(10,2);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS sg_t_m3      decimal(6,3);
ALTER TABLE lims_test_comminution ADD COLUMN IF NOT EXISTS rho_bulk_t_m3 decimal(6,3);

-- ─── 6. Knelson / Falcon ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_knelson (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id        uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  p80_feed_um      decimal(10,2),
  solids_pct       decimal(8,3),
  mass_feed_kg     decimal(10,3),
  au_feed_g_t      decimal(10,3),
  rotation_rpm     decimal(8,1),
  water_psi        decimal(8,2),
  duration_min     decimal(8,2),
  conc_mass_g      decimal(10,3),
  au_conc_g_t      decimal(10,3),
  au_tail_g_t      decimal(10,3),
  grg_recovery_pct decimal(8,3),
  mass_pull_pct    decimal(8,3),
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE lims_test_knelson ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_knelson" ON lims_test_knelson;
DROP POLICY IF EXISTS "anon_insert_lims_test_knelson" ON lims_test_knelson;
DROP POLICY IF EXISTS "anon_update_lims_test_knelson" ON lims_test_knelson;
DROP POLICY IF EXISTS "anon_delete_lims_test_knelson" ON lims_test_knelson;
CREATE POLICY "anon_select_lims_test_knelson" ON lims_test_knelson FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_knelson" ON lims_test_knelson FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_knelson" ON lims_test_knelson FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_knelson" ON lims_test_knelson FOR DELETE TO anon, authenticated USING (true);

-- ─── 7. E-GRG ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_egrg (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id                uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  k80_um                   decimal(10,2),
  au_conc_grade_g_t        decimal(10,3),
  recovery_pct             decimal(8,3),
  cumulative_recovery_pct  decimal(8,3),
  recalc_grade_g_t         decimal(10,3),
  measured_grade_g_t       decimal(10,3),
  residue_grade_g_t        decimal(10,3),
  created_at               timestamptz DEFAULT now()
);

ALTER TABLE lims_test_egrg ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_egrg" ON lims_test_egrg;
DROP POLICY IF EXISTS "anon_insert_lims_test_egrg" ON lims_test_egrg;
DROP POLICY IF EXISTS "anon_update_lims_test_egrg" ON lims_test_egrg;
DROP POLICY IF EXISTS "anon_delete_lims_test_egrg" ON lims_test_egrg;
CREATE POLICY "anon_select_lims_test_egrg" ON lims_test_egrg FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_egrg" ON lims_test_egrg FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_egrg" ON lims_test_egrg FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_egrg" ON lims_test_egrg FOR DELETE TO anon, authenticated USING (true);

-- ─── 8. Flottation ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_flotation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id       uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  au_feed_g_t     decimal(10,3),
  feed_p80_um     decimal(10,2),
  conc_wt_pct     decimal(8,3),
  au_conc_g_t     decimal(10,3),
  au_recovery_pct decimal(8,3),
  au_tail_g_t     decimal(10,3),
  total_time_min  decimal(8,2),
  collector_g_t   decimal(8,3),
  frother_g_t     decimal(8,3),
  depressant_g_t  decimal(8,3),
  s_recovery_pct  decimal(8,3),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE lims_test_flotation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_flotation" ON lims_test_flotation;
DROP POLICY IF EXISTS "anon_insert_lims_test_flotation" ON lims_test_flotation;
DROP POLICY IF EXISTS "anon_update_lims_test_flotation" ON lims_test_flotation;
DROP POLICY IF EXISTS "anon_delete_lims_test_flotation" ON lims_test_flotation;
CREATE POLICY "anon_select_lims_test_flotation" ON lims_test_flotation FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_flotation" ON lims_test_flotation FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_flotation" ON lims_test_flotation FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_flotation" ON lims_test_flotation FOR DELETE TO anon, authenticated USING (true);

-- ─── 9. Épaississement ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_thickening (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id               uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_area_m2_t_d        decimal(10,4),
  flocculant_g_t          decimal(10,3),
  underflow_density_pct   decimal(8,3),
  isr_m_h                 decimal(10,4),
  fsr_m_h                 decimal(10,4),
  uf_density_pct          decimal(8,3),
  uf_density_t_m3         decimal(8,4),
  overflow_turbidity_ntu  decimal(10,2),
  mass_flux_t_m2_d        decimal(10,4),
  cn_overflow_ppm         decimal(10,3),
  au_overflow_ppb         decimal(10,3),
  uf_viscosity_mpas       decimal(10,2),
  created_at              timestamptz DEFAULT now()
);

ALTER TABLE lims_test_thickening ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_thickening" ON lims_test_thickening;
DROP POLICY IF EXISTS "anon_insert_lims_test_thickening" ON lims_test_thickening;
DROP POLICY IF EXISTS "anon_update_lims_test_thickening" ON lims_test_thickening;
DROP POLICY IF EXISTS "anon_delete_lims_test_thickening" ON lims_test_thickening;
CREATE POLICY "anon_select_lims_test_thickening" ON lims_test_thickening FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_thickening" ON lims_test_thickening FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_thickening" ON lims_test_thickening FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_thickening" ON lims_test_thickening FOR DELETE TO anon, authenticated USING (true);

-- ─── 10. Élution ADR ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_elution (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id            uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_type            varchar(20),
  carbon_type          text,
  carbon_load_g_l      decimal(10,3),
  au_solution_ini_mg_l decimal(10,3),
  au_solution_fin_mg_l decimal(10,3),
  kinetics_freundlich  decimal(10,4),
  elution_temp_c       decimal(8,2),
  eluant_cn_g_l        decimal(8,3),
  eluant_naoh_g_l      decimal(8,3),
  flow_rate_bv_h       decimal(8,3),
  elution_time_h       decimal(8,2),
  au_eluted_mg_l       decimal(10,3),
  au_recovery_pct      decimal(8,3),
  carbon_fines_pct     decimal(8,3),
  observations         text,
  created_at           timestamptz DEFAULT now()
);

ALTER TABLE lims_test_elution ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_elution" ON lims_test_elution;
DROP POLICY IF EXISTS "anon_insert_lims_test_elution" ON lims_test_elution;
DROP POLICY IF EXISTS "anon_update_lims_test_elution" ON lims_test_elution;
DROP POLICY IF EXISTS "anon_delete_lims_test_elution" ON lims_test_elution;
CREATE POLICY "anon_select_lims_test_elution" ON lims_test_elution FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_elution" ON lims_test_elution FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_elution" ON lims_test_elution FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_elution" ON lims_test_elution FOR DELETE TO anon, authenticated USING (true);

-- ─── 11. Détoxification CN ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lims_test_cyanide_detox (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id                   uuid NOT NULL REFERENCES lims_samples(id) ON DELETE CASCADE,
  project_id                  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cn_wad_mg_l                 decimal(10,3),
  cn_total_mg_l               decimal(10,3),
  cn_free_mg_l                decimal(10,3),
  scn_mg_l                    decimal(10,3),
  ph_final                    decimal(6,2),
  cu_mg_l                     decimal(10,3),
  fe_mg_l                     decimal(10,3),
  ni_mg_l                     decimal(10,3),
  zn_mg_l                     decimal(10,3),
  as_mg_l                     decimal(10,3),
  hg_ug_l                     decimal(10,3),
  pb_mg_l                     decimal(10,3),
  so2_kg_t                    decimal(10,3),
  h2o2_kg_t                   decimal(10,3),
  cuso4_kg_t                  decimal(10,3),
  cao_kg_t                    decimal(10,3),
  treatment_duration_min      decimal(10,2),
  cn_wad_rebound_24h_mg_l     decimal(10,3),
  cn_wad_rebound_7j_mg_l      decimal(10,3),
  created_at                  timestamptz DEFAULT now()
);

ALTER TABLE lims_test_cyanide_detox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
DROP POLICY IF EXISTS "anon_insert_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
DROP POLICY IF EXISTS "anon_update_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
DROP POLICY IF EXISTS "anon_delete_lims_test_cyanide_detox" ON lims_test_cyanide_detox;
CREATE POLICY "anon_select_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_update_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lims_test_cyanide_detox" ON lims_test_cyanide_detox FOR DELETE TO anon, authenticated USING (true);
