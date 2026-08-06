/*
# Project metals — économie par métal (foyer multi-métal)

Complète l'abstraction multi-métal (lib/metals) côté base : chaque projet peut
déclarer plusieurs métaux économiquement récupérables, CHACUN avec sa propre
teneur de tête, son prix, SA RÉCUPÉRATION et sa fraction payable. Corrige la
limite mono-or (`projects.recovery_pct` unique) : un porphyre Cu-Au-Mo a des
récupérations distinctes (Cu ~81 %, Au ~48,5 %, Mo 50 % pour Morrison).

## project_metals (isolée par project_id, RLS)
- symbol ('Cu','Au','Mo','Ag'), name, is_primary, is_payable
- grade / grade_unit ('pct'|'g/t')  — teneur de tête in situ
- price_usd / price_unit ('usd/lb'|'usd/oz')
- recovery_pct — récupération métallurgique globale du métal
- payable_pct  — part payée par la fonderie (déductions d'unité, etc.)

## Sécurité
RLS activée, policies anon+authenticated (cohérent avec le schéma).
*/

CREATE TABLE IF NOT EXISTS project_metals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  symbol        text NOT NULL,                 -- 'Cu','Au','Mo','Ag'
  name          text,
  grade         numeric,                        -- teneur de tête (dans grade_unit)
  grade_unit    text NOT NULL DEFAULT 'pct',    -- 'pct' | 'g/t'
  price_usd     numeric,                        -- prix
  price_unit    text NOT NULL DEFAULT 'usd/lb', -- 'usd/lb' | 'usd/oz'
  recovery_pct  numeric CHECK (recovery_pct IS NULL OR recovery_pct BETWEEN 0 AND 100),
  payable_pct   numeric NOT NULL DEFAULT 100 CHECK (payable_pct BETWEEN 0 AND 100),
  is_primary    boolean NOT NULL DEFAULT false,
  is_payable    boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (project_id, symbol)
);

ALTER TABLE project_metals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_project_metals" ON project_metals;
CREATE POLICY "anon_select_project_metals" ON project_metals FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_project_metals" ON project_metals;
CREATE POLICY "anon_insert_project_metals" ON project_metals FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_project_metals" ON project_metals;
CREATE POLICY "anon_update_project_metals" ON project_metals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_project_metals" ON project_metals;
CREATE POLICY "anon_delete_project_metals" ON project_metals FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_project_metals_project ON project_metals (project_id, sort_order);
