import { useState, useEffect, useRef } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import * as XLSX from 'xlsx';
import {
  Boxes, Upload, Trash2, RefreshCw, AlertCircle, ChevronRight, FileSpreadsheet, FileText,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';
import { TROY_OZ_GRAMS, DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import { SliceViewer } from '../components/blockmodel/SliceViewer';

const TROY = 1 / TROY_OZ_GRAMS;
const CUTOFFS = [0.0, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const CACHE_TTL = 30_000;

type Tab = 'blocks' | 'stats' | 'profiles' | 'cutoff' | 'resources' | 'gtcurve' | 'benches';
type ResourceCategory = 'Mesuré' | 'Indiqué' | 'Inféré';

const TABS: { id: Tab; label: string }[] = [
  { id: 'blocks',    label: 'Tableur de Blocs' },
  { id: 'stats',     label: 'Statistiques & Distribution' },
  { id: 'profiles',  label: 'Coupes & Profils' },
  { id: 'cutoff',    label: 'Requêtes & Cut-off' },
  { id: 'resources', label: 'Ressources / Réserves' },
  { id: 'gtcurve',   label: 'Grade-Tonnage' },
  { id: 'benches',   label: 'Rapports Bancs' },
];

interface BmConfig {
  id: string; project_id: string; name: string;
  origin_x: number; origin_y: number; origin_z: number;
  block_x: number; block_y: number; block_z: number;
  rotation_deg: number; created_at: string;
}

interface BmBlock {
  id: string; config_id: string;
  i: number; j: number; k: number;
  cx: number; cy: number; cz: number;
  density: number; volume_m3: number;
  au_g_t: number; rock_type: string | null;
  resource_category: ResourceCategory | null;
  attributes: Record<string, unknown> | null;
}

interface AggStats {
  total_blocks: number; total_tonnes: number; avg_grade: number; total_oz: number;
  by_rock: Record<string, { blocks: number; tonnes: number; avg_grade: number; oz: number; max_grade: number }>;
  grade_hist: { bucket: number; count: number }[];
  by_z: { cz: number; blocks: number; tonnes: number; avg_grade: number; oz: number }[];
}

function buildStats(raw: BmBlock[]): AggStats {
  const total_blocks = raw.length;
  let total_tonnes = 0, sum_grade_x_tonnes = 0;
  const by_rock: AggStats['by_rock'] = {};
  const by_z_map: Record<number, { blocks: number; tonnes: number; sum_grade_t: number; oz: number }> = {};
  const hist_counts: Record<number, number> = {};

  for (const b of raw) {
    const t = b.density * b.volume_m3;
    const oz = b.au_g_t * t * TROY;
    total_tonnes += t;
    sum_grade_x_tonnes += b.au_g_t * t;

    const rock = b.rock_type ?? 'Unknown';
    if (!by_rock[rock]) by_rock[rock] = { blocks: 0, tonnes: 0, avg_grade: 0, oz: 0, max_grade: 0 };
    by_rock[rock].blocks += 1;
    by_rock[rock].tonnes += t;
    by_rock[rock].oz += oz;
    by_rock[rock].avg_grade = by_rock[rock].tonnes > 0
      ? (by_rock[rock].avg_grade * (by_rock[rock].tonnes - t) + b.au_g_t * t) / by_rock[rock].tonnes
      : b.au_g_t;
    if (b.au_g_t > by_rock[rock].max_grade) by_rock[rock].max_grade = b.au_g_t;

    const czKey = Math.round(b.cz / 10) * 10;
    if (!by_z_map[czKey]) by_z_map[czKey] = { blocks: 0, tonnes: 0, sum_grade_t: 0, oz: 0 };
    by_z_map[czKey].blocks += 1;
    by_z_map[czKey].tonnes += t;
    by_z_map[czKey].sum_grade_t += b.au_g_t * t;
    by_z_map[czKey].oz += oz;

    const bucket = Math.floor(b.au_g_t / 0.5) * 0.5;
    hist_counts[bucket] = (hist_counts[bucket] ?? 0) + 1;
  }

  const avg_grade = total_tonnes > 0 ? sum_grade_x_tonnes / total_tonnes : 0;
  const total_oz = total_tonnes * avg_grade * TROY;

  Object.values(by_rock).forEach(r => {
    r.avg_grade = r.tonnes > 0 ? (r.oz / TROY) / r.tonnes : 0;
  });

  const grade_hist = Object.entries(hist_counts)
    .map(([k, v]) => ({ bucket: parseFloat(k), count: v }))
    .sort((a, b) => a.bucket - b.bucket);

  const by_z = Object.entries(by_z_map)
    .map(([k, v]) => ({
      cz: parseFloat(k),
      blocks: v.blocks,
      tonnes: v.tonnes,
      avg_grade: v.tonnes > 0 ? v.sum_grade_t / v.tonnes : 0,
      oz: v.oz,
    }))
    .sort((a, b) => b.cz - a.cz);

  return { total_blocks, total_tonnes, avg_grade, total_oz, by_rock, grade_hist, by_z };
}

function buildGT(raw: BmBlock[]) {
  return CUTOFFS.map(co => {
    const above = raw.filter(b => b.au_g_t >= co);
    const tonnes = above.reduce((s, b) => s + b.density * b.volume_m3, 0);
    const oz = above.reduce((s, b) => s + b.au_g_t * b.density * b.volume_m3 * TROY, 0);
    const grade = tonnes > 0 ? (oz / TROY) / tonnes : 0;
    return { co, tonnes, grade, oz };
  });
}

interface BlockModelProps { project: Project }

export function BlockModel({ project }: BlockModelProps) {
  const [tab, setTab] = useState<Tab>('blocks');
  const [configs, setConfigs] = useState<BmConfig[]>([]);
  const [activeConfig, setActiveConfig] = useState<BmConfig | null>(null);
  const [blocks, setBlocks] = useState<BmBlock[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AggStats | null>(null);
  const [rawAll, setRawAll] = useState<BmBlock[]>([]);
  const [cutoff, setCutoff] = useState(0.5);
  const [showImport, setShowImport] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<string[][]>([]);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [reserveModal, setReserveModal] = useState(false);
  const [dilution, setDilution] = useState(5);
  const [mineRecovery, setMineRecovery] = useState(95);
  const [fineLoss, setFineLoss] = useState(2);
  const [rockFilter, setRockFilter] = useState('');
  const PAGE_SIZE = 50;
  const cacheRef = useRef<{ ts: number; data: AggStats; raw: BmBlock[] } | null>(null);

  useEffect(() => { loadConfigs(); }, [project.id]);
  useEffect(() => { if (activeConfig) { loadPage(); } }, [activeConfig, page]);
  useEffect(() => { if (activeConfig) { loadAll(); } }, [activeConfig]);

  async function loadConfigs() {
    setConfigs([]);
    setActiveConfig(null);
    setBlocks([]);
    setStats(null);
    setRawAll([]);
    setTotalCount(0);
    cacheRef.current = null;
    const { data } = await supabase
      .from('bm_configs')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    if (data?.length) {
      setConfigs(data);
      setActiveConfig(data[0]);
    }
  }

  async function loadPage() {
    if (!activeConfig) return;
    setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const { data, count } = await supabase
      .from('bm_blocks')
      .select('*', { count: 'exact' })
      .eq('config_id', activeConfig.id)
      .range(from, from + PAGE_SIZE - 1)
      .order('k').order('j').order('i');
    setBlocks(data ?? []);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  async function loadAll() {
    if (!activeConfig) return;
    const now = Date.now();
    if (cacheRef.current && now - cacheRef.current.ts < CACHE_TTL) {
      setStats(cacheRef.current.data);
      setRawAll(cacheRef.current.raw);
      return;
    }
    // PostgREST caps a single response (Supabase default max-rows = 1000). Page through
    // every block with .range() so stats/tonnage/ounces reflect the WHOLE model, not just
    // the first 1000 rows. Loop is driven by the exact count and advances by rows actually
    // returned, so it is correct whatever the server's per-request cap is.
    const COLS = 'id,config_id,i,j,k,cx,cy,cz,density,volume_m3,au_g_t,rock_type,resource_category,attributes';
    const BATCH = 1000;
    const raw: BmBlock[] = [];
    let from = 0;
    let total = Infinity;
    while (raw.length < total) {
      const { data, count, error } = await supabase
        .from('bm_blocks')
        .select(COLS, from === 0 ? { count: 'exact' } : undefined)
        .eq('config_id', activeConfig.id)
        .order('k').order('j').order('i')
        .range(from, from + BATCH - 1);
      if (error) break;
      if (from === 0 && count != null) total = count;
      const chunk = (data ?? []) as BmBlock[];
      if (chunk.length === 0) break;
      raw.push(...chunk);
      from += chunk.length;
    }
    const agg = buildStats(raw);
    cacheRef.current = { ts: now, data: agg, raw };
    setStats(agg);
    setRawAll(raw);
  }

  const TEMPLATE_ROWS = [
    ['i', 'j', 'k', 'cx', 'cy', 'cz', 'density', 'volume_m3', 'au_g_t', 'rock_type'],
    [0, 0, 0, 5, 5, 5, 2.70, 500, 1.230, 'Oxyde'],
    [1, 0, 0, 15, 5, 5, 2.70, 500, 0.450, 'Oxyde'],
    [0, 1, 0, 5, 15, 5, 2.85, 500, 2.100, 'Sulfure'],
    [1, 1, 0, 15, 15, 5, 2.85, 500, 3.750, 'Sulfure'],
    [0, 0, 1, 5, 5, 15, 2.70, 500, 0.320, 'Oxyde'],
    [1, 0, 1, 15, 5, 15, 2.72, 500, 0.850, 'Transitionnel'],
    [0, 1, 1, 5, 15, 15, 2.88, 500, 1.920, 'Sulfure'],
    [1, 1, 1, 15, 15, 15, 2.90, 500, 4.200, 'Sulfure'],
  ];

  function downloadTemplateCsv() {
    const csv = TEMPLATE_ROWS.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'block_model_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTemplateXlsx() {
    const ws = XLSX.utils.aoa_to_sheet(TEMPLATE_ROWS);
    ws['!cols'] = [6, 6, 6, 8, 8, 8, 10, 12, 10, 14].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BlockModel');
    const infoRows = [
      ['Colonne', 'Type', 'Description', 'Exemples noms acceptés'],
      ['i', 'entier', 'Index colonne X', 'i, ix, icent, col'],
      ['j', 'entier', 'Index rangée Y', 'j, jy, jcent, row'],
      ['k', 'entier', 'Index banc Z', 'k, kz, kcent, bench, lev'],
      ['cx', 'décimal', 'Coordonnée X centroïde (m)', 'cx, x, xc, xcentre, easting, east'],
      ['cy', 'décimal', 'Coordonnée Y centroïde (m)', 'cy, y, yc, ycentre, northing, north'],
      ['cz', 'décimal', 'Coordonnée Z centroïde (m)', 'cz, z, zc, zcentre, elev, rl'],
      ['density', 'décimal', 'Densité t/m³', 'density, dens, sg, sg_t, bulk_density'],
      ['volume_m3', 'décimal', 'Volume du bloc m³', 'volume_m3, vol, volume, vol_m3'],
      ['au_g_t', 'décimal', 'Teneur Au g/t', 'au_g_t, au, au_gt, gold, grade, teneur_au'],
      ['rock_type', 'texte', 'Type de roche', 'rock_type, rock, litho, lith, lithology, domain, code'],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
    wsInfo['!cols'] = [14, 10, 30, 45].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Description colonnes');
    XLSX.writeFile(wb, 'block_model_template.xlsx');
  }

  // Maps common mining software column names → our internal field names
  const COL_ALIASES: Record<string, string> = {
    // Block indices
    'i': 'i', 'ix': 'i', 'icent': 'i', 'col': 'i', 'xi': 'i', 'bi': 'i',
    'j': 'j', 'jy': 'j', 'jcent': 'j', 'row': 'j', 'yj': 'j', 'bj': 'j',
    'k': 'k', 'kz': 'k', 'kcent': 'k', 'lev': 'k', 'bk': 'k', 'bench': 'k',
    // Coordinates
    'cx': 'cx', 'xc': 'cx', 'x': 'cx', 'xcentre': 'cx', 'xcent': 'cx', 'xm': 'cx', 'xcoord': 'cx', 'east': 'cx', 'easting': 'cx',
    'cy': 'cy', 'yc': 'cy', 'y': 'cy', 'ycentre': 'cy', 'ycent': 'cy', 'ym': 'cy', 'ycoord': 'cy', 'north': 'cy', 'northing': 'cy',
    'cz': 'cz', 'zc': 'cz', 'z': 'cz', 'zcentre': 'cz', 'zcent': 'cz', 'zm': 'cz', 'zcoord': 'cz', 'elev': 'cz', 'elevation': 'cz', 'rl': 'cz',
    // Gold grade — all common variants
    'au_g_t': 'au_g_t', 'au': 'au_g_t', 'au_gt': 'au_g_t', 'au_ppm': 'au_g_t',
    'gold': 'au_g_t', 'gold_g_t': 'au_g_t', 'grade': 'au_g_t', 'au_grade': 'au_g_t',
    'aug_t': 'au_g_t', 'au(g/t)': 'au_g_t', 'au g/t': 'au_g_t',
    'teneur': 'au_g_t', 'teneur_au': 'au_g_t', 'ten_au': 'au_g_t',
    // Density
    'density': 'density', 'dens': 'density', 'sg': 'density', 'sp_grav': 'density',
    'sg_t': 'density', 'densité': 'density', 'densite': 'density', 'bulk_density': 'density',
    // Volume
    'volume_m3': 'volume_m3', 'vol': 'volume_m3', 'volume': 'volume_m3', 'vol_m3': 'volume_m3', 'volm3': 'volume_m3',
    // Rock type
    'rock_type': 'rock_type', 'rock': 'rock_type', 'rocktype': 'rock_type', 'litho': 'rock_type',
    'lithology': 'rock_type', 'lith': 'rock_type', 'code': 'rock_type', 'domain': 'rock_type',
    'ore_type': 'rock_type', 'oretype': 'rock_type', 'type': 'rock_type', 'type_roche': 'rock_type',
  };

  function autoMapHeaders(headers: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const h of headers) {
      const norm = h.trim().toLowerCase().replace(/[\s\-/\\()]/g, '_');
      const alias = COL_ALIASES[norm] ?? COL_ALIASES[h.trim().toLowerCase()];
      if (alias) map[alias] = h;
    }
    return map;
  }

  async function parseFile(file: File): Promise<string[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) return reject(new Error('Fichier vide'));
          // Try reading as binary (works for XLSX and CSV)
          let wb: ReturnType<typeof XLSX.read>;
          try {
            wb = XLSX.read(data, { type: 'binary' });
          } catch {
            return reject(new Error('Format non reconnu. Utilisez .csv ou .xlsx'));
          }
          const sheetName = wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' }) as (string | number)[][];
          const strRows = rows.map(r => r.map(c => String(c)));
          const filled = strRows.filter(r => r.some(c => c.trim() !== ''));
          if (!filled.length) return reject(new Error('Aucune donnée trouvée dans le fichier'));
          resolve(filled);
        } catch (err) {
          reject(new Error('Impossible de lire le fichier. Vérifiez le format CSV ou XLSX.'));
        }
      };
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
      reader.readAsBinaryString(file);
    });
  }

  async function handleFileSelect(file: File) {
    setImportError('');
    setImportPreview([]);
    setColMap({});
    setRawHeaders([]);
    setImportFile(file);
    try {
      const rows = await parseFile(file);
      const headers = rows[0] ?? [];
      setRawHeaders(headers);
      const mapped = autoMapHeaders(headers);
      setColMap(mapped);
      setImportPreview(rows.slice(0, 6));
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Erreur lecture fichier');
    }
  }

  function rowsToBlocks(rows: string[][], mapping: Record<string, string>): Omit<BmBlock, 'id' | 'config_id'>[] {
    if (rows.length < 2) throw new Error('Le fichier doit contenir une ligne d\'en-tête + données.');
    const header = rows[0].map(h => h.trim());
    const colIdx = (field: string): number => {
      const colName = mapping[field];
      if (!colName) return -1;
      return header.findIndex(h => h === colName);
    };
    const getNum = (vals: string[], field: string): number => {
      const idx = colIdx(field);
      if (idx < 0) return 0;
      return parseFloat(vals[idx] ?? '') || 0;
    };
    const getStr = (vals: string[], field: string): string | null => {
      const idx = colIdx(field);
      if (idx < 0) return null;
      return vals[idx]?.trim() || null;
    };

    // Validate required fields are mapped
    const missing = ['i', 'j', 'k', 'au_g_t'].filter(f => colIdx(f) < 0);
    if (missing.length) throw new Error(`Colonnes non mappées: ${missing.join(', ')}. Vérifiez la correspondance des colonnes.`);

    return rows.slice(1)
      .filter(r => r.some(c => c.trim() !== ''))
      .map(vals => ({
        i: getNum(vals, 'i'), j: getNum(vals, 'j'), k: getNum(vals, 'k'),
        cx: getNum(vals, 'cx'), cy: getNum(vals, 'cy'), cz: getNum(vals, 'cz'),
        density: getNum(vals, 'density') || DEFAULT_ASSUMPTIONS.DEFAULT_ORE_SG_T_M3,
        volume_m3: getNum(vals, 'volume_m3') || 500,
        au_g_t: getNum(vals, 'au_g_t'),
        rock_type: getStr(vals, 'rock_type'),
        resource_category: null,
        attributes: null,
      }));
  }

  async function handleImport() {
    setImportError('');
    setImporting(true);
    try {
      // Auto-create a default config for new projects that have none
      let cfg = activeConfig;
      if (!cfg) {
        const { data: newCfg, error: cfgErr } = await supabase
          .from('bm_configs')
          .insert({
            project_id: project.id,
            name: 'Configuration principale',
            origin_x: 0, origin_y: 0, origin_z: 0,
            block_x: 10, block_y: 10, block_z: 10,
            rotation_deg: 0,
          })
          .select('*')
          .maybeSingle();
        if (cfgErr || !newCfg) throw new Error('Impossible de créer la configuration du modèle de blocs.');
        cfg = newCfg;
        setActiveConfig(newCfg);
        setConfigs([newCfg]);
      }

      let blocks: Omit<BmBlock, 'id' | 'config_id'>[];
      if (importFile) {
        const rows = await parseFile(importFile);
        blocks = rowsToBlocks(rows, colMap);
      } else if (importText.trim()) {
        const wb = XLSX.read(importText, { type: 'string' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][];
        const strRows = rows.map(r => r.map(c => String(c)));
        const mapped = autoMapHeaders(strRows[0] ?? []);
        blocks = rowsToBlocks(strRows, mapped);
      } else {
        throw new Error('Aucun fichier sélectionné et aucun texte CSV collé.');
      }
      if (!blocks.length) throw new Error('Aucun bloc valide dans le fichier.');
      const payload = blocks.map(r => ({ ...r, config_id: cfg!.id, project_id: project.id }));
      const CHUNK = 500;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const { error } = await supabase.from('bm_blocks').upsert(payload.slice(i, i + CHUNK), { onConflict: 'config_id,i,j,k' });
        if (error) throw error;
      }
      setShowImport(false);
      setImportText(''); setImportFile(null); setImportPreview([]);
      setColMap({}); setRawHeaders([]);
      cacheRef.current = null;
      loadPage(); loadAll();
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
    setImporting(false);
  }

  async function handleRefresh() {
    cacheRef.current = null;
    setPage(1);
    await loadPage();
    await loadAll();
  }

  async function handleDeleteAll() {
    if (!activeConfig) return;
    await supabase.from('bm_blocks').delete().eq('config_id', activeConfig.id).eq('project_id', project.id);
    cacheRef.current = null;
    setBlocks([]);
    setTotalCount(0);
    setStats(null);
    setRawAll([]);
    setShowDeleteModal(false);
  }

  async function handleCategoryChange(blockId: string, cat: ResourceCategory | null) {
    await supabase.from('bm_blocks').update({ resource_category: cat }).eq('id', blockId).eq('project_id', project.id);
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, resource_category: cat } : b));
  }

  const filteredBlocks = rockFilter
    ? blocks.filter(b => (b.rock_type ?? '').toLowerCase().includes(rockFilter.toLowerCase()))
    : blocks;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const cutoffBlocks = rawAll.filter(b => b.au_g_t >= cutoff);
  const cutoffTonnes = cutoffBlocks.reduce((s, b) => s + b.density * b.volume_m3, 0);
  const cutoffOz = cutoffBlocks.reduce((s, b) => s + b.au_g_t * b.density * b.volume_m3 * TROY, 0);
  const cutoffGrade = cutoffTonnes > 0 ? (cutoffOz / TROY) / cutoffTonnes : 0;

  const gtData = rawAll.length ? buildGT(rawAll) : [];

  function reserveCalc(tonnes: number, grade: number) {
    const t = tonnes * (1 + dilution / 100) * (mineRecovery / 100) * (1 - fineLoss / 100);
    const oz = t * grade * TROY;
    return { tonnes: t, oz };
  }

  // ─── KPI row ──────────────────────────────────────────────────────────────────
  const kpis = [
    {
      label: 'BLOCS', value: stats ? formatDecimalGrouped(stats.total_blocks, 0) : '—',
      sub: activeConfig?.name ?? 'Aucune config', color: 'text-sky-400',
    },
    {
      label: 'TONNAGE', value: stats ? `${formatDecimalGrouped((stats.total_tonnes / 1e6), 2)} Mt` : '—',
      sub: 'Tonnes métriques totales', color: 'text-emerald-400',
    },
    {
      label: 'TENEUR AU', value: stats ? `${formatDecimalGrouped(stats.avg_grade, 3)} g/t` : '—',
      sub: 'Teneur pondérée par masse', color: 'text-amber-400',
    },
    {
      label: 'ONCES AU', value: stats ? `${formatDecimalGrouped((stats.total_oz / 1000), 1)} koz` : '—',
      sub: 'Onces troy totales', color: 'text-amber-400',
    },
  ];

  // ─── SVG GT curve helpers ─────────────────────────────────────────────────────
  const svgW = 640, svgH = 280, padL = 56, padR = 56, padT = 16, padB = 40;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  function toSvgPoints(vals: number[], mn: number, mx: number): string {
    return gtData.map((_, i) => {
      const x = padL + (i / (gtData.length - 1)) * plotW;
      const y = padT + (1 - (vals[i] - mn) / (mx - mn || 1)) * plotH;
      return `${x},${y}`;
    }).join(' ');
  }

  const maxTonnes = Math.max(...gtData.map(d => d.tonnes), 1);
  const maxGrade  = Math.max(...gtData.map(d => d.grade), 1);
  const maxOz     = Math.max(...gtData.map(d => d.oz), 1);

  const tonnesPts = toSvgPoints(gtData.map(d => d.tonnes), 0, maxTonnes);
  const gradePts  = toSvgPoints(gtData.map(d => d.grade), 0, maxGrade);
  const ozPts     = toSvgPoints(gtData.map(d => d.oz), 0, maxOz);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<Boxes size={20} />}
        title="Block Model"
        breadcrumb={['Projet', 'Géologie & Caractérisation', 'Block Model']}
        actions={
          <div className="flex gap-2">
            <button onClick={handleRefresh} className="btn btn-secondary flex items-center gap-1.5">
              <RefreshCw size={14} /> Actualiser
            </button>
            <button onClick={downloadTemplateCsv} className="btn btn-secondary flex items-center gap-1.5">
              <FileText size={14} /> Template CSV
            </button>
            <button onClick={downloadTemplateXlsx} className="btn btn-secondary flex items-center gap-1.5">
              <FileSpreadsheet size={14} /> Template XLSX
            </button>
            <button onClick={() => setShowImport(true)} className="btn btn-teal flex items-center gap-1.5">
              <Upload size={14} /> Importer Excel/CSV
            </button>
            {activeConfig && (
              <button onClick={() => setShowDeleteModal(true)} className="btn flex items-center gap-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 p-4">
        {kpis.map(k => (
          <div key={k.label} className="card-sm">
            <div className="text-xs font-semibold tracking-widest mf-txt3 mb-1">{k.label}</div>
            <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
            <div className="text-xs mf-txt4 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b mf-border px-4">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              tab === t.id
                ? 'border-sky-400 text-sky-300'
                : 'border-transparent mf-txt3 hover:mf-txt'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* ── Tableur de Blocs ─────────────────────────────────────────────────── */}
        {tab === 'blocks' && (
          <div className="space-y-3">
            <div className="flex gap-3 items-center">
              <input
                className="input-field text-sm w-64"
                placeholder="Filtrer par rock type…"
                value={rockFilter}
                onChange={e => setRockFilter(e.target.value)}
              />
              <span className="text-xs mf-txt3">{formatDecimalGrouped(totalCount, 0)} blocs</span>
            </div>
            {loading ? (
              <div className="text-center mf-txt3 py-12 text-sm">Chargement…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['I','J','K','CX','CY','CZ','Densité','Vol (m³)','Au (g/t)','Rock','Catégorie'].map(h => (
                        <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBlocks.map(b => (
                      <tr key={b.id} className="hover:bg-white/5 border-b border-white/5">
                        <td className="px-2 py-1.5">{b.i}</td>
                        <td className="px-2 py-1.5">{b.j}</td>
                        <td className="px-2 py-1.5">{b.k}</td>
                        <td className="px-2 py-1.5">{formatDecimalGrouped(b.cx, 1)}</td>
                        <td className="px-2 py-1.5">{formatDecimalGrouped(b.cy, 1)}</td>
                        <td className="px-2 py-1.5">{formatDecimalGrouped(b.cz, 1)}</td>
                        <td className="px-2 py-1.5">{formatDecimalGrouped(b.density, 2)}</td>
                        <td className="px-2 py-1.5">{formatDecimalGrouped(b.volume_m3, 0)}</td>
                        <td className={`px-2 py-1.5 font-semibold ${b.au_g_t >= 1 ? 'text-amber-400' : b.au_g_t >= 0.5 ? 'text-yellow-300' : 'mf-txt2'}`}>
                          {formatDecimalGrouped(b.au_g_t, 3)}
                        </td>
                        <td className="px-2 py-1.5 mf-txt2">{b.rock_type ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <select
                            value={b.resource_category ?? ''}
                            onChange={e => handleCategoryChange(b.id, (e.target.value as ResourceCategory) || null)}
                            className="bg-transparent border border-white/10 rounded text-xs px-1 py-0.5 mf-txt"
                          >
                            <option value="">—</option>
                            <option value="Mesuré">Mesuré</option>
                            <option value="Indiqué">Indiqué</option>
                            <option value="Inféré">Inféré</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                    {filteredBlocks.length === 0 && (
                      <tr><td colSpan={11} className="px-2 py-8 text-center mf-txt3 text-sm">Aucun bloc chargé</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex gap-2 items-center justify-end pt-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="btn btn-sm btn-secondary">‹</button>
                <span className="text-xs mf-txt3">Page {page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="btn btn-sm btn-secondary">›</button>
              </div>
            )}
          </div>
        )}

        {/* ── Statistiques & Distribution ──────────────────────────────────────── */}
        {tab === 'stats' && stats && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {Object.entries(stats.by_rock).map(([rock, r]) => (
                <div key={rock} className="card-sm space-y-1">
                  <div className="font-semibold text-sm mf-txt">{rock}</div>
                  <div className="text-xs mf-txt3">{formatDecimalGrouped(r.blocks, 0)} blocs · {formatDecimalGrouped((r.tonnes / 1e6), 3)} Mt</div>
                  <div className="text-amber-400 font-bold">{formatDecimalGrouped(r.avg_grade, 3)} g/t moy.</div>
                  <div className="text-xs mf-txt4">Max: {formatDecimalGrouped(r.max_grade, 3)} g/t · {formatDecimalGrouped((r.oz / 1000), 1)} koz</div>
                </div>
              ))}
            </div>
            {/* Histogram */}
            <div className="card-sm">
              <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Distribution des Teneurs (g/t Au)</div>
              {stats.grade_hist.length > 0 ? (() => {
                const maxCount = Math.max(...stats.grade_hist.map(x => x.count), 1);
                return (
                  <div>
                    {/* Bars — each column is h-full so the % height resolves against the h-32 row */}
                    <div className="flex items-end gap-1 h-32">
                      {stats.grade_hist.map(h => (
                        <div
                          key={h.bucket}
                          className="flex-1 h-full flex items-end"
                          title={`${formatDecimalGrouped(h.bucket, 1)}–${formatDecimalGrouped((h.bucket + 0.5), 1)} g/t · ${formatDecimalGrouped(h.count, 0)} blocs`}
                        >
                          <div
                            className="w-full bg-amber-400/70 hover:bg-amber-400 rounded-t transition-all"
                            style={{ height: `${Math.max((h.count / maxCount) * 100, 2)}%` }}
                          />
                        </div>
                      ))}
                    </div>
                    {/* Aligned axis labels */}
                    <div className="flex gap-1 mt-1">
                      {stats.grade_hist.map(h => (
                        <div key={h.bucket} className="flex-1 text-center text-[9px] mf-txt4">{formatDecimalGrouped(h.bucket, 1)}</div>
                      ))}
                    </div>
                  </div>
                );
              })() : (
                <div className="text-center mf-txt3 py-8 text-sm">Aucune donnée</div>
              )}
            </div>
          </div>
        )}
        {tab === 'stats' && !stats && (
          <div className="text-center mf-txt3 py-12 text-sm">Aucune donnée disponible</div>
        )}

        {/* ── Coupes & Profils ─────────────────────────────────────────────────── */}
        {tab === 'profiles' && stats && (
          <div className="space-y-4">
          {rawAll.length > 0 && (
            <div className="card-sm">
              <SliceViewer blocks={rawAll} />
            </div>
          )}
          <div className="card-sm">
            <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Profil par Banc (Z)</div>
            {stats.by_z.length > 0 ? (() => {
              const maxT = Math.max(...stats.by_z.map(r => r.tonnes), 1);
              const maxG = Math.max(...stats.by_z.map(r => r.avg_grade), 1);
              const rowH = 22;
              const totalH = stats.by_z.length * rowH + 34;
              // Fixed, aligned tracks so headers sit exactly above their data columns.
              const benchX = 8;
              const tX = 66, tW = 150;     // Tonnes bar track
              const gX = 330, gW = 190;    // Grade bar track
              return (
                <svg viewBox={`0 0 640 ${totalH}`} className="w-full font-mono text-xs">
                  <text x={benchX} y={14} fill="#6B7280" fontSize={10}>Banc CZ</text>
                  <text x={tX} y={14} fill="#6B7280" fontSize={10}>Tonnes</text>
                  <text x={gX} y={14} fill="#6B7280" fontSize={10}>Teneur (g/t)</text>
                  {stats.by_z.map((row, i) => {
                    const y = 24 + i * rowH;
                    const tPct = row.tonnes / maxT;
                    const gPct = row.avg_grade / maxG;
                    return (
                      <g key={row.cz}>
                        <text x={benchX} y={y + 12} fill="#9CA3AF" fontSize={9}>{formatDecimalGrouped(row.cz, 0)}</text>
                        <rect x={tX} y={y + 3} width={Math.max(tW * tPct, 1)} height={13} rx={2} fill="#3B82F6" opacity={0.55} />
                        <text x={tX + tW + 6} y={y + 12} fill="#93B4E0" fontSize={8}>{formatDecimalGrouped((row.tonnes / 1000), 0)}kt</text>
                        <rect x={gX} y={y + 3} width={Math.max(gW * gPct, 1)} height={13} rx={2} fill="#F59E0B" opacity={0.5} />
                        <text x={gX + gW * gPct + 6} y={y + 12} fill="#F59E0B" fontSize={9}>{formatDecimalGrouped(row.avg_grade, 3)}</text>
                      </g>
                    );
                  })}
                </svg>
              );
            })() : (
              <div className="text-center mf-txt3 py-8 text-sm">Aucune donnée</div>
            )}
          </div>
          </div>
        )}

        {/* ── Requêtes & Cut-off ───────────────────────────────────────────────── */}
        {tab === 'cutoff' && (
          <div className="space-y-4">
            <div className="flex gap-4 items-center">
              <label className="text-xs mf-txt3 font-semibold">Cut-off Au (g/t)</label>
              <input
                type="number" step="0.1" min="0" max="10"
                value={cutoff}
                onChange={e => setCutoff(parseFloat(e.target.value) || 0)}
                className="input-field w-28 text-sm"
              />
            </div>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Blocs ≥ cut-off', value: formatDecimalGrouped(cutoffBlocks.length, 0), color: 'text-sky-400' },
                { label: 'Tonnes ≥ cut-off', value: `${formatDecimalGrouped((cutoffTonnes / 1e6), 3)} Mt`, color: 'text-emerald-400' },
                { label: 'Teneur moyenne', value: `${formatDecimalGrouped(cutoffGrade, 3)} g/t`, color: 'text-amber-400' },
                { label: 'Onces contenues', value: `${formatDecimalGrouped((cutoffOz / 1000), 1)} koz`, color: 'text-amber-400' },
              ].map(k => (
                <div key={k.label} className="card-sm">
                  <div className="text-xs mf-txt3 mb-1">{k.label}</div>
                  <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr>
                    {['Cut-off (g/t)', 'Blocs', 'Tonnes (Mt)', 'Teneur (g/t)', 'Onces (koz)', '% Tonnes', '% Onces'].map(h => (
                      <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gtData.map(row => (
                    <tr key={row.co} className={`border-b border-white/5 hover:bg-white/5 ${row.co === cutoff ? 'bg-amber-400/5' : ''}`}>
                      <td className="px-3 py-1.5 font-semibold text-amber-300">{formatDecimalGrouped(row.co, 1)}</td>
                      <td className="px-3 py-1.5">{formatDecimalGrouped(rawAll.filter(b => b.au_g_t >= row.co).length, 0)}</td>
                      <td className="px-3 py-1.5">{formatDecimalGrouped((row.tonnes / 1e6), 3)}</td>
                      <td className="px-3 py-1.5">{formatDecimalGrouped(row.grade, 3)}</td>
                      <td className="px-3 py-1.5">{formatDecimalGrouped((row.oz / 1000), 1)}</td>
                      <td className="px-3 py-1.5">{stats ? formatDecimalGrouped(((row.tonnes / stats.total_tonnes) * 100), 1) + '%' : '—'}</td>
                      <td className="px-3 py-1.5">{stats ? formatDecimalGrouped(((row.oz / stats.total_oz) * 100), 1) + '%' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Ressources / Réserves ────────────────────────────────────────────── */}
        {tab === 'resources' && (
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm font-semibold mf-txt mb-1">Classification NI 43-101 / CIM 2019</div>
                <div className="text-xs mf-txt4">Ressources minérales par catégorie et type de roche</div>
              </div>
              <button onClick={() => setReserveModal(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                <ChevronRight size={13} /> Calculer Réserves
              </button>
            </div>
            {(['Mesuré', 'Indiqué', 'Inféré'] as ResourceCategory[]).map(cat => {
              const catBlocks = rawAll.filter(b => b.resource_category === cat);
              const tonnes = catBlocks.reduce((s, b) => s + b.density * b.volume_m3, 0);
              const oz = catBlocks.reduce((s, b) => s + b.au_g_t * b.density * b.volume_m3 * TROY, 0);
              const grade = tonnes > 0 ? (oz / TROY) / tonnes : 0;
              const catColor: Record<ResourceCategory, string> = {
                'Mesuré': 'text-sky-400', 'Indiqué': 'text-emerald-400', 'Inféré': 'text-amber-400',
              };
              return (
                <div key={cat} className="card-sm">
                  <div className={`text-sm font-bold ${catColor[cat]} mb-2`}>{cat}</div>
                  <div className="grid grid-cols-4 gap-4 text-xs">
                    <div><div className="mf-txt3">Blocs</div><div className="font-bold mf-txt">{formatDecimalGrouped(catBlocks.length, 0)}</div></div>
                    <div><div className="mf-txt3">Tonnes</div><div className="font-bold mf-txt">{formatDecimalGrouped((tonnes / 1e6), 3)} Mt</div></div>
                    <div><div className="mf-txt3">Teneur</div><div className="font-bold mf-txt">{formatDecimalGrouped(grade, 3)} g/t</div></div>
                    <div><div className="mf-txt3">Onces</div><div className={`font-bold ${catColor[cat]}`}>{formatDecimalGrouped((oz / 1000), 1)} koz</div></div>
                  </div>
                </div>
              );
            })}
            <div className="card-sm bg-amber-400/5 border border-amber-400/20">
              <div className="flex gap-2 items-start">
                <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs mf-txt3">
                  Les catégories de ressources doivent être assignées bloc par bloc dans l'onglet <strong className="mf-txt">Tableur de Blocs</strong>.
                  Assurez-vous que les paramètres géostatistiques (variance d'estimation, distances de recherche) sont validés avant de soumettre une déclaration NI 43-101.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Grade-Tonnage Curve ──────────────────────────────────────────────── */}
        {tab === 'gtcurve' && (
          <div className="card-sm">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Courbe Grade-Tonnage (Au)</div>
              {gtData.length > 0 && (
                <div className="flex items-center gap-4">
                  {[
                    { color: '#3B82F6', label: 'Tonnage' },
                    { color: '#F59E0B', label: 'Teneur' },
                    { color: '#10B981', label: 'Onces' },
                  ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: l.color }} />
                      <span className="text-[10px] mf-txt3">{l.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {gtData.length > 0 ? (
              <>
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full">
                  {/* Grid */}
                  {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <line key={f} x1={padL} y1={padT + f * plotH} x2={padL + plotW} y2={padT + f * plotH}
                      stroke="#ffffff10" strokeWidth={1} />
                  ))}
                  {/* X-axis labels */}
                  {gtData.map((d, i) => (
                    <text key={i} x={padL + (i / (gtData.length - 1)) * plotW} y={svgH - 6}
                      fill="#6B7280" fontSize={9} textAnchor="middle">{formatDecimalGrouped(d.co, 1)}</text>
                  ))}
                  <text x={padL + plotW / 2} y={svgH - 0} fill="#6B7280" fontSize={9} textAnchor="middle">Cut-off Au (g/t)</text>
                  {/* Lines */}
                  <polyline points={tonnesPts} fill="none" stroke="#3B82F6" strokeWidth={2} />
                  <polyline points={gradePts}  fill="none" stroke="#F59E0B" strokeWidth={2} />
                  <polyline points={ozPts}     fill="none" stroke="#10B981" strokeWidth={2} />
                </svg>
                <div className="overflow-x-auto mt-2">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['Cut-off (g/t)', 'Tonnes (Mt)', 'Teneur (g/t)', 'Onces (koz)'].map(h => (
                          <th key={h} className="text-left px-3 py-1.5 mf-txt3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gtData.map(d => (
                        <tr key={d.co} className="border-b border-white/5">
                          <td className="px-3 py-1 text-amber-300 font-semibold">{formatDecimalGrouped(d.co, 1)}</td>
                          <td className="px-3 py-1">{formatDecimalGrouped((d.tonnes / 1e6), 3)}</td>
                          <td className="px-3 py-1">{formatDecimalGrouped(d.grade, 3)}</td>
                          <td className="px-3 py-1">{formatDecimalGrouped((d.oz / 1000), 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="text-center mf-txt3 py-12 text-sm">Importer des blocs pour générer la courbe</div>
            )}
          </div>
        )}

        {/* ── Rapports Bancs ───────────────────────────────────────────────────── */}
        {tab === 'benches' && stats && (
          <div className="space-y-3">
            <div className="text-xs mf-txt3 font-semibold uppercase tracking-wider">Rapport par Banc</div>
            <div className="overflow-x-auto">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr>
                    {['Banc (CZ)', 'Blocs', 'Tonnes (kt)', 'Teneur (g/t)', 'Onces (oz)', '% Tonnes cumul.'].map(h => (
                      <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let cumT = 0;
                    return stats.by_z.map(row => {
                      cumT += row.tonnes;
                      return (
                        <tr key={row.cz} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-3 py-1.5 font-semibold mf-txt">{formatDecimalGrouped(row.cz, 0)}</td>
                          <td className="px-3 py-1.5">{row.blocks}</td>
                          <td className="px-3 py-1.5">{formatDecimalGrouped((row.tonnes / 1000), 1)}</td>
                          <td className={`px-3 py-1.5 font-semibold ${row.avg_grade >= 1 ? 'text-amber-400' : 'mf-txt2'}`}>
                            {formatDecimalGrouped(row.avg_grade, 3)}
                          </td>
                          <td className="px-3 py-1.5">{formatDecimalGrouped(row.oz, 0)}</td>
                          <td className="px-3 py-1.5 mf-txt3">
                            {stats.total_tonnes > 0 ? formatDecimalGrouped(((cumT / stats.total_tonnes) * 100), 1) + '%' : '—'}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'benches' && !stats && (
          <div className="text-center mf-txt3 py-12 text-sm">Aucune donnée disponible</div>
        )}

        {/* ── No config ─────────────────────────────────────────────────────────── */}
        {!activeConfig && (
          <div className="text-center mf-txt3 py-16">
            <Boxes size={40} className="mx-auto mb-3 opacity-30" />
            <div className="text-sm">Aucune configuration de bloc pour ce projet.</div>
            <div className="text-xs mt-1">Importez un fichier CSV pour créer automatiquement une configuration.</div>
          </div>
        )}
      </div>

      {/* ── Import Modal ──────────────────────────────────────────────────────── */}
      {showImport && (
        <Modal
          title="Importer Blocs (CSV ou XLSX)"
          onClose={() => { setShowImport(false); setImportFile(null); setImportText(''); setImportPreview([]); setColMap({}); setRawHeaders([]); setImportError(''); }}
        >
          <div className="space-y-4 p-4 w-[620px] max-w-full">
            {/* Instructions */}
            <div className="flex gap-2 p-3 rounded-lg bg-sky-500/8 border border-sky-500/20 text-xs text-mf-txt3">
              <AlertCircle size={13} className="text-sky-400 shrink-0 mt-0.5" />
              <div>
                Tout format de block model est accepté — le système détecte automatiquement vos colonnes
                (Vulcan, Datamine, Leapfrog, GEMS, etc.). Colonnes minimales requises&nbsp;:
                <code className="bg-white/10 px-1 mx-0.5 rounded">i/j/k</code> ou
                <code className="bg-white/10 px-1 mx-0.5 rounded">X/Y/Z</code> +
                <code className="bg-white/10 px-1 mx-0.5 rounded">AU</code>.
              </div>
            </div>

            {/* Download template buttons */}
            <div className="flex gap-2">
              <button onClick={downloadTemplateCsv} className="btn btn-sm btn-secondary flex items-center gap-1.5 text-xs">
                <FileText size={12} /> Template CSV
              </button>
              <button onClick={downloadTemplateXlsx} className="btn btn-sm btn-secondary flex items-center gap-1.5 text-xs">
                <FileSpreadsheet size={12} /> Template XLSX
              </button>
            </div>

            {/* File drop zone */}
            <label
              className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-7 cursor-pointer transition-colors ${
                importFile ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/15 hover:border-amber-400/30 hover:bg-amber-400/4'
              }`}
            >
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
              <Upload size={22} className={importFile ? 'text-emerald-400' : 'text-mf-txt4'} />
              {importFile ? (
                <div className="text-center">
                  <div className="text-sm font-semibold text-emerald-400">{importFile.name}</div>
                  <div className="text-xs text-mf-txt4 mt-0.5">{formatDecimalGrouped((importFile.size / 1024), 1)} Ko · cliquez pour changer</div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-sm font-semibold text-mf-txt">Glissez un fichier ou cliquez pour parcourir</div>
                  <div className="text-xs text-mf-txt4 mt-0.5">Accepté: .csv · .xlsx · .xls (tous formats mining)</div>
                </div>
              )}
            </label>

            {/* Column mapping — shown when file is loaded */}
            {rawHeaders.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Correspondance des colonnes</div>
                  <div className="text-[10px] text-mf-txt4">{rawHeaders.length} colonnes détectées</div>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {(['i', 'j', 'k', 'au_g_t', 'cx', 'cy', 'cz', 'density', 'volume_m3', 'rock_type'] as const).map(field => {
                    const required = ['i', 'j', 'k', 'au_g_t'].includes(field);
                    const labels: Record<string, string> = {
                      i: 'Index I (X)', j: 'Index J (Y)', k: 'Index K (Z)',
                      au_g_t: 'Teneur Au (g/t) *', cx: 'Coord. X', cy: 'Coord. Y', cz: 'Coord. Z',
                      density: 'Densité (t/m³)', volume_m3: 'Volume (m³)', rock_type: 'Type roche',
                    };
                    return (
                      <div key={field} className={`flex items-center gap-2 p-2 rounded-lg border ${required && !colMap[field] ? 'border-red-500/30 bg-red-500/5' : 'border-white/8 bg-white/3'}`}>
                        <div className="text-xs text-mf-txt3 w-28 shrink-0">{labels[field]}</div>
                        <select
                          className="flex-1 bg-mf-panel border border-mf-border rounded px-1.5 py-1 text-xs text-mf-txt"
                          value={colMap[field] ?? ''}
                          onChange={e => setColMap(prev => ({ ...prev, [field]: e.target.value || '' }))}
                        >
                          <option value="">— non mappé —</option>
                          {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        {colMap[field]
                          ? <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" title="Mappé" />
                          : <div className={`w-3 h-3 rounded-full shrink-0 ${required ? 'bg-red-500' : 'bg-white/20'}`} title={required ? 'Requis' : 'Optionnel'} />
                        }
                      </div>
                    );
                  })}
                </div>
                <div className="text-[10px] text-mf-txt4 mt-1.5">* = obligatoire · Les colonnes non mappées utilisent des valeurs par défaut</div>
              </div>
            )}

            {/* Preview table */}
            {importPreview.length > 0 && (
              <div>
                <div className="text-xs text-mf-txt3 mb-1.5 font-semibold">Aperçu — {importPreview.length - 1} lignes affichées sur {importFile ? '…' : '?'}</div>
                <div className="overflow-x-auto rounded-lg border border-white/8 max-h-32">
                  <table className="text-xs w-full">
                    <thead className="sticky top-0">
                      <tr>
                        {importPreview[0]?.map((h, i) => (
                          <th key={i} className="px-2 py-1.5 bg-mf-panel text-left text-mf-txt3 font-semibold whitespace-nowrap border-b border-white/8">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.slice(1).map((row, ri) => (
                        <tr key={ri} className="border-t border-white/5 hover:bg-white/3">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1 text-mf-txt whitespace-nowrap">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* CSV paste fallback */}
            <details>
              <summary className="text-xs text-mf-txt4 cursor-pointer hover:text-mf-txt3 transition-colors select-none">
                Ou coller du texte CSV manuellement…
              </summary>
              <textarea
                rows={5}
                className="input-field w-full text-xs font-mono mt-2"
                placeholder="i,j,k,au_g_t&#10;0,0,0,1.23&#10;…"
                value={importText}
                onChange={e => { setImportText(e.target.value); setImportFile(null); setImportPreview([]); setColMap({}); setRawHeaders([]); }}
              />
            </details>

            {importError && (
              <div className="flex gap-2 text-xs text-red-400 p-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
                <AlertCircle size={13} className="shrink-0 mt-0.5" /> {importError}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1 border-t border-white/5">
              <button
                onClick={() => { setShowImport(false); setImportFile(null); setImportText(''); setImportPreview([]); setColMap({}); setRawHeaders([]); setImportError(''); }}
                className="btn btn-secondary"
              >
                Annuler
              </button>
              <button
                onClick={handleImport}
                disabled={importing || (!importFile && !importText.trim())}
                className="btn btn-teal flex items-center gap-1.5"
              >
                <Upload size={13} />
                {importing ? `Importation…` : `Importer${importFile ? ` (${importFile.name})` : ''}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Modal ──────────────────────────────────────────────────────── */}
      {showDeleteModal && (
        <Modal title="Supprimer tous les blocs" onClose={() => setShowDeleteModal(false)}>
          <div className="p-4 space-y-4 min-w-[360px]">
            <p className="text-sm mf-txt3">Cette action supprimera définitivement tous les blocs de la configuration active. Cette opération est irréversible.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteModal(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={handleDeleteAll} className="btn bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30">
                Supprimer tout
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Reserve Modal ─────────────────────────────────────────────────────── */}
      {reserveModal && stats && (
        <Modal title="Calcul des Réserves (NI 43-101)" onClose={() => setReserveModal(false)}>
          <div className="p-4 space-y-4 min-w-[440px]">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Dilution (%)', value: dilution, set: setDilution },
                { label: 'Rec. minier (%)', value: mineRecovery, set: setMineRecovery },
                { label: 'Pertes fines (%)', value: fineLoss, set: setFineLoss },
              ].map(f => (
                <div key={f.label}>
                  <label className="label">{f.label}</label>
                  <input type="number" className="input-field w-full" value={f.value}
                    onChange={e => f.set(parseFloat(e.target.value) || 0)} />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(['Mesuré', 'Indiqué', 'Inféré'] as ResourceCategory[]).map(cat => {
                const catBlocks = rawAll.filter(b => b.resource_category === cat);
                const t = catBlocks.reduce((s, b) => s + b.density * b.volume_m3, 0);
                const oz = catBlocks.reduce((s, b) => s + b.au_g_t * b.density * b.volume_m3 * TROY, 0);
                const g = t > 0 ? (oz / TROY) / t : 0;
                const rsv = reserveCalc(t, g);
                return (
                  <div key={cat} className="card-sm text-xs">
                    <div className="font-semibold mf-txt mb-1">{cat}</div>
                    <div className="flex gap-4">
                      <span className="mf-txt3">Ressource: {formatDecimalGrouped((t / 1e6), 3)} Mt @ {formatDecimalGrouped(g, 3)} g/t</span>
                      <ChevronRight size={12} className="text-amber-400 mt-0.5" />
                      <span className="text-amber-400 font-semibold">Réserve: {formatDecimalGrouped((rsv.tonnes / 1e6), 3)} Mt · {formatDecimalGrouped((rsv.oz / 1000), 1)} koz</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end">
              <button onClick={() => setReserveModal(false)} className="btn btn-secondary">Fermer</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
