// ─────────────────────────────────────────────────────────────────────────────
// Bibliothèque d'équipements du flowsheet — données PURES, partagées.
//
// Le constructeur (page Flowsheet) et les modèles de circuit
// (./circuitTemplates) doivent parler du MÊME jeu de codes : un modèle qui
// référencerait un code absent d'ici produirait un nœud sans symbole ni
// couleur sur le canvas. La contrainte est vérifiée par les tests.
//
// Aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

export interface EquipDef {
  code: string;
  name: string;
  abbrev: string;
}

export interface EquipGroup {
  group: string;
  color: string;
  items: EquipDef[];
}

export const EQUIPMENT_LIBRARY: EquipGroup[] = [
  {
    group: 'Alimentation',
    color: '#F59E0B',
    items: [
      { code: 'FEED_ROM',      name: 'ROM Pad',                     abbrev: 'ROM'  },
      { code: 'FEED_COB',      name: 'Bac minerai brut (COB)',       abbrev: 'COB'  },
      { code: 'FEED_APRON',    name: 'Alimentateur tablier',         abbrev: 'APR'  },
      { code: 'FEED_SURGE',    name: 'Silo tampon',                  abbrev: 'SILO' },
      { code: 'CONV_BELT',     name: 'Convoyeur à bande',            abbrev: 'CONV' },
      { code: 'FEED_STACKER',  name: 'Empileur / Récupérateur',      abbrev: 'STCK' },
    ],
  },
  {
    group: 'Concassage',
    color: '#5BA4F5',
    items: [
      { code: 'CRUSH_GYRATORY',  name: 'Concasseur giratoire',       abbrev: 'GYR'  },
      { code: 'CRUSH_JAW',       name: 'Concasseur à mâchoires',     abbrev: 'JAW'  },
      { code: 'CRUSH_CONE_SEC',  name: 'Cône secondaire',            abbrev: 'SEC'  },
      { code: 'CRUSH_CONE_TER',  name: 'Cône tertiaire',             abbrev: 'TER'  },
      { code: 'CRUSH_HPGR',      name: 'HPGR',                      abbrev: 'HPGR' },
      { code: 'CRUSH_IMPACT',    name: "Concasseur à impact (VSI)",  abbrev: 'VSI'  },
      { code: 'CRUSH_PEBBLE',    name: 'Concasseur de galets',       abbrev: 'PEB'  },
      { code: 'CRUSH_ROLL',      name: 'Concasseur à rouleaux',      abbrev: 'ROLL' },
      { code: 'SCREEN_VIB',      name: 'Crible vibrant',             abbrev: 'SCR'  },
      { code: 'SCREEN_BANANA',   name: 'Crible banane',              abbrev: 'BSCR' },
    ],
  },
  {
    group: 'Broyage',
    color: '#A78BFA',
    items: [
      { code: 'MILL_SAG',       name: 'Broyeur SAG',                abbrev: 'SAG'  },
      { code: 'MILL_AG',        name: 'Broyeur AG',                 abbrev: 'AG'   },
      { code: 'MILL_BALL',      name: 'Broyeur à billes',           abbrev: 'BALL' },
      { code: 'MILL_ROD',       name: 'Broyeur à barres',           abbrev: 'ROD'  },
      { code: 'MILL_VERTIMILL', name: 'Vertimill',                  abbrev: 'VERT' },
      { code: 'MILL_ISAMILL',   name: 'IsaMill',                    abbrev: 'ISA'  },
      { code: 'MILL_TOWER',     name: 'Broyeur tour (Tower Mill)',   abbrev: 'TOWR' },
      { code: 'MILL_STIRRED',   name: 'Broyeur agité SMD',          abbrev: 'SMD'  },
    ],
  },
  {
    group: 'Classification',
    color: '#F88A44',
    items: [
      { code: 'CLASSIF_CYCL',   name: 'Batterie hydrocyclones',     abbrev: 'CYCL' },
      { code: 'SCREEN_TROMMEL', name: 'Trommel',                    abbrev: 'TROM' },
      { code: 'SCREEN_DSM',     name: 'Tamis DSM',                  abbrev: 'DSM'  },
      { code: 'CLASSIF_SPIRAL', name: 'Classificateur à spirale',   abbrev: 'SPIR' },
      { code: 'CLASSIF_RAKE',   name: 'Classificateur râteau',      abbrev: 'RAKE' },
    ],
  },
  {
    group: 'Gravimétrie',
    color: '#14B8A6',
    items: [
      { code: 'GRAV_KNELSON',  name: 'Knelson CVD',                abbrev: 'KNL'  },
      { code: 'GRAV_FALCON',   name: 'Falcon SB',                  abbrev: 'FAL'  },
      { code: 'GRAV_TABLE',    name: 'Table Gemeni GT-300',         abbrev: 'TBL'  },
      { code: 'GRAV_JIG',      name: 'Jig Kelsey',                 abbrev: 'JIG'  },
      { code: 'GRAV_SPIRAL',   name: 'Spirale concentratrice',     abbrev: 'SPR'  },
      { code: 'GRAV_ILR',      name: 'Réacteur ILR (intensif)',    abbrev: 'ILR'  },
      { code: 'GRAV_KACHA',    name: 'Gold Kacha',                 abbrev: 'GKA'  },
    ],
  },
  {
    group: 'Flottation',
    color: '#34D399',
    items: [
      { code: 'FLOAT_MECH',    name: 'Cellule mécanique',          abbrev: 'FLT'  },
      { code: 'FLOAT_COLUMN',  name: 'Flottation colonne',         abbrev: 'FCOL' },
      { code: 'FLOAT_FLASH',   name: 'Flash Flotation',            abbrev: 'FF'   },
      { code: 'FLOAT_JAMESON', name: 'Cellule Jameson',            abbrev: 'JAM'  },
      { code: 'FLOAT_ROUGH',   name: 'Banque rougher (ébauchage)', abbrev: 'RGHF' },
      { code: 'FLOAT_CLEAN',   name: 'Cellules épurage (cleaner)', abbrev: 'CLN'  },
    ],
  },
  {
    group: 'Séparation S/L',
    color: '#60A5FA',
    items: [
      { code: 'THCK_CONV',      name: 'Épaississeur conventionnel', abbrev: 'THCK' },
      { code: 'THCK_HIRATE',    name: 'Épaississeur haute capacité',abbrev: 'HRT'  },
      { code: 'THCK_PASTE',     name: 'Épaississeur pâte',          abbrev: 'PSTE' },
      { code: 'FILT_BELT',      name: 'Filtre à bande',             abbrev: 'BFLT' },
      { code: 'FILT_PRESS',     name: 'Filtre presse',              abbrev: 'FPRS' },
      { code: 'FILT_DISC',      name: 'Filtre à disques',           abbrev: 'DFLT' },
      { code: 'FILT_CENTRIFUGE',name: 'Centrifugeuse',              abbrev: 'CENT' },
    ],
  },
  {
    group: 'Lixiviation',
    color: '#FCD34D',
    items: [
      { code: 'CIL_TANK',      name: 'Cuve CIL',                  abbrev: 'CIL'  },
      { code: 'CIP_TANK',      name: 'Cuve CIP',                  abbrev: 'CIP'  },
      { code: 'LEACH_TANK',    name: 'Cuve lixiviation agitée',   abbrev: 'LCH'  },
      { code: 'LEACH_HEAP',    name: 'Heap Leach Pad',            abbrev: 'HL'   },
      { code: 'AGGLOM',        name: 'Agglomérateur',             abbrev: 'AGL'  },
      { code: 'SCREEN_INTER',  name: 'Tamis interstade CIP',      abbrev: 'ISTR' },
      { code: 'PLS_POND',      name: 'Bassin PLS',                abbrev: 'PLS'  },
    ],
  },
  {
    group: 'Oxydation (Réfractaire)',
    color: '#F87171',
    items: [
      { code: 'OX_AUTOCLAVE',  name: 'Autoclave POX / HPOX',      abbrev: 'POX'  },
      { code: 'OX_ROASTER',    name: 'Four rôtissoire',            abbrev: 'ROST' },
      { code: 'OX_BIOX',       name: 'Réacteurs BIOX',            abbrev: 'BIOX' },
      { code: 'OX_ALBION',     name: 'Procédé Albion',            abbrev: 'ALB'  },
      { code: 'OX_NITROX',     name: 'Procédé NITROX',            abbrev: 'NITR' },
      { code: 'NEUT_TANK',     name: 'Cuve neutralisation',       abbrev: 'NEUT' },
    ],
  },
  {
    group: 'ADR / Finition',
    color: '#FBBF24',
    items: [
      { code: 'ADR_COLUMN',         name: 'Colonnes ADR (carbone)',      abbrev: 'ADR'  },
      { code: 'ADR_ELUTION_AARL',   name: 'Colonne élution AARL',        abbrev: 'AARL' },
      { code: 'ADR_ELUTION_ZADRA',  name: 'Colonne élution ZADRA',       abbrev: 'ZADR' },
      { code: 'ADR_EW',             name: 'Cellule électrolyse (EW)',     abbrev: 'EW'   },
      { code: 'ADR_FURNACE',        name: 'Four à induction',            abbrev: 'FURN' },
      { code: 'ADR_RETORT',         name: 'Cornue (retort Hg)',           abbrev: 'RET'  },
      { code: 'ADR_KILN',           name: 'Four régénération carbone',    abbrev: 'KILN' },
      { code: 'ADR_DORE',           name: 'Moule doré',                  abbrev: 'DOR'  },
      { code: 'MC_MERRILL',         name: 'Merrill-Crowe',               abbrev: 'MC'   },
    ],
  },
  {
    group: 'Résidus / Eau',
    color: '#56657A',
    items: [
      { code: 'TAILS_TSF',    name: 'Parc à résidus (TSF)',         abbrev: 'TSF'  },
      { code: 'TAILS_DRY',    name: 'Résidus filtrés — Dry Stack',  abbrev: 'DRST' },
      { code: 'TAILS_PASTE',  name: 'Résidus en pâte',              abbrev: 'PSTS' },
      { code: 'WT_DETOX',     name: 'Détoxification SO₂/air',       abbrev: 'DETX' },
      { code: 'WT_EFFLUENT',  name: 'Traitement effluents',         abbrev: 'EFFT' },
      { code: 'WT_POND',      name: 'Bassin eau récupérée',         abbrev: 'POND' },
    ],
  },
];

// Flat map for quick lookup
export const EQUIP_MAP: Record<string, { abbrev: string; color: string; group: string }> = {};
EQUIPMENT_LIBRARY.forEach(g => {
  g.items.forEach(item => {
    EQUIP_MAP[item.code] = { abbrev: item.abbrev, color: g.color, group: g.group };
  });
});

export function getCfg(code: string) {
  return EQUIP_MAP[code] ?? { abbrev: code.slice(0, 4), color: '#7F8DA3', group: 'Autre' };
}

/** Nom catalogue par code — libellé par défaut d'un nœud posé sur le canvas. */
export const FS_NAME_BY_CODE: Record<string, string> = {};
EQUIPMENT_LIBRARY.forEach(g => g.items.forEach(it => { FS_NAME_BY_CODE[it.code] = it.name; }));

/** Familles de flux d'un PFD — couleur et pointillé par type de ligne. */
export type StreamType = 'process' | 'water' | 'reagent' | 'air' | 'pregnant' | 'recycle';

export const STREAM_TYPES: Record<StreamType, { label: string; color: string; dash?: string }> = {
  process:  { label: 'Procédé',        color: '#8FA6C4' },
  water:    { label: 'Eau de procédé', color: '#38BDF8', dash: '5 3' },
  reagent:  { label: 'Réactif',        color: '#F59E0B', dash: '2 3' },
  air:      { label: 'Air',            color: '#F87171', dash: '1 4' },
  pregnant: { label: 'Solution mère',  color: '#34D399' },
  recycle:  { label: 'Recyclage',      color: '#A78BFA', dash: '6 4' },
};
