# ROADMAP MetalFlow Pro — Innovation & praticité

**Date** : 24 juillet 2026
**Cadrage** : ce document complète `AUDIT_METALFLOW_PRO.md` (durcissement production, dette technique). Il porte sur un **autre axe** : rendre la plateforme *innovante* et *très pratique*, à partir d'une inspection des 19 modules (~28 000 lignes, moteurs purs + pages).

---

## Verdict d'ensemble

Le socle scientifique est solide : chaîne LIMS → granulométrie → critères → flowsheet → simulation → économie → NI 43-101, moteurs purs testés (Bond, WLS, Monte-Carlo, Pareto, cutoff/pit optimizer), agrégation P80 correcte, récupération centralisée dans `ProjectContext`.

Les axes d'amélioration ne sont **pas** dans les calculs mais dans trois dimensions :

1. **Le « I » de Intelligence n'existe pas encore.** `CircuitAI` (MetaScore), `GeoMet` Intelligence et `COS` « Cognitif » sont des moteurs de **scoring pondéré déterministes** — aucun ML, aucun LLM. Le branding promet une intelligence que le code ne livre pas.
2. **Expérience de tableur riche, pas de produit 2026** : thème sombre figé (`mf-bg #070A12`, pas de mode clair), graphiques SVG statiques sans interaction (~26 `<svg>` faits main), pas de recherche globale, accessibilité quasi nulle (`aria:5 / role:2` sur toute l'app), non responsive.
3. **Pas de mémoire décisionnelle** : ni snapshots de scénarios, ni versioning, ni piste d'audit — pénalisant pour un outil dont la sortie (NI 43-101) est un livrable réglementaire.

---

## A. Améliorations transversales (plus fort levier)

| # | Amélioration | Pourquoi c'est décisif | Effort |
|---|---|---|---|
| **T1** | **Copilote LLM embarqué** (Claude API) : interroger les données du projet en langage naturel, expliquer un résultat, **rédiger les sections narratives NI 43-101** depuis les données saisies. | Rend réelle la promesse « Intelligence ». Innovation signature. | Élevé |
| **T2** | **Couche graphique unifiée interactive** : composant commun (tooltip, zoom, export PNG/SVG) en remplacement des ~26 `<svg>` faits main. | Cohérence visuelle + interactivité attendue partout. | Moyen |
| **T3** | **Palette de commandes `Ctrl+K`** : recherche/navigation globale 19 modules + actions. | 19 modules sans recherche = friction constante. Standard SaaS. | Faible |
| **T4** | **Snapshots de scénarios + comparaison** : figer un état complet, diff, restaurer. | Un outil de décision doit mémoriser ses hypothèses. Base de la conformité NI 43-101. | Moyen |
| **T5** | **Thème clair + responsive tablette** : palette figée, sidebar 240px non repliable. | Praticité terrain (site, salle claire, iPad). | Moyen |
| **T6** | **Accessibilité** : navigation clavier des onglets, focus visibles, labels des inputs de tableaux. | Exigences marchés publics/miniers ; faible coût, fort signal qualité. | Faible |
| **T7** | **Cache de données (React Query/SWR)** : uniformiser fetch/loading/erreur ; résout aussi les warnings `exhaustive-deps`. | Vitesse perçue, moins de flicker, code plus simple. | Moyen |
| **T8** | **Générateur PDF/Word un-clic** pour NI 43-101 & Rapports : assembler le livrable final. | Le bout de chaîne (l'étude de faisabilité imprimable) manque. | Moyen |

---

## B. Améliorations par module

### Vue Exécutive
- **Dashboard** — Bon. *Ajouter :* bande P10/P50/P90 sur la production (moteur `lib/simulation/monteCarlo` déjà présent, non remonté) ; alertes hors-plage (AISC > prix spot).
- **Stage-Gates** — *Ajouter :* sign-off multi-utilisateur (qui/quand) + pièces jointes.

### Données
- **LIMS** — Le plus complet (7 onglets, QA/QC). *Ajouter :* cartes de contrôle Shewhart interactives, détection d'anomalies sur duplicatas/standards.
- **Block Model** — *Ajouter :* visualisation 3D légère (iso/coupes) ; import CSV/GEMS/Datamine.
- **Granulométrie** — Solide. *Ajouter :* superposition multi-échantillons sur la courbe PSD ; export courbe.
- **Analyse & Interprétation** — *Ajouter :* interactivité T2 ; narration auto des corrélations via T1.

### Design Procédé
- **Critères de conception** — Template Excel (Bond/Rowland/VSMA/Faraday). *Ajouter :* traçabilité formule (équation + entrées) et alertes hors domaine de validité des corrélations.
- **Flowsheet** — ⚠️ Seul module encore sur `mockData`. *Priorité :* le brancher sur données projet réelles persistées.
- **Bilan massique & eau** — *Ajouter :* réconciliation visuelle des écarts de fermeture.
- **Équipements** — *Ajouter :* liste générée automatiquement depuis flowsheet + critères ; datasheet exportable.

### Optimisation
- **MetaScore / CircuitAI** — *Ajouter :* assumer « MCDA » avec pondérations éditables + sensibilité, **ou** brancher T1 pour une recommandation argumentée.
- **Simulation Pro** — Monte-Carlo + Pareto = déjà le plus « produit ». *Ajouter :* tornado, front de Pareto interactif, runs comparables (T4).
- **Géo-Métal. Intelligence** — *Ajouter :* vraie prédiction (régression/krigeage) + intervalles de confiance.
- **Mine & Optimisation** — Pit optimizer en web-worker (bien). *Ajouter :* animation de la séquence par période ; comparaison de cadences (T4).
- **Système Exploitation Cognitif (COS)** — *Ajouter :* ingestion temps réel (capteurs/OPC) + alertes live (ossature `DigitalTwinPanel`/`IngestionImportPanel` déjà là).

### Économie & Risques
- **Modèle Économique** — *Ajouter :* sensibilité bidirectionnelle (tornado VAN/TRI) + seuils de rentabilité graphiques.
- **Registre des Risques** — *Ajouter :* Monte-Carlo du risque agrégé sur la VAN ; matrice interactive drag-and-drop.

### Conformité & Rapports
- **NI 43-101 / Rapports** — 21 sections suivies. *Priorité :* assemblage automatique du document (T8 + T1) — le livrable final ne se produit pas en un clic.

---

## C. Séquencement recommandé

Pour « innovant **et** très pratique », trio à plus fort ROI perçu :

1. **T3 — Palette `Ctrl+K`** (~1 j) : gain immédiat sur les 19 modules.
2. **T1 — Copilote LLM** : innovation signature, légitime le branding « Intelligence », débloque T8.
3. **T4 — Snapshots** : mémoire décisionnelle manquante à un outil de faisabilité.

---

## D. Suivi

| ID | Statut | Notes |
|---|---|---|
| T1 | ✅ Code livré — activation infra requise | Copilote LLM complet : Edge Function `supabase/functions/copilot/index.ts` (garde la clé côté serveur), client `lib/copilot.ts`, UI flottante `components/ui/CopilotPanel.tsx` (montée dans App). **Dormant** tant que `VITE_COPILOT_ENABLED=true` n'est pas posé → zéro impact prod. Activation : `supabase functions deploy copilot` + `supabase secrets set ANTHROPIC_API_KEY=...` + flag env. Modèle par défaut `claude-sonnet-5` (override `COPILOT_MODEL`). |
| T2 | 🟡 Fondation livrée (24/07) | Primitive graphique interactive `components/ui/Chart.tsx` (LineChart + BarChart : crosshair, tooltip, légende, print-safe). Démo branchée dans le Dashboard (récupération). Migration des ~26 SVG restants : par incréments. |
| T3 | ✅ Fait (24/07) | Palette `Ctrl/⌘+K` : `components/ui/CommandPalette.tsx`, config nav unifiée `lib/navConfig.ts`, bouton « Rechercher ⌘K » sidebar. 19 modules + actions, 100 % clavier. |
| T4 | ✅ Fait (24/07) — SQL à exécuter | Snapshots **avec comparaison de scénarios** (table diff KPI, couleurs mieux/pire) + restauration qui met à jour le projet actif en direct. Migration `supabase/migrations/..._project_snapshots.sql`, client `lib/snapshots.ts`, panneau `components/ui/SnapshotsPanel.tsx` (Dashboard). Dégradation gracieuse si table absente. Activation : exécuter le SQL dans Supabase. |
| T5 | ✅ Fait (24/07) | Mode clair/sombre commutable (variables CSS, toggle persistant sidebar `lib/theme.ts`), sombre par défaut **byte-identique** (zéro régression, vérifié). **Sidebar repliable** en rail d'icônes, état persistant (`Layout`). Îlots sombres NI 43-101 corrigés. Le module Simulation reste sombre **volontairement** (éditeur de diagramme). |
| T6 | ✅ Fait (24/07) | Focus-trap + `aria-modal`/`aria-labelledby`/restauration focus sur le `Modal` partagé ; a11y palette ; **indicateur de focus clavier global** (`:focus-visible`, specificity 0, n'écrase aucun style composant). Reste optionnel : rôles ARIA `tablist`/`tab` explicites sur les barres d'onglets. |
| T7 | ✅ Cœur livré + testé (24/07) | Couche de cache **sans dépendance** : `lib/query/queryClient.ts` (cache mémoire, dédup requêtes concurrentes, stale-while-revalidate, invalidation) + hook `lib/query/useQuery.ts`. **7 tests unitaires** sur le cœur pur. Adopté sur `SnapshotsPanel`. Déploiement page par page = rollout documenté. |
| T8 | ✅ Fait (24/07) | Export PDF un-clic sans dépendance : `@media print` + `components/ui/PrintButton.tsx`. Branché sur NI 43-101 et Rapports. |

## E. Déploiement (24/07/2026)

Déployé en production sur Railway (`railway up`, projet **MetalFlowPro** / env **production** / service **metalflowpro**).

- URL : https://metalflowpro.com — statut `● Online`, HTTP 200, 0 erreur console.
- Vérifié : le bundle servi (`index-hh0qDH_z.js`) est **exactement** celui du build local.
- Contrôles avant déploiement : `tsc` 0 · `eslint` 0 erreur · **493 tests** · `vite build` vert.

### Activation post-déploiement — ✅ FAITE (25/07/2026)
1. **T4 Snapshots** — table `project_snapshots` créée sur `qbcvrwyapvzugekbhrfy` (vérifiée via REST : HTTP 200). Panneau actif en prod.
2. **T1 Copilote** — fonction `copilot` déployée (ACTIVE v1, `verify_jwt`), secret `ANTHROPIC_API_KEY` posé, testée en live (HTTP 200, `claude-sonnet-5`, réponse métier correcte). Flag `VITE_COPILOT_ENABLED=true` posé sur Railway **et dans `.env`** (Nixpacks réutilisait le cache de build sur simple changement de variable ; le flag dans `.env` casse le cache et garantit l'inline Vite). Bundle prod `index-D7YChY2E.js` (flag ON).

> Note infra : la prod Railway pointe sur le projet Supabase **`qbcvrwyapvzugekbhrfy`** (« bolt-native-database »), pas sur « metalflowpro's Project ». La config Railway live fait foi.

### Reste (rollout incrémental, non bloquant)
- **T2** : migrer les ~26 SVG métier restants vers `components/ui/Chart.tsx` (page par page, avec vérification connectée).
- **T7** : adopter `useQuery` sur les 19 pages (fait sur `SnapshotsPanel`).
