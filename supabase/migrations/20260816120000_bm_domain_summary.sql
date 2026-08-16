-- ═══════════════════════════════════════════════════════════════════════════
-- Agrégat du modèle de blocs PAR DOMAINE (lithologie).
--
-- La récupération d'un gisement variable se calcule PAR DOMAINE puis se combine
-- selon ce que le plan minier envoie à l'usine (voir src/lib/analytics/
-- domainRecovery.ts). Cela demande, par domaine : le tonnage et la teneur
-- moyenne pondérée.
--
-- Un modèle de blocs compte couramment des MILLIONS de lignes : les charger
-- dans le navigateur pour les agréger côté client est exclu. Cette vue fait
-- l'agrégation dans la base et ne rend qu'une poignée de lignes par projet.
--
-- ⚠️ La teneur est pondérée par le TONNAGE (densité × volume), pas par le
-- nombre de blocs : des blocs de tailles ou de densités différentes ne pèsent
-- pas pareil. Une moyenne arithmétique des teneurs serait fausse.
--
-- SECURITY INVOKER : la vue s'exécute avec les droits de l'appelant, donc la
-- RLS de `bm_blocks` s'applique telle quelle — aucun contournement possible,
-- et rien à re-déclarer ici.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.bm_domain_summary;

CREATE VIEW public.bm_domain_summary
WITH (security_invoker = true)
AS
SELECT
  b.project_id,
  b.config_id,
  COALESCE(NULLIF(btrim(b.rock_type), ''), 'non classifié') AS domain,
  SUM(b.density * b.volume_m3)                              AS tonnes,
  -- Teneur moyenne pondérée par le tonnage : Σ(t×g) / Σt.
  CASE
    WHEN SUM(b.density * b.volume_m3) > 0
      THEN SUM(b.density * b.volume_m3 * b.au_g_t) / SUM(b.density * b.volume_m3)
    ELSE 0
  END                                                       AS grade_gt,
  SUM(b.density * b.volume_m3 * b.au_g_t)                   AS metal_g,
  COUNT(*)                                                  AS block_count
FROM public.bm_blocks b
WHERE b.density > 0
  AND b.volume_m3 > 0
GROUP BY b.project_id, b.config_id, COALESCE(NULLIF(btrim(b.rock_type), ''), 'non classifié');

COMMENT ON VIEW public.bm_domain_summary IS
  'Tonnage et teneur moyenne pondérée par domaine (lithologie) d''un modèle de blocs. '
  'Alimente la récupération par domaine géométallurgique. La teneur est pondérée par le '
  'tonnage, jamais par le nombre de blocs.';

-- L''agrégation balaie tous les blocs d''un projet : sans cet index, chaque
-- lecture de la vue force un parcours complet de la table.
CREATE INDEX IF NOT EXISTS bm_blocks_project_config_rock_idx
  ON public.bm_blocks (project_id, config_id, rock_type);
