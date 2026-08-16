-- ═══════════════════════════════════════════════════════════════════════════
-- Essais de séparation MULTI-PRODUITS (bilan à trois produits, bi-métallique).
--
-- `lims_test_flotation` décrit une séparation à DEUX produits sur l'OR seul :
-- une alimentation, un concentré, un rejet. Elle ne peut pas décrire un circuit
-- différentiel — Cu/Zn, Pb/Zn, Cu-Au/Mo — où une alimentation donne DEUX
-- concentrés et un rejet.
--
-- Le partage massique d'un tel circuit ne se résout pas avec un seul métal : le
-- système est indéterminé. Il faut les titres de DEUX métaux sur les QUATRE
-- courants — d'où cette table (voir src/lib/analytics/metAccounting.ts,
-- `threeProductBalance`, réf. 911 Metallurgist).
--
-- Table dédiée plutôt que seize colonnes greffées sur l'essai de flottation or :
-- un circuit différentiel n'est pas une variante d'un essai mono-métal, et
-- charger `lims_test_flotation` de colonnes nulles pour tout projet aurifère
-- serait un mauvais service rendu au cas courant.
--
-- Owner-scoped comme les autres tables enfant ; le verrou d'approbation est déjà
-- assuré en amont par la RLS sur `projects`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lims_test_separation_multi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id   uuid REFERENCES public.lims_samples(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  test_label   text,
  conc1_label  text NOT NULL DEFAULT 'Concentré 1',
  conc2_label  text NOT NULL DEFAULT 'Concentré 2',

  -- Les deux métaux qui servent à résoudre le partage massique. Symboles du
  -- registre applicatif ('Cu', 'Zn', 'Pb', 'Au', 'Ag'…).
  metal_a text NOT NULL,
  metal_b text NOT NULL,
  CONSTRAINT separation_multi_distinct_metals CHECK (metal_a <> metal_b),

  -- Titres du métal A sur les quatre courants, dans une unité HOMOGÈNE.
  a_feed  numeric CHECK (a_feed  IS NULL OR a_feed  >= 0),
  a_conc1 numeric CHECK (a_conc1 IS NULL OR a_conc1 >= 0),
  a_conc2 numeric CHECK (a_conc2 IS NULL OR a_conc2 >= 0),
  a_tail  numeric CHECK (a_tail  IS NULL OR a_tail  >= 0),

  -- Titres du métal B sur les mêmes quatre courants.
  b_feed  numeric CHECK (b_feed  IS NULL OR b_feed  >= 0),
  b_conc1 numeric CHECK (b_conc1 IS NULL OR b_conc1 >= 0),
  b_conc2 numeric CHECK (b_conc2 IS NULL OR b_conc2 >= 0),
  b_tail  numeric CHECK (b_tail  IS NULL OR b_tail  >= 0),

  -- Ce que le laboratoire ANNONCE — sert à recouper le bilan recalculé, jamais
  -- à s'y substituer (même discipline que la réconciliation à deux produits).
  reported_a_recovery_pct numeric CHECK (reported_a_recovery_pct IS NULL OR reported_a_recovery_pct BETWEEN 0 AND 100),
  reported_b_recovery_pct numeric CHECK (reported_b_recovery_pct IS NULL OR reported_b_recovery_pct BETWEEN 0 AND 100),
  reported_conc1_mass_pct numeric CHECK (reported_conc1_mass_pct IS NULL OR reported_conc1_mass_pct BETWEEN 0 AND 100),
  reported_conc2_mass_pct numeric CHECK (reported_conc2_mass_pct IS NULL OR reported_conc2_mass_pct BETWEEN 0 AND 100),

  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lims_test_separation_multi_project_idx
  ON public.lims_test_separation_multi (project_id);

ALTER TABLE public.lims_test_separation_multi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lims_sep_multi_owner_all ON public.lims_test_separation_multi;
CREATE POLICY lims_sep_multi_owner_all ON public.lims_test_separation_multi
  FOR ALL TO authenticated
  USING      (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

COMMENT ON TABLE public.lims_test_separation_multi IS
  'Essais de séparation à DEUX concentrés (circuit différentiel). Les titres de deux '
  'métaux sur les quatre courants permettent de résoudre le partage massique, qu''un '
  'seul métal laisse indéterminé. Alimente le bilan à trois produits.';
