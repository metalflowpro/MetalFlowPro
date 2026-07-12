import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  MousePointer2, Link2, Trash2, LayoutGrid, Save,
  FolderOpen, Plus, X, Search, BarChart3, GitCompare,
  Network, CheckCircle2, AlertTriangle, ChevronDown, Sparkles,
  Image as ImageIcon, Upload,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { FLOWSHEET_TEMPLATES } from '../data/mockData';
import type { Project } from '../types';

// ─── Equipment library ────────────────────────────────────────────────────────

interface EquipDef {
  code: string;
  name: string;
  abbrev: string;
}

interface EquipGroup {
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
const EQUIP_MAP: Record<string, { abbrev: string; color: string; group: string }> = {};
EQUIPMENT_LIBRARY.forEach(g => {
  g.items.forEach(item => {
    EQUIP_MAP[item.code] = { abbrev: item.abbrev, color: g.color, group: g.group };
  });
});

function getCfg(code: string) {
  return EQUIP_MAP[code] ?? { abbrev: code.slice(0, 4), color: '#7F8DA3', group: 'Autre' };
}

// Pictorial equipment symbol per process family (PFD-style icons), drawn in a 24×24 box.
function EquipIcon({ group, color, size = 22 }: { group: string; color: string; size?: number }) {
  const s = { stroke: color, strokeWidth: 1.6, fill: 'none', strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const fill = { fill: color, fillOpacity: 0.18, stroke: color, strokeWidth: 1.4 };
  let body: React.ReactNode;
  switch (group) {
    case 'Alimentation':                                   // silo / hopper
      body = <><path d="M5 5 h14 l-4 9 v5 h-6 v-5 z" {...fill} /><path d="M9 19 h6" {...s} /></>; break;
    case 'Concassage':                                     // crusher (funnel + jaws)
      body = <><path d="M4 5 h16 l-5 7 v3 h-6 v-3 z" {...fill} /><path d="M9 15 l3 4 3-4" {...s} /></>; break;
    case 'Broyage':                                        // mill (horizontal cylinder)
      body = <><rect x="3" y="8" width="18" height="8" rx="4" {...fill} /><line x1="7" y1="8" x2="7" y2="16" {...s} /><line x1="17" y1="8" x2="17" y2="16" {...s} /></>; break;
    case 'Classification':                                 // hydrocyclone (inverted cone)
      body = <><path d="M6 5 h12 l-1 4 -5 10 -5-10 z" {...fill} /><path d="M12 5 v3" {...s} /></>; break;
    case 'Gravimétrie':                                    // conical concentrator
      body = <><path d="M6 6 h12 l-6 13 z" {...fill} /><circle cx="12" cy="9" r="1.4" fill={color} /></>; break;
    case 'Flottation':                                     // flotation cell (tank + impeller shaft + froth)
      body = <><rect x="4" y="8" width="16" height="10" rx="1.5" {...fill} /><path d="M4 8 q4 -3 8 0 t8 0" {...s} /><line x1="12" y1="9" x2="12" y2="17" {...s} /></>; break;
    case 'Séparation S/L':                                 // thickener (cone tank + rake)
      body = <><path d="M4 6 h16 v3 l-8 10 -8-10 z" {...fill} /><line x1="12" y1="6" x2="12" y2="14" {...s} /><line x1="8" y1="10" x2="16" y2="10" {...s} /></>; break;
    case 'Lixiviation':                                    // agitated leach/CIP tank
      body = <><rect x="5" y="7" width="14" height="12" rx="1.5" {...fill} /><line x1="12" y1="4" x2="12" y2="16" {...s} /><path d="M9 16 h6" {...s} /></>; break;
    case 'Oxydation (Réfractaire)':                        // autoclave (horizontal vessel)
      body = <><rect x="3" y="9" width="18" height="7" rx="3.5" {...fill} /><line x1="12" y1="6" x2="12" y2="9" {...s} /></>; break;
    case 'ADR / Finition':                                 // column / EW cell
      body = <><rect x="8" y="4" width="8" height="16" rx="1.5" {...fill} /><line x1="8" y1="9" x2="16" y2="9" {...s} /><line x1="8" y1="14" x2="16" y2="14" {...s} /></>; break;
    case 'Résidus / Eau':                                  // pond / TSF
      body = <><path d="M4 9 h16 l-2 9 h-12 z" {...fill} /><path d="M6 12 q3 -1.5 6 0 t6 0" {...s} /></>; break;
    default:
      body = <rect x="5" y="6" width="14" height="12" rx="2" {...fill} />;
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>{body}</svg>;
}

// Maps a Design-Criteria equipment id to a flowsheet library code + a process sequence,
// so a flowsheet can be auto-generated from the criteria the project already defines.
const CRITERIA_TO_FS: Record<string, { code: string; seq: number }> = {
  reclaim: { code: 'FEED_STACKER', seq: 5 }, stockpile: { code: 'FEED_SURGE', seq: 6 },
  apron: { code: 'FEED_APRON', seq: 7 }, conveyor: { code: 'CONV_BELT', seq: 8 },
  silo: { code: 'FEED_SURGE', seq: 9 }, grizzly: { code: 'SCREEN_VIB', seq: 10 },
  gyratory: { code: 'CRUSH_GYRATORY', seq: 20 }, jaw: { code: 'CRUSH_JAW', seq: 21 },
  scalp_screen: { code: 'SCREEN_VIB', seq: 22 }, cone: { code: 'CRUSH_CONE_SEC', seq: 23 },
  double_deck: { code: 'SCREEN_VIB', seq: 24 }, single_deck: { code: 'SCREEN_VIB', seq: 25 },
  banana_screen: { code: 'SCREEN_BANANA', seq: 26 }, hpgr: { code: 'CRUSH_HPGR', seq: 27 },
  wet_screen_hpgr: { code: 'SCREEN_BANANA', seq: 28 }, pebble_crusher: { code: 'CRUSH_PEBBLE', seq: 29 },
  sag: { code: 'MILL_SAG', seq: 40 }, ag: { code: 'MILL_AG', seq: 41 }, rod: { code: 'MILL_ROD', seq: 42 },
  ball: { code: 'MILL_BALL', seq: 43 }, trommels: { code: 'SCREEN_TROMMEL', seq: 44 },
  hydrocyclone: { code: 'CLASSIF_CYCL', seq: 50 }, deslime: { code: 'CLASSIF_CYCL', seq: 51 },
  vertimill: { code: 'MILL_VERTIMILL', seq: 55 }, isamill: { code: 'MILL_ISAMILL', seq: 56 }, towermill: { code: 'MILL_TOWER', seq: 57 },
  gravity: { code: 'GRAV_KNELSON', seq: 60 }, intensive_leach: { code: 'GRAV_ILR', seq: 61 },
  flash_flot: { code: 'FLOAT_FLASH', seq: 65 }, flotation: { code: 'FLOAT_MECH', seq: 70 }, column_flot: { code: 'FLOAT_COLUMN', seq: 71 },
  pox: { code: 'OX_AUTOCLAVE', seq: 80 }, roasting: { code: 'OX_ROASTER', seq: 81 }, biox: { code: 'OX_BIOX', seq: 82 }, albion: { code: 'OX_ALBION', seq: 83 },
  preleach_thickener: { code: 'THCK_CONV', seq: 88 }, trash_screen: { code: 'SCREEN_INTER', seq: 89 },
  cil: { code: 'CIL_TANK', seq: 90 }, heap_leach: { code: 'LEACH_HEAP', seq: 91 }, interstage_screens: { code: 'SCREEN_INTER', seq: 92 },
  adr: { code: 'ADR_COLUMN', seq: 100 }, carbon_reg: { code: 'ADR_KILN', seq: 102 }, merrill_crowe: { code: 'MC_MERRILL', seq: 103 }, smelt: { code: 'ADR_FURNACE', seq: 104 },
  thickener: { code: 'THCK_HIRATE', seq: 110 }, filter: { code: 'FILT_PRESS', seq: 111 },
  tailings: { code: 'TAILS_TSF', seq: 120 }, dry_stack: { code: 'TAILS_DRY', seq: 121 },
  detox: { code: 'WT_DETOX', seq: 122 }, water_treat: { code: 'WT_EFFLUENT', seq: 123 }, effluent: { code: 'WT_EFFLUENT', seq: 124 }, sart: { code: 'WT_EFFLUENT', seq: 125 },
};

// Fallback standard oxide-gold circuit when the project has no active criteria yet.
const DEFAULT_CIRCUIT = ['FEED_ROM', 'CRUSH_GYRATORY', 'SCREEN_VIB', 'MILL_SAG', 'CLASSIF_CYCL', 'MILL_BALL', 'GRAV_KNELSON', 'CIL_TANK', 'ADR_COLUMN', 'THCK_HIRATE', 'TAILS_TSF'];

const FS_NAME_BY_CODE: Record<string, string> = {};
EQUIPMENT_LIBRARY.forEach(g => g.items.forEach(it => { FS_NAME_BY_CODE[it.code] = it.name; }));

// ─── Canvas types ─────────────────────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  equipCode: string;
  tag: string;
  label: string;
  x: number;
  y: number;
}

export type StreamType = 'process' | 'water' | 'reagent' | 'air' | 'pregnant' | 'recycle';

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type?: StreamType;
}

// Stream families (PFD legend) — colour + dash pattern per line type.
const STREAM_TYPES: Record<StreamType, { label: string; color: string; dash?: string }> = {
  process:  { label: 'Procédé',        color: '#8FA6C4' },
  water:    { label: 'Eau de procédé', color: '#38BDF8', dash: '5 3' },
  reagent:  { label: 'Réactif',        color: '#F59E0B', dash: '2 3' },
  air:      { label: 'Air',            color: '#F87171', dash: '1 4' },
  pregnant: { label: 'Solution mère',  color: '#34D399' },
  recycle:  { label: 'Recyclage',      color: '#A78BFA', dash: '6 4' },
};

type Mode = 'select' | 'connect' | 'delete';

const NODE_W = 138;
const NODE_H = 56;
const CANVAS_W = 2200;
const CANVAS_H = 1000;

// ─── Auto-layout ──────────────────────────────────────────────────────────────

function autoLayout(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  if (nodes.length === 0) return nodes;

  const childMap = new Map<string, string[]>();
  const indegree  = new Map<string, number>();
  nodes.forEach(n => { childMap.set(n.id, []); indegree.set(n.id, 0); });
  edges.forEach(e => {
    childMap.get(e.from)?.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  });

  const depth = new Map<string, number>();
  const queue = nodes
    .filter(n => (indegree.get(n.id) ?? 0) === 0)
    .map(n => ({ id: n.id, d: 0 }));

  if (queue.length === 0) {
    nodes.forEach((n, i) => depth.set(n.id, i));
  } else {
    while (queue.length) {
      const { id, d } = queue.shift()!;
      if ((depth.get(id) ?? -1) >= d) continue;
      depth.set(id, d);
      childMap.get(id)?.forEach(c => queue.push({ id: c, d: d + 1 }));
    }
    nodes.forEach(n => { if (!depth.has(n.id)) depth.set(n.id, 0); });
  }

  const cols = new Map<number, CanvasNode[]>();
  nodes.forEach(n => {
    const d = depth.get(n.id) ?? 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(n);
  });

  const COL_W = 185, ROW_H = 86;
  return nodes.map(n => {
    const d    = depth.get(n.id) ?? 0;
    const col  = cols.get(d)!;
    const row  = col.findIndex(x => x.id === n.id);
    const startY = Math.max(40, 340 - (col.length * ROW_H) / 2);
    return { ...n, x: 40 + d * COL_W, y: startY + row * ROW_H };
  });
}

function getNextTag(code: string, nodes: CanvasNode[]): string {
  const abbrev = EQUIP_MAP[code]?.abbrev ?? code.slice(0, 3);
  const count  = nodes.filter(n => n.equipCode === code).length + 1;
  return `${abbrev}-${String(count).padStart(3, '0')}`;
}

// ─── Radar chart for comparison ───────────────────────────────────────────────

const RADAR_AXES   = ['Récupération', 'OPEX', 'Énergie', 'Réactifs', 'Robustesse', 'Flexibilité'];
const RADAR_COLORS = ['#F59E0B', '#14B8A6', '#5BA4F5', '#F88A44', '#A78BFA'];
const CIRCUIT_SCORES: Record<string, number[]> = {
  AU_CIL_OXIDE:   [0.92, 0.80, 0.78, 0.72, 0.90, 0.85],
  AU_GRAV_CIL:    [0.94, 0.76, 0.74, 0.70, 0.88, 0.82],
  AU_FLOAT_CIL:   [0.88, 0.68, 0.66, 0.62, 0.82, 0.78],
  HEAP_LEACH_STD: [0.74, 0.95, 0.95, 0.88, 0.72, 0.60],
  POX_REFRACTORY: [0.89, 0.50, 0.52, 0.55, 0.70, 0.65],
};

function RadarChart({ codes }: { codes: string[] }) {
  const cx = 150, cy = 150, r = 100;
  const n  = RADAR_AXES.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt    = (i: number, v: number) => ({
    x: cx + Math.cos(angle(i)) * r * v,
    y: cy + Math.sin(angle(i)) * r * v,
  });

  return (
    <svg width={300} height={300} viewBox="0 0 300 300">
      {[0.25, 0.5, 0.75, 1].map(lv => (
        <polygon key={lv}
          points={RADAR_AXES.map((_, i) => { const p = pt(i, lv); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="#1E2A3B" strokeWidth={0.8} />
      ))}
      {RADAR_AXES.map((_, i) => { const p = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#1E2A3B" strokeWidth={0.8} />; })}
      {RADAR_AXES.map((ax, i) => { const p = pt(i, 1.25); return <text key={ax} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#56657A">{ax}</text>; })}
      {codes.map((code, ci) => {
        const vals   = CIRCUIT_SCORES[code] ?? RADAR_AXES.map(() => 0.5);
        const points = vals.map((v, i) => { const p = pt(i, v); return `${p.x},${p.y}`; }).join(' ');
        const color  = RADAR_COLORS[ci % RADAR_COLORS.length];
        return (
          <g key={code}>
            <polygon points={points} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={1.5} />
            {vals.map((v, i) => { const p = pt(i, v); return <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />; })}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface FlowsheetProps { project: Project; }

interface SavedSheet { id: string; name: string; created_at: string; nodes: CanvasNode[]; edges: CanvasEdge[]; }

const TABS = ['Constructeur', 'Bilans de flux', 'Comparaison', 'Référence Visio'];
const REF_MARKER = '[REF]';
const MAX_REF_BYTES = 6 * 1024 * 1024; // ~6 MB data-url cap

export function Flowsheet({ project }: FlowsheetProps) {
  const [activeTab, setActiveTab] = useState('Constructeur');

  // ── Canvas state ──────────────────────────────────────────────────────────
  const [nodes, setNodes]         = useState<CanvasNode[]>([]);
  const [edges, setEdges]         = useState<CanvasEdge[]>([]);
  const [mode, setMode]           = useState<Mode>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [fsName, setFsName]       = useState('Nouveau flowsheet');
  const [isDirty, setIsDirty]     = useState(false);
  const [currentFsId, setCurrentFsId] = useState<string | null>(null);
  const [savedSheets, setSavedSheets] = useState<SavedSheet[]>([]);
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [search, setSearch]       = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Drag state ─────────────────────────────────────────────────────────────
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // ── Comparison state ───────────────────────────────────────────────────────
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set(['AU_CIL_OXIDE', 'AU_GRAV_CIL']));

  // ── Visio / reference-image state ──────────────────────────────────────────
  const [refImg, setRefImg] = useState<{ id: string | null; dataUrl: string; mime: string; filename: string } | null>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState('');
  const [showRefOverlay, setShowRefOverlay] = useState(false);
  const [refOpacity, setRefOpacity] = useState(0.35);
  const refInputRef = useRef<HTMLInputElement>(null);

  // ── Load saved sheets (+ the reference image row) from Supabase on mount ─────
  useEffect(() => {
    supabase
      .from('project_flowsheets')
      .select('id, name, created_at, nodes, edges')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const rows = data as SavedSheet[];
        // The reference image is stored in a marker row (name starts with [REF]).
        const refRow = rows.find(r => typeof r.name === 'string' && r.name.startsWith(REF_MARKER));
        const refNode = (refRow?.nodes as unknown as { __ref__?: boolean; dataUrl?: string; mime?: string; filename?: string }[] | undefined)?.[0];
        if (refRow && refNode?.dataUrl) {
          setRefImg({ id: refRow.id, dataUrl: refNode.dataUrl, mime: refNode.mime ?? 'image/png', filename: refNode.filename ?? 'référence' });
        }
        setSavedSheets(rows.filter(r => !(typeof r.name === 'string' && r.name.startsWith(REF_MARKER))));
      });
  }, [project.id]);

  // ── Import a Visio-exported reference (SVG / PNG / JPG / PDF) ────────────────
  const handleRefUpload = useCallback((file: File) => {
    setRefError('');
    const ok = ['image/svg+xml', 'image/png', 'image/jpeg', 'application/pdf'];
    if (!ok.includes(file.type)) { setRefError('Format non supporté. Utilisez SVG, PNG, JPG ou PDF.'); return; }
    if (file.size > MAX_REF_BYTES) { setRefError(`Fichier trop volumineux (max ${Math.round(MAX_REF_BYTES / 1024 / 1024)} Mo).`); return; }
    setRefBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      const meta = { __ref__: true, mime: file.type, filename: file.name, dataUrl };
      try {
        const name = `${REF_MARKER} ${file.name}`;
        if (refImg?.id) {
          await supabase.from('project_flowsheets').update({ name, nodes: [meta], edges: [] }).eq('id', refImg.id).eq('project_id', project.id);
          setRefImg({ id: refImg.id, dataUrl, mime: file.type, filename: file.name });
        } else {
          const { data } = await supabase.from('project_flowsheets').insert({ project_id: project.id, name, nodes: [meta], edges: [] }).select('id').maybeSingle();
          setRefImg({ id: data?.id ?? null, dataUrl, mime: file.type, filename: file.name });
        }
        setShowRefOverlay(file.type !== 'application/pdf');
      } catch {
        setRefError('Enregistrement impossible — la référence reste disponible pour cette session.');
        setRefImg({ id: null, dataUrl, mime: file.type, filename: file.name });
      } finally {
        setRefBusy(false);
      }
    };
    reader.onerror = () => { setRefBusy(false); setRefError('Lecture du fichier impossible.'); };
    reader.readAsDataURL(file);
  }, [project.id, refImg]);

  const handleRefRemove = useCallback(async () => {
    if (refImg?.id) await supabase.from('project_flowsheets').delete().eq('id', refImg.id).eq('project_id', project.id);
    setRefImg(null); setShowRefOverlay(false); setRefError('');
  }, [refImg, project.id]);

  // Mark dirty on canvas changes
  useEffect(() => { setIsDirty(true); }, [nodes, edges, fsName]);

  // ── Library filter ─────────────────────────────────────────────────────────
  const filteredLibrary = useMemo(() => {
    if (!search.trim()) return EQUIPMENT_LIBRARY;
    const q = search.toLowerCase();
    return EQUIPMENT_LIBRARY
      .map(g => ({ ...g, items: g.items.filter(i => i.name.toLowerCase().includes(q) || i.abbrev.toLowerCase().includes(q)) }))
      .filter(g => g.items.length > 0);
  }, [search]);

  // ── Add node from library ──────────────────────────────────────────────────
  const addNode = useCallback((equip: EquipDef) => {
    const tag   = getNextTag(equip.code, nodes);
    const count = nodes.length;
    const x     = 60 + (count % 8) * 160;
    const y     = 60 + Math.floor(count / 8) * 110;
    const newNode: CanvasNode = { id: `n-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, equipCode: equip.code, tag, label: equip.name, x, y };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(newNode.id);
    setActiveTab('Constructeur');
  }, [nodes]);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (mode !== 'select') return;
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
    setSelectedId(nodeId);
  }, [mode, nodes]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setNodes(prev => prev.map(n =>
      n.id === d.nodeId ? { ...n, x: Math.max(0, d.origX + dx), y: Math.max(0, d.origY + dy) } : n
    ));
  }, []);

  const handleCanvasMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // ── Node click ─────────────────────────────────────────────────────────────
  const handleNodeClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (dragRef.current) return; // ignore click at end of drag

    if (mode === 'delete') {
      setNodes(prev => prev.filter(n => n.id !== nodeId));
      setEdges(prev => prev.filter(ed => ed.from !== nodeId && ed.to !== nodeId));
      if (selectedId === nodeId) setSelectedId(null);
      return;
    }
    if (mode === 'connect') {
      if (!connectingFrom) {
        setConnectingFrom(nodeId);
      } else if (connectingFrom !== nodeId) {
        const alreadyExists = edges.some(ed => ed.from === connectingFrom && ed.to === nodeId);
        if (!alreadyExists) {
          setEdges(prev => [...prev, { id: `e-${Date.now()}`, from: connectingFrom, to: nodeId }]);
        }
        setConnectingFrom(null);
      }
      return;
    }
    setSelectedId(prev => prev === nodeId ? null : nodeId);
  }, [mode, connectingFrom, edges, selectedId]);

  // ── Edge delete click ──────────────────────────────────────────────────────
  const handleEdgeClick = useCallback((edgeId: string) => {
    if (mode === 'delete') {
      setEdges(prev => prev.filter(e => e.id !== edgeId));
    }
  }, [mode]);

  // ── Canvas background click ────────────────────────────────────────────────
  const handleCanvasClick = useCallback(() => {
    if (mode === 'connect') { setConnectingFrom(null); return; }
    setSelectedId(null);
  }, [mode]);

  // ── Auto-layout ────────────────────────────────────────────────────────────
  const handleLayout = useCallback(() => {
    setNodes(prev => autoLayout(prev, edges));
  }, [edges]);

  // ── Clear canvas ───────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    if (nodes.length === 0) return;
    if (!confirm('Effacer tout le canvas ? Cette action est irréversible.')) return;
    setNodes([]); setEdges([]); setSelectedId(null); setConnectingFrom(null);
    setCurrentFsId(null); setFsName('Nouveau flowsheet');
  }, [nodes.length]);

  // ── Auto-generate flowsheet from the project's design criteria / LIMS ────────
  const [generating, setGenerating] = useState(false);
  const generateFlowsheet = useCallback(async () => {
    setGenerating(true);
    try {
      // 1. Read the design-criteria draft (active equipment + user flow order).
      const { data } = await supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle();
      const content = (data?.content ?? {}) as { equip?: Record<string, boolean>; flowOrder?: string[] };
      const equip = content.equip ?? {};
      const flowOrder = content.flowOrder ?? [];

      // 2. Ordered list of active criteria equipment → flowsheet codes.
      const orderIndex = (id: string) => {
        const fi = flowOrder.indexOf(id);
        return fi >= 0 ? fi : 1000 + (CRITERIA_TO_FS[id]?.seq ?? 999);
      };
      const activeIds = Object.keys(CRITERIA_TO_FS)
        .filter(id => equip[id] === true)
        .sort((a, b) => orderIndex(a) - orderIndex(b));

      // 3. Dedup to one node per flowsheet code, preserving order.
      const codes: string[] = [];
      for (const id of activeIds) {
        const code = CRITERIA_TO_FS[id].code;
        if (!codes.includes(code)) codes.push(code);
      }
      // Fallback + always frame the circuit with a feed source and a tailings sink.
      let finalCodes = codes.length >= 3 ? codes : [...DEFAULT_CIRCUIT];
      if (finalCodes[0] !== 'FEED_ROM') finalCodes = ['FEED_ROM', ...finalCodes];
      if (!finalCodes.includes('TAILS_TSF') && !finalCodes.includes('TAILS_DRY')) finalCodes = [...finalCodes, 'TAILS_TSF'];

      // 4. Build nodes + a sequential chain of edges, then auto-layout.
      const built: CanvasNode[] = [];
      finalCodes.forEach((code, i) => {
        const tag = getNextTag(code, built);
        built.push({ id: `n-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`, equipCode: code, tag, label: FS_NAME_BY_CODE[code] ?? code, x: 0, y: 0 });
      });
      const built_edges: CanvasEdge[] = [];
      let ei = 0;
      const nid = (code: string) => built.find(n => n.equipCode === code)?.id;
      // Main process chain
      for (let i = 0; i < built.length - 1; i++) {
        built_edges.push({ id: `e-${Date.now()}-${ei++}`, from: built[i].id, to: built[i + 1].id, type: 'process' });
      }
      // Branch / utility streams that make the diagram read like a real PFD.
      const addEdge = (from?: string, to?: string, type?: StreamType) => {
        if (from && to && from !== to && !built_edges.some(e => e.from === from && e.to === to)) {
          built_edges.push({ id: `e-${Date.now()}-${ei++}`, from, to, type });
        }
      };
      // Grinding closed circuit: cyclone underflow recycles to the ball mill.
      addEdge(nid('CLASSIF_CYCL'), nid('MILL_BALL'), 'recycle');
      // Process-water reclaim from the tailings thickener back to grinding.
      addEdge(nid('THCK_HIRATE') ?? nid('THCK_CONV'), nid('MILL_BALL') ?? nid('MILL_SAG'), 'water');
      // Gravity concentrate → intensive leach reactor (if present).
      addEdge(nid('GRAV_KNELSON'), nid('GRAV_ILR'), 'process');
      const laid = autoLayout(built, built_edges);
      setNodes(laid);
      setEdges(built_edges);
      setSelectedId(null);
      setConnectingFrom(null);
      setCurrentFsId(null);
      setFsName(`Flowsheet auto — ${project.name}`);
      setActiveTab('Constructeur');
    } finally {
      setGenerating(false);
    }
  }, [project.id, project.name, nodes.length]);

  // ── Save flowsheet ─────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    const payload = { project_id: project.id, name: fsName, nodes, edges, updated_at: new Date().toISOString() };
    if (currentFsId) {
      await supabase.from('project_flowsheets').update(payload).eq('id', currentFsId).eq('project_id', project.id);
    } else {
      const { data } = await supabase.from('project_flowsheets').insert(payload).select('id').maybeSingle();
      if (data) {
        setCurrentFsId(data.id);
        setSavedSheets(prev => [{ id: data.id, name: fsName, created_at: new Date().toISOString(), nodes, edges }, ...prev]);
      }
    }
    setIsDirty(false);
    setSaving(false);
  }, [project.id, fsName, nodes, edges, currentFsId]);

  // ── Load flowsheet ─────────────────────────────────────────────────────────
  const handleLoad = useCallback((sheet: SavedSheet) => {
    setNodes(sheet.nodes);
    setEdges(sheet.edges);
    setFsName(sheet.name);
    setCurrentFsId(sheet.id);
    setSelectedId(null);
    setConnectingFrom(null);
    setShowLoadMenu(false);
    setIsDirty(false);
  }, []);

  // ── Selected node properties ───────────────────────────────────────────────
  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedId) ?? null, [nodes, selectedId]);

  const updateNodeProp = useCallback((prop: 'tag' | 'label', val: string) => {
    setNodes(prev => prev.map(n => n.id === selectedId ? { ...n, [prop]: val } : n));
  }, [selectedId]);

  // ── Canvas size from node positions ───────────────────────────────────────
  const canvasW = useMemo(() => nodes.length ? Math.max(CANVAS_W, Math.max(...nodes.map(n => n.x + NODE_W + 80))) : CANVAS_W, [nodes]);
  const canvasH = useMemo(() => nodes.length ? Math.max(CANVAS_H, Math.max(...nodes.map(n => n.y + NODE_H + 80))) : CANVAS_H, [nodes]);

  // ── Cursor style based on mode ────────────────────────────────────────────
  const cursor = mode === 'connect' ? (connectingFrom ? 'crosshair' : 'cell') : mode === 'delete' ? 'not-allowed' : 'default';

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100vh - 0px)' }}>
      <PageHeader
        title="Flowsheet Ingénierie"
        subtitle={`Constructeur de procédé · Bibliothèque complète — ${project.name}`}
        breadcrumb={['Design Procédé', 'Flowsheet']}
      />

      {/* Tab bar */}
      <div className="border-b border-mf-border px-6 flex gap-1 shrink-0 bg-mf-card">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-all -mb-px flex items-center gap-1.5 ${
              activeTab === t ? 'border-amber-400 text-amber-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt2'
            }`}>
            {t === 'Constructeur'    && <Network    size={13} />}
            {t === 'Bilans de flux'  && <BarChart3   size={13} />}
            {t === 'Comparaison'     && <GitCompare  size={13} />}
            {t === 'Référence Visio' && <ImageIcon   size={13} />}
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LIBRARY SIDEBAR (visible on Constructeur + Bilans) ────────── */}
        {(activeTab === 'Constructeur' || activeTab === 'Bilans de flux') && (
          <aside className="w-60 border-r border-mf-border bg-mf-card flex flex-col shrink-0 overflow-hidden">
            <div className="p-3 border-b border-mf-border">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mf-txt4" />
                <input
                  className="input-field pl-7 text-xs py-1.5 w-full"
                  placeholder="Rechercher…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredLibrary.map(g => (
                <div key={g.group}>
                  <button
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors hover:bg-mf-hover"
                    style={{ color: g.color }}
                    onClick={() => setCollapsedGroups(prev => {
                      const next = new Set(prev);
                      next.has(g.group) ? next.delete(g.group) : next.add(g.group);
                      return next;
                    })}
                  >
                    <span>{g.group}</span>
                    <ChevronDown size={11} className={`transition-transform ${collapsedGroups.has(g.group) ? '-rotate-90' : ''}`} />
                  </button>
                  {!collapsedGroups.has(g.group) && (
                    <div className="pb-1">
                      {g.items.map(item => (
                        <button
                          key={item.code}
                          onClick={() => addNode(item)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-mf-hover transition-colors group"
                        >
                          <span
                            className="shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                            style={{ color: g.color, backgroundColor: g.color + '18' }}
                          >{item.abbrev}</span>
                          <span className="text-[11px] text-mf-txt3 group-hover:text-mf-txt leading-tight truncate">{item.name}</span>
                          <Plus size={10} className="ml-auto shrink-0 text-mf-txt4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Project KPIs */}
            <div className="border-t border-mf-border p-3 space-y-1">
              {[
                ['Débit', `${project.target_tph} t/h`],
                ['Au', `${project.gold_grade_g_t} g/t`],
                ['Récup.', `${project.recovery_pct}%`],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between">
                  <span className="text-[10px] text-mf-txt4">{k}</span>
                  <span className="text-[10px] font-mono text-amber-400 font-semibold">{v}</span>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* ── CONSTRUCTEUR TAB ──────────────────────────────────────────── */}
        {activeTab === 'Constructeur' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Canvas area */}
            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-mf-border bg-mf-card shrink-0 flex-wrap">
                {/* Flowsheet name */}
                <input
                  className="input-field text-sm font-semibold py-1 px-2 w-48"
                  value={fsName}
                  onChange={e => setFsName(e.target.value)}
                  placeholder="Nom du flowsheet"
                />
                {isDirty && <span className="text-[10px] text-amber-400 opacity-70">● non sauvegardé</span>}

                <div className="h-5 w-px bg-mf-border mx-1" />

                {/* Mode selector */}
                {([
                  ['select',  <MousePointer2 size={13} />, 'Sélection'],
                  ['connect', <Link2          size={13} />, 'Connecter'],
                  ['delete',  <Trash2         size={13} />, 'Supprimer'],
                ] as [Mode, React.ReactNode, string][]).map(([m, icon, label]) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); setConnectingFrom(null); }}
                    className={`btn btn-sm gap-1.5 ${mode === m ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {icon}{label}
                  </button>
                ))}

                {connectingFrom && (
                  <span className="text-xs text-teal-400 flex items-center gap-1.5 px-2 py-1 bg-teal-500/10 rounded-lg border border-teal-500/20">
                    <Link2 size={11} />
                    Cliquez sur un nœud destination
                    <button onClick={() => setConnectingFrom(null)} className="ml-1 opacity-60 hover:opacity-100"><X size={11} /></button>
                  </span>
                )}

                {refImg && refImg.mime !== 'application/pdf' && (
                  <label className="flex items-center gap-1.5 text-[11px] text-mf-txt3 ml-2" title="Afficher la référence Visio en fond">
                    <input type="checkbox" checked={showRefOverlay} onChange={e => setShowRefOverlay(e.target.checked)} className="accent-teal-400" />
                    <ImageIcon size={12} /> Fond Visio
                    {showRefOverlay && (
                      <input type="range" min={0.1} max={0.9} step={0.05} value={refOpacity}
                        onChange={e => setRefOpacity(parseFloat(e.target.value))} className="w-16 accent-teal-400" />
                    )}
                  </label>
                )}

                <div className="h-5 w-px bg-mf-border mx-1 ml-auto" />

                <button onClick={generateFlowsheet} disabled={generating}
                  className="btn btn-teal btn-sm gap-1.5" title="Générer le flowsheet à partir des critères de conception du projet">
                  <Sparkles size={13} />{generating ? 'Génération…' : 'Générer le flowsheet'}
                </button>
                <button onClick={handleLayout} className="btn btn-secondary btn-sm gap-1.5">
                  <LayoutGrid size={13} />Auto-arranger
                </button>
                <button onClick={handleClear} className="btn btn-danger btn-sm gap-1.5">
                  <Trash2 size={13} />Effacer
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowLoadMenu(v => !v)}
                    className="btn btn-secondary btn-sm gap-1.5"
                  >
                    <FolderOpen size={13} />Charger
                    <ChevronDown size={11} className={showLoadMenu ? 'rotate-180' : ''} />
                  </button>
                  {showLoadMenu && (
                    <div className="absolute right-0 top-full mt-1 w-72 bg-mf-card border border-mf-border rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="p-2 text-[10px] font-bold uppercase tracking-widest text-mf-txt4 border-b border-mf-border px-3 py-2">Flowsheets sauvegardés</div>
                      {savedSheets.length === 0 && (
                        <div className="px-3 py-4 text-xs text-mf-txt4 text-center">Aucun flowsheet sauvegardé</div>
                      )}
                      {savedSheets.map(s => (
                        <button key={s.id} onClick={() => handleLoad(s)}
                          className="w-full text-left px-3 py-2 hover:bg-mf-hover transition-colors border-b border-mf-border/40 last:border-0">
                          <div className="text-xs font-semibold text-mf-txt">{s.name}</div>
                          <div className="text-[10px] text-mf-txt4 mt-0.5">{s.nodes.length} nœuds · {s.edges.length} connexions · {new Date(s.created_at).toLocaleDateString('fr-FR')}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={handleSave} disabled={saving}
                  className="btn btn-primary btn-sm gap-1.5">
                  <Save size={13} />{saving ? 'Sauvegarde…' : 'Sauvegarder'}
                </button>
              </div>

              {/* Canvas scroll area */}
              <div
                ref={canvasWrapRef}
                className="flex-1 overflow-auto bg-mf-bg"
                style={{ cursor }}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
                onClick={handleCanvasClick}
              >
                {/* Stream legend (PFD-style) */}
                {nodes.length > 0 && (
                  <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 30, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none' }}>
                    <div style={{ pointerEvents: 'auto', margin: 8, padding: '8px 10px', background: '#0B111Cee', border: '1px solid #1E2A3B', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#7F8DA3', textTransform: 'uppercase', marginBottom: 5 }}>Légende — Flux</div>
                      {(Object.keys(STREAM_TYPES) as StreamType[]).map(k => (
                        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={STREAM_TYPES[k].color} strokeWidth="2" strokeDasharray={STREAM_TYPES[k].dash} /></svg>
                          <span style={{ fontSize: 10, color: '#B8C3D3' }}>{STREAM_TYPES[k].label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ position: 'relative', width: canvasW, height: canvasH, minWidth: '100%', minHeight: '100%' }}>

                  {/* Imported Visio reference used as a tracing background */}
                  {showRefOverlay && refImg && refImg.mime !== 'application/pdf' && (
                    <img src={refImg.dataUrl} alt="" style={{
                      position: 'absolute', top: 20, left: 20, maxWidth: canvasW - 40,
                      opacity: refOpacity, pointerEvents: 'none', zIndex: 0,
                    }} />
                  )}

                  {/* Grid background */}
                  <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    <defs>
                      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#0F1828" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                  </svg>

                  {/* SVG edges overlay */}
                  <svg
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <defs>
                      {Object.entries(STREAM_TYPES).map(([k, v]) => (
                        <marker key={k} id={`arr-${k}`} markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                          <polygon points="0 0, 8 3, 0 6" fill={v.color} />
                        </marker>
                      ))}
                      <marker id="arr-del" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                        <polygon points="0 0, 8 3, 0 6" fill="#F87171" />
                      </marker>
                    </defs>
                    {edges.map(edge => {
                      const from = nodes.find(n => n.id === edge.from);
                      const to   = nodes.find(n => n.id === edge.to);
                      if (!from || !to) return null;
                      const st = STREAM_TYPES[edge.type ?? 'process'];
                      const isRecycle = edge.type === 'recycle';
                      // route recycle streams below the nodes so they read as loop-backs
                      const x1 = from.x + (isRecycle ? NODE_W / 2 : NODE_W), y1 = from.y + (isRecycle ? NODE_H : NODE_H / 2);
                      const x2 = to.x + (isRecycle ? NODE_W / 2 : 0),        y2 = to.y   + (isRecycle ? NODE_H : NODE_H / 2);
                      const mx = (x1 + x2) / 2;
                      const dip = isRecycle ? Math.max(y1, y2) + 46 : 0;
                      const d = isRecycle
                        ? `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`
                        : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
                      const isDelMode = mode === 'delete';
                      return (
                        <g key={edge.id} style={{ pointerEvents: isDelMode ? 'stroke' : 'none' }}
                          onClick={() => handleEdgeClick(edge.id)}>
                          <path d={d} fill="none" stroke={isDelMode ? '#F8717140' : st.color + '30'} strokeWidth={isDelMode ? 6 : 3}
                            style={{ cursor: isDelMode ? 'pointer' : 'default' }} />
                          <path d={d} fill="none" stroke={isDelMode ? '#F87171' : st.color} strokeWidth={1.6}
                            strokeDasharray={isDelMode ? undefined : st.dash}
                            markerEnd={isDelMode ? 'url(#arr-del)' : `url(#arr-${edge.type ?? 'process'})`} />
                        </g>
                      );
                    })}
                    {/* Connection preview line */}
                    {connectingFrom && (() => {
                      const from = nodes.find(n => n.id === connectingFrom);
                      if (!from) return null;
                      return (
                        <circle
                          cx={from.x + NODE_W}
                          cy={from.y + NODE_H / 2}
                          r={6}
                          fill="#14B8A6"
                          opacity={0.8}
                          style={{ animation: 'pulse 1s infinite' }}
                        />
                      );
                    })()}
                  </svg>

                  {/* Node boxes */}
                  {nodes.map(node => {
                    const cfg        = getCfg(node.equipCode);
                    const isSelected = selectedId === node.id;
                    const isFrom     = connectingFrom === node.id;
                    return (
                      <div
                        key={node.id}
                        style={{
                          position:   'absolute',
                          left:       node.x,
                          top:        node.y,
                          width:      NODE_W,
                          height:     NODE_H,
                          cursor:     mode === 'select' ? 'grab' : mode === 'connect' ? 'pointer' : 'not-allowed',
                          userSelect: 'none',
                          zIndex:     isSelected ? 10 : 1,
                          borderRadius: 8,
                          border:     `1.5px solid ${isSelected ? cfg.color : cfg.color + '40'}`,
                          backgroundColor: isSelected ? cfg.color + '20' : '#0D1520',
                          boxShadow:  isSelected
                            ? `0 0 0 2px ${cfg.color}40, 0 4px 16px ${cfg.color}20`
                            : isFrom
                            ? `0 0 0 2px #14B8A640`
                            : '0 2px 8px rgba(0,0,0,0.4)',
                          transition: 'box-shadow 0.15s, border-color 0.15s',
                        }}
                        onMouseDown={e => handleNodeMouseDown(e, node.id)}
                        onClick={e => handleNodeClick(e, node.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: '100%', paddingLeft: 8, paddingRight: 6 }}>
                          {/* Pictorial equipment symbol */}
                          <div style={{
                            width: 34, height: 34, borderRadius: 7, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: cfg.color + '15', border: `1px solid ${cfg.color}40`,
                          }}>
                            <EquipIcon group={cfg.group} color={cfg.color} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                              <span style={{
                                fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
                                color: cfg.color, background: cfg.color + '18',
                                padding: '1px 4px', borderRadius: 3,
                              }}>{cfg.abbrev}</span>
                              <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: '#DCE3EE', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }}>
                                {node.tag}
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: isSelected ? '#B0C0D8' : '#56657A', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {node.label}
                            </div>
                          </div>
                        </div>
                        {/* Connection port (right) */}
                        <div style={{
                          position: 'absolute', right: -4, top: '50%', transform: 'translateY(-50%)',
                          width: 8, height: 8, borderRadius: '50%',
                          backgroundColor: cfg.color, opacity: mode === 'connect' ? 0.8 : 0.3,
                          border: '1.5px solid #070A12',
                        }} />
                      </div>
                    );
                  })}

                  {/* Empty state */}
                  {nodes.length === 0 && (
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}
                      className="text-center pointer-events-none select-none">
                      <Network size={40} className="text-mf-border mx-auto mb-3" />
                      <p className="text-sm font-semibold text-mf-txt3">Canvas vide</p>
                      <p className="text-xs text-mf-txt4 mt-1">Cliquez sur un équipement dans la bibliothèque pour l'ajouter</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Properties panel */}
            <aside className="w-64 border-l border-mf-border bg-mf-card flex flex-col shrink-0 overflow-y-auto">
              {selectedNode ? (
                <>
                  <div className="p-4 border-b border-mf-border">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCfg(selectedNode.equipCode).color }} />
                      <span className="text-[10px] text-mf-txt4">{getCfg(selectedNode.equipCode).group}</span>
                    </div>
                    <div className="text-sm font-semibold text-mf-txt">{selectedNode.label}</div>
                    <div className="text-[10px] font-mono text-mf-txt4 mt-0.5">{selectedNode.equipCode}</div>
                  </div>
                  <div className="p-4 space-y-3 flex-1">
                    <div>
                      <label className="text-[10px] text-mf-txt3 mb-1 block font-medium">Tag</label>
                      <input
                        className="input-field text-xs font-mono w-full"
                        value={selectedNode.tag}
                        onChange={e => updateNodeProp('tag', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-mf-txt3 mb-1 block font-medium">Désignation</label>
                      <input
                        className="input-field text-xs w-full"
                        value={selectedNode.label}
                        onChange={e => updateNodeProp('label', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-mf-txt4">
                      <div>Position X<br /><span className="font-mono text-mf-txt3">{Math.round(selectedNode.x)}</span></div>
                      <div>Position Y<br /><span className="font-mono text-mf-txt3">{Math.round(selectedNode.y)}</span></div>
                    </div>
                    <div className="pt-2 border-t border-mf-border">
                      <div className="text-[10px] text-mf-txt4 mb-1.5">Connexions</div>
                      <div className="text-[10px] text-mf-txt3">
                        Entrants : <span className="font-mono text-blue-400">{edges.filter(e => e.to === selectedNode.id).length}</span>
                        &nbsp;·&nbsp;
                        Sortants : <span className="font-mono text-teal-400">{edges.filter(e => e.from === selectedNode.id).length}</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 border-t border-mf-border">
                    <button
                      onClick={() => { setNodes(p => p.filter(n => n.id !== selectedNode.id)); setEdges(p => p.filter(e => e.from !== selectedNode.id && e.to !== selectedNode.id)); setSelectedId(null); }}
                      className="btn btn-danger btn-sm w-full gap-1.5 justify-center"
                    >
                      <Trash2 size={13} />Supprimer ce nœud
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                  <MousePointer2 size={24} className="text-mf-border mb-3" />
                  <p className="text-xs font-semibold text-mf-txt3">Aucun nœud sélectionné</p>
                  <p className="text-[10px] text-mf-txt4 mt-1 leading-snug">Cliquez sur un nœud du canvas pour modifier ses propriétés</p>
                  <div className="mt-6 space-y-1 text-left w-full">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4 mb-2">Raccourcis</div>
                    {[
                      ['Ajouter', 'Clic dans la bibliothèque'],
                      ['Déplacer', 'Glisser (mode Sélection)'],
                      ['Relier', 'Mode Connecter → clic×2'],
                      ['Supprimer nœud', 'Mode Suppr. → clic nœud'],
                      ['Supprimer lien', 'Mode Suppr. → clic arête'],
                      ['Arranger', 'Bouton Auto-arranger'],
                    ].map(([k, v]) => (
                      <div key={k as string} className="flex gap-2">
                        <span className="text-[10px] text-mf-txt4 w-24 shrink-0">{k}</span>
                        <span className="text-[10px] text-mf-txt3">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {/* ── BILANS DE FLUX TAB ────────────────────────────────────────── */}
        {activeTab === 'Bilans de flux' && (
          <div className="flex-1 overflow-auto p-6">
            {nodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <Network size={32} className="text-mf-border mb-3" />
                <p className="text-sm font-semibold text-mf-txt3">Canvas vide</p>
                <p className="text-xs text-mf-txt4 mt-1">Construisez un flowsheet dans l'onglet Constructeur pour voir les bilans</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-sm font-semibold text-mf-txt">{fsName}</span>
                  <span className="text-xs text-mf-txt4">{nodes.length} équipements · {edges.length} connexions · {project.target_tph} t/h</span>
                </div>
                <div className="card p-0 overflow-hidden mb-5">
                  <table className="tbl text-xs">
                    <thead>
                      <tr>
                        <th>Tag</th><th>Équipement</th><th>Groupe</th>
                        <th className="text-right">Entrants</th><th className="text-right">Sortants</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nodes.map(n => {
                        const cfg = getCfg(n.equipCode);
                        const incoming = edges.filter(e => e.to === n.id);
                        const outgoing = edges.filter(e => e.from === n.id);
                        return (
                          <tr key={n.id} className="hover:bg-mf-hover/50 cursor-pointer" onClick={() => { setSelectedId(n.id); setActiveTab('Constructeur'); }}>
                            <td><span className="font-mono text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ color: cfg.color, backgroundColor: cfg.color + '18' }}>{n.tag}</span></td>
                            <td className="text-mf-txt">{n.label}</td>
                            <td><span className="text-[10px]" style={{ color: cfg.color }}>{cfg.group}</span></td>
                            <td className="text-right font-mono text-blue-400">{incoming.length}</td>
                            <td className="text-right font-mono text-teal-400">{outgoing.length}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Nœuds totaux',    val: nodes.length,   unit: 'équipements', color: 'text-amber-400' },
                    { label: 'Connexions',       val: edges.length,   unit: 'liens',       color: 'text-teal-400'  },
                    { label: 'Nœuds isolés',     val: nodes.filter(n => !edges.some(e => e.from === n.id || e.to === n.id)).length, unit: 'non connectés', color: 'text-orange-400' },
                  ].map(c => (
                    <div key={c.label} className="card-sm">
                      <div className="text-[10px] text-mf-txt4 mb-1">{c.label}</div>
                      <div className={`text-2xl font-bold font-mono ${c.color}`}>{c.val}</div>
                      <div className="text-[10px] text-mf-txt4 mt-0.5">{c.unit}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── COMPARAISON TAB ──────────────────────────────────────────── */}
        {activeTab === 'Comparaison' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="mb-5">
              <div className="text-sm font-semibold text-mf-txt mb-1">Analyse comparative — Circuits standards</div>
              <p className="text-xs text-mf-txt3">Sélectionnez les circuits à comparer. Le radar montre les performances normalisées sur 6 axes.</p>
            </div>
            <div className="flex flex-wrap gap-2 mb-6">
              {FLOWSHEET_TEMPLATES.map((t, ci) => {
                const on    = compareSet.has(t.code);
                const color = RADAR_COLORS[Array.from(compareSet).indexOf(t.code) % RADAR_COLORS.length];
                return (
                  <button key={t.code}
                    onClick={() => setCompareSet(prev => { const n = new Set(prev); n.has(t.code) ? (n.size > 1 && n.delete(t.code)) : n.add(t.code); return n; })}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${on ? 'bg-mf-card' : 'opacity-40 bg-mf-panel border-mf-border text-mf-txt4'}`}
                    style={on ? { borderColor: color + '60', color } : undefined}>
                    {on ? <CheckCircle2 size={11} style={{ color }} /> : <AlertTriangle size={11} />}
                    <span className="font-mono font-bold">{t.code}</span>
                    <span className="text-mf-txt3 font-normal hidden sm:inline">{t.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="card flex flex-col items-center">
                <div className="text-xs font-semibold text-mf-txt mb-1 self-start">Radar performance (normalisé 0→1)</div>
                <RadarChart codes={Array.from(compareSet)} />
                <div className="flex flex-wrap gap-3 mt-2">
                  {Array.from(compareSet).map((code, i) => (
                    <div key={code} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length] }} />
                      <span className="text-[10px] text-mf-txt3 font-mono">{code}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card p-0 overflow-hidden self-start">
                <table className="tbl text-xs">
                  <thead>
                    <tr>
                      <th>Circuit</th>
                      {RADAR_AXES.map(a => <th key={a} className="text-right">{a}</th>)}
                      <th className="text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(compareSet).map((code, ci) => {
                      const vals  = CIRCUIT_SCORES[code] ?? RADAR_AXES.map(() => 0.5);
                      const score = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100);
                      const color = RADAR_COLORS[ci % RADAR_COLORS.length];
                      const tpl   = FLOWSHEET_TEMPLATES.find(t => t.code === code);
                      return (
                        <tr key={code}>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <div>
                                <div className="font-mono font-bold text-[10px]" style={{ color }}>{code}</div>
                                <div className="text-[9px] text-mf-txt4">{tpl?.name}</div>
                              </div>
                            </div>
                          </td>
                          {vals.map((v, i) => (
                            <td key={i} className="text-right font-mono">
                              <span className={v >= 0.85 ? 'text-emerald-400' : v >= 0.7 ? 'text-amber-400' : 'text-red-400'}>
                                {Math.round(v * 100)}
                              </span>
                            </td>
                          ))}
                          <td className="text-right">
                            <span className="font-bold font-mono text-sm" style={{ color }}>{score}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="p-4 border-t border-mf-border">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4 mb-3">Détail par axe</div>
                  {RADAR_AXES.map(ax => {
                    const axIdx = RADAR_AXES.indexOf(ax);
                    return (
                      <div key={ax} className="mb-3">
                        <div className="text-[10px] text-mf-txt3 mb-1">{ax}</div>
                        <div className="space-y-1">
                          {Array.from(compareSet).map((code, ci) => {
                            const v     = (CIRCUIT_SCORES[code] ?? RADAR_AXES.map(() => 0.5))[axIdx];
                            const color = RADAR_COLORS[ci % RADAR_COLORS.length];
                            return (
                              <div key={code} className="flex items-center gap-2">
                                <span className="text-[9px] font-mono w-24 truncate text-mf-txt4">{code}</span>
                                <div className="flex-1 bg-mf-panel rounded-full h-1.5 overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${v * 100}%`, backgroundColor: color }} />
                                </div>
                                <span className="text-[9px] font-mono w-6 text-right" style={{ color }}>{Math.round(v * 100)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Référence Visio' && (
          <div className="flex-1 overflow-auto p-6">
            <input ref={refInputRef} type="file" accept=".svg,.png,.jpg,.jpeg,.pdf,image/svg+xml,image/png,image/jpeg,application/pdf"
              className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleRefUpload(f); e.currentTarget.value = ''; }} />
            <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-mf-txt mb-1">Référence Visio / Image importée</div>
                <p className="text-xs text-mf-txt3 max-w-xl">
                  Dessinez le flowsheet dans Microsoft Visio, exportez-le en <span className="text-mf-txt2">SVG, PDF, PNG ou JPG</span>, puis importez-le ici. La référence est enregistrée par projet et peut servir de fond dans le Constructeur.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => refInputRef.current?.click()} disabled={refBusy} className="btn btn-teal btn-sm gap-1.5">
                  <Upload size={13} />{refBusy ? 'Import…' : refImg ? 'Remplacer' : 'Importer un fichier'}
                </button>
                {refImg && (
                  <button onClick={handleRefRemove} className="btn btn-danger btn-sm gap-1.5"><Trash2 size={13} />Retirer</button>
                )}
              </div>
            </div>

            {refError && <div className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{refError}</div>}

            {!refImg ? (
              <div onClick={() => refInputRef.current?.click()}
                className="border-2 border-dashed border-mf-border rounded-xl p-12 text-center cursor-pointer hover:border-teal-400/40 hover:bg-mf-hover/20 transition-all">
                <ImageIcon size={32} className="mx-auto text-mf-txt4 mb-3" />
                <div className="text-sm text-mf-txt3 mb-1">Cliquez pour importer votre flowsheet Visio</div>
                <div className="text-xs text-mf-txt4">SVG · PDF · PNG · JPG (max 6 Mo)</div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-3 text-xs text-mf-txt3 flex-wrap">
                  <span className="font-mono text-mf-txt2">{refImg.filename}</span>
                  <span className="text-mf-txt4">{refImg.mime}</span>
                  {refImg.mime !== 'application/pdf' && (
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={showRefOverlay} onChange={e => setShowRefOverlay(e.target.checked)} className="accent-teal-400" />
                      Afficher comme fond dans le Constructeur
                    </label>
                  )}
                  {refImg.id === null && <span className="text-amber-400">· non enregistré (session)</span>}
                </div>
                <div className="border border-mf-border rounded-xl overflow-hidden bg-white" style={{ maxHeight: '70vh' }}>
                  {refImg.mime === 'application/pdf'
                    ? <iframe title="Référence Visio" src={refImg.dataUrl} style={{ width: '100%', height: '70vh', border: 0 }} />
                    : <img src={refImg.dataUrl} alt="Référence flowsheet" style={{ width: '100%', height: 'auto', display: 'block' }} />}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
