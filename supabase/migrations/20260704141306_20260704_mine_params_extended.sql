/*
# Extend mine_params table for advanced Mine & Optimisation module

1. New columns added
- `ga_cost_m` (float, default 8) — G&A in M$/year (replaces ga_cost_t)
- `sustaining_capex_m` (float, default 6) — sustaining CAPEX M$/yr (clearer name alongside old column)
- `discount_rate_pct` (float, default 10) — discount rate %
- `royalty_pct` (float, default 3) — royalties %
- `nsr_pct` (float, default 1.5) — NSR %
- `pump_cost_m` (float, default 1.5) — dewatering cost M$/yr
- `blasting_cost_t` (float, default 0.9) — blasting $/t total
- `ore_recovery_pct` (float, default 95) — ore recovery %
- `dilution_pct` (float, default 5) — mining dilution %
- `gold_price_sens` (float, default 2000) — sensitivity analysis gold price

2. Notes
- Uses IF NOT EXISTS pattern (via DO block) for idempotency
- All columns have defaults so existing rows are unaffected
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='ga_cost_m') THEN
    ALTER TABLE mine_params ADD COLUMN ga_cost_m float NOT NULL DEFAULT 8.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='sustaining_capex_m') THEN
    ALTER TABLE mine_params ADD COLUMN sustaining_capex_m float NOT NULL DEFAULT 6.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='discount_rate_pct') THEN
    ALTER TABLE mine_params ADD COLUMN discount_rate_pct float NOT NULL DEFAULT 10.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='royalty_pct') THEN
    ALTER TABLE mine_params ADD COLUMN royalty_pct float NOT NULL DEFAULT 3.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='nsr_pct') THEN
    ALTER TABLE mine_params ADD COLUMN nsr_pct float NOT NULL DEFAULT 1.5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='pump_cost_m') THEN
    ALTER TABLE mine_params ADD COLUMN pump_cost_m float NOT NULL DEFAULT 1.5;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='blasting_cost_t') THEN
    ALTER TABLE mine_params ADD COLUMN blasting_cost_t float NOT NULL DEFAULT 0.9;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='ore_recovery_pct') THEN
    ALTER TABLE mine_params ADD COLUMN ore_recovery_pct float NOT NULL DEFAULT 95.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='dilution_pct') THEN
    ALTER TABLE mine_params ADD COLUMN dilution_pct float NOT NULL DEFAULT 5.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mine_params' AND column_name='gold_price_sens') THEN
    ALTER TABLE mine_params ADD COLUMN gold_price_sens float NOT NULL DEFAULT 2000.0;
  END IF;
END $$;
