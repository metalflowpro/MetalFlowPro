// ─────────────────────────────────────────────────────────────────────────────
// Modèles de circuit COMPLETS — six schémas de procédé prêts à charger dans le
// constructeur de flowsheet.
//
// « Complet » signifie ici : de l'alimentation ROM jusqu'au doré ET jusqu'aux
// résidus, boucles fermées comprises (circuit de broyage, régénération du
// charbon, eau recyclée). Un modèle tronqué au CIL ne se bilan-flux pas.
//
// ⚠️ NOMENCLATURE — CIL et CIP désignent le circuit de cyanuration COMPLET,
// lixiviation comprise : en CIL le charbon actif est DANS les cuves de
// lixiviation, en CIP il est dans une cuverie qui SUIT la lixiviation. On
// n'écrit donc jamais « Lixiviation + CIL » (pléonasme) ni « Lixiviation +
// CIP » (laisse croire à un troisième étage) — voir ../analytics/routeEstimation.
//
// ⚠️ Les scores du radar de comparaison sont des repères de CADRAGE issus de la
// littérature (Marsden & House ; Adams, Gold Ore Processing ; Wills). Ils
// servent à départager des familles de circuits, pas à chiffrer un projet :
// à recaler sur les essais et l'étude d'ingénierie du site.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import type { StreamType } from './equipmentLibrary';

/** Un équipement du modèle. `equipCode` DOIT exister dans EQUIPMENT_LIBRARY. */
export interface CircuitTemplateNode {
  /** Identifiant local au modèle, référencé par les flux. */
  id: string;
  equipCode: string;
  /** Libellé métier — précise la fonction (« CIL — 6 cuves, 48 h »), pas juste le catalogue. */
  label: string;
}

/** Un flux entre deux équipements du modèle. */
export interface CircuitTemplateEdge {
  from: string;
  to: string;
  type?: StreamType;
  label?: string;
}

/** Axes du radar de comparaison des circuits. */
export const CIRCUIT_RADAR_AXES = [
  'Récupération', 'OPEX', 'Énergie', 'Réactifs', 'Robustesse', 'Flexibilité',
] as const;

export type CircuitRadarAxis = typeof CIRCUIT_RADAR_AXES[number];

export interface CircuitTemplate {
  code: string;
  /** Famille de procédé — regroupe les modèles dans le sélecteur. */
  family: string;
  name: string;
  description: string;
  /** Conditions minéralurgiques qui rendent ce circuit pertinent. */
  applicability: string[];
  /** Limites connues — ce que le circuit ne sait PAS traiter. */
  limitations: string[];
  /** Scores normalisés 0→1, un par axe de CIRCUIT_RADAR_AXES. */
  scores: Record<CircuitRadarAxis, number>;
  nodes: CircuitTemplateNode[];
  edges: CircuitTemplateEdge[];
}

// ── Briques réutilisées d'un modèle à l'autre ───────────────────────────────
// Les six circuits partagent leur tête (concassage + broyage en circuit fermé)
// et leur queue (ADR + résidus). Les dupliquer six fois garantirait qu'ils
// divergent à la première correction.

/** Concassage primaire + criblage en circuit fermé, jusqu'à l'alimentation broyage. */
const CRUSHING_NODES: CircuitTemplateNode[] = [
  { id: 'rom',    equipCode: 'FEED_ROM',       label: 'ROM Pad' },
  { id: 'apron',  equipCode: 'FEED_APRON',     label: 'Alimentateur tablier' },
  { id: 'gyr',    equipCode: 'CRUSH_GYRATORY', label: 'Concassage primaire' },
  { id: 'stock',  equipCode: 'FEED_SURGE',     label: 'Stock tampon broyage' },
];

const CRUSHING_EDGES: CircuitTemplateEdge[] = [
  { from: 'rom',   to: 'apron' },
  { from: 'apron', to: 'gyr' },
  { from: 'gyr',   to: 'stock', label: 'P80 ≈ 150 mm' },
];

/**
 * Broyage SAG + billes en circuit fermé sur hydrocyclones.
 *
 * ⚠️ Le broyage n'est PAS une chaîne séquentielle : le SAG décharge au cyclone,
 * la sousverse (grossier) alimente le broyeur à billes qui reboucle sur le
 * cyclone, et seule la surverse (fin) descend vers l'aval. Les cailloux de
 * taille critique sortent du SAG vers le concasseur de galets et y retournent.
 */
const GRINDING_NODES: CircuitTemplateNode[] = [
  { id: 'sag',    equipCode: 'MILL_SAG',      label: 'Broyeur SAG' },
  { id: 'pebble', equipCode: 'CRUSH_PEBBLE',  label: 'Concasseur de galets' },
  { id: 'cycl',   equipCode: 'CLASSIF_CYCL',  label: 'Batterie hydrocyclones' },
  { id: 'ball',   equipCode: 'MILL_BALL',     label: 'Broyeur à billes' },
];

const GRINDING_EDGES: CircuitTemplateEdge[] = [
  { from: 'stock',  to: 'sag',    label: 'Alim. broyage' },
  { from: 'sag',    to: 'cycl',   label: 'Décharge SAG' },
  // Aller = flux procédé (il positionne le concasseur de galets APRÈS le SAG au
  // tracé), retour = recyclage.
  { from: 'sag',    to: 'pebble', label: 'Cailloux (taille critique)' },
  { from: 'pebble', to: 'sag',    type: 'recycle', label: 'Concassé retour' },
  { from: 'cycl',   to: 'ball',   label: 'Sousverse (UF)' },
  { from: 'ball',   to: 'cycl',   type: 'recycle', label: 'Décharge broyeur' },
];

/**
 * Circuit ADR complet : élution, électrolyse, fusion, régénération du charbon.
 * `from` est l'équipement d'adsorption qui livre le charbon chargé, `regenTo`
 * celui qui reçoit le charbon régénéré (la même cuverie en boucle fermée).
 */
function adrChain(from: string, regenTo: string, elution: 'AARL' | 'ZADRA' = 'AARL'): {
  nodes: CircuitTemplateNode[]; edges: CircuitTemplateEdge[];
} {
  return {
    nodes: [
      { id: 'elut', equipCode: elution === 'AARL' ? 'ADR_ELUTION_AARL' : 'ADR_ELUTION_ZADRA', label: `Élution ${elution}` },
      { id: 'ew',   equipCode: 'ADR_EW',      label: 'Électrolyse (EW)' },
      { id: 'furn', equipCode: 'ADR_FURNACE', label: 'Four à induction' },
      { id: 'dore', equipCode: 'ADR_DORE',    label: 'Coulée doré' },
      { id: 'kiln', equipCode: 'ADR_KILN',    label: 'Régénération du charbon' },
    ],
    edges: [
      { from, to: 'elut', label: 'Charbon chargé' },
      { from: 'elut', to: 'ew',   type: 'pregnant', label: 'Éluat riche' },
      { from: 'ew',   to: 'furn', label: 'Boues cathodiques' },
      { from: 'furn', to: 'dore' },
      { from: 'elut', to: 'kiln', label: 'Charbon dénudé' },
      { from: 'kiln', to: regenTo, type: 'recycle', label: 'Charbon régénéré' },
    ],
  };
}

/**
 * Fin de circuit résidus : détoxification cyanure, épaississage, parc à résidus,
 * et retour de l'eau de procédé au broyage.
 * `from` est l'équipement qui rejette la pulpe lixiviée.
 */
function tailingsChain(from: string, waterTo = 'ball'): {
  nodes: CircuitTemplateNode[]; edges: CircuitTemplateEdge[];
} {
  return {
    nodes: [
      { id: 'detox', equipCode: 'WT_DETOX',    label: 'Détoxification SO₂/air' },
      { id: 'thck',  equipCode: 'THCK_HIRATE', label: 'Épaississeur résidus' },
      { id: 'tsf',   equipCode: 'TAILS_TSF',   label: 'Parc à résidus (TSF)' },
    ],
    edges: [
      { from, to: 'detox', label: 'Pulpe lixiviée' },
      { from: 'detox', to: 'thck' },
      { from: 'thck',  to: 'tsf', label: 'Sousverse épaissie' },
      { from: 'thck',  to: waterTo, type: 'water', label: 'Eau recyclée' },
    ],
  };
}

const merge = (...parts: { nodes: CircuitTemplateNode[]; edges: CircuitTemplateEdge[] }[]) => ({
  nodes: parts.flatMap(p => p.nodes),
  edges: parts.flatMap(p => p.edges),
});

// ── 1. CIL standard — minerai oxydé free-milling ─────────────────────────────

const CIL_STANDARD: CircuitTemplate = {
  code: 'AU_CIL_STD',
  family: 'A. Cyanuration en cuves',
  name: 'CIL standard — minerai oxydé free-milling',
  description:
    'Le circuit de référence de l\'industrie aurifère : broyage en circuit fermé puis cyanuration '
    + 'avec charbon actif présent DANS les cuves de lixiviation. L\'or se dissout et s\'adsorbe '
    + 'simultanément, ce qui limite l\'inventaire d\'or en solution et coupe court au preg-robbing.',
  applicability: [
    'Minerai oxydé ou free-milling, or non verrouillé dans les sulfures',
    'Carbone organique présent (Corg > 0,2 %) — le charbon actif concurrence le carbone natif',
    'Teneur de tête modérée (< 5 g/t)',
  ],
  limitations: [
    'Or grossier / GRG élevé mal valorisé — préférer un circuit gravité + CIL',
    'Inefficace sur or réfractaire enfermé dans la pyrite/arsénopyrite',
  ],
  scores: { 'Récupération': 0.92, 'OPEX': 0.80, 'Énergie': 0.78, 'Réactifs': 0.72, 'Robustesse': 0.90, 'Flexibilité': 0.85 },
  ...merge(
    { nodes: CRUSHING_NODES, edges: CRUSHING_EDGES },
    { nodes: GRINDING_NODES, edges: GRINDING_EDGES },
    {
      nodes: [
        { id: 'trash', equipCode: 'SCREEN_INTER', label: 'Tamis anti-débris' },
        { id: 'preth', equipCode: 'THCK_CONV',    label: 'Épaississeur pré-lixiviation' },
        { id: 'cil',   equipCode: 'CIL_TANK',     label: 'CIL — 6 cuves, 48 h' },
      ],
      edges: [
        { from: 'cycl',  to: 'trash', label: 'Surverse (OF) P80 75 µm' },
        { from: 'trash', to: 'preth' },
        { from: 'preth', to: 'cil', label: 'Pulpe 45 % solides' },
      ],
    },
    adrChain('cil', 'cil'),
    tailingsChain('cil'),
  ),
};

// ── 2. CIP standard — lixiviation puis adsorption séparée ────────────────────

const CIP_STANDARD: CircuitTemplate = {
  code: 'AU_CIP_STD',
  family: 'A. Cyanuration en cuves',
  name: 'CIP standard — adsorption séparée de la lixiviation',
  description:
    'La lixiviation se fait d\'abord dans sa propre cuverie ; l\'or dissous est ensuite adsorbé sur '
    + 'charbon dans une seconde cuverie à contre-courant, avec tamis interstades. Le charbon n\'est '
    + 'jamais exposé au broyage de la lixiviation : moins d\'attrition, régénération plus facile.',
  applicability: [
    'Consommation de cyanure élevée (> 2,5 kg/t) — charbon isolé de la lixiviation',
    'Teneur de tête élevée (> 5 g/t) — réduit l\'inventaire d\'or immobilisé en cuve',
    'Sulfures présents (> 1,5 %) — limite l\'encrassement du charbon',
  ],
  limitations: [
    'Sans défense contre le preg-robbing : l\'or reste en solution face au carbone natif — passer en CIL si Corg > 0,2 %',
    'Deux cuveries à construire : emprise et CAPEX supérieurs au CIL',
  ],
  scores: { 'Récupération': 0.91, 'OPEX': 0.78, 'Énergie': 0.76, 'Réactifs': 0.80, 'Robustesse': 0.86, 'Flexibilité': 0.80 },
  ...merge(
    { nodes: CRUSHING_NODES, edges: CRUSHING_EDGES },
    { nodes: GRINDING_NODES, edges: GRINDING_EDGES },
    {
      nodes: [
        { id: 'trash', equipCode: 'SCREEN_INTER', label: 'Tamis anti-débris' },
        { id: 'preth', equipCode: 'THCK_CONV',    label: 'Épaississeur pré-lixiviation' },
        { id: 'leach', equipCode: 'LEACH_TANK',   label: 'Lixiviation — 6 cuves, 48 h' },
        { id: 'istr',  equipCode: 'SCREEN_INTER', label: 'Tamis interstades' },
        { id: 'cip',   equipCode: 'CIP_TANK',     label: 'CIP — 5 cuves à contre-courant' },
      ],
      edges: [
        { from: 'cycl',  to: 'trash', label: 'Surverse (OF) P80 75 µm' },
        { from: 'trash', to: 'preth' },
        { from: 'preth', to: 'leach', label: 'Pulpe 45 % solides' },
        { from: 'leach', to: 'istr',  label: 'Pulpe lixiviée + or dissous' },
        { from: 'istr',  to: 'cip',   label: 'Pulpe déclassée' },
      ],
    },
    adrChain('cip', 'cip'),
    tailingsChain('cip'),
  ),
};

// ── 3. Gravité (Knelson) + CIL ───────────────────────────────────────────────

const GRAVITY_CIL: CircuitTemplate = {
  code: 'AU_GRAV_CIL',
  family: 'B. Pré-concentration gravimétrique',
  name: 'Gravité (Knelson) + CIL — or grossier',
  description:
    'Un soutirage (bleed) de 15–20 % de la sousverse cyclone passe au concentrateur centrifuge : '
    + 'l\'or libre grossier est capté avant d\'atteindre la cyanuration, puis dissous dans un '
    + 'réacteur de lixiviation intensive dont la solution mère part directement à l\'électrolyse. '
    + 'Le résidu gravimétrique retourne au broyage, la charge du CIL est allégée d\'autant.',
  applicability: [
    'GRG élevé (> 10 %) mesuré à l\'essai Knelson/Falcon',
    'Or grossier visible en minéralogie — cinétique de cyanuration lente sur les grosses particules',
    'Volonté de réduire la consommation de cyanure et l\'inventaire d\'or en cuverie',
  ],
  limitations: [
    'Investissement centrifuge + réacteur intensif — CAPEX supérieur au CIL seul',
    'Sans effet si l\'or est finement disséminé (GRG faible)',
  ],
  scores: { 'Récupération': 0.94, 'OPEX': 0.76, 'Énergie': 0.74, 'Réactifs': 0.78, 'Robustesse': 0.88, 'Flexibilité': 0.82 },
  ...merge(
    { nodes: CRUSHING_NODES, edges: CRUSHING_EDGES },
    { nodes: GRINDING_NODES, edges: GRINDING_EDGES },
    {
      nodes: [
        { id: 'knel',  equipCode: 'GRAV_KNELSON', label: 'Concentrateur Knelson' },
        { id: 'table', equipCode: 'GRAV_TABLE',   label: 'Table à secousses (nettoyage)' },
        { id: 'ilr',   equipCode: 'GRAV_ILR',     label: 'Réacteur de lixiviation intensive' },
        { id: 'trash', equipCode: 'SCREEN_INTER', label: 'Tamis anti-débris' },
        { id: 'preth', equipCode: 'THCK_CONV',    label: 'Épaississeur pré-lixiviation' },
        { id: 'cil',   equipCode: 'CIL_TANK',     label: 'CIL — 6 cuves, 48 h' },
      ],
      edges: [
        { from: 'cycl',  to: 'knel',  label: 'Bleed 15–20 % de l\'UF' },
        { from: 'knel',  to: 'table', label: 'Concentré gravimétrique' },
        { from: 'table', to: 'ilr',   label: 'Concentré nettoyé' },
        { from: 'ilr',   to: 'ew',    type: 'pregnant', label: 'Solution mère → EW' },
        { from: 'knel',  to: 'ball',  type: 'recycle', label: 'Résidu gravimétrique' },
        { from: 'cycl',  to: 'trash', label: 'Surverse (OF) P80 75 µm' },
        { from: 'trash', to: 'preth' },
        { from: 'preth', to: 'cil',   label: 'Pulpe 45 % solides' },
      ],
    },
    adrChain('cil', 'cil'),
    tailingsChain('cil'),
  ),
};

// ── 4. Flottation + rebroyage + CIL — or semi-réfractaire ────────────────────

const FLOTATION_CIL: CircuitTemplate = {
  code: 'AU_FLOT_CIL',
  family: 'C. Concentration par flottation',
  name: 'Flottation + rebroyage + CIL — or semi-réfractaire',
  description:
    'La flottation concentre les sulfures porteurs d\'or dans un faible tonnage, rebroyé finement '
    + 'pour libérer l\'or occlus avant cyanuration. Seul le concentré part au CIL : la cuverie est '
    + 'dimensionnée sur 5–10 % du tonnage usine, et les rejets de flottation vont directement aux résidus.',
  applicability: [
    'Or partiellement associé aux sulfures — récupération directe par cyanuration insuffisante',
    'Essais de flottation disponibles (récupération Au au concentré)',
    'Sulfures 1–5 % : assez pour flotter, pas assez pour justifier une oxydation',
  ],
  limitations: [
    'La flottation SÉPARE le flux : l\'or perdu aux rejets ne revoit jamais la cyanuration',
    'Circuit le plus complexe à conduire — réactifs de flottation à recaler en continu',
  ],
  scores: { 'Récupération': 0.88, 'OPEX': 0.68, 'Énergie': 0.66, 'Réactifs': 0.62, 'Robustesse': 0.82, 'Flexibilité': 0.78 },
  ...merge(
    { nodes: CRUSHING_NODES, edges: CRUSHING_EDGES },
    { nodes: GRINDING_NODES, edges: GRINDING_EDGES },
    {
      nodes: [
        { id: 'flash',  equipCode: 'FLOAT_FLASH',    label: 'Flash flotation (UF cyclone)' },
        { id: 'rough',  equipCode: 'FLOAT_ROUGH',    label: 'Banque rougher' },
        { id: 'clean',  equipCode: 'FLOAT_CLEAN',    label: 'Cellules cleaner' },
        { id: 'regr',   equipCode: 'MILL_ISAMILL',   label: 'Rebroyage IsaMill P80 20 µm' },
        { id: 'concth', equipCode: 'THCK_CONV',      label: 'Épaississeur concentré' },
        { id: 'cil',    equipCode: 'CIL_TANK',       label: 'CIL concentré — 6 cuves' },
        { id: 'flotth', equipCode: 'THCK_HIRATE',    label: 'Épaississeur rejets flottation' },
      ],
      edges: [
        { from: 'cycl',   to: 'flash', label: 'Bleed UF' },
        { from: 'flash',  to: 'regr',  label: 'Concentré flash' },
        { from: 'cycl',   to: 'rough', label: 'Surverse (OF) P80 106 µm' },
        { from: 'rough',  to: 'clean', label: 'Concentré rougher' },
        { from: 'clean',  to: 'rough', type: 'recycle', label: 'Rejets cleaner (middlings)' },
        { from: 'clean',  to: 'regr',  label: 'Concentré final' },
        { from: 'regr',   to: 'concth' },
        { from: 'concth', to: 'cil',   label: 'Concentré rebroyé' },
        { from: 'rough',  to: 'flotth', label: 'Rejets flottation (~92 % du tonnage)' },
        { from: 'flotth', to: 'tsf' },
        { from: 'flotth', to: 'ball',  type: 'water', label: 'Eau recyclée' },
      ],
    },
    adrChain('cil', 'cil'),
    tailingsChain('cil'),
  ),
};

// ── 5. Flottation + POX + CIL — minerai réfractaire ──────────────────────────

const POX_REFRACTORY: CircuitTemplate = {
  code: 'AU_POX_CIL',
  family: 'D. Prétraitement oxydant (réfractaire)',
  name: 'Flottation + POX + CIL — minerai réfractaire',
  description:
    'L\'or est enfermé dans la matrice sulfurée : aucune cyanuration ne l\'atteint sans destruction '
    + 'préalable des sulfures. Le concentré de flottation est oxydé sous pression en autoclave, '
    + 'la pulpe oxydée est neutralisée à la chaux, puis cyanurée en CIL.',
  applicability: [
    'Sulfures > 2 % avec or verrouillé (pyrite/arsénopyrite) — récupération directe < 60 %',
    'Diagnostic de réfractarité confirmé par minéralogie et lixiviation diagnostique',
    'Tonnage de concentré suffisant pour amortir un autoclave',
  ],
  limitations: [
    'CAPEX et OPEX les plus élevés de la gamme — autoclave, oxygène, chaux',
    'Chaîne SÉQUENTIELLE : l\'or perdu aux rejets de flottation ne revoit ni l\'oxydation ni la cyanuration',
    'Gestion des effluents acides et de l\'arsenic (précipitation en scorodite)',
  ],
  scores: { 'Récupération': 0.89, 'OPEX': 0.50, 'Énergie': 0.52, 'Réactifs': 0.55, 'Robustesse': 0.70, 'Flexibilité': 0.65 },
  ...merge(
    { nodes: CRUSHING_NODES, edges: CRUSHING_EDGES },
    { nodes: GRINDING_NODES, edges: GRINDING_EDGES },
    {
      nodes: [
        { id: 'rough',  equipCode: 'FLOAT_ROUGH',   label: 'Banque rougher sulfures' },
        { id: 'clean',  equipCode: 'FLOAT_CLEAN',   label: 'Cellules cleaner' },
        { id: 'concth', equipCode: 'THCK_CONV',     label: 'Épaississeur concentré 50 % sol.' },
        { id: 'pox',    equipCode: 'OX_AUTOCLAVE',  label: 'Autoclave POX 220 °C / 3 200 kPa' },
        { id: 'neut',   equipCode: 'NEUT_TANK',     label: 'Neutralisation à la chaux' },
        { id: 'cil',    equipCode: 'CIL_TANK',      label: 'CIL post-POX — 6 cuves' },
        { id: 'flotth', equipCode: 'THCK_HIRATE',   label: 'Épaississeur rejets flottation' },
        { id: 'eff',    equipCode: 'WT_EFFLUENT',   label: 'Traitement effluents (As)' },
      ],
      edges: [
        { from: 'cycl',   to: 'rough',  label: 'Surverse (OF) P80 75 µm' },
        { from: 'rough',  to: 'clean',  label: 'Concentré rougher' },
        { from: 'clean',  to: 'rough',  type: 'recycle', label: 'Rejets cleaner' },
        { from: 'clean',  to: 'concth', label: 'Concentré sulfures' },
        { from: 'concth', to: 'pox' },
        { from: 'pox',    to: 'neut',   label: 'Pulpe oxydée pH 1' },
        { from: 'neut',   to: 'cil',    label: 'Pulpe neutralisée pH 10,5' },
        { from: 'neut',   to: 'eff',    label: 'Purge acide / arsenic' },
        { from: 'rough',  to: 'flotth', label: 'Rejets flottation' },
        { from: 'flotth', to: 'tsf' },
        { from: 'flotth', to: 'ball',   type: 'water', label: 'Eau recyclée' },
      ],
    },
    adrChain('cil', 'cil'),
    tailingsChain('cil'),
  ),
};

// ── 6. Lixiviation en tas — minerai à faible teneur ──────────────────────────

const HEAP_LEACH: CircuitTemplate = {
  code: 'AU_HEAP_LEACH',
  family: 'E. Lixiviation en tas',
  name: 'Heap leach — minerai oxydé à faible teneur',
  description:
    'Pas de broyage : le minerai concassé en trois étages est aggloméré à la chaux et au ciment, '
    + 'empilé sur une aire étanche et arrosé de solution cyanurée. La solution mère (PLS) est '
    + 'reprise en colonnes de charbon, et la solution stérile (barren) retourne à l\'arrosage.',
  applicability: [
    'Minerai oxydé à faible teneur (< 1 g/t) — la cyanuration en cuves ne se rentabilise pas',
    'Or libre bien exposé au concassage, sans besoin de broyage fin',
    'Climat et topographie compatibles avec une aire de lixiviation',
  ],
  limitations: [
    'Récupération plafonnée (55–75 %) et cinétique lente — plusieurs mois par cellule',
    'Rédhibitoire sur minerai carboné (preg-robbing) ou réfractaire',
    'Pas de résidus épaissis : le tas reste en place, à réhabiliter en fin de vie',
  ],
  scores: { 'Récupération': 0.74, 'OPEX': 0.95, 'Énergie': 0.95, 'Réactifs': 0.88, 'Robustesse': 0.72, 'Flexibilité': 0.60 },
  nodes: [
    { id: 'rom',    equipCode: 'FEED_ROM',      label: 'ROM Pad' },
    { id: 'apron',  equipCode: 'FEED_APRON',    label: 'Alimentateur tablier' },
    { id: 'jaw',    equipCode: 'CRUSH_JAW',     label: 'Concassage primaire' },
    { id: 'sec',    equipCode: 'CRUSH_CONE_SEC', label: 'Cône secondaire' },
    { id: 'scr',    equipCode: 'SCREEN_VIB',    label: 'Crible de contrôle' },
    { id: 'ter',    equipCode: 'CRUSH_CONE_TER', label: 'Cône tertiaire' },
    { id: 'agglom', equipCode: 'AGGLOM',        label: 'Agglomération chaux/ciment' },
    { id: 'stack',  equipCode: 'FEED_STACKER',  label: 'Empileur radial' },
    { id: 'heap',   equipCode: 'LEACH_HEAP',    label: 'Tas de lixiviation (cellules)' },
    { id: 'pls',    equipCode: 'PLS_POND',      label: 'Bassin PLS' },
    { id: 'adr',    equipCode: 'ADR_COLUMN',    label: 'Colonnes carbone (CIC)' },
    { id: 'barren', equipCode: 'WT_POND',       label: 'Bassin solution stérile' },
    { id: 'elut',   equipCode: 'ADR_ELUTION_ZADRA', label: 'Élution ZADRA' },
    { id: 'ew',     equipCode: 'ADR_EW',        label: 'Électrolyse (EW)' },
    { id: 'furn',   equipCode: 'ADR_FURNACE',   label: 'Four à induction' },
    { id: 'dore',   equipCode: 'ADR_DORE',      label: 'Coulée doré' },
    { id: 'kiln',   equipCode: 'ADR_KILN',      label: 'Régénération du charbon' },
  ],
  edges: [
    { from: 'rom',    to: 'apron' },
    { from: 'apron',  to: 'jaw' },
    { from: 'jaw',    to: 'sec' },
    { from: 'sec',    to: 'scr' },
    { from: 'scr',    to: 'ter',    label: 'Refus (oversize)' },
    { from: 'ter',    to: 'scr',    type: 'recycle', label: 'Retour crible' },
    { from: 'scr',    to: 'agglom', label: 'Passant P80 12 mm' },
    { from: 'agglom', to: 'stack' },
    { from: 'stack',  to: 'heap' },
    { from: 'heap',   to: 'pls',    type: 'pregnant', label: 'Solution mère (PLS)' },
    { from: 'pls',    to: 'adr' },
    { from: 'adr',    to: 'barren', label: 'Solution stérile' },
    { from: 'barren', to: 'heap',   type: 'recycle', label: 'Réarrosage (NaCN d\'appoint)' },
    { from: 'adr',    to: 'elut',   label: 'Charbon chargé' },
    { from: 'elut',   to: 'ew',     type: 'pregnant', label: 'Éluat riche' },
    { from: 'ew',     to: 'furn',   label: 'Boues cathodiques' },
    { from: 'furn',   to: 'dore' },
    { from: 'elut',   to: 'kiln',   label: 'Charbon dénudé' },
    { from: 'kiln',   to: 'adr',    type: 'recycle', label: 'Charbon régénéré' },
  ],
};

/** Les six modèles de circuit, dans l'ordre de complexité croissante du minerai. */
export const CIRCUIT_TEMPLATES: CircuitTemplate[] = [
  CIL_STANDARD,
  CIP_STANDARD,
  GRAVITY_CIL,
  FLOTATION_CIL,
  POX_REFRACTORY,
  HEAP_LEACH,
];

export function findCircuitTemplate(code: string): CircuitTemplate | undefined {
  return CIRCUIT_TEMPLATES.find(t => t.code === code);
}
