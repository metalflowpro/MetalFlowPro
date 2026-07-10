/*
# Add LOM configuration parameters to mine_params

1. Modified Tables
   - `mine_params`: adds 3 new configurable fields for LOM schedule builder
     - `ramp_up_y1_pct` (double): Year 1 production ramp-up factor (default 80%)
     - `ramp_up_y2_pct` (double): Year 2 production ramp-up factor (default 92%)
     - `grade_decay_pct_yr` (double): Annual grade decay rate percent (default 1.6%/yr)
     - `capex_unit_cost_usd_t` (double): Initial CAPEX estimate in $/daily-tonne (default 42000)

2. Notes
   - All new columns have sensible defaults matching the existing hardcoded values
   - No data loss — only ADD operations
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mine_params' AND column_name = 'ramp_up_y1_pct'
  ) THEN
    ALTER TABLE mine_params ADD COLUMN ramp_up_y1_pct double precision NOT NULL DEFAULT 80.0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mine_params' AND column_name = 'ramp_up_y2_pct'
  ) THEN
    ALTER TABLE mine_params ADD COLUMN ramp_up_y2_pct double precision NOT NULL DEFAULT 92.0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mine_params' AND column_name = 'grade_decay_pct_yr'
  ) THEN
    ALTER TABLE mine_params ADD COLUMN grade_decay_pct_yr double precision NOT NULL DEFAULT 1.6;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mine_params' AND column_name = 'capex_unit_cost_usd_t'
  ) THEN
    ALTER TABLE mine_params ADD COLUMN capex_unit_cost_usd_t double precision NOT NULL DEFAULT 42000.0;
  END IF;
END $$;
