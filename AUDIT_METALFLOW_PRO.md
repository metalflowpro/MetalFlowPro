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

### 3.3 Migration terminée — 0 constante hardcodée résiduelle

Les 21 occurrences résiduelles de `31.1035` / `8760` ont été migrées (`Criteria.tsx`, `MassBalance.tsx`, `MineOpt.tsx`, `GeoMet.tsx`, `Granulometry.tsx`). Vérification : `grep -rn "31\.1035\|8760" src` ne retourne plus que `config/constants.ts`.

La migration **n'a pas été un simple remplacement d'import** :

- Les modules situés dans `ProjectProvider` (`MineOpt`, `GeoMet`, `Criteria`, `MassBalance`) consomment `assumptions.hoursPerYear` — donc **l'override `project_settings` est réellement respecté**, alors qu'un import de la constante brute aurait figé 8760 en dur d'une autre manière.
- `Criteria` : `hours_per_year` ajouté à `ProjectInputs` ; les **libellés de formules** (« TPH × Dispo% × 8760 ») sont interpolés — ils affichaient une valeur fausse dès que le projet configurait d'autres heures.
- `MineOpt` : `buildLOM` / `buildScenarios` (fonctions pures hors composant) prennent `hoursPerYear` en paramètre.
- `Granulometry` : coût électrique `0.08` → `DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH` (documenté).

---

## 4. Cohérence inter-modules

**Colonne vertébrale « récupération » : déjà centralisée et confirmée saine.** `ProjectContext` calcule à partir du testwork LIMS (Knelson GRG + lixiviation) :
- `gravityRecoveryPct` = GRG × efficacité plant
- `globalRecoveryPct` = 1 − (1 − R_grav)(1 − R_leach) (série gravité→lixiviation)
- `effectiveRecoveryPct` = global testwork si dispo, sinon `project.recovery_pct` (design manuel).

Consommateurs vérifiés utilisant bien cette source unique : **Dashboard, MassBalance, Economics, Granulometry**. La production annuelle (`annualProduction`), le CAPEX total et l'OPEX total dérivent également du contexte (tables `capex_lines` / `opex_lines`).

**Point d'attention** : `ProjectList` (écran multi-projets, hors `ProjectProvider`) utilise `project.recovery_pct` brut — acceptable car il s'agit d'une estimation de vignette transverse, mais à garder en tête (il n'a pas accès au testwork par projet).

### 4.1 Deux incohérences réelles corrigées

La colonne vertébrale « récupération » était effectivement saine, mais deux défauts de cohérence ont été trouvés et corrigés :

**a) `annualProduction` tombait à 0** — `ProjectContext` lisait `settings?.hours_per_year ?? null` et retournait `0` quand la ligne `project_settings` était absente, alors que `MassBalance` et `Criteria` calculaient *la même grandeur* avec `8760` en dur. Résultat : **deux modules affichaient des chiffres contradictoires pour la production annuelle** sur un projet neuf (Dashboard à 0, MassBalance à sa vraie valeur). Le contexte résout désormais les hypothèses via `resolveSettings` (défaut 8760) et expose `assumptions` + `annualTonnes` comme source unique ; `MassBalance` consomme `annualProduction` au lieu de recalculer.

**b) L'objectif `maximize_npv` de l'optimiseur ignorait le projet** — `optimizer.ts` codait en dur une disponibilité de `0.8`, un or à `2000 $/oz`, et un « NPV » = cash-flow × 5 **sans actualisation**. L'optimiseur classait donc les flowsheets sur une économie différente de celle rapportée par le module Economics. Il accepte maintenant `OptimizationEconomics`, câblé sur `project.availability_pct`, `project.gold_price_usd` et `assumptions` (taux, LOM), avec actualisation réelle sur l'horizon. À 91 % de disponibilité, l'écart de revenus vs. l'ancien `0.8` est de **+13,8 %** — suffisant pour changer le classement des candidats. (Le CAPEX reste hors de cet objectif : invariant sur les paramètres optimisés, il décalerait tous les candidats de la même constante — c'est un objectif *relatif*, pas un NPV publiable.)

---

## 5. Durcissement production

- **Validation des variables d'environnement** (`lib/supabase.ts`) : échec explicite et localisé si `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` manquent, au lieu d'un crash silencieux au premier appel.
- **ErrorBoundary** (`components/ui/ErrorBoundary.tsx`) : encapsule le rendu des pages dans `App.tsx`. Une erreur dans un module affiche un fallback récupérable (« Réessayer ») sans blanchir toute l'application ; reset automatique à la navigation.
- **CI/CD** (`.github/workflows/ci.yml`) : pipeline **lint → typecheck → build** sur push/PR (`main`/`master`), Node 20, cache npm, `concurrency` anti-doublon, secrets Supabase injectés au build.

---

## 6. Recommandations / dette restante (priorisées)

**P0 — la CI ne s'exécute jamais**
1. **Aucun remote git n'est configuré** (`git remote -v` est vide). Le pipeline `.github/workflows/ci.yml` est donc du code mort : rien ne l'a jamais déclenché, et les déploiements Railway partent directement du poste local sans filet. Créer le dépôt distant et pousser est le prérequis de tout le reste (dont la branche protégée, P3-8).

**P1 — court terme**
2. Résoudre les 72 warnings `react-hooks/exhaustive-deps` (risques de données périmées / re-renders manqués) ; passer la CI en `--max-warnings 0` une fois nettoyé.
3. Ajouter un `ErrorBoundary` racine au-dessus de `ProjectProvider` (couvrir aussi Landing/ProjectList).

**P2 — performance & robustesse**
4. ~~Code-splitting des pages~~ — **fait** (§9.2). Premier paint 443,3 → 94,4 kB gzip (−79 %).
5. ~~Éditeur de `project_settings`~~ — **fait** (§9.1). ⚠️ **La recommandation initiale était fausse** : l'éditeur existait déjà (Economics → onglet Paramètres). Le travail réel a été de corriger ses trois défauts, pas d'en construire un.
6. Générer les types Supabase (`supabase gen types typescript`) pour supprimer les casts de lignes restants et fiabiliser les requêtes.
7. **Unifier le coût électrique** — *non fait, décision produit requise*. `Granulometry` utilise `ELECTRICITY_COST_USD_KWH` (0,08 **USD**/kWh) tandis qu'`Economics` a un `elec_cad_kwh` éditable en **CAD**. Deux modules chiffrent l'énergie différemment. L'unification suppose de trancher : où stocke-t-on le taux de change, est-il par projet, et quelle devise fait référence ? Le modèle n'a aujourd'hui aucune notion de conversion — l'inventer arbitrairement fausserait des chiffres publiés.

**P3 — qualité continue**
8. ~~Tests unitaires sur le moteur~~ — **partiellement fait** (§9.3). 32 tests sur `constants`/`economics`/`parseSettingInput`, branchés dans la CI. **Reste à couvrir** : `optimizer.ts` et `engine.ts`, dont les objectifs exigent un flowsheet complet (nodes/edges/feed via le registre d'unités) donc un harnais plus lourd.
9. Branche protégée `main` exigeant la CI verte avant merge (dépend de P0-1).

---

## 7. Vérification finale

```
tsc --noEmit ................... ✅ 0 erreur
eslint . ....................... ✅ 0 erreur (73 warnings, non bloquants)
npm test ....................... ✅ 32 tests, 3 fichiers
vite build ..................... ✅ build vert (entrée 16,6 kB gzip)
grep 31.1035|8760 sur src/ ..... ✅ 0 occurrence hors config/constants
```

**Checks d'exécution** (logique pure exécutée, pas seulement compilée) :

| Contrôle | Résultat |
|---|---|
| `resolveSettings(null)` → heures par défaut, pas 0 | ✅ |
| Override BDD gagne ; `discount_rate_pct` 12 → fraction 0,12 | ✅ |
| Régression : `annualProduction` > 0 sans `project_settings` | ✅ (était 0) |
| Cohérence : formule contexte == formule MassBalance | ✅ identiques |
| NPV : taux ↑ ⇒ NPV ↓ ; 10 ans @8 % ≈ 6,71 × cash-flow | ✅ |
| `kgToTroyOz` ≡ ancien littéral `/0.0311035` | ✅ |

**Périmètre non vérifié** : les modules corrigés (Criteria, GeoMet, MineOpt, MassBalance, Simulation) sont derrière l'authentification et n'ont pas été exercés dans un navigateur connecté. Leur validation repose sur le typecheck, le build et les checks d'exécution ci-dessus. Un passage manuel sur ces 5 écrans avec un compte réel reste recommandé — en particulier **Criteria**, dont les libellés de formules ont été modifiés en masse.

---

## 8. Déploiement

Déployé en production sur Railway (projet `MetalFlowPro`, environnement `production`) le 15 juillet 2026.

- URL : https://metalflowpro-production.up.railway.app
- Statut build : `SUCCESS`
- Vérifié : la page servie référence `assets/index-CO5SyK_2.js`, soit **exactement le bundle produit par le build local** ; 0 erreur console au chargement.
- ⚠️ Déploiement lancé via `railway up` depuis le poste local, **sans passage par la CI** (voir P0-1).

---

## 9. Deuxième passe

### 9.1 Éditeur d'hypothèses (Economics → Paramètres)

L'éditeur **existait déjà** ; trois défauts corrigés :

| Défaut | Effet | Correction |
|---|---|---|
| `saveSettings` appelé dans `onChange` | une écriture Supabase **par caractère tapé** | état local, persistance au blur / Entrée, aucune écriture si inchangé |
| `parseFloat(v) \|\| null` | **un 0 saisi devenait `null`** → redevance mise à 0 % retombait sur le défaut 3 % | `parseSettingInput` (exporté, testé) distingue « vidé » (null) de « zéro » (0) |
| Champs vides muets | l'hypothèse réellement appliquée était invisible | défaut documenté affiché sous le champ et en placeholder |

Corrigé aussi : le générateur d'OPEX utilisait `?? 8000` h/an — un **troisième** défaut divergent (contexte et Criteria : 8760), qui décalait de ~9,5 % les lignes OPEX écrites en base.

Le *gating* volontaire d'Economics (refus de calculer un NPV sans settings) est **conservé** : ne pas publier de NPV sur des hypothèses supposées est un choix défendable, distinct des défauts appliqués par les autres modules.

### 9.2 Code-splitting

| JS du premier paint (gzip) | Avant | Après |
|---|---|---|
| chunk d'entrée | 228,1 kB | **16,6 kB** |
| react | 44,3 kB | 44,3 kB |
| supabase | 33,5 kB | 33,5 kB |
| xlsx | 137,4 kB | **0** (chargé à l'ouverture de LIMS / Block Model) |
| **Total** | **443,3 kB** | **94,4 kB** (−79 %) |

Le gain dépasse le découpage des pages : `xlsx` était tiré en statique par LIMS/BlockModel, donc **préchargé pour tous les utilisateurs**, y compris ceux n'ouvrant jamais ces modules. Le `Suspense` est placé dans l'`ErrorBoundary` pour qu'un échec réseau de chunk reste récupérable.

### 9.3 Tests (Vitest)

32 tests, branchés dans la CI entre typecheck et build. Ils verrouillent notamment l'égalité entre la formule de production du contexte et celle que MassBalance dupliquait (§4.1a), et le zéro explicite de `parseSettingInput` (§9.1).
