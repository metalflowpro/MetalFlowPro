import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  MousePointer2, Link2, Trash2, LayoutGrid, Save,
  FolderOpen, Plus, X, Search, BarChart3, GitCompare,
  Network, CheckCircle2, AlertTriangle, ChevronDown, Sparkles,
  Image as ImageIcon, Upload, Maximize2,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { useProject } from '../lib/ProjectContext';
import {
  EQUIPMENT_LIBRARY, EQUIP_MAP, FS_NAME_BY_CODE, STREAM_TYPES, getCfg,
  type EquipDef, type StreamType,
} from '../lib/flowsheet/equipmentLibrary';
import { CIRCUIT_TEMPLATES, CIRCUIT_RADAR_AXES, findCircuitTemplate, type CircuitTemplate } from '../lib/flowsheet/circuitTemplates';
import type { Project } from '../types';

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
  cone_tertiary: { code: 'CRUSH_CONE_TER', seq: 24 },
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

// ─── Canvas types ─────────────────────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  equipCode: string;
  tag: string;
  label: string;
  x: number;
  y: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type?: StreamType;
  label?: string;   // stream annotation shown mid-edge (OF/UF, cailloux, eau recyclée…)
}

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
    // Cap depth at the node count so cyclic graphs (recycle / reclaim loops) can't make
    // the longest-path BFS grow without bound and hang the renderer.
    const MAX_DEPTH = nodes.length;
    while (queue.length) {
      const { id, d } = queue.shift()!;
      if ((depth.get(id) ?? -1) >= d) continue;
      depth.set(id, d);
      if (d < MAX_DEPTH) childMap.get(id)?.forEach(c => queue.push({ id: c, d: d + 1 }));
    }
    nodes.forEach(n => { if (!depth.has(n.id)) depth.set(n.id, 0); });
  }

  const cols = new Map<number, CanvasNode[]>();
  nodes.forEach(n => {
    const d = depth.get(n.id) ?? 0;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(n);
  });
  const stackIndex = new Map<string, number>();
  cols.forEach(list => list.forEach((n, i) => stackIndex.set(n.id, i)));

  // ── Serpentine (boustrophedon) layout ─────────────────────────────────────
  // Instead of one long horizontal chain, fold the process sequence into rows
  // that alternate direction (left→right, then right→left, …) and drop down at
  // each fold — so a long circuit reads as a compact "S" like a real PFD, using
  // vertical space rather than running off to the right.
  const COL_W = 200, ROW_H = 92, PER_ROW = 6, MARGIN = 48;
  // Band height must clear the tallest parallel stack in that band.
  const maxStackByBand = new Map<number, number>();
  cols.forEach((list, d) => {
    const band = Math.floor(d / PER_ROW);
    maxStackByBand.set(band, Math.max(maxStackByBand.get(band) ?? 1, list.length));
  });
  const bandY = new Map<number, number>();
  let acc = MARGIN;
  const maxBand = Math.max(0, ...[...maxStackByBand.keys()]);
  for (let b = 0; b <= maxBand; b++) {
    bandY.set(b, acc);
    acc += (maxStackByBand.get(b) ?? 1) * ROW_H + ROW_H * 1.4; // gap for the fold pipe
  }

  return nodes.map(n => {
    const d = depth.get(n.id) ?? 0;
    const s = stackIndex.get(n.id) ?? 0;
    const band = Math.floor(d / PER_ROW);
    const pos = d % PER_ROW;
    const visualCol = band % 2 === 0 ? pos : (PER_ROW - 1 - pos); // alternate direction
    const x = MARGIN + visualCol * COL_W;
    const y = (bandY.get(band) ?? MARGIN) + s * ROW_H;
    return { ...n, x, y };
  });
}

function getNextTag(code: string, nodes: CanvasNode[]): string {
  const abbrev = EQUIP_MAP[code]?.abbrev ?? code.slice(0, 3);
  const count  = nodes.filter(n => n.equipCode === code).length + 1;
  return `${abbrev}-${String(count).padStart(3, '0')}`;
}

// ─── Radar chart for comparison ───────────────────────────────────────────────

const RADAR_COLORS = ['#F59E0B', '#14B8A6', '#5BA4F5', '#F88A44', '#A78BFA', '#34D399'];

/** Scores du modèle, dans l'ordre des axes du radar. */
function radarValues(code: string): number[] {
  const tpl = findCircuitTemplate(code);
  return CIRCUIT_RADAR_AXES.map(axis => tpl?.scores[axis] ?? 0.5);
}

function RadarChart({ codes }: { codes: string[] }) {
  const cx = 150, cy = 150, r = 100;
  const n  = CIRCUIT_RADAR_AXES.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt    = (i: number, v: number) => ({
    x: cx + Math.cos(angle(i)) * r * v,
    y: cy + Math.sin(angle(i)) * r * v,
  });

  return (
    <svg width={300} height={300} viewBox="0 0 300 300">
      {[0.25, 0.5, 0.75, 1].map(lv => (
        <polygon key={lv}
          points={CIRCUIT_RADAR_AXES.map((_, i) => { const p = pt(i, lv); return `${p.x},${p.y}`; }).join(' ')}
          fill="none" stroke="#1E2A3B" strokeWidth={0.8} />
      ))}
      {CIRCUIT_RADAR_AXES.map((_, i) => { const p = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#1E2A3B" strokeWidth={0.8} />; })}
      {CIRCUIT_RADAR_AXES.map((ax, i) => { const p = pt(i, 1.25); return <text key={ax} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="#56657A">{ax}</text>; })}
      {codes.map((code, ci) => {
        const vals   = radarValues(code);
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

const TABS = ['Constructeur', 'Bilans de flux', 'Modèles de circuit', 'Comparaison', 'Référence Visio'];
const REF_MARKER = '[REF]';
const MAX_REF_BYTES = 6 * 1024 * 1024; // ~6 MB data-url cap

export function Flowsheet({ project }: FlowsheetProps) {
  // The app's single effective recovery (LIMS testwork) — the sidebar KPI showed
  // the raw design recovery_pct, disagreeing with the Dashboard on the same data.
  const { effectiveRecoveryPct } = useProject();
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

  // ── Drag / zoom state ──────────────────────────────────────────────────────
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const pendingFitRef = useRef(false);
  const [legendOpen, setLegendOpen] = useState(false);

  // ── Comparison state ───────────────────────────────────────────────────────
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set(['AU_CIL_STD', 'AU_GRAV_CIL']));

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
    const dx = (e.clientX - d.startX) / zoom;   // screen px → layout px (zoom-aware)
    const dy = (e.clientY - d.startY) / zoom;
    setNodes(prev => prev.map(n =>
      n.id === d.nodeId ? { ...n, x: Math.max(0, d.origX + dx), y: Math.max(0, d.origY + dy) } : n
    ));
  }, [zoom]);

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
      const addEdge = (from?: string, to?: string, type: StreamType = 'process', label?: string) => {
        if (from && to && from !== to && !built_edges.some(e => e.from === from && e.to === to)) {
          built_edges.push({ id: `e-${Date.now()}-${ei++}`, from, to, type, label });
        }
      };

      // ── Real process topology (cascade + closed circuits), not a flat chain ──
      // The grinding circuit is NOT sequential: the SAG discharges to the cyclone,
      // the underflow (coarse) recycles to the ball mill, the ball mill closes back
      // on the cyclone, and only the overflow (fine) moves downstream. We therefore
      // route the pre-grind and post-grind stages as forward cascades and wire the
      // grinding loop explicitly.
      const GRIND = new Set(['MILL_SAG', 'MILL_AG', 'MILL_ROD', 'MILL_BALL', 'CLASSIF_CYCL', 'SCREEN_TROMMEL', 'CRUSH_PEBBLE']);
      // Bleed / loop units routed by dedicated branches below, NOT the main cascade.
      const BRANCH = new Set(['GRAV_KNELSON', 'GRAV_ILR']);
      const primaryMill = nid('MILL_SAG') ?? nid('MILL_AG') ?? nid('MILL_ROD');
      const cyc  = nid('CLASSIF_CYCL');
      const ball = nid('MILL_BALL');
      const hasGrind = !!(primaryMill || cyc || ball);

      if (!hasGrind) {
        // No grinding circuit (e.g. heap leach): simple forward cascade.
        for (let i = 0; i < built.length - 1; i++) addEdge(built[i].id, built[i + 1].id);
      } else {
        const spine = finalCodes.filter(c => !GRIND.has(c) && !BRANCH.has(c));
        const firstGrindSeq = Math.min(...finalCodes.filter(c => GRIND.has(c)).map(c => finalCodes.indexOf(c)));
        const preCodes  = spine.filter(c => finalCodes.indexOf(c) < firstGrindSeq);
        const postCodes = spine.filter(c => finalCodes.indexOf(c) > firstGrindSeq);
        // Pre-grind cascade (feed → crushing → …).
        for (let i = 0; i < preCodes.length - 1; i++) addEdge(nid(preCodes[i]), nid(preCodes[i + 1]));
        const gridEntry = primaryMill ?? ball ?? cyc;
        const gridExit  = cyc ?? ball ?? primaryMill;
        if (preCodes.length) addEdge(nid(preCodes[preCodes.length - 1]), gridEntry, 'process', 'Alim. broyage');
        // Grinding closed circuit.
        if (primaryMill && cyc) addEdge(primaryMill, cyc, 'process', 'Décharge broyeur');
        // Sousverse (UF) = alimentation RÉELLE du ball mill → flux procédé (visible
        // et positionne le broyeur dans le circuit) ; sa décharge boucle au cyclone.
        if (cyc && ball)  { addEdge(cyc, ball, 'process', 'Sousverse (UF) → alim. ball'); addEdge(ball, cyc, 'recycle', 'Décharge broyeur'); }
        if (cyc && !ball) addEdge(cyc, primaryMill, 'recycle', 'Sousverse (UF)');
        if (!cyc && primaryMill && ball) addEdge(primaryMill, ball, 'process');
        // SAG pebble loop (critical-size recycle).
        if (primaryMill && nid('CRUSH_PEBBLE')) {
          addEdge(primaryMill, nid('CRUSH_PEBBLE'), 'recycle', 'Cailloux (pebbles)');
          addEdge(nid('CRUSH_PEBBLE'), primaryMill, 'recycle', 'Concassé retour');
        }
        // Overflow (fine product) → downstream cascade.
        if (postCodes.length) {
          addEdge(gridExit, nid(postCodes[0]), 'process', 'Surverse (OF)');
          for (let i = 0; i < postCodes.length - 1; i++) addEdge(nid(postCodes[i]), nid(postCodes[i + 1]));
        }
      }

      // ── Loops & branch streams that make it read like a real PFD ────────────
      // Crushing closed circuit: screen oversize back to the fine crusher.
      const screen = nid('SCREEN_VIB') ?? nid('SCREEN_BANANA');
      const fineCrusher = nid('CRUSH_CONE_TER') ?? nid('CRUSH_CONE_SEC');
      if (screen && fineCrusher) {
        addEdge(screen, fineCrusher, 'recycle', 'Refus (oversize)');
        addEdge(fineCrusher, screen, 'recycle', 'Retour crible');
      }
      // Gravity: bleed off the cyclone underflow → Knelson; concentrate → intensive
      // leach (ILR) → CIL; gravity tails recycle to the grinding circuit.
      const grav = nid('GRAV_KNELSON');
      if (grav) {
        addEdge(cyc ?? primaryMill, grav, 'process', 'Bleed ~15-20% UF');
        addEdge(grav, nid('GRAV_ILR'), 'process', 'Concentré grav.');
        addEdge(nid('GRAV_ILR'), nid('CIL_TANK'), 'pregnant', 'Solution grav.');
        addEdge(grav, cyc ?? ball ?? primaryMill, 'recycle', 'Résidu grav.');
      }
      // Regrind (flotation concentrate / middlings) product returns to leach.
      const regrind = nid('MILL_VERTIMILL') ?? nid('MILL_ISAMILL') ?? nid('MILL_TOWER');
      if (regrind) addEdge(regrind, nid('CIL_TANK') ?? nid('FLOAT_MECH'), 'process', 'Rebroyé');
      // ADR carbon regeneration recycle back to CIL.
      addEdge(nid('ADR_KILN'), nid('CIL_TANK'), 'recycle', 'Charbon régénéré');
      // Process-water reclaim from the tailings thickener back to grinding.
      addEdge(nid('THCK_HIRATE') ?? nid('THCK_CONV'), ball ?? primaryMill, 'water', 'Eau recyclée');
      // Lay out on forward streams only — recycle / reclaim loops must not drive columns.
      const laid = autoLayout(built, built_edges.filter(e => e.type !== 'recycle' && e.type !== 'water'));
      pendingFitRef.current = true;   // auto-fit the fresh flowsheet into view
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

  // ── Load a complete circuit template onto the canvas ───────────────────────
  // The template carries stable local ids; we remap them to fresh canvas ids and
  // number the tags per equipment family. Layout runs on FORWARD streams only —
  // recycle and water-reclaim loops must not push their target into a later
  // column, or the grinding circuit would unfold into a straight line.
  const loadTemplate = useCallback((tpl: CircuitTemplate) => {
    if (nodes.length > 0 && !confirm(`Charger « ${tpl.name} » ? Le contenu actuel du canvas sera remplacé.`)) return;

    const stamp = Date.now();
    const idMap = new Map<string, string>();
    const built: CanvasNode[] = tpl.nodes.map((n, i) => {
      const id = `n-${stamp}-${i}`;
      idMap.set(n.id, id);
      return { id, equipCode: n.equipCode, tag: '', label: n.label, x: 0, y: 0 };
    });
    built.forEach((n, i) => { n.tag = getNextTag(n.equipCode, built.slice(0, i)); });

    const builtEdges: CanvasEdge[] = tpl.edges.map((e, i) => ({
      id: `e-${stamp}-${i}`,
      from: idMap.get(e.from)!,
      to: idMap.get(e.to)!,
      type: e.type ?? 'process',
      label: e.label,
    }));

    const laid = autoLayout(built, builtEdges.filter(e => e.type !== 'recycle' && e.type !== 'water'));
    pendingFitRef.current = true;
    setNodes(laid);
    setEdges(builtEdges);
    setSelectedId(null);
    setConnectingFrom(null);
    setCurrentFsId(null);
    setFsName(`${tpl.name} — ${project.name}`);
    setIsDirty(true);
    setActiveTab('Constructeur');
  }, [nodes.length, project.name]);

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

  // ── Zoom-to-fit : scale the whole flowsheet so it's fully visible ───────────
  const fitToView = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || nodes.length === 0) { setZoom(1); return; }
    const minX = Math.min(...nodes.map(n => n.x));
    const minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + NODE_W));
    const maxY = Math.max(...nodes.map(n => n.y + NODE_H));
    const contentW = maxX - minX + 120;
    const contentH = maxY - minY + 120;
    const z = Math.min(wrap.clientWidth / contentW, wrap.clientHeight / contentH, 1);
    setZoom(Math.max(0.25, +z.toFixed(2)));
    requestAnimationFrame(() => wrap.scrollTo({ left: 0, top: 0 }));
  }, [nodes]);

  // Auto-fit once after an auto-generation (nodes replaced wholesale).
  useEffect(() => {
    if (pendingFitRef.current && nodes.length) {
      pendingFitRef.current = false;
      fitToView();
    }
  }, [nodes, fitToView]);

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
                      if (next.has(g.group)) next.delete(g.group); else next.add(g.group);
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
                ['Récup.', `${effectiveRecoveryPct}%`],
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
                {/* Zoom controls — keep the whole flowsheet visible & editable */}
                <div className="flex items-center gap-0.5 rounded-lg border border-mf-border bg-mf-panel px-1">
                  <button onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))} className="px-1.5 py-1 text-mf-txt3 hover:text-mf-txt" title="Dézoomer">−</button>
                  <button onClick={fitToView} className="px-2 py-1 text-[11px] font-mono text-mf-txt3 hover:text-mf-txt" title="Ajuster à la vue">{Math.round(zoom * 100)}%</button>
                  <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} className="px-1.5 py-1 text-mf-txt3 hover:text-mf-txt" title="Zoomer">+</button>
                </div>
                <button onClick={fitToView} className="btn btn-secondary btn-sm gap-1.5" title="Cadrer tout le flowsheet dans la vue">
                  <Maximize2 size={13} />Ajuster
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
                {/* Stream legend (PFD-style) — collapsible so it never masks the diagram */}
                {nodes.length > 0 && (
                  <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 30, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none' }}>
                    {legendOpen ? (
                      <div style={{ pointerEvents: 'auto', margin: 8, padding: '8px 10px', background: '#0B111Cf2', border: '1px solid #1E2A3B', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: '#7F8DA3', textTransform: 'uppercase' }}>Légende — Flux</span>
                          <button onClick={() => setLegendOpen(false)} title="Réduire" style={{ color: '#7F8DA3', lineHeight: 1 }}><X size={12} /></button>
                        </div>
                        {(Object.keys(STREAM_TYPES) as StreamType[]).map(k => (
                          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={STREAM_TYPES[k].color} strokeWidth="2" strokeDasharray={STREAM_TYPES[k].dash} /></svg>
                            <span style={{ fontSize: 10, color: '#B8C3D3' }}>{STREAM_TYPES[k].label}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button onClick={() => setLegendOpen(true)} title="Afficher la légende des flux"
                        style={{ pointerEvents: 'auto', margin: 8, padding: '5px 9px', background: '#0B111Cdd', border: '1px solid #1E2A3B', borderRadius: 8, fontSize: 10, color: '#7F8DA3', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <BarChart3 size={12} /> Légende
                      </button>
                    )}
                  </div>
                )}
                <div style={{ width: canvasW * zoom, height: canvasH * zoom, minWidth: '100%', minHeight: '100%', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: canvasW, height: canvasH, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>

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
                      const cx1 = from.x + NODE_W / 2, cy1 = from.y + NODE_H / 2;
                      const cx2 = to.x + NODE_W / 2,   cy2 = to.y + NODE_H / 2;
                      const dx = cx2 - cx1, dy = cy2 - cy1;
                      const horizontal = Math.abs(dx) >= Math.abs(dy);
                      // Pipe geometry: exit/enter from the side facing the target so
                      // the conduit reads cleanly in a serpentine (side ports for
                      // horizontal runs, top/bottom ports for the vertical folds).
                      let x1: number, y1: number, x2: number, y2: number, d: string, lx: number, ly: number;
                      if (isRecycle) {
                        // Loop-back below the nodes.
                        x1 = from.x + NODE_W / 2; y1 = from.y + NODE_H;
                        x2 = to.x + NODE_W / 2;   y2 = to.y + NODE_H;
                        const dip = Math.max(y1, y2) + 52;
                        d = `M${x1},${y1} C${x1},${dip} ${x2},${dip} ${x2},${y2}`;
                        lx = (x1 + x2) / 2; ly = dip;
                      } else if (horizontal) {
                        x1 = from.x + (dx >= 0 ? NODE_W : 0); y1 = cy1;
                        x2 = to.x + (dx >= 0 ? 0 : NODE_W);   y2 = cy2;
                        const mx = (x1 + x2) / 2;
                        d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
                        lx = mx; ly = (y1 + y2) / 2;
                      } else {
                        // Vertical fold: bottom → top.
                        x1 = cx1; y1 = from.y + (dy >= 0 ? NODE_H : 0);
                        x2 = cx2; y2 = to.y + (dy >= 0 ? 0 : NODE_H);
                        const my = (y1 + y2) / 2;
                        d = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
                        lx = (x1 + x2) / 2; ly = my;
                      }
                      const isDelMode = mode === 'delete';
                      return (
                        <g key={edge.id} style={{ pointerEvents: isDelMode ? 'stroke' : 'none' }}
                          onClick={() => handleEdgeClick(edge.id)}>
                          {/* Pipe casing (grey conduit) */}
                          <path d={d} fill="none" stroke={isDelMode ? '#F8717155' : '#4A5568'} strokeWidth={isDelMode ? 8 : 6.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ cursor: isDelMode ? 'pointer' : 'default' }} />
                          {/* Coloured flow core */}
                          <path d={d} fill="none" stroke={isDelMode ? '#F87171' : st.color} strokeWidth={2.4}
                            strokeLinecap="round" strokeLinejoin="round"
                            strokeDasharray={isDelMode ? undefined : st.dash}
                            markerEnd={isDelMode ? 'url(#arr-del)' : `url(#arr-${edge.type ?? 'process'})`} />
                          {edge.label && !isDelMode && (() => {
                            const w = edge.label.length * 5.6 + 8;
                            return (
                              <g pointerEvents="none">
                                <rect x={lx - w / 2} y={ly - 8} width={w} height={13} rx={3} fill="#0B111C" opacity={0.88} stroke={st.color + '55'} strokeWidth={0.5} />
                                <text x={lx} y={ly + 1.5} textAnchor="middle" fontSize={8.5} fill={st.color} fontWeight={500}>{edge.label}</text>
                              </g>
                            );
                          })()}
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

        {/* ── MODÈLES TAB ──────────────────────────────────────────────── */}
        {activeTab === 'Modèles de circuit' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="mb-5">
              <div className="text-sm font-semibold text-mf-txt mb-1">Modèles de circuit complets</div>
              <p className="text-xs text-mf-txt3 max-w-3xl">
                Six schémas de procédé prêts à charger dans le constructeur — de l'alimentation ROM jusqu'au doré
                et aux résidus, boucles fermées comprises (broyage, régénération du charbon, eau recyclée).
                Le chargement remplace le contenu du canvas ; renommez et sauvegardez pour en faire un flowsheet de projet.
              </p>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {CIRCUIT_TEMPLATES.map(tpl => (
                <div key={tpl.code} className="card flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4">{tpl.family}</div>
                      <div className="text-sm font-semibold text-mf-txt mt-0.5">{tpl.name}</div>
                      <div className="text-[10px] font-mono text-amber-400 mt-0.5">{tpl.code}</div>
                    </div>
                    <button onClick={() => loadTemplate(tpl)} className="btn btn-teal btn-sm gap-1.5 shrink-0">
                      <Network size={13} />Charger
                    </button>
                  </div>
                  <p className="text-xs text-mf-txt3 leading-relaxed">{tpl.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tpl.nodes.map(n => {
                      const cfg = getCfg(n.equipCode);
                      return (
                        <span key={n.id} title={n.label}
                          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                          style={{ color: cfg.color, backgroundColor: cfg.color + '18' }}>
                          {cfg.abbrev}
                        </span>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80 mb-1">Domaine d'emploi</div>
                      <ul className="space-y-1">
                        {tpl.applicability.map(a => (
                          <li key={a} className="text-[10px] text-mf-txt3 flex gap-1.5">
                            <CheckCircle2 size={10} className="shrink-0 mt-0.5 text-emerald-400/70" /><span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80 mb-1">Limites</div>
                      <ul className="space-y-1">
                        {tpl.limitations.map(l => (
                          <li key={l} className="text-[10px] text-mf-txt3 flex gap-1.5">
                            <AlertTriangle size={10} className="shrink-0 mt-0.5 text-amber-400/70" /><span>{l}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="text-[10px] text-mf-txt4 border-t border-mf-border pt-2">
                    {tpl.nodes.length} équipements · {tpl.edges.length} flux ·{' '}
                    {tpl.edges.filter(e => e.type === 'recycle' || e.type === 'water').length} boucles fermées
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── COMPARAISON TAB ──────────────────────────────────────────── */}
        {activeTab === 'Comparaison' && (
          <div className="flex-1 overflow-auto p-6">
            <div className="mb-5">
              <div className="text-sm font-semibold text-mf-txt mb-1">Analyse comparative — Circuits standards</div>
              <p className="text-xs text-mf-txt3">
                Sélectionnez les circuits à comparer. Le radar montre les performances normalisées sur {CIRCUIT_RADAR_AXES.length} axes —
                repères de cadrage issus de la littérature, à recaler sur les essais du projet.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 mb-6">
              {CIRCUIT_TEMPLATES.map(t => {
                const on    = compareSet.has(t.code);
                const color = RADAR_COLORS[Array.from(compareSet).indexOf(t.code) % RADAR_COLORS.length];
                return (
                  <button key={t.code}
                    onClick={() => setCompareSet(prev => { const n = new Set(prev); if (n.has(t.code)) { if (n.size > 1) n.delete(t.code); } else n.add(t.code); return n; })}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${on ? 'bg-mf-card' : 'opacity-40 bg-mf-panel border-mf-border text-mf-txt4'}`}
                    style={on ? { borderColor: color + '60', color } : undefined}>
                    {on ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
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
                      {CIRCUIT_RADAR_AXES.map(a => <th key={a} className="text-right">{a}</th>)}
                      <th className="text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(compareSet).map((code, ci) => {
                      const vals  = radarValues(code);
                      const score = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100);
                      const color = RADAR_COLORS[ci % RADAR_COLORS.length];
                      const tpl   = findCircuitTemplate(code);
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
                  {CIRCUIT_RADAR_AXES.map((ax, axIdx) => (
                    <div key={ax} className="mb-3">
                      <div className="text-[10px] text-mf-txt3 mb-1">{ax}</div>
                      <div className="space-y-1">
                        {Array.from(compareSet).map((code, ci) => {
                          const v     = radarValues(code)[axIdx];
                          const color = RADAR_COLORS[ci % RADAR_COLORS.length];
                          return (
                            <div key={code} className="flex items-center gap-2">
                              <span className="text-[9px] font-mono w-24 truncate text-mf-txt4">{code}</span>
                              <div className="flex-1 bg-mf-panel rounded-full h-1.5 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${v * 100}%`, backgroundColor: color }} />
                              </div>
                              <span className="text-[9px] font-mono w-6 text-right" style={{ color }}>{Math.round(v * 100)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
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
