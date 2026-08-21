// ─────────────────────────────────────────────────────────────────────────────
// Bibliothèque de templates de flowsheet — module PUR (aucun React/DB).
//
// Les 12 modèles du cahier des charges (§4). Chaque template porte :
//   • une TOPOLOGIE explicite (nœuds + arêtes) qui peut être BRANCHÉE — un
//     concentré de flottation part au CIL pendant que les rejets vont au parc,
//     un concentré de gravité part en lixiviation intensive, etc. ;
//   • des MÉTADONNÉES de gouvernance : chaîne principale, cas d'usage, conditions
//     d'applicabilité, données nécessaires, maturité recommandée ;
//   • des MOTS-CLÉS DE ROUTE pour que le générateur (generator.ts) mappe une route
//     chiffrée par estimateRoutes vers le bon template de topologie.
//
// L'ancien format sériel `CircuitTemplate` (templates.ts) reste en place et testé ;
// cette bibliothèque est la version « flowsheet_template » riche du CdC. L'instan-
// ciateur pose les nœuds par couches (profondeur depuis l'alimentation) et empile
// les branches verticalement — aucune coordonnée en dur par template.
// ─────────────────────────────────────────────────────────────────────────────

import { getUnit } from './unitRegistry';
import { layoutByCircuit } from './layout';
import type { ProcessNode, StreamEdge, StreamType } from './types';
import type { MaturityLevel } from './generator';

export interface TemplateNode {
  /** Clé unique DANS le template (référencée par les arêtes). */
  key: string;
  unitType: string;
  label?: string;
}

export interface TemplateEdge {
  from: string;
  to: string;
  streamType?: StreamType;
  streamLabel?: string;
}

export interface FlowsheetTemplate {
  id: string;
  name: string;
  /** Chaîne principale lisible (§4, colonne « Chaîne principale »). */
  mainChain: string;
  /** Cas d'utilisation (§4, colonne « Cas d'utilisation »). */
  useCase: string;
  /** Conditions d'applicabilité affichées sur la carte template (§9). */
  applicability: string[];
  /** Données nécessaires pour exploiter le template (§9). */
  dataNeeds: string[];
  maturityRecommended: MaturityLevel;
  /** Mots-clés testés contre le libellé de route pour le mapping générateur. */
  routeKeywords: string[];
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

// ─── Constructeurs de topologie ───────────────────────────────────────────────

/** Chaîne linéaire : produit nœuds (clés auto) + arêtes série (pulpe). */
function serial(unitTypes: string[]): { nodes: TemplateNode[]; edges: TemplateEdge[] } {
  const nodes: TemplateNode[] = unitTypes.map((u, i) => ({ key: `${u}_${i}`, unitType: u }));
  const edges: TemplateEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].key, to: nodes[i + 1].key, streamType: 'pulp' });
  }
  return { nodes, edges };
}

// ─── Les 12 templates ─────────────────────────────────────────────────────────

export const FLOWSHEET_TEMPLATES: FlowsheetTemplate[] = [
  // 1. CIL direct – tout-venant
  {
    id: 'direct-cil',
    name: 'CIL direct — tout-venant',
    mainChain: 'Concassage → broyage → classification → épaississage → CIL → élution → électro-extraction → résidus',
    useCase: 'Minerai oxydé ou free-milling, sans préconcentration',
    applicability: ['Minerai free-milling / oxydé', 'GRG faible', 'Sulfures et carbone organique faibles'],
    dataNeeds: ['Récupération de lixiviation 48 h', 'F80 / P80', 'Consommation NaCN & chaux'],
    maturityRecommended: 'conceptual',
    routeKeywords: ['CIL direct'],
    ...serial(['feed_source', 'jaw_crusher', 'cone_crusher', 'sag_mill', 'hydrocyclone', 'thickener', 'cil_reactor', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink']),
  },

  // 2. CIP direct
  {
    id: 'direct-cip',
    name: 'CIP direct',
    mainChain: 'Concassage → broyage → lixiviation → CIP → élution → électro-extraction → résidus',
    useCase: 'Lixiviation suivie d’adsorption sur charbon séparée',
    applicability: ['Minerai free-milling', 'Faible carbone organique (pas de preg-robbing)', 'Adsorption séparée de la lixiviation'],
    dataNeeds: ['Cinétique de lixiviation', 'Consommation NaCN & chaux', 'Isotherme d’adsorption'],
    maturityRecommended: 'conceptual',
    routeKeywords: ['CIP direct', 'CIP'],
    ...serial(['feed_source', 'jaw_crusher', 'sag_mill', 'hydrocyclone', 'pre_aeration_tank', 'agitator', 'cip_reactor', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink']),
  },

  // 3. Gravimétrie + CIL des rejets
  {
    id: 'gravity-cil-tails',
    name: 'Gravimétrie + CIL des rejets',
    mainChain: 'Concassage → broyage → gravimétrie → lixiviation intensive du concentré → CIL des rejets',
    useCase: 'Minerai avec or libre et GRG significatif',
    applicability: ['GRG significatif (or libre)', 'Lixiviation des rejets de gravité'],
    dataNeeds: ['GRG (essai Knelson)', 'Récupération lixiviation 48 h', 'Récupération lixiviation intensive'],
    maturityRecommended: 'pre_feasibility',
    routeKeywords: ['Gravité + CIL', 'Gravité (Knelson) + CIL', 'résidus de gravité', 'CIL (résidus)'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'gravity', unitType: 'gravity_concentrator' },
      { key: 'ilr', unitType: 'ilr_intensive_leach' },
      { key: 'cil', unitType: 'cil_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'gravity', streamType: 'pulp' },
      // Concentré gravité → lixiviation intensive → électro-extraction
      { from: 'gravity', to: 'ilr', streamType: 'solid', streamLabel: 'concentré gravité' },
      { from: 'ilr', to: 'ew', streamType: 'solution' },
      // Rejets gravité → CIL
      { from: 'gravity', to: 'cil', streamType: 'pulp', streamLabel: 'rejets gravité' },
      { from: 'cil', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cil', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIL' },
    ],
  },

  // 4. Gravimétrie + CIP des rejets
  {
    id: 'gravity-cip-tails',
    name: 'Gravimétrie + CIP des rejets',
    mainChain: 'Concassage → broyage → gravimétrie → ILR/électro-extraction → CIP des rejets',
    useCase: 'Variante pour séparation lixiviation/adsorption',
    applicability: ['GRG significatif', 'Adsorption CIP séparée sur les rejets de gravité'],
    dataNeeds: ['GRG', 'Cinétique de lixiviation des rejets', 'Isotherme d’adsorption'],
    maturityRecommended: 'pre_feasibility',
    routeKeywords: ['Gravité + CIP', 'Gravité (Knelson) + CIP', 'CIP (résidus)'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'gravity', unitType: 'gravity_concentrator' },
      { key: 'ilr', unitType: 'ilr_intensive_leach' },
      { key: 'leach', unitType: 'agitator' },
      { key: 'cip', unitType: 'cip_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'gravity', streamType: 'pulp' },
      { from: 'gravity', to: 'ilr', streamType: 'solid', streamLabel: 'concentré gravité' },
      { from: 'ilr', to: 'ew', streamType: 'solution' },
      { from: 'gravity', to: 'leach', streamType: 'pulp', streamLabel: 'rejets gravité' },
      { from: 'leach', to: 'cip', streamType: 'pulp' },
      { from: 'cip', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cip', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIP' },
    ],
  },

  // 5. Flottation + CIL du concentré
  {
    id: 'flotation-cil-conc',
    name: 'Flottation + CIL du concentré',
    mainChain: 'Concassage → broyage → flottation → épaississage concentré → rebroyage → CIL → résidus',
    useCase: 'Or associé aux sulfures et concentrable',
    applicability: ['Or associé aux sulfures', 'Concentrable par flottation', 'Rejets de flottation au parc'],
    dataNeeds: ['Récupération de flottation (essai)', 'Rendement masse concentré', 'Lixiviation du concentré rebroyé'],
    maturityRecommended: 'pre_feasibility',
    routeKeywords: ['Flottation + CIL (concentré)', 'Flottation + CIL', 'concentré'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'rougher', unitType: 'flotation_rougher' },
      { key: 'thickener', unitType: 'thickener' },
      { key: 'regrind', unitType: 'concentrate_regrind' },
      { key: 'cil', unitType: 'cil_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'rougher', streamType: 'pulp' },
      // Concentré → épaississage → rebroyage → CIL
      { from: 'rougher', to: 'thickener', streamType: 'pulp', streamLabel: 'concentré' },
      { from: 'thickener', to: 'regrind', streamType: 'pulp' },
      { from: 'regrind', to: 'cil', streamType: 'pulp' },
      { from: 'cil', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cil', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIL' },
      // Rejets de flottation → parc (l'or non flotté est perdu → R = R_f × R_l)
      { from: 'rougher', to: 'tails', streamType: 'solid', streamLabel: 'rejets flottation' },
    ],
  },

  // 6. Gravimétrie + flottation + CIL
  {
    id: 'gravity-flotation-cil',
    name: 'Gravimétrie + flottation + CIL',
    mainChain: 'Concassage → broyage → gravimétrie → flottation → rebroyage concentré → CIL → résidus',
    useCase: 'Minerai mixte : or libre et or sulfuré',
    applicability: ['Or libre (GRG) ET or sulfuré', 'Preg-robbing possible → CIL du concentré'],
    dataNeeds: ['GRG', 'Récupération de flottation', 'Lixiviation du concentré rebroyé', 'Carbone organique'],
    maturityRecommended: 'pre_feasibility',
    routeKeywords: ['Gravité + Flottation + CIL', 'Gravité (Knelson) + Flottation', 'Gravité + Flottation'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'gravity', unitType: 'gravity_concentrator' },
      { key: 'ilr', unitType: 'ilr_intensive_leach' },
      { key: 'rougher', unitType: 'flotation_rougher' },
      { key: 'regrind', unitType: 'concentrate_regrind' },
      { key: 'cil', unitType: 'cil_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'gravity', streamType: 'pulp' },
      { from: 'gravity', to: 'ilr', streamType: 'solid', streamLabel: 'concentré gravité' },
      { from: 'ilr', to: 'ew', streamType: 'solution' },
      { from: 'gravity', to: 'rougher', streamType: 'pulp', streamLabel: 'rejets gravité' },
      { from: 'rougher', to: 'regrind', streamType: 'pulp', streamLabel: 'concentré flottation' },
      { from: 'regrind', to: 'cil', streamType: 'pulp' },
      { from: 'cil', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cil', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIL' },
      { from: 'rougher', to: 'tails', streamType: 'solid', streamLabel: 'rejets flottation' },
    ],
  },

  // 7. Flottation + cyanuration intensive
  {
    id: 'flotation-intensive-cyanidation',
    name: 'Flottation + cyanuration intensive',
    mainChain: 'Concassage → broyage → flottation → traitement intensif du concentré → électro-extraction',
    useCase: 'Concentré faible masse, à forte teneur en Au',
    applicability: ['Concentré de flottation à forte teneur', 'Faible masse de concentré', 'Cyanuration intensive dédiée'],
    dataNeeds: ['Récupération de flottation', 'Teneur du concentré', 'Cinétique de cyanuration intensive'],
    maturityRecommended: 'pre_feasibility',
    routeKeywords: ['Flottation + cyanuration intensive', 'cyanuration intensive'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'rougher', unitType: 'flotation_rougher' },
      { key: 'regrind', unitType: 'concentrate_regrind' },
      { key: 'ilr', unitType: 'ilr_intensive_leach' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'rougher', streamType: 'pulp' },
      { from: 'rougher', to: 'regrind', streamType: 'pulp', streamLabel: 'concentré' },
      { from: 'regrind', to: 'ilr', streamType: 'pulp' },
      { from: 'ilr', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'ilr', to: 'tails', streamType: 'solid', streamLabel: 'résidus lixiviation' },
      { from: 'rougher', to: 'tails', streamType: 'solid', streamLabel: 'rejets flottation' },
    ],
  },

  // 8. Lixiviation en tas
  {
    id: 'heap-leach',
    name: 'Lixiviation en tas',
    mainChain: 'Concassage → agglomération → heap leach → récupération solution → CIC/CIP → élution',
    useCase: 'Minerai oxydé, faible teneur, broyage non requis',
    applicability: ['Minerai oxydé, faible teneur', 'Broyage non requis', 'Percolation favorable'],
    dataNeeds: ['Récupération en colonne / tas', 'Consommation NaCN & chaux', 'Perméabilité / agglomération'],
    maturityRecommended: 'conceptual',
    routeKeywords: ['Heap Leach', 'lixiviation en tas', 'tas'],
    ...serial(['feed_source', 'jaw_crusher', 'cone_crusher', 'heap_leach_pad', 'carbon_adsorption', 'elution_column', 'electrowinning', 'product_sink']),
  },

  // 9. HPGR + broyage + CIL
  {
    id: 'hpgr-cil',
    name: 'HPGR + broyage + CIL',
    mainChain: 'Concassage → HPGR → broyage à boulets → cyclones → CIL → élution',
    useCase: 'Projet nécessitant une alternative énergétique de comminution',
    applicability: ['BWi élevé', 'Alternative énergétique de comminution', 'Free-milling'],
    dataNeeds: ['BWi / indice d’abrasion', 'F80 / P80', 'Récupération de lixiviation 48 h'],
    maturityRecommended: 'pre_feasibility',
    routeKeywords: ['HPGR', 'CIL direct'],
    ...serial(['feed_source', 'primary_gyratory', 'hpgr', 'banana_screen', 'ball_mill', 'hydrocyclone', 'cil_reactor', 'elution_column', 'electrowinning', 'smelting_furnace', 'product_sink']),
  },

  // 10. SABC + gravimétrie + CIL
  {
    id: 'sabc-gravity-cil',
    name: 'SABC + gravimétrie + CIL',
    mainChain: 'Concassage → SAG → broyeur à boulets → cyclones → gravimétrie → CIL des rejets',
    useCase: 'Grand tonnage, circuit conventionnel SABC',
    applicability: ['Grand tonnage', 'Circuit SABC conventionnel', 'GRG significatif'],
    dataNeeds: ['BWi', 'Charge circulante', 'GRG', 'Récupération de lixiviation 48 h'],
    maturityRecommended: 'feasibility',
    routeKeywords: ['SABC', 'Gravité + CIL', 'Gravité (Knelson) + CIL'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'primary_gyratory' },
      { key: 'sag', unitType: 'sag_mill' },
      { key: 'ball', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'gravity', unitType: 'gravity_concentrator' },
      { key: 'ilr', unitType: 'ilr_intensive_leach' },
      { key: 'cil', unitType: 'cil_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    // Note : le concasseur de galets (pebble crusher) du SABC recircule les scats
    // du SAG. Le SAG a une seule sortie dans ce moteur (pas de splitter de recycle
    // sans boucle) ; on modélise donc SAG→boulets en série, le pebble crusher est
    // à ajouter en édition si le circuit de recyclage doit être représenté.
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'sag', streamType: 'pulp' },
      { from: 'sag', to: 'ball', streamType: 'pulp' },
      { from: 'ball', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'gravity', streamType: 'pulp' },
      { from: 'gravity', to: 'ilr', streamType: 'solid', streamLabel: 'concentré gravité' },
      { from: 'ilr', to: 'ew', streamType: 'solution' },
      { from: 'gravity', to: 'cil', streamType: 'pulp', streamLabel: 'rejets gravité' },
      { from: 'cil', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cil', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIL' },
    ],
  },

  // 11. Flottation + oxydation + CIL (réfractaire)
  {
    id: 'flotation-oxidation-cil',
    name: 'Flottation + oxydation + CIL',
    mainChain: 'Concassage → broyage → flottation → POX/BIOX simulé → lavage → CIL',
    useCase: 'Minerai réfractaire sulfuré',
    applicability: ['Minerai réfractaire sulfuré', 'Or encapsulé dans les sulfures', 'Prétraitement oxydant requis'],
    dataNeeds: ['Récupération de flottation des sulfures', 'Rendement d’oxydation (POX/BIOX)', 'Lixiviation post-oxydation'],
    maturityRecommended: 'feasibility',
    routeKeywords: ['POX', 'BIOX', 'oxydation', 'réfractaire', 'oxydant'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'rougher', unitType: 'flotation_rougher' },
      { key: 'thickener', unitType: 'thickener' },
      { key: 'pox', unitType: 'pressure_oxidation' },
      { key: 'ccd', unitType: 'ccd_circuit' },
      { key: 'cil', unitType: 'cil_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'rougher', streamType: 'pulp' },
      { from: 'rougher', to: 'thickener', streamType: 'pulp', streamLabel: 'concentré sulfures' },
      { from: 'thickener', to: 'pox', streamType: 'pulp' },
      { from: 'pox', to: 'ccd', streamType: 'pulp' },
      { from: 'ccd', to: 'cil', streamType: 'pulp' },
      { from: 'cil', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cil', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIL' },
      { from: 'rougher', to: 'tails', streamType: 'solid', streamLabel: 'rejets flottation' },
    ],
  },

  // 12. Gravimétrie + flottation + traitement séparé
  {
    id: 'gravity-flotation-split-treatment',
    name: 'Gravimétrie + flottation + traitement séparé',
    mainChain: 'Gravimétrie → ILR ; flottation → rebroyage → CIL ; résidus → stockage',
    useCase: 'Minerai complexe avec traitement différencié des fractions',
    applicability: ['Minerai complexe multi-comportement', 'Fractions traitées séparément', 'Or libre + or sulfuré + preg-robbing'],
    dataNeeds: ['GRG', 'Récupération de flottation', 'Lixiviation intensive & du concentré', 'Carbone organique'],
    maturityRecommended: 'feasibility',
    routeKeywords: ['traitement séparé', 'Gravité + Flottation + CIL', 'Gravité (Knelson) + Flottation'],
    nodes: [
      { key: 'feed', unitType: 'feed_source' },
      { key: 'crush', unitType: 'jaw_crusher' },
      { key: 'mill', unitType: 'ball_mill' },
      { key: 'cyclone', unitType: 'hydrocyclone' },
      { key: 'gravity', unitType: 'gravity_concentrator' },
      { key: 'ilr', unitType: 'ilr_intensive_leach' },
      { key: 'rougher', unitType: 'flotation_rougher' },
      { key: 'regrind', unitType: 'concentrate_regrind' },
      { key: 'cil', unitType: 'cil_reactor' },
      { key: 'elution', unitType: 'elution_column' },
      { key: 'ew', unitType: 'electrowinning' },
      { key: 'dore', unitType: 'smelting_furnace' },
      { key: 'product', unitType: 'product_sink' },
      { key: 'tails', unitType: 'tailings_pond' },
    ],
    edges: [
      { from: 'feed', to: 'crush', streamType: 'pulp' },
      { from: 'crush', to: 'mill', streamType: 'pulp' },
      { from: 'mill', to: 'cyclone', streamType: 'pulp' },
      { from: 'cyclone', to: 'gravity', streamType: 'pulp' },
      { from: 'gravity', to: 'ilr', streamType: 'solid', streamLabel: 'concentré gravité' },
      { from: 'ilr', to: 'ew', streamType: 'solution' },
      { from: 'gravity', to: 'rougher', streamType: 'pulp', streamLabel: 'rejets gravité' },
      { from: 'rougher', to: 'regrind', streamType: 'pulp', streamLabel: 'concentré flottation' },
      { from: 'regrind', to: 'cil', streamType: 'pulp' },
      { from: 'cil', to: 'elution', streamType: 'pulp' },
      { from: 'elution', to: 'ew', streamType: 'solution' },
      { from: 'ew', to: 'dore', streamType: 'solution' },
      { from: 'dore', to: 'product', streamType: 'solution' },
      { from: 'cil', to: 'tails', streamType: 'solid', streamLabel: 'résidus CIL' },
      { from: 'rougher', to: 'tails', streamType: 'solid', streamLabel: 'rejets flottation' },
    ],
  },
];

// ─── Instanciation vers l'état du module (nœuds + arêtes réels) ───────────────

export interface InstantiateContext {
  flowsheetId: string;
  projectId: string;
  makeId: () => string;
}

/**
 * Transforme un template en nœuds + arêtes prêts à injecter dans le module.
 * - Unités absentes du registre → ignorées (ainsi que leurs arêtes).
 * - Paramètres par défaut copiés depuis le registre.
 * - Mise en page EN CASCADE GROUPÉE PAR CIRCUIT (voir layout.ts) : chaque circuit
 *   forme une bande, les bandes s'empilent dans l'ordre du procédé — jamais une
 *   seule ligne, pour tenir dans le panneau sans zoom.
 */
export function instantiateTemplate(
  template: FlowsheetTemplate,
  ctx: InstantiateContext,
): { nodes: ProcessNode[]; edges: StreamEdge[] } {
  const known = template.nodes.filter(n => getUnit(n.unitType));
  const keyToId = new Map<string, string>(known.map(n => [n.key, ctx.makeId()]));

  const pos = layoutByCircuit(
    known.map(n => ({ id: keyToId.get(n.key)!, unit_type: n.unitType })),
    template.edges
      .filter(e => keyToId.has(e.from) && keyToId.has(e.to))
      .map(e => ({ source: keyToId.get(e.from)!, target: keyToId.get(e.to)! })),
  );

  const nodes: ProcessNode[] = known.map(tn => {
    const unit = getUnit(tn.unitType)!;
    const id = keyToId.get(tn.key)!;
    const p = pos.get(id) ?? { x: 40, y: 40 };
    const parameters: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(unit.defaultParameters)) parameters[k] = v.default;
    return {
      id,
      flowsheet_id: ctx.flowsheetId,
      project_id: ctx.projectId,
      unit_type: tn.unitType,
      label: tn.label ?? unit.displayName,
      position_x: p.x,
      position_y: p.y,
      parameters,
      design_capacity: 500,
      availability_pct: 91,
    };
  });

  const edges: StreamEdge[] = [];
  for (const te of template.edges) {
    const source = keyToId.get(te.from);
    const target = keyToId.get(te.to);
    if (!source || !target) continue; // arête vers une unité ignorée
    edges.push({
      id: ctx.makeId(),
      flowsheet_id: ctx.flowsheetId,
      project_id: ctx.projectId,
      source_node_id: source,
      target_node_id: target,
      stream_type: te.streamType ?? 'pulp',
      stream_label: te.streamLabel,
    });
  }

  return { nodes, edges };
}

/** Mappe un libellé de route vers l'id du template le plus pertinent (pour le générateur). */
export function matchTemplateForRoute(routeLabel: string): string | null {
  const hay = routeLabel.toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const t of FLOWSHEET_TEMPLATES) {
    let score = 0;
    for (const kw of t.routeKeywords) {
      if (hay.includes(kw.toLowerCase())) score = Math.max(score, kw.length);
    }
    if (score > 0 && (!best || score > best.score)) best = { id: t.id, score };
  }
  return best?.id ?? null;
}

export function getTemplate(id: string): FlowsheetTemplate | null {
  return FLOWSHEET_TEMPLATES.find(t => t.id === id) ?? null;
}
