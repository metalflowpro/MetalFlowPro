/*
# Module d'étude P80 (Granulométrie / Étude P80)

Étude d'optimisation P80 projet-centrée, connectée au LIMS SANS le modifier. Le
LIMS reste la source officielle des échantillons et résultats bruts ; ce module
ne stocke que des RÉFÉRENCES (lims_sample_id, lims_result_id) plus ses propres
calculs et sa décision métallurgique. Trois niveaux nets : données brutes LIMS →
calculs P80 → recommandation approuvée.

## Tables (toutes portent project_id pour l'isolation par propriétaire)
1. p80_study            — l'étude (nom, minerai, zone, procédé, objectif, statut)
2. p80_study_sample     — échantillons sélectionnés (réf. lims_sample_id + motif)
3. p80_test_plan        — plan d'essais (type, P80 cible, limites, réplicats)
4. p80_test_result      — résultats (réf. lims_result_id, P80 visé/mesuré, bilan)
5. p80_plant_scenario   — données usine saisies/importées (débit, énergie, oz/j)
6. p80_recommendation   — P80 labo/usine, plage, confiance, hypothèses, approbation
7. p80_audit_log        — audit trail (qui, quand, quelle valeur, ancienne valeur)

## Sécurité
RLS activée. Politique canonique du dépôt : propriétaire du projet ET approuvé
(EXISTS projects p WHERE p.id = project_id AND p.user_id = auth.uid()
 AND public.is_approved()).
*/

-- ── 1. p80_study ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_study (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_name     text NOT NULL,
  ore_type       text,
  deposit_zone   text,
  process_route  text,                    -- gravimétrie, flottation, cyanuration…
  objective      text NOT NULL DEFAULT 'net_value'
                   CHECK (objective IN ('recovery','throughput','cost','net_value')),
  p80_targets_um numeric[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','samples_selected','plan_approved',
                     'results_imported','qc','computed','reviewed',
                     'recommendation_approved','published')),
  created_by     text,
  approved_by    text,
  approved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_study_project ON p80_study (project_id, created_at DESC);

-- ── 2. p80_study_sample ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_study_sample (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id              uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  lims_sample_id        uuid REFERENCES lims_samples(id) ON DELETE SET NULL,
  sample_type           text,             -- composite, variabilité, rejet, concentré
  geological_domain     text,
  head_grade_au         numeric,
  sample_mass           numeric,
  representativity_status text NOT NULL DEFAULT 'to_verify'
                          CHECK (representativity_status IN ('to_verify','acceptable','rejected')),
  selection_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, lims_sample_id)
);
CREATE INDEX IF NOT EXISTS idx_p80_sample_study ON p80_study_sample (study_id);

-- ── 3. p80_test_plan ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_test_plan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id        uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  study_sample_id uuid REFERENCES p80_study_sample(id) ON DELETE CASCADE,
  test_type       text NOT NULL,          -- cyanuration, flottation, GRG, rebroyage
  target_p80      numeric,
  p80_lower_limit numeric,
  p80_upper_limit numeric,
  replicate_count integer NOT NULL DEFAULT 1,
  method_id       text,
  planned_date    date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_plan_study ON p80_test_plan (study_id);

-- ── 4. p80_test_result ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_test_result (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id            uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  test_plan_id        uuid REFERENCES p80_test_plan(id) ON DELETE CASCADE,
  lims_result_id      text,               -- réf. LIMS (texte ; null si saisie manuelle)
  lims_result_version integer,
  target_p80          numeric,            -- consigne de l'essai
  actual_p80          numeric,            -- P80 mesuré (ne remplace jamais la consigne)
  p80_unit            text NOT NULL DEFAULT 'um',
  au_feed             numeric,
  au_concentrate      numeric,
  au_tailings         numeric,
  au_recovery         numeric,            -- récupération rapportée
  mass_recovery       numeric,
  reagent_consumption numeric,
  energy_consumption  numeric,
  throughput          numeric,
  psd_curve           jsonb,              -- fractions par tamis, pour recalcul du P80
  computed_p80        numeric,            -- P80 recalculé sur la courbe
  computed_recovery   numeric,            -- récupération recalculée par bilan
  p80_method          text,              -- exact | log_interpolation | insufficient_data
  qc_status           text NOT NULL DEFAULT 'a_revoir'
                        CHECK (qc_status IN ('conforme','a_revoir','non_conforme')),
  review_status       text NOT NULL DEFAULT 'non_revise'
                        CHECK (review_status IN ('non_revise','revise','approuve')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_result_study ON p80_test_result (study_id);
CREATE INDEX IF NOT EXISTS idx_p80_result_plan ON p80_test_result (test_plan_id);

-- ── 5. p80_plant_scenario ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_plant_scenario (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id          uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  target_p80        numeric NOT NULL,
  f80_um            numeric,
  throughput_tph    numeric,
  mill_power_kw     numeric,
  bond_wi           numeric,
  recovery_pct      numeric,
  energy_kwh_t      numeric,
  ball_consumption  numeric,
  oz_per_day        numeric,
  net_value_per_day numeric,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_plant_study ON p80_plant_scenario (study_id);

-- ── 6. p80_recommendation ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_recommendation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id            uuid NOT NULL REFERENCES p80_study(id) ON DELETE CASCADE,
  lab_p80_um          numeric,
  plant_p80_um        numeric,
  range_low_um        numeric,
  range_high_um       numeric,
  estimated_recovery_pct numeric,
  confidence          text NOT NULL DEFAULT 'low'
                        CHECK (confidence IN ('low','medium','high')),
  rationale           text,
  assumptions         jsonb NOT NULL DEFAULT '{}',
  validation_required text[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','approved','published')),
  approved_by         text,
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_reco_study ON p80_recommendation (study_id, created_at DESC);

-- ── 7. p80_audit_log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p80_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  study_id    uuid REFERENCES p80_study(id) ON DELETE CASCADE,
  entity      text NOT NULL,             -- study | sample | plan | result | scenario | recommendation
  entity_id   uuid,
  action      text NOT NULL,             -- create | update | delete | status_change | approve
  actor       text,
  old_value   jsonb,
  new_value   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p80_audit_study ON p80_audit_log (study_id, created_at DESC);

-- ── RLS : propriétaire du projet ET approuvé, pour les 7 tables ───────────────

DO $p80_rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'p80_study','p80_study_sample','p80_test_plan','p80_test_result',
    'p80_plant_scenario','p80_recommendation','p80_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved())) WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      t || '_owner_delete', t);
  END LOOP;
END
$p80_rls$;
