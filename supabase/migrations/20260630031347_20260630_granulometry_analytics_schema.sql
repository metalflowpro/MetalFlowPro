/*
# Granulométrie & Analyse PSD — Migration

## Titre
Ajout des tables pour la granulométrie (PSD) et la libération minéralogique.

## Description
Ce module stocke les analyses granulométriques (courbes PSD) et la déportation de l'or
par fraction granulométrique, ainsi que les données de libération minérale (MLA/a3).
Ces données alimentent directement le moteur de comminution (équation de Bond).

## Nouvelles tables

### lims_granulometry
Table principale d'un essai granulométrique (un essai = un échantillon + un type de test).
- id : uuid PK
- project_id : référence projet (RLS)
- sample_id : référence optionnelle à lims_samples
- test_code : code de famille (a2 = granulo alimentation, a2p = produit broyage)
- campaign : campagne d'échantillonnage
- domain : domaine géomet (optionnel)
- lithotype : lithologie (optionnel)
- p80_um : P80 calculé par interpolation (µm)
- d50_um : D50 calculé (µm)
- f80_rom_mm : F80 ROM alimentation (mm) — paramètre amont
- notes : commentaires libres
- created_at / updated_at

### lims_psd_fractions
Fractions granulométriques retenues (une ligne par classe de tamis par essai).
- id : uuid PK
- granulometry_id : FK vers lims_granulometry
- project_id : RLS
- sieve_um : ouverture de tamis en µm (ex. 500, 212, 150, 106, 75, 53, 38, 0 pour -38)
- retained_pct : % retenu partiel sur ce tamis
- passing_pct : % passant cumulé (calculé ou saisi)
- au_g_t : teneur or sur cette fraction (g/t)
- au_dist_pct : distribution Au sur cette fraction (%)
- UNIQUE(granulometry_id, sieve_um)

### lims_liberation (a3)
Données de libération minérale (MLA / analyse d'images).
- id : uuid PK
- project_id : RLS
- sample_id : FK optionnel vers lims_samples
- granulometry_id : FK optionnel vers lims_granulometry
- p80_liberation_um : P80 de libération (µm)
- au_free_pct : % d'or libre
- au_locked_sulfide_pct : or occlus dans sulfures (%)
- au_locked_oxide_pct : or occlus dans oxydes (%)
- au_locked_silicate_pct : or occlus dans silicates (%)
- au_preg_robbing_pct : potentiel prég-robbing (%)
- sulfide_liberation_pct : libération des sulfures (%)
- created_at

## Sécurité
RLS activé sur toutes les tables. Politiques de lecture/écriture/suppression
owner-scoped via project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()).
*/

-- ============================================================
-- 1. LIMS GRANULOMETRY
-- ============================================================

CREATE TABLE IF NOT EXISTS lims_granulometry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sample_id       uuid REFERENCES lims_samples(id) ON DELETE SET NULL,
  test_code       text NOT NULL DEFAULT 'a2' CHECK (test_code IN ('a2','a2p','a2f')),
  campaign        text,
  domain          text,
  lithotype       text,
  p80_um          numeric CHECK (p80_um > 0),
  d50_um          numeric CHECK (d50_um > 0),
  f80_rom_mm      numeric CHECK (f80_rom_mm > 0),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE lims_granulometry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_granulometry" ON lims_granulometry;
CREATE POLICY "select_own_granulometry" ON lims_granulometry FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_granulometry" ON lims_granulometry;
CREATE POLICY "insert_own_granulometry" ON lims_granulometry FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_granulometry" ON lims_granulometry;
CREATE POLICY "update_own_granulometry" ON lims_granulometry FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_granulometry" ON lims_granulometry;
CREATE POLICY "delete_own_granulometry" ON lims_granulometry FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 2. LIMS PSD FRACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS lims_psd_fractions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  granulometry_id  uuid NOT NULL REFERENCES lims_granulometry(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL,
  sieve_um         numeric NOT NULL CHECK (sieve_um >= 0),
  retained_pct     numeric CHECK (retained_pct >= 0 AND retained_pct <= 100),
  passing_pct      numeric CHECK (passing_pct >= 0 AND passing_pct <= 100),
  au_g_t           numeric CHECK (au_g_t >= 0),
  au_dist_pct      numeric CHECK (au_dist_pct >= 0 AND au_dist_pct <= 100),
  UNIQUE (granulometry_id, sieve_um)
);

CREATE INDEX IF NOT EXISTS idx_psd_fractions_granulo ON lims_psd_fractions(granulometry_id);
CREATE INDEX IF NOT EXISTS idx_psd_fractions_project ON lims_psd_fractions(project_id);

ALTER TABLE lims_psd_fractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_psd_fractions" ON lims_psd_fractions;
CREATE POLICY "select_own_psd_fractions" ON lims_psd_fractions FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_psd_fractions" ON lims_psd_fractions;
CREATE POLICY "insert_own_psd_fractions" ON lims_psd_fractions FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_psd_fractions" ON lims_psd_fractions;
CREATE POLICY "update_own_psd_fractions" ON lims_psd_fractions FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_psd_fractions" ON lims_psd_fractions;
CREATE POLICY "delete_own_psd_fractions" ON lims_psd_fractions FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 3. LIMS LIBERATION (a3)
-- ============================================================

CREATE TABLE IF NOT EXISTS lims_liberation (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sample_id               uuid REFERENCES lims_samples(id) ON DELETE SET NULL,
  granulometry_id         uuid REFERENCES lims_granulometry(id) ON DELETE SET NULL,
  p80_liberation_um       numeric CHECK (p80_liberation_um > 0),
  au_free_pct             numeric CHECK (au_free_pct BETWEEN 0 AND 100),
  au_locked_sulfide_pct   numeric CHECK (au_locked_sulfide_pct BETWEEN 0 AND 100),
  au_locked_oxide_pct     numeric CHECK (au_locked_oxide_pct BETWEEN 0 AND 100),
  au_locked_silicate_pct  numeric CHECK (au_locked_silicate_pct BETWEEN 0 AND 100),
  au_preg_robbing_pct     numeric CHECK (au_preg_robbing_pct BETWEEN 0 AND 100),
  sulfide_liberation_pct  numeric CHECK (sulfide_liberation_pct BETWEEN 0 AND 100),
  created_at              timestamptz DEFAULT now()
);

ALTER TABLE lims_liberation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_liberation" ON lims_liberation;
CREATE POLICY "select_own_liberation" ON lims_liberation FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_liberation" ON lims_liberation;
CREATE POLICY "insert_own_liberation" ON lims_liberation FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_liberation" ON lims_liberation;
CREATE POLICY "update_own_liberation" ON lims_liberation FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_liberation" ON lims_liberation;
CREATE POLICY "delete_own_liberation" ON lims_liberation FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
