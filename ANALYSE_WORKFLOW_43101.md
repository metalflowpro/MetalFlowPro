# Analyse — Du terrain au rapport NI 43-101 : cartographie du workflow et structure fonctionnelle de MetalFlow Pro

**Date** : 5 août 2026
**Source analysée** : *Morrison Copper/Gold Project — Feasibility Study* (Pacific Booker Minerals Inc. / Wardrop Engineering Inc., 2009).
`Partie 01` = Volume 1 « Process Plant, Mining and Infrastructure » (375 p.) + Appendices (Drawings, Equipment List, Power Load, Design Basis Memoranda, HPGR trade-off). `Partie 02` = Volume 4 « Operating Cost Estimate (OPEX) » (34 p.).
**Objet** : identifier chaque étape du flux de travail illustré (donnée brute → rapport 43-101), la relier aux modules existants de MetalFlow Pro, et en déduire la structure fonctionnelle cible + les points de validation.

> ⚠️ **Cadrage important sur la nature du document.** Le dossier joint est un **livrable d'ingénierie/faisabilité** (procédé, mine, infrastructure, coûts) — c'est le *produit final* de la chaîne, pas la chaîne de production de la ressource elle-même. Le calcul de ressource proprement dit (base de données de forages, compositage, variographie, krigeage, QA/QC des analyses, classification) a été réalisé par **GeoSim Services Inc.** sous **Surpac** et n'est présent ici que par son **résultat** (Table 1.1, block model importé). De même, la métallurgie détaillée vit dans les rapports SGS Lakefield / PRA / Polysius, cités mais non inclus. Les étapes amont sont donc **déduites** des références du document et signalées comme telles au §8.

---

## 1. Le projet exemple en bref (ancrage factuel)

| Élément | Valeur (source) |
|---|---|
| Gisement | Porphyre Cu-Au-Mo, « Babine type » biotite-feldspath porphyre (BFP), C.-B., Canada |
| Ressource (M+I, cut-off 0,30 % CuEq) | 206,869 Mt à 0,46 % CuEq (0,39 % Cu, 0,20 g/t Au, 0,005 % Mo) — GeoSim, 4 mai 2007 |
| Ressource inférée | 56,524 Mt à 0,47 % CuEq |
| Réserve exploitable (cut-off 5,60 $/t NSR) | 224,25 Mt à 0,330 % Cu, 0,163 g/t Au, 0,004 % Mo — Prouvée 115,1 Mt / Probable 109,1 Mt |
| Block model | Surpac, origine 669 850 E / 6 118 500 N / 300 Z, blocs **20 × 20 × 12 m**, 90 × 80 × 66 blocs |
| Procédé | Concassage → **HPGR** → broyage à boulets → flottation Cu (+ circuit Mo), 30 000 t/j |
| Récupérations (équations SGS) | Cu % = 9,136·ln(Cu%) + 90,89 ; Au % = 7,415·ln(Au g/t) + 61,76 ; Mo = 50 % fixe |
| Optimisation fosse | MineSight®, **Lerchs-Grossmann à pente variable**, 7 coquilles emboîtées (10→70 %) |
| Vie de mine | 21 ans (dont récupération de stock jusqu'à l'an 21) |
| Intervenants | Wardrop (procédé/mine/infra/finances), GeoSim (ressource), Nilsson Mining (mine), Klohn Crippen Berger (géotech/résidus/eau), Rescan (environnement), + consultants électricité/route |

---

## 2. Le workflow complet illustré (10 étapes)

Le flux « donnée terrain → rapport 43-101 » que l'application doit savoir traiter :

```
1. EXPLORATION & COLLECTE TERRAIN
   géochimie (sédiments de ruisseau, sols) → géophysique (EM, mag, IP, résistivité)
   → tranchées / puits d'essai → forage diamant (carotte)
        │  (95 trous Noranda + 82 PBM = 25 245 m ; PQ métallurgiques ; géotech ; condamnation ; monitoring eau)
        ▼
2. LOGGING & ÉCHANTILLONNAGE
   log géologique (lithologie, altération, minéralisation) → découpe carotte
   → envoi labo → collier/déviation/survey des trous
        ▼
3. ANALYSES LABO (LIMS) + QA/QC
   dosage Cu/Au/Mo/Ag → standards, blancs, duplicatas, re-dosages
   → validation, réconciliation, acceptation des lots
        ▼
4. MODÈLE GÉOLOGIQUE
   interprétation des zones (copper zone > 0,20 % Cu), domaines (Jurassique sédiments /
   intrusifs / faille), wireframes/solides, codes roche, SG
        ▼
5. ESTIMATION DE RESSOURCE  ← cœur 43-101
   compositage → analyse statistique/variographie → krigeage/IDW dans block model
   → CuEq → classification Mesuré/Indiqué/Inféré → tabulation par cut-off → QA/QC modèle
        ▼
6. ESSAIS MÉTALLURGIQUES & CONCEPTION PROCÉDÉ
   têtes, minéralogie (QEMSCAN), comminution (Bond, JK drop-weight, HPGR pilote),
   flottation (locked cycle) → courbes de récupération → flowsheet → critères de conception
        ▼
7. INGÉNIERIE MINE (ressource → réserve)
   NSR par bloc (termes de fonderie, TC/RC, transport, humidité, payables)
   → valeur nette bloc → optimisation Lerchs-Grossmann → conception fosse par phases
   → conception pentes (géotech, FoS ≥ 1,3) → séquençage/planning → dilution/récupération
   → réserves Prouvées/Probables
        ▼
8. INFRASTRUCTURE & CRITÈRES DE SITE
   Design Basis Memoranda (civil, méca, élec, tuyauterie, HVAC, instrumentation),
   résidus (TSF), gestion de l'eau (zéro rejet), routes, énergie, bâtiments
        ▼
9. COÛTS & ÉCONOMIE
   CAPEX (initial + soutènement) + OPEX (mine/procédé/G&A/résidus)
   → modèle de flux (NSR → cash-flow → VAN/TRI) → sensibilités → fiscal / LOM
        ▼
10. ENVIRONNEMENT, PERMIS & RÉDACTION 43-101
   caractérisation PAG/NAG, plan de gestion de l'eau, réclamation
   → assemblage du Technical Report (structure 22 items), signature du/des Qualified Person(s)
```

Chaque flèche est un **point de transfert de données** — c'est là que se placent les contrôles de cohérence (§7).

---

## 3. Données d'entrée : types et formats

| Catégorie | Contenu (exemples Morrison) | Format usuel dans l'industrie |
|---|---|---|
| **Colliers de forage** | X/Y/Z, azimut, plongée (-45°), profondeur, diamètre (AEX/BQ/PQ) | CSV / Excel ; tables `collar`, `survey` |
| **Déviation (survey)** | mesures gyroscopiques/magnétiques le long du trou | CSV ; downhole survey |
| **Logs géologiques** | intervalles lithologie, altération (biotite/chlorite), minéralisation | CSV / Excel `lithology` |
| **Analyses (assays)** | Cu %, Au g/t, Mo %, Ag ; par intervalle | CSV / LIMS export ; table `assay` |
| **QA/QC** | standards (CRM), blancs, duplicatas de terrain/labo, re-dosages | CSV ; certificats labo (SGS) |
| **Géophysique** | grilles EM, magnétiques, IP, résistivité | grilles/rasters, XYZ |
| **Topographie / surfaces** | topo, interface roc/mort-terrain | DXF/DWG, surfaces triangulées (DTM) |
| **Modèle géologique** | wireframes de zones/domaines, solides | DXF, .00t (Surpac), .dm (Datamine), OMF |
| **Block model** | blocs 20×20×12 m avec Cu/Au/Mo/CuEq/Class/RockCode/SG/Zone/PAG/NET/VAL | Surpac/GEMS/Datamine/CSV ; importé dans MineSight® |
| **Essais métallurgiques** | têtes, work index (18,0 kWh/t), QEMSCAN, locked-cycle, HPGR | rapports labo (PDF) + tableaux |
| **Paramètres économiques** | prix LME (Cu 2,45 $/lb, Au 570 $/oz, Mo 28 $/lb), FX 0,87, TC/RC, fret | Excel / hypothèses |
| **Géotechnique** | domaines, résistances, discontinuités, secteurs de pente | rapports (Knight Piésold) |

**Constat pour l'app** : le format pivot le plus universel est **CSV/Excel pour les 4 tables de forage** (collar, survey, litho, assay) + import de **block model** (CSV a minima ; idéalement Surpac/Datamine/GEMS/OMF). C'est le socle d'ingestion à garantir.

---

## 4. Calculs, modélisations et traitements par étape

| Étape | Traitements requis | Preuve dans le document |
|---|---|---|
| **3 — LIMS/QA-QC** | Cartes de contrôle (standards/blancs), % d'échec, biais duplicatas, acceptation de lot | 82 trous / 25 245 m assayés ; re-log sans dosage pour trous stériles |
| **5 — Ressource** | Compositage, statistiques, **variographie**, **krigeage/IDW**, calcul **CuEq**, classification CIM, **tabulation grade-tonnage par cut-off** | Table 1.1 (7 cut-offs de 0,15 à 0,40) ; « conventional block modelling », Surpac |
| **6 — Métallurgie** | Régressions de récupération (log), work index/Bond, dimensionnement comminution, bilan de flottation, grade de concentré (25,1 % Cu) | Éqs. Fig. 4.1 ; QEMSCAN ; trade-off HPGR (-23 % OPEX) |
| **7a — NSR/bloc** | Concentré recovery-based (dmt/t), payables (Cu 96 % - 1 unité, Au 95 %), TC (85-90 $/dmt), RC (0,085-0,090 $/lb + price participation), transport (truck+ocean+stevedoring), humidité 8 %, pertes 0,25 %, → **NSR $/t** puis facteurs $/% Cu et $/g Au | Table 4.6 complète (« Net Smelter Return ») |
| **7b — Cut-off** | Cut-off NSR **5,60 $/t** ; cut-off variable/déclinant sur la LOM ; bacs de teneur pour stock | §4.2.3 ; stock final 26,6 Mt |
| **7c — Optimisation** | **Lerchs-Grossmann pente variable** ; valeur de bloc actualisée (5 bancs/an), **7 coquilles emboîtées** (10-70 %) ; pit design par phases | §4.3.10, Table 4.9 (Pit 812) |
| **7d — Pentes** | Secteurs géotech (inter-ramp 40-48°), bermes, double-benching, **FoS ≥ 1,3** | Table 4.8, 7 secteurs |
| **7e — Planning** | Séquençage 4 phases sur 21 ans, cadence 30 000 t/j, réhandle de stock, récupérations annuelles Cu/Au/Mo | Table 4.2 (grille annuelle complète) |
| **7f — Dilution/récup.** | Dilution interne via compositage/interpolation ; récupération minière 100 % (justifiée) | §4.3.8 |
| **9 — Économie** | CAPEX (initial 3,15 M$ mobile + soutènement 0,29 $/t ore, 0,43 $/t waste), OPEX ($/t : load-haul, drill-blast, aux, labour), **VAN/TRI**, sensibilités, fiscal | Tables 4.4/4.5, Volume 4 OPEX |
| **8 — Infra** | Dimensionnement selon DBM (charges, codes, HVAC, élec 138/13,8 kV, tuyauterie) ; TSF ; eau zéro rejet (crue 200 ans/2 sem.) | Appendix D (DBMs), §Water Management |

---

## 5. Exigences NI 43-101 à respecter dans le rapport final

Le NI 43-101 (règlement des Autorités canadiennes en valeurs mobilières) + le **Form 43-101F1** imposent :

1. **Structure en 25 items** (Form 43-101F1) — le rapport doit couvrir, dans l'ordre :
   1 Titre · 2 Reliance on other experts · 3 Property description & location · 4 Accessibility/climate/infrastructure · 5 History · 6 Geological setting & mineralization · 7 Deposit types · 8 Exploration · 9 Drilling · 10 Sample preparation, analyses & security · 11 Data verification · 12 Mineral processing & metallurgical testing · 13 **Mineral Resource Estimates** · 14 **Mineral Reserve Estimates** · 15 Mining methods · 16 Recovery methods · 17 Project infrastructure · 18 Market studies · 19 Environmental/permitting/social · 20 Capital & operating costs · 21 Economic analysis · 22 Adjacent properties · 23 Other data · 24 Interpretation & conclusions · 25 Recommendations · (26 References).
   > Le Volume 1 Morrison couvre visiblement les items 6-9, 12-17, 20-21 ; les items 3-5, 10-11, 13-14, 18-19, 24-25 vivent dans d'autres volumes / le rapport 43-101 chapeau.
2. **Qualified Person (QP)** : chaque section technique doit être sous la responsabilité d'un QP nommé, avec certificat et déclaration de site-visit récente. Traçabilité auteur → section → signature.
3. **Définitions CIM** : classification Ressources (Inférée/Indiquée/Mesurée) et Réserves (Probable/Prouvée) selon *CIM Definition Standards*. **Une ressource inférée ne peut pas être convertie en réserve** ni utilisée dans l'étude économique — Morrison respecte ce point (« Inferred resources have not been used in the mine plan »).
4. **QA/QC des analyses & vérification des données** (items 10-11) : protocole standards/blancs/duplicatas, sécurité de la chaîne d'échantillons, vérification indépendante par le QP.
5. **Cut-off documenté & paramètres** : hypothèses de prix, récupérations, coûts, NSR — tous justifiés et datés (Morrison : moyenne LME 4 ans, T3-2008).
6. **Transparence & non-trompeur** : le résumé doit refléter le rapport ; les ressources sont exprimées avec cut-off, date d'effet, et ne peuvent être additionnées aux réserves.
7. **Date d'effet & date de signature** pour chaque estimation.

---

## 6. Cartographie avec les modules existants de MetalFlow Pro

L'application **couvre déjà** l'essentiel de la chaîne. Mapping étape → module actuel :

| Étape workflow | Module MetalFlow Pro existant | État / écart constaté |
|---|---|---|
| 1-2 Exploration/logging | *(aucun module dédié)* | **Écart** : pas de gestion colliers/survey/litho ; l'app démarre au labo |
| 3 Analyses + QA/QC | **LIMS** (`src/pages/LIMS.tsx`, 7 onglets QA/QC) | Le plus complet ; manque cartes Shewhart interactives |
| 4 Modèle géologique | **BlockModel** (`SliceViewer`) | Coupes 2D présentes ; pas de wireframing ni 3D ; import limité |
| 5 Estimation ressource | **BlockModel** + `lib/blockmodel/slice` | ⚠️ **Écart majeur** : pas de moteur de **compositage/variographie/krigeage** visible ; le block model semble *importé*, pas *estimé* dans l'app |
| 6 Métallurgie/procédé | **GeoMet** (RecoveryRegression), **Granulometry** (P80), **Criteria**, **Flowsheet**, **Simulation**, **MassBalance**, **CircuitAI** | Très fourni ; `Flowsheet` encore sur `mockData` (cf. ROADMAP) |
| 7a NSR/bloc | `lib/mine/cutoff`, `lib/economics/npvModel` | Présent (cutoff engine) — vérifier couverture termes de fonderie complets |
| 7c Optimisation fosse | **MineOpt** (`lib/mine/pitOptimizer` + web-worker) | ✅ Pit optimizer implémenté (bien) |
| 7e Planning | `lib/mine/planning` | Présent ; ROADMAP suggère animation de séquence |
| 9 Économie | **Economics** (LomTab, SensitivityTab, FiscalTab), `lib/economics` | ✅ VAN/sensibilité/fiscal/LOM |
| 8 Infra/critères | **Criteria**, **Equipment** | Critères de conception présents ; DBM/infra partielle |
| 10 Environnement | **Risks** | Registre de risques ; pas de module PAG/NAG/eau dédié |
| Décision/gouvernance | **StageGates**, **Dashboard**, **COS**, **Analytics** | Stage-gates présents ; manque sign-off multi-utilisateur (ROADMAP T4) |
| Rapport final | **NI43101** (`src/pages/NI43101.tsx`), **Reports** | Structure présente ; manque **générateur PDF/Word un-clic** (ROADMAP T8) |

**Conclusion du mapping** : la moitié aval (procédé → mine → économie → 43-101) est **mature**. Les **deux écarts structurants** vis-à-vis d'un vrai « du terrain au rapport » sont :
- **A. L'amont géologique** : ingestion des 4 tables de forage + gestion du modèle géologique.
- **B. Le moteur d'estimation de ressource** (compositage → variographie → krigeage → classification), aujourd'hui absent ou externalisé.

---

## 7. Structure fonctionnelle cible + points de validation

Ordre logique d'utilisation (un onglet = une étape ; verrouillage de gate entre blocs) :

### Bloc I — Données (amont, à compléter)
1. **Projet** (ProjectList) → métadonnées, système de coordonnées, QP assignés.
2. **Forages** *(nouveau)* → import/validation collar, survey, litho, assay (CSV/Excel).
   - ✅ *Validation V1* : desurvey cohérent, pas de chevauchement d'intervalles, longueurs = profondeur totale, colliers dans l'emprise.
3. **LIMS + QA/QC** (existant) → dosages, standards/blancs/duplicatas.
   - ✅ *V2* : taux d'échec standards < seuil, biais duplicatas < X %, lots acceptés horodatés.

### Bloc II — Géologie & Ressource (cœur 43-101, à renforcer)
4. **Modèle géologique** (BlockModel étendu) → domaines, wireframes, codes roche, SG.
5. **Estimation de ressource** *(moteur à ajouter)* → compositage → statistiques → **variographie** → **krigeage/IDW** → CuEq → **classification CIM** → tabulation grade-tonnage.
   - ✅ *V3 (gate réglementaire)* : validation croisée (swath plots, K-cross), réconciliation modèle vs composites, cut-off & date d'effet renseignés, **inféré ségrégué** du M+I, QP signataire.

### Bloc III — Procédé & Métallurgie (mature)
6. **GeoMet / Granulométrie / Critères** → récupérations, P80, work index, domaines géomet.
7. **Flowsheet / Simulation / Bilan massique / Équipements** → circuit, Monte-Carlo, Pareto.
   - ✅ *V4* : Flowsheet branché sur données projet réelles (⚠ actuellement mockData) ; fermeture du bilan massique dans tolérance ; validité des corrélations (domaine Bond/Rowland).

### Bloc IV — Mine (ressource → réserve, mature)
8. **NSR & Cut-off** → termes de fonderie complets, NSR/bloc.
9. **MineOpt** → Lerchs-Grossmann, coquilles emboîtées, phases, pentes (FoS).
10. **Planning** → séquençage, dilution, récupération minière, réserves P&P.
    - ✅ *V5 (gate réglementaire)* : réserves dérivées **uniquement** de M+I ; dilution/récupération appliquées et documentées ; cohérence tonnage réserve ≤ ressource contrainte fosse ; QP mine signataire.

### Bloc V — Infra, Coûts, Économie (mature)
11. **Critères/Équipements/Infra** (DBM) · **Économie** (CAPEX/OPEX/VAN/TRI/sensibilité/fiscal).
    - ✅ *V6* : hypothèses de prix datées et cohérentes entre modules (source unique de vérité) ; sensibilités tornade présentes.

### Bloc VI — Gouvernance & Rapport
12. **Risks** (env./PAG-NAG/eau) · **StageGates** (sign-off) · **Analytics/Dashboard**.
13. **NI 43-101 / Reports** → assemblage 25 items, cohérence résumé↔corps, **export PDF/Word un-clic**.
    - ✅ *V7 (gate final)* : checklist Form 43-101F1 complète (25 items) ; chaque item a un QP + date ; le résumé ne contredit pas le corps ; ressources/réserves non additionnées ; toutes les données sources tracées jusqu'au forage.

**Principe transversal (essentiel pour la conformité)** : une **source unique de vérité** pour les hypothèses (prix, récupérations, coûts, FX) + **snapshots de scénarios versionnés** (cf. ROADMAP T4) — un livrable réglementaire doit pouvoir prouver *quelles hypothèses* ont produit *quels chiffres*, à *quelle date*.

---

## 8. Ambiguïtés / éléments incomplets du document (à ne pas supposer)

Points où le dossier est insuffisant pour spécifier une fonctionnalité — à clarifier plutôt qu'inventer :

1. **Estimation de ressource — méthode exacte non détaillée.** Le document dit « conventional block modelling » (GeoSim, Surpac) mais **ne donne ni la méthode d'interpolation (krigeage ordinaire ? IDW ?), ni les paramètres de variogramme, ni les distances de recherche, ni les règles précises de classification** M/I/I. → *Impossible de spécifier le moteur d'estimation depuis ce seul document ; il faut le rapport GeoSim (mai 2007).*
2. **Formule du CuEq non explicitée.** La colonne CuEq existe (Table 1.1) mais **la formule d'équivalence** (prix/récupérations retenus pour convertir Au et Mo en Cu) n'est pas donnée. → à paramétrer, ne pas coder en dur.
3. **QA/QC analytique — protocole non fourni.** On sait que 82 trous ont été dosés (SGS) mais **aucun résultat de standards/blancs/duplicatas** n'est présenté ici. → le module LIMS doit rester générique, pas calibré sur ces chiffres.
4. **Compositage & dilution.** Le document affirme « dilution interne incorporée via compositage/interpolation » et « récupération minière 100 % » **sans donner la longueur de composite ni la méthode**. → à exposer comme paramètres.
5. **Détail Table 4.6 (NSR).** Le grade de concentré Au est « calculated from head grade, recovery and concentrate production » sans valeur ; certains price-participation (Cu) sont à 0 %. → la logique NSR doit être **entièrement paramétrable** (le doc montre *un* jeu d'hypothèses, pas la règle générale).
6. **Périmètre 43-101 réel.** Le dossier joint est le **Volume 1 + Volume 4** d'une étude multi-volumes ; les items 43-101 3-5, 10-11, 13-14 (détail), 18-19 sont **ailleurs**. → la checklist 25-items de l'app ne peut être « cochée » depuis ces deux fichiers seuls.
7. **Molybdène — récupération fixée à 50 %.** Valeur forfaitaire, non issue d'une courbe. → traiter comme hypothèse éditable, pas comme modèle.
8. **Versions logicielles & interopérabilité.** Surpac (ressource) → MineSight® (mine) : le doc illustre un **échange inter-logiciels** par export d'items de bloc (Topography%, Bedrock%, PAG, NET, VAL, t/hr, p80). → confirme le besoin d'un **format d'échange de block model** robuste dans l'app (quels champs ? quelle convention ?), à cadrer avec l'utilisateur.

---

## Synthèse en une ligne

MetalFlow Pro possède déjà ~80 % de la chaîne aval (procédé → mine → économie → NI 43-101) ; pour être un vrai « du terrain au rapport 43-101 » il manque surtout **(A) l'ingestion des forages + modèle géologique** et **(B) un moteur d'estimation de ressource (variographie/krigeage/classification CIM)**, plus les *gates* de validation réglementaires V3/V5/V7 et l'export un-clic du rapport.
