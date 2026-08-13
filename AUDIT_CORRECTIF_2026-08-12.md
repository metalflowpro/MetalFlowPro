# MetalFlow Pro — Audit correctif complet

**Date :** 12 août 2026  
**Périmètre lu :** `src` (147 TS + 69 TSX), 35 migrations SQL, fonction Edge, configuration et dépendances — environ 75 900 lignes.  
**Référence initiale :** typecheck vert, build vert, 919 tests verts, ESLint 0 erreur / 80 avertissements.

## Corrections appliquées

### 1. `supabase/migrations/20260808120000_user_approval.sql` → migration corrective `20260813100000_security_isolation_completion.sql`
- **Problème :** les politiques `projects_approved_*` ne vérifiaient que l’approbation. PostgreSQL combine les politiques permissives avec `OR`; elles contournaient donc les anciennes politiques `*_own_projects` et permettaient à tout compte approuvé de lire/modifier les projets des autres utilisateurs.
- **Pourquoi :** violation critique de l’isolation multi-projet et de la confidentialité des données minières.
- **Correction :** suppression des deux jeux de politiques et création d’une expression atomique `user_id = auth.uid() AND is_approved()` pour SELECT/INSERT/UPDATE/DELETE.

### 2. Migrations forage, ressources, QP et métaux (5–8 août) → migration corrective
- **Problème :** 8 tables créées après le durcissement RLS réintroduisaient `TO anon, authenticated USING/WITH CHECK (true)`.
- **Pourquoi :** lecture, création, modification et suppression anonymes de forages, analyses, estimations de ressources, signataires NI 43-101 et hypothèses économiques.
- **Correction :** retrait de toutes les policies ouvertes; politiques authentifiées bornées au propriétaire approuvé; clés étrangères vers `projects`; contraintes d’intervalles, azimut, pendage, unités, QA/QC, méthode d’estimation, prix et teneurs.

### 3. `report_section_signoffs` / `qualified_persons`
- **Problème :** `qp_id` pouvait référencer une QP d’un autre projet.
- **Pourquoi :** signature réglementaire incohérente et traçabilité NI 43-101 invalide.
- **Correction :** clé candidate `(id, project_id)` et FK composite `(qp_id, project_id)`.

### 4. `src/lib/simulation/engine.ts` — source d’alimentation
- **Problème :** `solveFlowsheet()` construisait le `FeedInput`, puis appelait `feed_source.calculate()` avec les paramètres persistés du nœud. Les défauts 250 t/h, 2 g/t et 3 % d’humidité remplaçaient silencieusement le scénario lancé.
- **Pourquoi :** tous les bilans, récupérations, consommations et OPEX pouvaient être calculés sur une alimentation différente de celle affichée.
- **Correction :** le `FeedInput` du run est désormais la source autoritative; les paramètres du nœud restent des valeurs d’édition UI.

### 5. `src/lib/simulation/engine.ts` — inventaire d’or dissous
- **Problème :** aux produits, le moteur additionnait `gold_flow` (kg/h, inventaire total) et `dissolved_gold × volume` (concentration dérivée), comptant deux fois le même métal.
- **Pourquoi :** récupération artificiellement supérieure à 100 %, ensuite masquée par un plafond à 99 %.
- **Correction :** `gold_flow` devient l’inventaire autoritatif; `dissolved_gold` reste une concentration; plafond arbitraire 99 % supprimé au profit d’un paramètre explicite par défaut à 100 %.

### 6. `src/lib/simulation/engine.ts` — teneur des rejets
- **Problème :** la masse de rejets était le “dernier flux solide” selon l’ordre d’objet, non la somme des flux solides terminaux.
- **Pourquoi :** teneur rejet non déterministe et bilan métallique non fermé pour les circuits multi-produits.
- **Correction :** agrégation conjointe des masses et de l’or de tous les rejets solides terminaux.

### 7. `src/lib/simulation/unitRegistry.ts` — table à secousses
- **Problème :** répartition de l’or = récupération + 10 % middlings + `(1 − récupération − 10 %)` rejets; à récupération > 90 %, l’or des rejets devenait négatif.
- **Pourquoi :** violation de la conservation de masse métallique.
- **Correction :** bornage de la récupération à [0,1], puis partage 10/90 uniquement de l’or non récupéré.

### 8. `src/lib/config/constants.ts` / `simulation/engine.ts`
- **Problème :** électricité 0,12 USD/kWh, NaCN 2,5 USD/kg, chaux 0,12 USD/kg et plafond 99 % étaient écrits dans la formule.
- **Pourquoi configurable :** tarifs site/fournisseur et convention de reporting varient par juridiction et date; ils changent l’OPEX et les décisions d’optimisation.
- **Correction :** utilisation de la source électrique partagée existante et externalisation des coûts réactifs/plafond dans `DEFAULT_ASSUMPTIONS`.

### 9. `src/lib/simulation/engine.ts` — conditions ambiantes
- **Problème :** deux replis locaux restaient à pH 7 / 25 °C alors que la source partagée fixe 7 / 20 °C.
- **Pourquoi :** incohérence inter-modules affectant cinétique et demande de réactifs.
- **Correction :** tous les replis lisent `FEED_STREAM_DEFAULTS`.

### 10. `supabase/functions/copilot/index.ts` et `.env.example`
- **Problème :** CORS `*`, limites de question/contexte absentes, `max_tokens` figé et corps d’erreur fournisseur renvoyé au client.
- **Pourquoi configurable :** origine de déploiement, modèle, budget et quotas diffèrent par environnement; les détails fournisseur peuvent divulguer des métadonnées.
- **Correction :** `COPILOT_ALLOWED_ORIGIN`, modèle et limites externalisés; requêtes trop grandes rejetées; réponse fournisseur brute masquée.

### 11. `.gitignore`
- **Problème :** clés privées et état local Supabase non exclus.
- **Correction :** ajout de `*.pem`, `*.key`, `supabase/.temp/`; `.env` retiré de la copie livrable (il était déjà ignoré dans Git).

## Alignement métallurgique
- Inventaire d’or exprimé une seule fois en kg/h; teneur g/t dérivée de `kg/h ÷ t/h × 1000`.
- Fermeture des flux solides terminaux avant calcul de teneur des rejets.
- Aucune récupération artificiellement forcée à 99 %; bornes physiques [0,100].
- Conservation de l’or corrigée sur la séparation gravimétrique.
- Les valeurs par défaut restent des hypothèses de screening, pas des garanties de conception : BWi, SG, cyanure, chaux, cinétique CIL/CIP, prix et facteurs d’équipement doivent être calés sur les essais et paramètres projet avant publication NI 43-101.

## Valeurs codées en dur — statut et justification
L’application possédait déjà trois couches pertinentes : constantes physiques (`PHYSICAL_CONSTANTS`), hypothèses projet (`project_settings` / `DEFAULT_ASSUMPTIONS`) et constantes métallurgiques surchargeables (`project_met_constants`). L’audit a conservé les invariants légitimes (conversion oz troy, gravité, Faraday, stœchiométrie) et externalisé les nouveaux paramètres opérationnels trouvés dans des formules. Les valeurs `default` de formulaires et bibliothèques d’équipements restent volontairement versionnées en code : ce sont des préréglages visibles et modifiables par nœud, non des constantes cachées de calcul.

## Validation finale
- TypeScript : **0 erreur**.
- Tests : **920/920**, 59 fichiers (un test de régression ajouté).
- Build Vite : **succès**.
- ESLint : **0 erreur**, 80 avertissements historiques (hooks/variables inutilisées), aucun nouvel avertissement bloquant.
- Scan secrets/motifs dangereux : **0 constat** après retrait du `.env` de la livraison.

## Risques résiduels non masqués
1. `xlsx@0.18.5` : alertes connues prototype pollution/ReDoS, aucun correctif npm disponible. Migration vers une bibliothèque maintenue recommandée; entre-temps limiter taille/type des imports et exécuter le parsing hors du thread principal.
2. `brace-expansion` signalé dans l’installation locale partagée : dépendance transitive d’outillage, non du bundle navigateur; recréer `node_modules` avec Node 20 + `npm ci` après mise à jour du lockfile.
3. 80 avertissements ESLint historiques, dont dépendances de hooks : dette de robustesse UI à traiter module par module, sans remplacement automatique risqué.
4. La migration SQL est créée mais **non appliquée à la base distante** dans cet audit; son déploiement doit précéder toute utilisation multi-utilisateur.
