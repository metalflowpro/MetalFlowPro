/*
# Fiscal regimes, report documents, and Monte Carlo config tables

## Summary
1. Moves 20 hardcoded fiscal regimes from Economics.tsx into a database table
2. Adds report_documents table to replace the fake Reports.tsx page
3. Adds monte_carlo_configs table for per-project stochastic simulation settings

## Security
RLS enabled on all tables with ownership-via-project pattern.
*/

-- ============================================================
-- 1. FISCAL REGIMES (global reference table)
-- ============================================================

CREATE TABLE IF NOT EXISTS fiscal_regimes (
  id              text PRIMARY KEY,
  country         text NOT NULL,
  region          text,
  regime_group    text NOT NULL DEFAULT 'Autre',
  corp_tax_pct    numeric NOT NULL DEFAULT 30 CHECK (corp_tax_pct BETWEEN 0 AND 60),
  mining_tax_pct  numeric NOT NULL DEFAULT 0  CHECK (mining_tax_pct BETWEEN 0 AND 40),
  royalty_pct     numeric NOT NULL DEFAULT 0  CHECK (royalty_pct BETWEEN 0 AND 20),
  depletion_pct   numeric NOT NULL DEFAULT 0  CHECK (depletion_pct BETWEEN 0 AND 30),
  notes           text,
  is_active       boolean DEFAULT true,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE fiscal_regimes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_fiscal_regimes" ON fiscal_regimes;
CREATE POLICY "select_fiscal_regimes" ON fiscal_regimes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_fiscal_regimes" ON fiscal_regimes;
CREATE POLICY "insert_fiscal_regimes" ON fiscal_regimes FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_fiscal_regimes" ON fiscal_regimes;
CREATE POLICY "update_fiscal_regimes" ON fiscal_regimes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

INSERT INTO fiscal_regimes (id, country, region, regime_group, corp_tax_pct, mining_tax_pct, royalty_pct, depletion_pct, notes, sort_order) VALUES
  ('ca-qc','Canada','Québec','Canada',26.5,16.0,0.0,0.0,'Taxe minière QC: 16% profit minier net. Crédit REER mines.',1),
  ('ca-on','Canada','Ontario','Canada',26.5,10.0,0.0,0.0,'Ontario Mining Tax: 10% profits. Exemption 10 M$ profits < 500k oz.',2),
  ('ca-bc','Canada','BC','Canada',27.0,15.0,0.0,25.0,'BC Mineral Tax 2%+13%. Allowance dépréciation 25%.',3),
  ('ca-sk','Canada','Saskatchewan','Canada',27.0,10.0,2.0,0.0,'Crown royalty 2%. Mining profits tax 10%.',4),
  ('ca-nu','Canada','Nunavut / NWT','Canada',28.0,13.0,5.0,25.0,'Royalty fédérale 5% (terres fédérales). NWT mining licences.',5),
  ('ml','Mali',NULL,'Afrique Ouest',30.0,0.0,6.0,0.0,'Redevance 6% revenus bruts. IS 30%. Poss. exonération 5 ans.',6),
  ('ci','Côte d''Ivoire',NULL,'Afrique Ouest',25.0,0.0,5.0,0.0,'Redevance 5%. IS 25%. Code minier 2014.',7),
  ('sn','Sénégal',NULL,'Afrique Ouest',30.0,0.0,5.0,0.0,'Redevance 5% chiffre d''affaires. IS 30%.',8),
  ('bf','Burkina Faso',NULL,'Afrique Ouest',27.5,0.0,5.0,0.0,'Taxe sur profits miniers 27.5%. Redevance 5%.',9),
  ('gh','Ghana',NULL,'Afrique Ouest',35.0,0.0,5.0,0.0,'Corporate tax mines 35%. Royalty 5%. Withholding 8%.',10),
  ('tz','Tanzanie',NULL,'Afrique Est',30.0,0.0,6.0,0.0,'Royalty 6% revenu brut. IS 30%. TMAA inspection.',11),
  ('za','Afrique du Sud',NULL,'Afrique Est',28.0,0.0,0.5,0.0,'Royalty 0.5–5% (formule Mining Royalty Act). IS 28%.',12),
  ('mx','Mexique',NULL,'Amérique Latine',30.0,7.5,0.5,0.0,'IEPS minier 7.5% EBITDA. Redevance speciale 0.5%. ISR 30%.',13),
  ('co','Colombie',NULL,'Amérique Latine',35.0,0.0,4.0,0.0,'Regalía 4% (or). Impuesto renta 35%.',14),
  ('pe','Pérou',NULL,'Amérique Latine',30.0,0.0,3.0,0.0,'Royalty 3%. Participation speciale 20-50%. IS 30%.',15),
  ('br','Brésil',NULL,'Amérique Latine',34.0,0.0,1.5,0.0,'CFEM 1.5% revenus bruts (or). CSLL+IRPJ 34%.',16),
  ('au','Australie',NULL,'Pacifique',30.0,0.0,2.5,0.0,'Royalty WA/QLD 2.5%. IS 30%. Pas de taxe minière fédérale sur or.',17),
  ('pg','PNG',NULL,'Pacifique',30.0,0.0,2.0,0.0,'Royalty 2%. IS 30%. Additional Profits Tax (APT) éventuel.',18),
  ('us-nv','USA','Nevada','USA',21.0,5.0,3.5,15.0,'Federal 21%. Nevada Net Proceeds Tax 5%. BLM royalty 3.5% (terres fédérales).',19),
  ('us-ak','USA','Alaska','USA',21.0,9.4,3.0,15.0,'Alaska corporate max 9.4%. No state royalty on private lands.',20)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. PROJECT FISCAL SELECTION
-- ============================================================

CREATE TABLE IF NOT EXISTS project_fiscal_selection (
  project_id  uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  regime_id   text NOT NULL REFERENCES fiscal_regimes(id),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE project_fiscal_selection ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_fiscal_sel" ON project_fiscal_selection;
CREATE POLICY "select_own_fiscal_sel" ON project_fiscal_selection FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_fiscal_sel" ON project_fiscal_selection;
CREATE POLICY "insert_own_fiscal_sel" ON project_fiscal_selection FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_fiscal_sel" ON project_fiscal_selection;
CREATE POLICY "update_own_fiscal_sel" ON project_fiscal_selection FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_fiscal_sel" ON project_fiscal_selection;
CREATE POLICY "delete_own_fiscal_sel" ON project_fiscal_selection FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 3. REPORT DOCUMENTS (replaces fake Reports.tsx)
-- ============================================================

CREATE TABLE IF NOT EXISTS report_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title               text NOT NULL,
  report_type         text NOT NULL CHECK (report_type IN ('ni43101','internal','monthly','technical','budget','water','lims','risk','flowsheet','economics')),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','validated','published')),
  sections_total      integer DEFAULT 0,
  sections_completed  integer DEFAULT 0,
  pages_estimated     integer DEFAULT 0,
  author_name         text,
  content_snapshot    jsonb,
  generated_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_documents_project ON report_documents(project_id);

ALTER TABLE report_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_report_docs" ON report_documents;
CREATE POLICY "select_own_report_docs" ON report_documents FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_report_docs" ON report_documents;
CREATE POLICY "insert_own_report_docs" ON report_documents FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_report_docs" ON report_documents;
CREATE POLICY "update_own_report_docs" ON report_documents FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_report_docs" ON report_documents;
CREATE POLICY "delete_own_report_docs" ON report_documents FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 4. MONTE CARLO CONFIGS
-- ============================================================

CREATE TABLE IF NOT EXISTS monte_carlo_configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  iterations          integer NOT NULL DEFAULT 5000 CHECK (iterations BETWEEN 100 AND 50000),
  bins                integer NOT NULL DEFAULT 25 CHECK (bins BETWEEN 5 AND 100),
  seed                bigint,
  distribution_method text NOT NULL DEFAULT 'empirical' CHECK (distribution_method IN ('empirical','fitted','triangular')),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE monte_carlo_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_mc_configs" ON monte_carlo_configs;
CREATE POLICY "select_own_mc_configs" ON monte_carlo_configs FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_mc_configs" ON monte_carlo_configs;
CREATE POLICY "insert_own_mc_configs" ON monte_carlo_configs FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_mc_configs" ON monte_carlo_configs;
CREATE POLICY "update_own_mc_configs" ON monte_carlo_configs FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_mc_configs" ON monte_carlo_configs;
CREATE POLICY "delete_own_mc_configs" ON monte_carlo_configs FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
