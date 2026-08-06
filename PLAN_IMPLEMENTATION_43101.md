# Plan d'implémentation — Compléter la chaîne « du terrain au rapport NI 43-101 »

**Date** : 5 août 2026
**Prérequis de lecture** : `ANALYSE_WORKFLOW_43101.md` (analyse du projet Morrison + cartographie des écarts).
**Objet** : plan prêt à coder pour combler les 3 écarts retenus — **(A)** ingestion forages + modèle géologique, **(B)** moteur d'estimation de ressource, **(C)** gates de validation réglementaires + export 43-101.

## Conventions du repo à respecter (observées)

- **Moteurs = fonctions pures** dans `src/lib/<domaine>/`, **aucun** import React/Supabase, JSDoc d'en-tête expliquant le « pourquoi », **test colocalisé** `*.test.ts` (Vitest). Réf. : `src/lib/mine/cutoff.ts`, `src/lib/geomet/p80.ts`.
- **Pages** : `src/pages/X.tsx`, signature `({ project }: { project: Project })`, pattern à onglets (`type Tab = …`), `PageHeader` + `Modal` partagés, fetch Supabase direct avec cache TTL, import Excel via `xlsx` (déjà dépendance, cf. `BlockModel.tsx`).
- **Enregistrement d'une page** : ajouter au union `Page` (`src/types/index.ts`), à l'icône Sidebar (`src/components/layout/Sidebar.tsx`), au switch (`src/App.tsx`).
- **Persistance** : migration Supabase `supabase/migrations/AAAAMMJJHHMMSS_*.sql`, **isolation `project_id` + RLS** (cf. `20260727010000_project_isolation_integrity.sql`), FK vers `projects`.
- **Types** partagés dans `src/types/index.ts` ; réglages/hypothèses dans `ProjectContext` / `config/constants`.
- **Multi-métal** : ⚠️ le modèle actuel est mono-or (`au_g_t`, `Project.gold_grade_g_t/gold_price_usd`). Morrison est **Cu-Au-Mo**. Le plan introduit une abstraction multi-élément ; garder la rétro-compat or.

> **Règle d'or (déjà appliquée dans le repo)** : tout ce qui est calcul scientifique va dans `lib/` en pur + testé ; les pages ne font qu'orchestrer/afficher/persister. Chaque tâche ci-dessous respecte cette séparation.

---

# PHASE A — Ingestion forages + modèle géologique

**But** : donner à l'app un point d'entrée « terrain » : les 4 tables de forage → desurvey → composites → wireframes de domaines. Aujourd'hui l'app démarre au LIMS ; il manque la donnée spatiale brute qui alimente l'estimation (Phase B).

### A1 — Schéma de données forages
- **Fichier** : `supabase/migrations/20260805xxxxxx_drilling_tables.sql`
- **Tables** (toutes `project_id uuid → projects`, RLS activée, index sur `(project_id, hole_id)`) :
  - `dh_collar` : `hole_id`, `x`, `y`, `z`, `max_depth`, `hole_type` (`resource|geotech|metallurgical|condemnation|monitoring`), `drilled_on`, `diameter`.
  - `dh_survey` : `hole_id`, `depth`, `azimuth`, `dip`.
  - `dh_litho` : `hole_id`, `from_m`, `to_m`, `lithology`, `alteration`, `mineralization`.
  - `dh_assay` : `hole_id`, `from_m`, `to_m`, `element` (`Cu|Au|Mo|Ag|…`), `value`, `unit`, `lab_job`, `qaqc_type` (`sample|standard|blank|duplicate|null`).
- **Note** : `dh_assay` en format **long** (une ligne par élément) pour supporter le multi-métal sans migration future.

### A2 — Moteur de desurvey (pur)
- **Fichiers** : `src/lib/drilling/desurvey.ts` + `desurvey.test.ts`
- **Fonctions** :
  - `desurveyHole(collar, surveys[]): DesurveyedPoint[]` — méthode **minimum curvature** (standard industrie ; gérer le cas mono-survey → tangentiel).
  - `intervalToXYZ(hole, from, to): {midXYZ, length}` — projette un intervalle assay/litho en coordonnées.
- **Tests** : trou vertical (XYZ = collar - profondeur en Z), trou -45° azimut 90° (validation trigonométrique connue), cohérence longueur cumulée.

### A3 — Moteur de compositage (pur) — *partagé avec Phase B*
- **Fichiers** : `src/lib/drilling/compositing.ts` + test
- **Fonction** : `compositeByLength(assays[], { length, mode: 'fixed'|'honourBoundaries', domainField? }): Composite[]`
  - longueur cible paramétrable (⚠️ le document Morrison ne donne pas la valeur → **paramètre**, cf. ambiguïté §8.4 de l'analyse), pondération par longueur, gestion des trous/`null`, résidus.
- **Tests** : composite 2 m sur intervalles 1 m homogènes = même teneur ; pondération correcte sur teneurs mixtes ; conservation du métal (Σ teneur×longueur).

### A4 — Extension `BlockModel` → import forages + wireframes
- **Page** : étendre `src/pages/BlockModel.tsx` (nouvel onglet **« Forages »**) OU nouvelle page `Drilling.tsx` (recommandé : page dédiée, `Page='drilling'`, placée **avant** blockmodel dans la Sidebar).
- **Composants** : `src/components/drilling/CollarTable.tsx`, `DrillSectionViewer.tsx` (réutilise le SVG de `SliceViewer`), `ImportDrillingModal.tsx` (4 onglets d'import CSV/XLSX mappés aux 4 tables).
- **Wireframes de domaines** : v1 = **assignation de domaine par règle** (ex. `Cu ≥ 0,20 %` → « copper zone » ; par lithologie/altération) plutôt que modélisation implicite 3D complète — signaler comme limite. Solides 3D = itération ultérieure.

### A5 — Câblage
- `Page` union + Sidebar (icône `Drill`/`Pickaxe`) + `App.tsx` switch + `ModuleStatus` (completion basée sur nb de trous/assays).

**Livrable Phase A** : import des 4 tables → desurvey visualisable en coupe → composites calculés et persistés, prêts pour l'estimation.

---

# PHASE B — Moteur d'estimation de ressource (cœur réglementaire)

**But** : produire le block model **dans l'app** (aujourd'hui importé tout fait). C'est l'item 13-14 du NI 43-101. Chaîne : composites → stats → variographie → interpolation → CuEq → classification CIM → grade-tonnage.

### B1 — Statistiques & déclustering (pur)
- **Fichiers** : `src/lib/resource/statistics.ts` + test
- **Fonctions** : `declusterCellSizes(composites)`, `summaryStats(values)` (min/max/moy/médiane/CV), `capOutliers(values, method)` (écrêtage/top-cut — paramétrable, documenté).
- **Réutilise** : `src/lib/ml/distributions.ts` (déjà présent) pour histogrammes/probabilité.

### B2 — Variographie (pur)
- **Fichiers** : `src/lib/resource/variogram.ts` + test
- **Fonctions** :
  - `experimentalVariogram(points, { lagDistance, nLags, azimuth, dip, tolerance }): VarioPoint[]`
  - `fitVariogramModel(varioPoints, { type: 'spherical'|'exponential'|'gaussian' }): { nugget, sill, range }` (ajustement moindres carrés — réutiliser `src/lib/ml/regression.ts` / `linalg.ts`).
- **Tests** : semivariance = 0 à distance 0 (hors pépite) ; palier ≈ variance ; modèle sphérique reproduit une plage connue sur jeu synthétique.
- **⚠️ Ambiguïté §8.1** : Morrison ne fournit pas les paramètres de variogramme → l'app doit les **estimer/laisser saisir**, pas les supposer.

### B3 — Interpolation dans le block model (pur, potentiellement web-worker)
- **Fichiers** : `src/lib/resource/kriging.ts` + test, `src/lib/resource/idw.ts` + test
- **Fonctions** :
  - `krigeBlock(blockCentroid, neighbours, variogramModel, { maxSamples, searchEllipsoid }): { estimate, krigingVariance }` — **krigeage ordinaire** (résolution du système via `linalg.ts`).
  - `idwBlock(blockCentroid, neighbours, { power, searchEllipsoid })` — repli/IDW.
  - `estimateModel(blocks[], composites[], config): EstimatedBlock[]` — orchestrateur (candidat **web-worker**, suivre le pattern `src/lib/mine/pitOptimizer.worker.ts`).
- **Tests** : krigeage exact aux points d'échantillon ; variance de krigeage croît avec l'éloignement ; IDW power→∞ ≈ plus proche voisin.

### B4 — CuEq & classification CIM (pur)
- **Fichiers** : `src/lib/resource/equivalent.ts` + test, `src/lib/resource/classification.ts` + test
- **Fonctions** :
  - `copperEquivalent(grades, { prices, recoveries }): number` — **formule paramétrable** (⚠️ §8.2 : Morrison ne la donne pas). CuEq = Cu + Σ(gradeᵢ·prixᵢ·récupᵢ)/(prix_Cu·récup_Cu).
  - `classifyBlock({ krigingVariance, nSamples, avgDistance, nDrillholes }, thresholds): 'Mesuré'|'Indiqué'|'Inféré'` — règles CIM paramétrables (distance de recherche / variance / nb de trous). **Mesuré/Indiqué/Inféré** = enum déjà présent dans `BlockModel.tsx`.
- **Tests** : CuEq à Au/Mo=0 égale Cu ; monotonie ; classification passe Mesuré→Inféré quand distance↑/variance↑.

### B5 — Validation croisée & grade-tonnage (pur)
- **Fichiers** : `src/lib/resource/validation.ts` + test
- **Fonctions** : `crossValidate(composites, config)` (leave-one-out, biais/dispersion), `swathPlot(model, composites, axis)`, `gradeTonnage(blocks, cutoffs[], sg)` — **déjà à moitié dans `BlockModel` (onglet `gtcurve`)** : factoriser ici en pur.
- **Tests** : grade-tonnage monotone décroissant en tonnage / croissant en teneur avec le cut-off ; conservation du métal.

### B6 — Persistance & page « Estimation »
- **Migration** : `resource_estimation_runs` (config JSON : variogramme, ellipsoïde, méthode, prix/récup CuEq, seuils de classe) + `estimated_blocks` (ou réutiliser la table blocs existante avec `run_id` + colonnes multi-élément `cu_pct/au_g_t/mo_pct/cueq_pct/kriging_variance`).
- **Page** : `src/pages/ResourceEstimation.tsx` (`Page='resource'`), onglets : *Composites · Statistiques · Variogramme · Paramètres krigeage · Classification · Validation · Grade-Tonnage*. Persiste un `run` → alimente `BlockModel` (viewer) **et** `MineOpt` en aval.
- **Refactor `BlockModel`** : passe du statut « importeur » à « visualiseur d'un run d'estimation » (garder l'import CSV externe comme alternative).

**Livrable Phase B** : à partir des composites Phase A, un **run d'estimation reproductible** produit un block model multi-métal classé CIM, validé, avec courbe grade-tonnage — traçable jusqu'au forage.

---

# PHASE C — Gates de validation + export du rapport 43-101

**But** : rendre la sortie **conforme et défendable** : points de contrôle bloquants + assemblage du Form 43-101F1 signé, exportable.

### C1 — Moteur de règles de validation (pur)
- **Fichiers** : `src/lib/compliance/gates.ts` + test
- **Concept** : `evaluateGate(gateId, projectData): GateResult { status: 'pass'|'warn'|'fail', checks: Check[] }`. Règles clés (issues du §5 de l'analyse) :
  - **V3 (ressource)** : date d'effet présente ; cut-off documenté ; CuEq paramétré ; validation croisée dans tolérance ; QP assigné.
  - **V5 (réserve)** : ⛔ **réserve dérivée du seul Mesuré+Indiqué** (aucun bloc Inféré dans le plan minier) — règle dure CIM ; dilution/récupération renseignées ; tonnage réserve ≤ tonnage ressource contraint fosse.
  - **V6 (économie)** : hypothèses de prix cohérentes entre modules (source unique) ; sensibilités présentes.
  - **V7 (rapport)** : 25 items du Form 43-101F1 remplis ; chaque item a QP + date ; résumé non contradictoire.
- **Tests** : V5 échoue si un bloc Inféré est marqué exploité ; V3 échoue sans date d'effet ; V7 échoue si item manquant.

### C2 — Source unique des hypothèses (refactor transversal)
- **Fichiers** : centraliser prix métaux / récupérations / FX / coûts dans `ProjectContext` + `config/constants` (partiellement déjà là). Objectif : le CuEq (B4), le NSR (`lib/mine`) et l'économie (`lib/economics`) lisent **le même** jeu. Prérequis de la règle V6.
- **Bonus conformité** : s'appuyer sur `project_snapshots` (migration `20260724…` déjà présente) pour figer « quelles hypothèses → quels chiffres → à quelle date ».

### C3 — Registre Qualified Persons
- **Migration** : `qualified_persons` (nom, titre, société, désignation P.Eng/P.Geo, date de visite de site) + `report_section_signoffs` (item 43-101 → QP → date). Réutiliser l'ossature de `StageGates` (sign-off déjà esquissé, cf. ROADMAP).

### C4 — Checklist & assemblage 43-101 (étendre l'existant)
- **Page** : étendre `src/pages/NI43101.tsx` (migration `ni43101_sections_unique` déjà présente) : mapper explicitement les **25 items du Form 43-101F1**, statut par item, QP assigné, badge de gate (C1) par item.
- **Génération narrative** : brancher l'edge function **`copilot`** (déjà présente `supabase/functions/copilot`) pour **rédiger les sections narratives** depuis les données saisies (ROADMAP T1) — l'utilisateur relit/valide (jamais d'auto-signature).

### C5 — Export un-clic PDF/Word (ROADMAP T8)
- **Fichiers** : `src/lib/report/assemble.ts` (pur : ordonne items + injecte tableaux/figures depuis chaque module) + composant `src/components/report/ExportButton.tsx`.
- **Techno** : DOCX via `docx`, PDF via `@react-pdf/renderer` ou impression HTML. **Bloquer l'export** si le gate V7 est `fail`.
- **Tests** : `assemble.ts` produit les 25 items dans l'ordre ; refuse un projet sans QP.

**Livrable Phase C** : un rapport 43-101 assemblé, chaque section rattachée à un QP daté, gates bloquants respectés (inféré jamais en réserve), export DOCX/PDF conditionné à la conformité.

---

## Ordre d'exécution & dépendances

```
A1 ─► A2 ─► A3 ─► A4 ─► A5           (Phase A : données terrain)
                 │
                 ▼  (composites)
B1 ─► B2 ─► B3 ─► B4 ─► B5 ─► B6     (Phase B : estimation) ── alimente ──► MineOpt (existant)
                              │
                              ▼  (run classé)
C2 ─► C1 ─► C3 ─► C4 ─► C5           (Phase C : conformité + rapport)
```

- **A → B** : dur (les composites de A3 sont l'entrée de B). Faire A d'abord.
- **B → C** : le gate V5 (C1) a besoin de la classification (B4) et du plan minier (MineOpt existant).
- **C2 (source unique)** peut/doit démarrer **en parallèle** dès le début — c'est un refactor transversal qui débloque V6 et fiabilise le CuEq de B4.
- **Réutilisations fortes** : `ml/linalg` + `ml/regression` (B2/B3), `pitOptimizer.worker` comme patron de web-worker (B3), `SliceViewer` (A4), onglet `gtcurve` de `BlockModel` (B5), `project_snapshots` + `copilot` + `StageGates` (C).

## Stratégie de test (Vitest, colocalisé)

Chaque moteur pur livré **avec** son `.test.ts` (comme tout `lib/` existant). Priorité aux invariants vérifiables sans données réelles :
- desurvey trigonométrique (A2), conservation du métal au compositage (A3) et au grade-tonnage (B5),
- exactitude du krigeage aux points (B3), monotonie CuEq (B4),
- **la règle dure V5** : un test qui échoue si un bloc Inféré entre dans la réserve (C1) — c'est le test de conformité le plus important.

## Ce que ce plan ne fait volontairement PAS (à cadrer avec vous)

1. **Modélisation géologique 3D implicite** (solides/wireframes complexes) — Phase A v1 se limite à l'assignation de domaine par règle. Vrai wireframing = lot séparé.
2. **Formats propriétaires** (Datamine `.dm`, Surpac `.00t`, GEMS, **OMF**) — v1 = CSV/XLSX. L'échange OMF est le candidat standard ouvert si besoin d'interop (cf. ambiguïté §8.8 de l'analyse).
3. **Bascule multi-métal complète du domaine or existant** — introduite dans les nouvelles tables/moteurs, mais la migration des pages historiquement mono-or (`Project.gold_*`) est un chantier à planifier à part.
4. Les **valeurs Morrison ne sont pas codées en dur** nulle part : elles servent de jeu de test de bout-en-bout, pas de constantes (cf. ambiguïtés §8.1-8.7).
