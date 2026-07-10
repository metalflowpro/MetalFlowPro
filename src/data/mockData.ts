import type {
  FlowsheetTemplate,
  MassBalanceStream,
  SimRun,
  CapexLine,
  OpexLine,
  StageGate,
} from '../types';

// ─── Flowsheet Templates ─────────────────────────────────────────────────────

export const FLOWSHEET_TEMPLATES: FlowsheetTemplate[] = [
  {
    code: 'AU_CIL_OXIDE',
    family: 'A. CIL/CIP',
    name: 'Au-CIL — Minerai oxydé free-milling',
    description: 'Circuit standard pour or libre en minerai oxydé. Concassage, broyage SAG+Ball, CIL, ADR.',
    nodes: [
      { id: 'feed',     op_code: 'FEED',            label: 'Minerai brut',          parent: null },
      { id: 'crush1',   op_code: 'CRUSH_GYRATORY',  label: 'Concassage primaire',   parent: 'feed' },
      { id: 'crush2',   op_code: 'CRUSH_CONE',      label: 'Concassage secondaire', parent: 'crush1' },
      { id: 'sag',      op_code: 'MILL_SAG',        label: 'Broyage SAG',           parent: 'crush2' },
      { id: 'ball',     op_code: 'MILL_BALL',       label: 'Broyage secondaire',    parent: 'sag' },
      { id: 'clas',     op_code: 'CLASSIF_CYCL',    label: 'Classification',        parent: 'ball' },
      { id: 'cil1',     op_code: 'CIL_TANK',        label: 'CIL — Cuve 1',         parent: 'clas' },
      { id: 'cil2',     op_code: 'CIL_TANK',        label: 'CIL — Cuve 2',         parent: 'cil1' },
      { id: 'cil3',     op_code: 'CIL_TANK',        label: 'CIL — Cuve 3',         parent: 'cil2' },
      { id: 'cil4',     op_code: 'CIL_TANK',        label: 'CIL — Cuve 4',         parent: 'cil3' },
      { id: 'cil5',     op_code: 'CIL_TANK',        label: 'CIL — Cuve 5',         parent: 'cil4' },
      { id: 'cil6',     op_code: 'CIL_TANK',        label: 'CIL — Cuve 6',         parent: 'cil5' },
      { id: 'elut',     op_code: 'ELUTION',         label: 'Élution AARL',          parent: 'cil6' },
      { id: 'ew',       op_code: 'ELECTROWIN',      label: 'Électrolyse',           parent: 'elut' },
      { id: 'smelt',    op_code: 'SMELT',           label: 'Fusion / Doré',         parent: 'ew' },
      { id: 'tails',    op_code: 'TAILINGS',        label: 'Résidus TSF',           parent: 'cil6' },
    ],
  },
  {
    code: 'AU_GRAV_CIL',
    family: 'A. CIL/CIP',
    name: 'Gravity + CIL — Gold libre',
    description: 'Récupération gravitaire en circuit avant CIL. Optimise le traitement de l\'or grossier.',
    nodes: [
      { id: 'feed',     op_code: 'FEED',            label: 'Minerai brut',          parent: null },
      { id: 'crush1',   op_code: 'CRUSH_GYRATORY',  label: 'Concassage primaire',   parent: 'feed' },
      { id: 'sag',      op_code: 'MILL_SAG',        label: 'Broyage SAG',           parent: 'crush1' },
      { id: 'ball',     op_code: 'MILL_BALL',       label: 'Broyage secondaire',    parent: 'sag' },
      { id: 'knelson',  op_code: 'GRAVITY_KNELSON', label: 'Concentrateur Knelson', parent: 'ball' },
      { id: 'ilt',      op_code: 'GRAVITY_ILT',     label: 'Table intensive',       parent: 'knelson' },
      { id: 'cil1',     op_code: 'CIL_TANK',        label: 'CIL — Cuves (1-6)',     parent: 'ball' },
      { id: 'elut',     op_code: 'ELUTION',         label: 'Élution',               parent: 'cil1' },
      { id: 'ew',       op_code: 'ELECTROWIN',      label: 'Électrolyse',           parent: 'elut' },
      { id: 'smelt',    op_code: 'SMELT',           label: 'Fusion / Doré',         parent: 'ew' },
      { id: 'tails',    op_code: 'TAILINGS',        label: 'Résidus TSF',           parent: 'cil1' },
    ],
  },
  {
    code: 'HEAP_LEACH_STD',
    family: 'B. Heap Leach',
    name: 'Heap Leach — Standard aggloméré',
    description: 'Lixiviation en tas classique pour minerais à faible teneur. Solution Merrill-Crowe ou ADR.',
    nodes: [
      { id: 'feed',     op_code: 'FEED',            label: 'Minerai',               parent: null },
      { id: 'crush1',   op_code: 'CRUSH_GYRATORY',  label: 'Concassage 3 étages',   parent: 'feed' },
      { id: 'agglom',   op_code: 'AGGLOMERATION',   label: 'Agglomération',         parent: 'crush1' },
      { id: 'heap',     op_code: 'HEAP_PAD',        label: 'Tas de lixiviation',    parent: 'agglom' },
      { id: 'pls',      op_code: 'PLS_POND',        label: 'Bassin PLS',            parent: 'heap' },
      { id: 'adr',      op_code: 'ADR_COLUMN',      label: 'Colonnes ADR',          parent: 'pls' },
      { id: 'elut',     op_code: 'ELUTION',         label: 'Élution',               parent: 'adr' },
      { id: 'ew',       op_code: 'ELECTROWIN',      label: 'Électrolyse',           parent: 'elut' },
      { id: 'smelt',    op_code: 'SMELT',           label: 'Fusion / Doré',         parent: 'ew' },
    ],
  },
  {
    code: 'POX_REFRACTORY',
    family: 'C. Réfractaire',
    name: 'POX — Oxydation sous pression',
    description: 'Traitement de minerais réfractaires sulfurés. Autoclave HPOX suivi CIL.',
    nodes: [
      { id: 'feed',     op_code: 'FEED',            label: 'Minerai réfractaire',   parent: null },
      { id: 'crush',    op_code: 'CRUSH_CONE',      label: 'Concassage',            parent: 'feed' },
      { id: 'ball',     op_code: 'MILL_BALL',       label: 'Broyage fin',           parent: 'crush' },
      { id: 'flotation',op_code: 'FLOTATION',       label: 'Flottation sulfures',   parent: 'ball' },
      { id: 'thickener',op_code: 'THICKENER',       label: 'Épaississeur',          parent: 'flotation' },
      { id: 'pox',      op_code: 'AUTOCLAVE_POX',   label: 'Autoclave POX',         parent: 'thickener' },
      { id: 'neutr',    op_code: 'NEUTRALISATION',  label: 'Neutralisation',        parent: 'pox' },
      { id: 'cil1',     op_code: 'CIL_TANK',        label: 'CIL post-POX',          parent: 'neutr' },
      { id: 'elut',     op_code: 'ELUTION',         label: 'Élution',               parent: 'cil1' },
      { id: 'ew',       op_code: 'ELECTROWIN',      label: 'Électrolyse',           parent: 'elut' },
      { id: 'smelt',    op_code: 'SMELT',           label: 'Fusion',                parent: 'ew' },
    ],
  },
  {
    code: 'AU_FLOAT_CIL',
    family: 'A. CIL/CIP',
    name: 'Flottation + CIL — Or semi-réfractaire',
    description: 'Flottation préliminaire pour concentrer les sulfures avant CIL.',
    nodes: [
      { id: 'feed',     op_code: 'FEED',            label: 'Minerai',               parent: null },
      { id: 'sag',      op_code: 'MILL_SAG',        label: 'Broyage SAG',           parent: 'feed' },
      { id: 'ball',     op_code: 'MILL_BALL',       label: 'Broyage secondaire',    parent: 'sag' },
      { id: 'float',    op_code: 'FLOTATION',       label: 'Flottation',            parent: 'ball' },
      { id: 'regrind',  op_code: 'MILL_VERTIMILL',  label: 'Rebroyage Vertimill',   parent: 'float' },
      { id: 'cil',      op_code: 'CIL_TANK',        label: 'CIL — Cuves (1-6)',     parent: 'regrind' },
      { id: 'elut',     op_code: 'ELUTION',         label: 'Élution',               parent: 'cil' },
      { id: 'ew',       op_code: 'ELECTROWIN',      label: 'Électrolyse',           parent: 'elut' },
      { id: 'smelt',    op_code: 'SMELT',           label: 'Fusion',                parent: 'ew' },
    ],
  },
];

// ─── Mass Balance Streams ────────────────────────────────────────────────────

export const MOCK_STREAMS: MassBalanceStream[] = [
  { id: 's1',  name: 'Alimentation usine',    source: 'FEED',     destination: 'CRUSH',   mass_tph: 200, solids_pct: 100, au_g_t: 2.50 },
  { id: 's2',  name: 'Alimentation SAG',      source: 'CRUSH',    destination: 'SAG',     mass_tph: 200, solids_pct: 100, au_g_t: 2.50 },
  { id: 's3',  name: 'Décharge SAG',          source: 'SAG',      destination: 'BALL',    mass_tph: 198, solids_pct: 75,  au_g_t: 2.51 },
  { id: 's4',  name: 'Produit broyage',       source: 'BALL',     destination: 'CYCL',    mass_tph: 196, solids_pct: 65,  au_g_t: 2.52 },
  { id: 's5',  name: 'U/F cyclone → Ball',    source: 'CYCL',     destination: 'BALL',    mass_tph: 85,  solids_pct: 78,  au_g_t: 2.80 },
  { id: 's6',  name: 'O/F cyclone → CIL',     source: 'CYCL',     destination: 'CIL',     mass_tph: 111, solids_pct: 38,  au_g_t: 2.52 },
  { id: 's7',  name: 'Pulpe CIL',             source: 'CIL',      destination: 'THCK',    mass_tph: 111, solids_pct: 48,  au_g_t: 0.28 },
  { id: 's8',  name: 'U/F épaississeur',      source: 'THCK',     destination: 'TAILS',   mass_tph: 82,  solids_pct: 60,  au_g_t: 0.28 },
  { id: 's9',  name: 'Débordement épaiss.',   source: 'THCK',     destination: 'RECYCLE', mass_tph: 29,  solids_pct: 2,   au_g_t: 0.05 },
  { id: 's10', name: 'Chargé carbone',        source: 'CIL',      destination: 'STRIP',   mass_tph: 0.8, solids_pct: 100, au_g_t: 1950 },
  { id: 's11', name: 'Solution élution',      source: 'STRIP',    destination: 'EW',      mass_tph: 0.5, solids_pct: 0,   au_g_t: 450 },
  { id: 's12', name: 'Dépôt EW',             source: 'EW',       destination: 'SMELT',   mass_tph: 0.02,solids_pct: 100, au_g_t: 28000 },
];

// ─── Simulation Runs ─────────────────────────────────────────────────────────

export const MOCK_SIM_RUNS: SimRun[] = [
  { id: 'r1', timestamp: '2025-03-15 14:22', scenario: 'Base Case',         recovery_pct: 91.2, throughput_tph: 200, energy_kwh_t: 18.4, reagent_kg_t: 1.32, annual_oz: 165800, status: 'completed' },
  { id: 'r2', timestamp: '2025-03-15 15:40', scenario: 'Optimisé P80=75µm', recovery_pct: 92.8, throughput_tph: 195, energy_kwh_t: 19.8, reagent_kg_t: 1.41, annual_oz: 163200, status: 'completed' },
  { id: 'r3', timestamp: '2025-03-16 09:11', scenario: 'Haute teneur +25%', recovery_pct: 90.5, throughput_tph: 200, energy_kwh_t: 18.4, reagent_kg_t: 1.32, annual_oz: 204500, status: 'completed' },
  { id: 'r4', timestamp: '2025-03-16 11:33', scenario: 'Débit max 220 t/h',  recovery_pct: 89.1, throughput_tph: 220, energy_kwh_t: 19.1, reagent_kg_t: 1.45, annual_oz: 175800, status: 'completed' },
  { id: 'r5', timestamp: '2025-03-17 08:05', scenario: 'NSGA-II Pareto',    recovery_pct: 93.1, throughput_tph: 198, energy_kwh_t: 20.2, reagent_kg_t: 1.38, annual_oz: 166200, status: 'completed' },
];

// ─── CAPEX Lines ─────────────────────────────────────────────────────────────

export function getCapexLines(target_tph: number): CapexLine[] {
  const base = target_tph * 40000; // USD per daily tonne ~rough estimate
  const daily = target_tph * 24;
  const total = daily * 40000 / 1_000_000; // M USD
  return [
    { category: 'Mines & Développement',  description: 'Exploitation minière, galeries, voies',  value_musd: total * 0.06, pct: 6 },
    { category: 'Préparation du minerai', description: 'Concassage & broyage',                    value_musd: total * 0.18, pct: 18 },
    { category: 'Traitement procédé',     description: 'CIL/CIP, ADR, Électrolyse',               value_musd: total * 0.22, pct: 22 },
    { category: 'Infrastructures',        description: 'Power, eau, routes, bâtiments',            value_musd: total * 0.15, pct: 15 },
    { category: 'Ingénierie & EPCM',      description: 'Études, construction, gestion projet',     value_musd: total * 0.14, pct: 14 },
    { category: 'Contingence (15%)',      description: 'Réserve projet',                           value_musd: total * 0.12, pct: 12 },
    { category: 'Gestion résidus TSF',    description: 'Parc à résidus & eau',                     value_musd: total * 0.08, pct: 8 },
    { category: 'Divers & Mobilisation',  description: 'Camp, logistique, démarrage',              value_musd: total * 0.05, pct: 5 },
  ];
}

// ─── OPEX Lines ──────────────────────────────────────────────────────────────

export function getOpexLines(target_tph: number): OpexLine[] {
  return [
    { category: 'Main-d\'œuvre',    value_usd_t:  8.2, pct: 28, color: '#5BA4F5' },
    { category: 'Énergie',          value_usd_t:  6.8, pct: 23, color: '#F59E0B' },
    { category: 'Réactifs',         value_usd_t:  5.4, pct: 18, color: '#2ECC8A' },
    { category: 'Mobile / Diesel',  value_usd_t:  3.9, pct: 13, color: '#F06B6B' },
    { category: 'Maintenance',      value_usd_t:  3.2, pct: 11, color: '#9D78F0' },
    { category: 'G&A',             value_usd_t:  2.1, pct: 7,  color: '#F88A44' },
  ];
}

// ─── Stage Gates ─────────────────────────────────────────────────────────────

export const STAGE_GATES: StageGate[] = [
  {
    id: 'sg0',
    name: 'Gate 0 — Scoping',
    phase: 'SCOPING',
    status: 'completed',
    completion_pct: 100,
    checklist: [
      { id: 'c0_1', label: 'Cartographie minérale initiale', completed: true, required: true },
      { id: 'c0_2', label: 'Estimation ressource préliminaire', completed: true, required: true },
      { id: 'c0_3', label: 'Étude de scoping ±50%', completed: true, required: true },
      { id: 'c0_4', label: 'Permis environnemental phase 1', completed: true, required: false },
    ],
  },
  {
    id: 'sg1',
    name: 'Gate 1 — Pré-faisabilité',
    phase: 'PRE-FEASIBILITY',
    status: 'completed',
    completion_pct: 100,
    checklist: [
      { id: 'c1_1', label: 'Programme LIMS ≥ 50 échantillons', completed: true, required: true },
      { id: 'c1_2', label: 'Essais GRG et CIL confirmés', completed: true, required: true },
      { id: 'c1_3', label: 'Études comminution BWI/SPI', completed: true, required: true },
      { id: 'c1_4', label: 'Flowsheet conceptuel validé', completed: true, required: true },
      { id: 'c1_5', label: 'Estimation CAPEX ±30%', completed: true, required: true },
    ],
  },
  {
    id: 'sg2',
    name: 'Gate 2 — Faisabilité',
    phase: 'FEASIBILITY',
    status: 'active',
    completion_pct: 64,
    checklist: [
      { id: 'c2_1', label: 'Bilan massique et eau validé', completed: true, required: true },
      { id: 'c2_2', label: 'Dimensionnement équipements', completed: true, required: true },
      { id: 'c2_3', label: 'Simulation procédé (SimPro)', completed: true, required: true },
      { id: 'c2_4', label: 'Modèle économique CAPEX ±15%', completed: false, required: true },
      { id: 'c2_5', label: 'Registre risques ≥ 20 items', completed: false, required: true },
      { id: 'c2_6', label: 'Rapport NI 43-101 technique', completed: false, required: true },
      { id: 'c2_7', label: 'Études géotechniques complètes', completed: false, required: false },
    ],
  },
  {
    id: 'sg3',
    name: 'Gate 3 — BFS',
    phase: 'BFS',
    status: 'locked',
    completion_pct: 0,
    checklist: [
      { id: 'c3_1', label: 'Étude de faisabilité bankable', completed: false, required: true },
      { id: 'c3_2', label: 'ESIA complète', completed: false, required: true },
      { id: 'c3_3', label: 'Financement structuré', completed: false, required: true },
      { id: 'c3_4', label: 'Décision Investissement (FID)', completed: false, required: true },
    ],
  },
  {
    id: 'sg4',
    name: 'Gate 4 — DFS',
    phase: 'DFS',
    status: 'locked',
    completion_pct: 0,
    checklist: [
      { id: 'c4_1', label: 'Plans EPCM 90% complets', completed: false, required: true },
      { id: 'c4_2', label: 'Commandes équipements LLI', completed: false, required: true },
      { id: 'c4_3', label: 'Plan de démarrage approuvé', completed: false, required: true },
    ],
  },
];

// ─── Mock LIMS Data (used if project has no DB samples yet) ─────────────────

export const MOCK_LIMS_DATA = [
  { sample_id: 'KMG-001', campaign: 'C1', domain: 'Oxyde', test_type: 'GRG',  result_value: 68.2, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-002', campaign: 'C1', domain: 'Oxyde', test_type: 'CIL',  result_value: 91.5, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-003', campaign: 'C1', domain: 'Trans', test_type: 'CIL',  result_value: 88.3, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-004', campaign: 'C1', domain: 'Trans', test_type: 'BWI',  result_value: 14.2, result_unit: 'kWh/t',   status: 'passed'  as const },
  { sample_id: 'KMG-005', campaign: 'C1', domain: 'Sulfure',test_type: 'CIL', result_value: 62.1, result_unit: '%',       status: 'flagged' as const },
  { sample_id: 'KMG-006', campaign: 'C1', domain: 'Sulfure',test_type: 'FLOAT',result_value: 78.4, result_unit: '%',      status: 'passed'  as const },
  { sample_id: 'KMG-007', campaign: 'C2', domain: 'Oxyde', test_type: 'GRG',  result_value: 71.0, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-008', campaign: 'C2', domain: 'Oxyde', test_type: 'CIL',  result_value: 93.2, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-009', campaign: 'C2', domain: 'Trans', test_type: 'BWI',  result_value: 13.8, result_unit: 'kWh/t',   status: 'passed'  as const },
  { sample_id: 'KMG-010', campaign: 'C2', domain: 'Trans', test_type: 'SAG',  result_value: 28.5, result_unit: 'kWh/t',   status: 'passed'  as const },
  { sample_id: 'KMG-011', campaign: 'C2', domain: 'Sulfure',test_type: 'POX', result_value: 85.6, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-012', campaign: 'C2', domain: 'Sulfure',test_type: 'CIL', result_value: 58.9, result_unit: '%',       status: 'failed'  as const },
  { sample_id: 'KMG-013', campaign: 'C3', domain: 'Oxyde', test_type: 'CIL',  result_value: 90.8, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-014', campaign: 'C3', domain: 'Trans', test_type: 'GRG',  result_value: 45.2, result_unit: '%',       status: 'passed'  as const },
  { sample_id: 'KMG-015', campaign: 'C3', domain: 'Oxyde', test_type: 'BWI',  result_value: 12.9, result_unit: 'kWh/t',   status: 'passed'  as const },
];

// ─── Default equipment catalog for new projects ──────────────────────────────

export const DEFAULT_EQUIPMENT = [
  { tag: 'CR-001', name: 'Concasseur giratoire primaire',  category: 'Comminution',  sub_category: 'Concassage',  capacity: 200,  capacity_unit: 't/h',   power_kw: 375,  status: 'proposed' as const },
  { tag: 'CR-002', name: 'Concasseur à cône secondaire',   category: 'Comminution',  sub_category: 'Concassage',  capacity: 150,  capacity_unit: 't/h',   power_kw: 220,  status: 'proposed' as const },
  { tag: 'MI-001', name: 'Broyeur SAG Ø7.3×3.7m',         category: 'Comminution',  sub_category: 'Broyage',     capacity: 200,  capacity_unit: 't/h',   power_kw: 3700, status: 'proposed' as const },
  { tag: 'MI-002', name: 'Broyeur à billes Ø5.5×8.5m',    category: 'Comminution',  sub_category: 'Broyage',     capacity: 180,  capacity_unit: 't/h',   power_kw: 2800, status: 'proposed' as const },
  { tag: 'CY-001', name: 'Batterie cyclones (12 x Ø500)',  category: 'Classification',sub_category: 'Cyclones',   capacity: 200,  capacity_unit: 't/h',   power_kw: 0,    status: 'proposed' as const },
  { tag: 'KN-001', name: 'Concentrateur Knelson CVD-42',   category: 'Gravimétrie',  sub_category: 'Knelson',     capacity: 50,   capacity_unit: 't/h',   power_kw: 11,   status: 'proposed' as const },
  { tag: 'CIL-001',name: 'Cuve CIL No.1 — Ø9×12m',       category: 'Lixiviation',  sub_category: 'CIL',         capacity: 750,  capacity_unit: 'm³',    power_kw: 55,   status: 'proposed' as const },
  { tag: 'CIL-002',name: 'Cuve CIL No.2 — Ø9×12m',       category: 'Lixiviation',  sub_category: 'CIL',         capacity: 750,  capacity_unit: 'm³',    power_kw: 55,   status: 'proposed' as const },
  { tag: 'CIL-003',name: 'Cuve CIL No.3 — Ø9×12m',       category: 'Lixiviation',  sub_category: 'CIL',         capacity: 750,  capacity_unit: 'm³',    power_kw: 55,   status: 'proposed' as const },
  { tag: 'CIL-004',name: 'Cuve CIL No.4 — Ø9×12m',       category: 'Lixiviation',  sub_category: 'CIL',         capacity: 750,  capacity_unit: 'm³',    power_kw: 55,   status: 'proposed' as const },
  { tag: 'CIL-005',name: 'Cuve CIL No.5 — Ø9×12m',       category: 'Lixiviation',  sub_category: 'CIL',         capacity: 750,  capacity_unit: 'm³',    power_kw: 55,   status: 'proposed' as const },
  { tag: 'CIL-006',name: 'Cuve CIL No.6 — Ø9×12m',       category: 'Lixiviation',  sub_category: 'CIL',         capacity: 750,  capacity_unit: 'm³',    power_kw: 55,   status: 'proposed' as const },
  { tag: 'EL-001', name: 'Colonne d\'élution AARL',        category: 'ADR',          sub_category: 'Élution',     capacity: 2000, capacity_unit: 'kg C',  power_kw: 75,   status: 'proposed' as const },
  { tag: 'EW-001', name: 'Cellule d\'électrolyse',         category: 'ADR',          sub_category: 'Électrolyse', capacity: 12,   capacity_unit: 'cellules',power_kw: 90, status: 'proposed' as const },
  { tag: 'SM-001', name: 'Four de fusion 250 kg/batch',    category: 'ADR',          sub_category: 'Fusion',      capacity: 250,  capacity_unit: 'kg/batch',power_kw: 45, status: 'proposed' as const },
  { tag: 'TK-001', name: 'Épaississeur Ø18m',              category: 'Déshydratation',sub_category: 'Épaississ.', capacity: 18,   capacity_unit: 'm diam', power_kw: 15,  status: 'proposed' as const },
];

// ─── Activity feed items ─────────────────────────────────────────────────────

export const MOCK_ACTIVITIES = [
  { time: 'Il y a 2h',    user: 'M. Kofi',   action: 'a soumis le bilan massique v3.1 pour validation', type: 'update' },
  { time: 'Il y a 4h',    user: 'R. Mensah',  action: 'a complété les essais GRG de la campagne C3',      type: 'success' },
  { time: 'Hier 15:30',   user: 'SimPro',    action: 'Simulation NSGA-II terminée — Pareto 12 solutions', type: 'info' },
  { time: 'Hier 11:20',   user: 'P. Asante', action: 'a ajouté 3 nouveaux risques au registre',           type: 'warning' },
  { time: '2j ago',       user: 'B. Owusu',  action: 'Rapport NI 43-101 section 13 mise à jour',          type: 'update' },
  { time: '3j ago',       user: 'Système',   action: 'Gate 1 (Pré-faisabilité) validé — 5/5 critères',    type: 'success' },
];
