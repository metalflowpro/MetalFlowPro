/*
# Add advanced columns to geomet_domains

## Summary
The TypeScript code references 12 columns that were never added to the geomet_domains table.
Every insert that included these fields (sai_kwh_t, abi, rqi, clay_pct, sulphide_pct,
carbonate_pct, grg_min, grg_max, cil_min, cil_max, flotation_pct, preg_robbing) was
silently failing with "column does not exist", which is why domain auto-creation was broken.

## New Columns
1. sai_kwh_t      — SAG Abrasion Index (kWh/t)
2. abi             — Abrasion Bond Index
3. rqi             — Rock Quality Index
4. clay_pct        — Clay content (%) — 0-100
5. sulphide_pct    — Sulphide content (%) — 0-100
6. carbonate_pct   — Carbonate content (%) — 0-100
7. grg_min         — Gravity recovery min (%)
8. grg_max         — Gravity recovery max (%)
9. cil_min         — CIL recovery min (%)
10. cil_max        — CIL recovery max (%)
11. flotation_pct  — Flotation recovery (%)
12. preg_robbing   — Preg-robbing flag (boolean, default false)
13. updated_at     — Last updated timestamp

## Impact
These columns enable full GeoMet domain data to persist, fixing the silent insert failure
that prevented domain auto-creation during LIMS + Block Model sync.
*/

ALTER TABLE geomet_domains
  ADD COLUMN IF NOT EXISTS sai_kwh_t       numeric,
  ADD COLUMN IF NOT EXISTS abi             numeric,
  ADD COLUMN IF NOT EXISTS rqi             numeric,
  ADD COLUMN IF NOT EXISTS clay_pct        numeric CHECK (clay_pct IS NULL OR clay_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS sulphide_pct    numeric CHECK (sulphide_pct IS NULL OR sulphide_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS carbonate_pct   numeric CHECK (carbonate_pct IS NULL OR carbonate_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS grg_min         numeric,
  ADD COLUMN IF NOT EXISTS grg_max         numeric,
  ADD COLUMN IF NOT EXISTS cil_min         numeric,
  ADD COLUMN IF NOT EXISTS cil_max         numeric,
  ADD COLUMN IF NOT EXISTS flotation_pct   numeric CHECK (flotation_pct IS NULL OR flotation_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS preg_robbing    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Index for faster project-scoped lookups
CREATE INDEX IF NOT EXISTS idx_geomet_domains_project ON geomet_domains(project_id);
CREATE INDEX IF NOT EXISTS idx_geomet_domains_project_name ON geomet_domains(project_id, name);
