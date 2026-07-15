# Audit MetalFlow Pro — Rapport de mise à niveau production

**Date** : 15 juillet 2026
**Périmètre** : audit complet (≈ 27 175 lignes, 40 fichiers, 18 modules), correction des valeurs hardcodées, cohérence inter-modules, durcissement production, préparation CI/CD.
**Stack** : React 18 · TypeScript · Vite 5 · Supabase (Postgres + RLS) · déploiement Railway (Nixpacks).

---

## 1. État de la base au démarrage

| Contrôle | Avant | Après |
|---|---|---|
| `tsc --noEmit` (typecheck) | ✅ 0 erreur | ✅ 0 erreur |
| `eslint .` | ❌ **45 erreurs**, 70 warnings | ✅ **0 erreur**, warnings résiduels non bloquants |
| `vite build` | ❌ échec (binaire natif rollup, environnement) | ✅ build vert |

Le build échouait uniquement à cause du binaire natif `@rollup/rollup-*` lié à la plateforme d'installation (macOS arm64) vs. exécution Linux. **En CI/Railway (`npm ci` sur Linux), ce problème n'existe pas** ; il a été confirmé résolu ici en installant le binaire correspondant.

---

## 2. Qualité de code — lint strict (0 erreur)

Les 45 erreurs ont été éliminées avec un typage réel (aucun `any` de complaisance, aucune suppression de règle abusive) :

- **33 `no-explicit-any`** remplacés par des types propres :
  - `FlowsheetCanvas.tsx` : introduction de `NodeChange`, `EdgeChange`, `ConnectionInput` (modèles de changement type ReactFlow) au lieu de `any`.
  - `Simulation.tsx` : `catch (err: unknown)` avec garde `instanceof Error`, maps Supabase typées, `OptimizationResults` sur l'état de l'optimiseur, unions littérales sur l'objectif d'optimisation.
  - `Risks.tsx` / `NI43101.tsx` : types de lignes Supabase étroits (`SimRunRow`, `MineParamsRow`, etc.) au lieu de casts `as any` ; filtres `.filter((v): v is number => v != null)` pour narrower correctement les `null` que `any` masquait.
- **9 `no-loss-of-precision`** (`Analytics.tsx`) : ce sont les **coefficients de Lanczos** (fonction gamma, g=7), constantes scientifiques canoniques dont les décimales excèdent volontairement la précision f64. Règle désactivée **sur la ligne précise** avec justification documentée — aucune altération des valeurs.
- **2 `no-unused-expressions`** (`Flowsheet.tsx`) : ternaires-instructions convertis en `if/else`.
- **1 `no-useless-escape`** (`BlockModel.tsx`) : `\/` superflu dans une classe de caractères.

> Note : les 70 warnings restants sont des `react-hooks/exhaustive-deps` et variables inutilisées ; **non bloquants** pour `eslint` (exit 0) et donc pour la CI. Ils sont listés comme dette à traiter (§6).

---

## 3. Valeurs hardcodées → configuration (défauts en code + override BDD)

### 3.1 Architecture retenue

L'application possédait déjà une table `project_settings` (Supabase, RLS, override par projet) exposée via `ProjectContext`, mais les **fallbacks étaient éparpillés et dupliqués** dans le code (ex. facteur troy-once `31.1035` dupliqué **14×**, heures/an `8760` **32×**, taux d'actualisation `0.08` **20×**).

Nouvelle **couche unique** : `src/lib/config/constants.ts`
- `PHYSICAL_CONSTANTS` — constantes physiques immuables (`TROY_OZ_GRAMS`, `TROY_OZ_PER_KG`, `HOURS_PER_YEAR`) + helpers `kgToTroyOz`, `gramsToTroyOz`.
- `DEFAULT_ASSUMPTIONS` — hypothèses économiques/opérationnelles **versionnées et documentées** (taux d'actualisation 8 %, disponibilité, LOM, prix de l'or et échelle de sensibilité, efficacité plant gravité 0,90, redevance, contingence, frais de raffinage…), chacune avec sa justification métier.
- `resolveSettings(project_settings)` — **fusionne l'override BDD par-dessus les défauts code** (conversion %→fraction incluse). C'est le mécanisme « défauts en code, surcharge en base » demandé.

### 3.2 Câblages réalisés (cœur partagé)

- `lib/simulation/economics.ts` : suppression des constantes locales dupliquées ; taux d'actualisation et échelle de prix de l'or désormais **paramétrables** (`discountRate`, `goldPriceLadder`) avec défaut sur `DEFAULT_ASSUMPTIONS`.
- `lib/ProjectContext.tsx` : facteur d'efficacité gravité `0.90` → `DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY` ; `31.1035` → `TROY_OZ_GRAMS`.
- `Dashboard`, `Economics`, `MineOpt`, `BlockModel`, `GeoMet` : les définitions locales `const TROY = 1/31.1035` pointent vers `TROY_OZ_GRAMS` (source unique).
- `ProjectList`, `App` (aperçu formulaire) : `8760` et `31.1035` → `HOURS_PER_YEAR`, `TROY_OZ_GRAMS`.

### 3.3 Reste-à-faire (même pattern, extension mécanique)

21 occurrences résiduelles de `31.1035` / `8760` subsistent dans les modules volumineux — **à migrer en important depuis `config/constants`** :
`Criteria.tsx` (3 073 lignes), `MassBalance.tsx`, `Granulometry.tsx`, `GeoMet.tsx` (calculs internes). Le mécanisme est en place ; la migration est un remplacement d'import sans risque fonctionnel (valeurs numériquement identiques).

---

## 4. Cohérence inter-modules

**Colonne vertébrale « récupération » : déjà centralisée et confirmée saine.** `ProjectContext` calcule à partir du testwork LIMS (Knelson GRG + lixiviation) :
- `gravityRecoveryPct` = GRG × efficacité plant
- `globalRecoveryPct` = 1 − (1 − R_grav)(1 − R_leach) (série gravité→lixiviation)
- `effectiveRecoveryPct` = global testwork si dispo, sinon `project.recovery_pct` (design manuel).

Consommateurs vérifiés utilisant bien cette source unique : **Dashboard, MassBalance, Economics, Granulometry**. La production annuelle (`annualProduction`), le CAPEX total et l'OPEX total dérivent également du contexte (tables `capex_lines` / `opex_lines`).

**Point d'attention** : `ProjectList` (écran multi-projets, hors `ProjectProvider`) utilise `project.recovery_pct` brut — acceptable car il s'agit d'une estimation de vignette transverse, mais à garder en tête (il n'a pas accès au testwork par projet).

---

## 5. Durcissement production

- **Validation des variables d'environnement** (`lib/supabase.ts`) : échec explicite et localisé si `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` manquent, au lieu d'un crash silencieux au premier appel.
- **ErrorBoundary** (`components/ui/ErrorBoundary.tsx`) : encapsule le rendu des pages dans `App.tsx`. Une erreur dans un module affiche un fallback récupérable (« Réessayer ») sans blanchir toute l'application ; reset automatique à la navigation.
- **CI/CD** (`.github/workflows/ci.yml`) : pipeline **lint → typecheck → build** sur push/PR (`main`/`master`), Node 20, cache npm, `concurrency` anti-doublon, secrets Supabase injectés au build.

---

## 6. Recommandations / dette restante (priorisées)

**P1 — court terme**
1. Terminer la migration des 21 constantes résiduelles vers `config/constants` (§3.3).
2. Résoudre les 70 warnings `react-hooks/exhaustive-deps` (risques de données périmées / re-renders manqués) ; passer la CI en `--max-warnings 0` une fois nettoyé.
3. Ajouter un `ErrorBoundary` racine au-dessus de `ProjectProvider` (couvrir aussi Landing/ProjectList).

**P2 — performance & robustesse**
4. **Code-splitting des pages** : bundle principal ≈ 962 kB (gzip 233 kB). Passer les 18 pages en `React.lazy` + `Suspense` dans `renderPage()` — gain de first-load majeur, refactor mécanique.
5. Exposer un éditeur UI complet de `project_settings` (taux, prix or, LOM, contingence) branché sur `resolveSettings`, pour rendre les hypothèses éditables sans code.
6. Générer les types Supabase (`supabase gen types typescript`) pour supprimer les casts de lignes restants et fiabiliser les requêtes.

**P3 — qualité continue**
7. Tests unitaires sur le moteur (`engine.ts`, `economics.ts`, `optimizer.ts`) : NPV/IRR/récupération série — calculs à fort impact décisionnel.
8. Branche protégée `main` exigeant la CI verte avant merge.

---

## 7. Vérification finale

```
tsc --noEmit ........... ✅ 0 erreur
eslint . ............... ✅ 0 erreur (exit 0)
vite build ............. ✅ build vert
```
