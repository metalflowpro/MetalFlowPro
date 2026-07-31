// ─────────────────────────────────────────────────────────────────────────────
// Import de données usine — module COS (ingestion L2 → contextualisation L3).
//
// Pendant opérationnel de ingestionTemplates.ts : les templates DÉCRIVENT les
// formats attendus, ce module les LIT. Chaque jeu de données correspond à une
// section du contrat d'ingestion et atterrit dans une table cos_*.
//
// Règles appliquées (contrat d'ingestion) :
//   • horodatage UTC ISO-8601 obligatoire sur toute mesure ;
//   • unités canoniques — une unité non conforme fait REJETER la ligne ;
//   • drapeau qualité parmi les 6 codes ; `substitute` et `provisional`
//     déclenchent l'exigence de sign-off (AMIRA P754 n°6) ;
//   • rien n'est écrit sans passer la validation : chaque rejet porte son motif.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import { INGESTION_QUALITY_FLAGS } from './ingestionTemplates';

// ═══ Jeux de données importables ═════════════════════════════════════════════

export type ImportDatasetId =
  | 'tags'          // §1   → cos_tag_readings
  | 'ore_lots'      // §3.1 → cos_ore_lots
  | 'ore_movements' // §3.2 → cos_ore_movements
  | 'stockpiles'    // §4   → cos_stockpiles
  | 'reagents'      // §5   → cos_reagent_consumption
  | 'cmms_events'   // §6   → cos_equipment_events
  | 'work_orders'   // §6.1 → cos_work_orders
  | 'shifts';       // §7   → cos_shifts

export interface ImportDatasetDef {
  id: ImportDatasetId;
  label: string;
  section: string;
  table: string;
  /** Clé naturelle (hors project_id) servant à dédupliquer un ré-import. */
  conflictKey: string;
  formats: Array<'json' | 'csv'>;
  hint: string;
}

export const IMPORT_DATASETS: ImportDatasetDef[] = [
  { id: 'tags',          label: 'Tags temps réel (OPC-UA / SCADA)', section: '§1',   table: 'cos_tag_readings',        conflictKey: 'project_id,tag,ts',        formats: ['json', 'csv'], hint: 'Batch JSON { source, site, asset_path, tags:[…] } ou CSV tag,unit,ts,value,quality' },
  { id: 'ore_lots',      label: 'Lots de minerai',                  section: '§3.1', table: 'cos_ore_lots',            conflictKey: 'project_id,lot_id',        formats: ['json', 'csv'], hint: 'JSON { ore_lots:[…] } ou CSV lot_id,source_name,au_g_t,tonnage_t,…' },
  { id: 'ore_movements', label: 'Mouvements minerai (bascules)',    section: '§3.2', table: 'cos_ore_movements',       conflictKey: 'project_id,movement_id',   formats: ['csv', 'json'], hint: 'CSV movement_id,ts,from,to,lot_id,tonnage_wet_t,moisture_pct,…' },
  { id: 'stockpiles',    label: 'Stockpiles',                       section: '§4',   table: 'cos_stockpiles',          conflictKey: 'project_id,name',          formats: ['json', 'csv'], hint: 'JSON { stockpiles:[…] } avec blended_composite' },
  { id: 'reagents',      label: 'Réactifs & utilités',              section: '§5',   table: 'cos_reagent_consumption', conflictKey: '',                         formats: ['json', 'csv'], hint: 'JSON { period, reagents:[…], utilities:[…] }' },
  { id: 'cmms_events',   label: 'Événements & arrêts (CMMS)',       section: '§6',   table: 'cos_equipment_events',    conflictKey: 'project_id,event_id',      formats: ['json', 'csv'], hint: 'JSON { events:[…] } ou CSV event_id,asset_path,type,started_at,…' },
  { id: 'work_orders',   label: 'Ordres de travail',                section: '§6.1', table: 'cos_work_orders',         conflictKey: 'project_id,wo_id',         formats: ['csv', 'json'], hint: 'CSV wo_id,asset_path,type,priority,created_at,scheduled_at,status,…' },
  { id: 'shifts',        label: 'Quarts & campagnes',               section: '§7',   table: 'cos_shifts',              conflictKey: 'project_id,shift_id',      formats: ['json', 'csv'], hint: 'JSON { shifts:[…], campaigns:[…] }' },
];

// ═══ Résultat d'import ═══════════════════════════════════════════════════════

export interface ImportRejection {
  /** Index 1-based de la ligne/enregistrement dans la source. */
  row: number;
  reasons: string[];
  raw: unknown;
}

export interface ImportWarning {
  row: number;
  message: string;
}

export interface ImportResult {
  dataset: ImportDatasetId;
  format: 'json' | 'csv' | 'xlsx';
  /** Lignes prêtes à insérer (project_id non inclus — ajouté à l'écriture). */
  rows: Array<Record<string, unknown>>;
  rejected: ImportRejection[];
  warnings: ImportWarning[];
  /** Vrai si au moins une valeur est `substitute` / `provisional` (P754 n°6). */
  requiresSignoff: boolean;
  summary: { total: number; accepted: number; rejected: number };
  /** Erreur bloquante (fichier illisible, structure inattendue). */
  fatal: string | null;
}

// ═══ Unités canoniques ═══════════════════════════════════════════════════════

/**
 * Unités admises par grandeur. Le contrat d'ingestion impose le rejet des
 * incohérences d'unité plutôt qu'une conversion silencieuse : convertir à
 * l'aveugle masquerait une erreur de configuration côté historian.
 */
export const CANONICAL_UNITS: Record<string, string[]> = {
  mass_t:      ['t'],
  flow_th:     ['t/h'],
  volume_m3:   ['m3', 'm³'],
  flow_m3h:    ['m3/h', 'm³/h'],
  grade_gt:    ['g/t', 'g/t_C'],
  conc_mgl:    ['mg/L'],
  energy_kwh:  ['kWh'],
  power_kw:    ['kW'],
  reagent_kg:  ['kg'],
  dose_kgt:    ['kg/t'],
  gas_nm3:     ['Nm3', 'Nm³'],
  pct:         ['%', '%solids', '%S', '%As', '%C', '%H2O'],
  temp:        ['degC', '°C'],
  ph:          ['pH'],
  size_um:     ['um', 'µm'],
  time_min:    ['min'],
};

const ALL_UNITS = new Set(Object.values(CANONICAL_UNITS).flat());
const QUALITY_KEYS = new Set(INGESTION_QUALITY_FLAGS.map(f => f.key));

/** Vrai si l'unité fait partie du catalogue canonique. */
export function isCanonicalUnit(unit: string): boolean {
  return ALL_UNITS.has(unit.trim());
}

// ═══ Helpers de validation ═══════════════════════════════════════════════════

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function checkTimestamp(v: unknown, field: string, errors: string[]): string | null {
  if (v == null || v === '') { errors.push(`${field} est obligatoire`); return null; }
  const s = String(v).trim();
  if (!ISO_UTC.test(s)) {
    errors.push(`${field} "${s}" n'est pas au format UTC ISO-8601 (…Z)`);
    return null;
  }
  if (Number.isNaN(Date.parse(s))) { errors.push(`${field} "${s}" n'est pas une date valide`); return null; }
  return s;
}

function optTimestamp(v: unknown, field: string, errors: string[]): string | null {
  if (v == null || v === '') return null;
  return checkTimestamp(v, field, errors);
}

function num(v: unknown, field: string, errors: string[], opts: { min?: number; max?: number; required?: boolean } = {}): number | null {
  if (v == null || v === '') {
    if (opts.required) errors.push(`${field} est obligatoire`);
    return null;
  }
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) { errors.push(`${field} "${v}" n'est pas numérique`); return null; }
  if (opts.min != null && n < opts.min) { errors.push(`${field} = ${n} hors plage (min ${opts.min})`); return null; }
  if (opts.max != null && n > opts.max) { errors.push(`${field} = ${n} hors plage (max ${opts.max})`); return null; }
  return n;
}

function text(v: unknown, field: string, errors: string[], required = false): string {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) errors.push(`${field} est obligatoire`);
  return s;
}

function quality(v: unknown, errors: string[]): string {
  const s = v == null || v === '' ? 'good' : String(v).trim();
  if (!QUALITY_KEYS.has(s)) {
    errors.push(`quality "${s}" inconnu — attendu : ${[...QUALITY_KEYS].join(' | ')}`);
    return 'good';
  }
  return s;
}

function unit(v: unknown, field: string, errors: string[], required = false): string {
  const s = v == null ? '' : String(v).trim();
  if (!s) {
    if (required) errors.push(`${field} est obligatoire`);
    return '';
  }
  if (!isCanonicalUnit(s)) {
    errors.push(`${field} "${s}" hors catalogue canonique — incohérence d'unité rejetée à l'ingestion`);
  }
  return s;
}

// ═══ Lecture CSV ═════════════════════════════════════════════════════════════

/** CSV minimal : séparateur , ; ou tabulation, guillemets doubles supportés. */
export function parseCsv(textContent: string): Array<Record<string, string>> {
  const lines = textContent.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const sep = [',', ';', '\t'].reduce((best, s) =>
    (lines[0].split(s).length > lines[0].split(best).length ? s : best), ',');

  const splitLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === sep && !inQuotes) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };

  const headers = splitLine(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = cells[i] ?? ''; });
    return rec;
  });
}

/** Première valeur non vide parmi plusieurs alias de colonne. */
function pick(rec: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = rec[k] ?? rec[k.toLowerCase()];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

// ═══ Aplatissement des payloads JSON vers des enregistrements plats ══════════

interface FlatContext { source?: string; asset_path?: string; period_from?: string; period_to?: string }

function flattenJson(dataset: ImportDatasetId, parsed: unknown): Array<Record<string, unknown>> {
  const root = parsed as Record<string, unknown>;
  const ctx: FlatContext = {
    source: typeof root?.source === 'string' ? root.source : undefined,
    asset_path: typeof root?.asset_path === 'string' ? root.asset_path : undefined,
  };
  const period = root?.period as Record<string, unknown> | undefined;
  if (period) {
    ctx.period_from = typeof period.from === 'string' ? period.from : undefined;
    ctx.period_to = typeof period.to === 'string' ? period.to : undefined;
  }

  const arr = (key: string): Array<Record<string, unknown>> =>
    Array.isArray(root?.[key]) ? (root[key] as Array<Record<string, unknown>>) : [];

  switch (dataset) {
    case 'tags':
      return arr('tags').map(t => ({ ...ctx, ...t }));
    case 'ore_lots':
      return arr('ore_lots').map(l => {
        const c = (l.characterization ?? {}) as Record<string, unknown>;
        const o = (l.origin ?? {}) as Record<string, unknown>;
        return { ...ctx, ...l, ...c, mine: o.mine, bench: o.bench, block: o.block };
      });
    case 'ore_movements':
      return arr('movements').map(m => ({ ...ctx, ...m }));
    case 'stockpiles':
      return arr('stockpiles').map(s => {
        const b = (s.blended_composite ?? {}) as Record<string, unknown>;
        return { ...ctx, ...s, ...b };
      });
    case 'reagents': {
      const reagents = arr('reagents').map(r => ({ ...ctx, kind: 'reagent', ...r }));
      const utilities = arr('utilities').map(u => ({ ...ctx, kind: 'utility', ...u }));
      return [...reagents, ...utilities];
    }
    case 'cmms_events':
      return arr('events').map(e => ({ ...ctx, ...e }));
    case 'work_orders':
      return arr('work_orders').map(w => ({ ...ctx, ...w }));
    case 'shifts': {
      const campaigns = arr('campaigns');
      return arr('shifts').map(s => {
        const camp = campaigns.find(c => c.campaign_id === s.campaign_id);
        const t = (s.targets ?? {}) as Record<string, unknown>;
        return { ...ctx, ...s, ...t, campaign_strategy: camp?.ore_strategy, notes: camp?.notes };
      });
    }
    default:
      return [];
  }
}

// ═══ Mapping par jeu de données ══════════════════════════════════════════════

type Mapper = (rec: Record<string, unknown>, errors: string[], warnings: string[]) => Record<string, unknown> | null;

const MAPPERS: Record<ImportDatasetId, Mapper> = {
  tags: (r, e) => ({
    source:     text(pick(r, 'source'), 'source', e),
    asset_path: text(pick(r, 'asset_path'), 'asset_path', e),
    tag:        text(pick(r, 'tag'), 'tag', e, true),
    unit:       unit(pick(r, 'unit'), 'unit', e),
    ts:         checkTimestamp(pick(r, 'ts', 'timestamp'), 'ts', e),
    value:      num(pick(r, 'value'), 'value', e),
    quality:    quality(pick(r, 'quality'), e),
    confidence: num(pick(r, 'confidence'), 'confidence', e, { min: 0, max: 1 }),
    lineage:    text(pick(r, 'lineage'), 'lineage', e) || null,
    note:       text(pick(r, 'note'), 'note', e) || null,
  }),

  ore_lots: (r, e) => ({
    lot_id:             text(pick(r, 'lot_id'), 'lot_id', e, true),
    source_name:        text(pick(r, 'source_name', 'stockpile_id', 'mine'), 'source_name', e) || 'import',
    au_g_t:             num(pick(r, 'au_g_t', 'Au_g_t'), 'au_g_t', e, { min: 0, required: true }),
    spi:                num(pick(r, 'spi', 'SPI_min'), 'spi', e, { min: 0 }),
    bwi:                num(pick(r, 'bwi', 'BWi_kWh_t'), 'bwi', e, { min: 0 }),
    sulfides_pct:       num(pick(r, 'sulfides_pct', 'S_sulfide_pct'), 'sulfides_pct', e, { min: 0, max: 100 }) ?? 0,
    arsenic_ppm:        (() => {
      const pct = num(pick(r, 'As_pct'), 'As_pct', e, { min: 0, max: 100 });
      if (pct != null) return pct * 10000;
      return num(pick(r, 'arsenic_ppm'), 'arsenic_ppm', e, { min: 0 }) ?? 0;
    })(),
    organic_carbon_pct: num(pick(r, 'organic_carbon_pct', 'Corg_PRC_pct'), 'organic_carbon_pct', e, { min: 0, max: 100 }) ?? 0,
    clay_pct:           num(pick(r, 'clay_pct'), 'clay_pct', e, { min: 0, max: 100 }) ?? 0,
    tonnage_t:          num(pick(r, 'tonnage_t', 'tonnage_dry_t'), 'tonnage_t', e, { min: 0, required: true }),
    stockpile_id:       text(pick(r, 'stockpile_id'), 'stockpile_id', e) || null,
    is_available:       true,
  }),

  ore_movements: (r, e, w) => {
    const wet = num(pick(r, 'tonnage_wet_t'), 'tonnage_wet_t', e, { min: 0 });
    const moist = num(pick(r, 'moisture_pct'), 'moisture_pct', e, { min: 0, max: 100 });
    let dry = num(pick(r, 'tonnage_dry_t'), 'tonnage_dry_t', e, { min: 0 });
    if (dry == null && wet != null && moist != null) {
      dry = +(wet * (1 - moist / 100)).toFixed(3);
      w.push('tonnage_dry_t recalculé depuis tonnage_wet_t et moisture_pct');
    }
    if (dry != null && wet != null && dry > wet) {
      e.push(`tonnage_dry_t (${dry}) supérieur à tonnage_wet_t (${wet})`);
    }
    return {
      movement_id:    text(pick(r, 'movement_id'), 'movement_id', e, true),
      ts:             checkTimestamp(pick(r, 'ts'), 'ts', e),
      from_location:  text(pick(r, 'from_location', 'from'), 'from', e),
      to_location:    text(pick(r, 'to_location', 'to'), 'to', e),
      lot_id:         text(pick(r, 'lot_id'), 'lot_id', e) || null,
      tonnage_wet_t:  wet,
      moisture_pct:   moist,
      tonnage_dry_t:  dry,
      truck_id:       text(pick(r, 'truck_id'), 'truck_id', e) || null,
      operator:       text(pick(r, 'operator'), 'operator', e) || null,
      quality:        quality(pick(r, 'quality'), e),
    };
  },

  stockpiles: (r, e) => ({
    name:                 text(pick(r, 'name', 'stockpile_id'), 'stockpile_id', e, true),
    current_tonnage_t:    num(pick(r, 'current_tonnage_t', 'current_inventory_dry_t'), 'current_inventory_dry_t', e, { min: 0, required: true }),
    blended_au_g_t:       num(pick(r, 'blended_au_g_t', 'Au_g_t'), 'Au_g_t', e, { min: 0 }) ?? 0,
    blended_bwi:          num(pick(r, 'blended_bwi', 'BWi_kWh_t'), 'BWi_kWh_t', e, { min: 0 }),
    blended_sulfides_pct: num(pick(r, 'blended_sulfides_pct', 'S_sulfide_pct'), 'S_sulfide_pct', e, { min: 0, max: 100 }) ?? 0,
    blended_prc_pct:      num(pick(r, 'blended_prc_pct', 'Corg_PRC_pct'), 'Corg_PRC_pct', e, { min: 0, max: 100 }) ?? 0,
    reclaim_rate_tph:     num(pick(r, 'reclaim_rate_tph'), 'reclaim_rate_tph', e, { min: 0 }) ?? 0,
  }),

  reagents: (r, e) => {
    const qty = num(pick(r, 'consumed_kg', 'consumed_Nm3', 'consumed_kWh', 'consumed_m3', 'fresh_added_kg', 'consumed_qty'), 'consumed_qty', e, { min: 0 });
    // L'unité découle du champ présent — le contrat nomme la quantité par son unité.
    const inferred =
      pick(r, 'consumed_kg') !== undefined || pick(r, 'fresh_added_kg') !== undefined ? 'kg'
      : pick(r, 'consumed_Nm3') !== undefined ? 'Nm3'
      : pick(r, 'consumed_kWh') !== undefined ? 'kWh'
      : pick(r, 'consumed_m3') !== undefined ? 'm3'
      : String(pick(r, 'consumed_unit') ?? 'kg');
    return {
      source:        text(pick(r, 'source'), 'source', e),
      asset_path:    text(pick(r, 'asset_path'), 'asset_path', e),
      kind:          text(pick(r, 'kind'), 'kind', e) === 'utility' ? 'utility' : 'reagent',
      name:          text(pick(r, 'name', 'reagent', 'utility'), 'reagent/utility', e, true),
      period_from:   optTimestamp(pick(r, 'period_from'), 'period_from', e),
      period_to:     optTimestamp(pick(r, 'period_to'), 'period_to', e),
      consumed_qty:  qty,
      consumed_unit: unit(inferred, 'consumed_unit', e, true),
      dose_kg_t:     num(pick(r, 'dose_kg_t'), 'dose_kg_t', e, { min: 0 }),
      stock_t:       num(pick(r, 'stock_t'), 'stock_t', e, { min: 0 }),
      quality:       quality(pick(r, 'quality'), e),
    };
  },

  cmms_events: (r, e, w) => {
    const started = checkTimestamp(pick(r, 'started_at'), 'started_at', e);
    const ended = optTimestamp(pick(r, 'ended_at'), 'ended_at', e);
    let dur = num(pick(r, 'duration_min'), 'duration_min', e, { min: 0 });
    if (started && ended) {
      if (Date.parse(ended) < Date.parse(started)) e.push('ended_at antérieur à started_at');
      else if (dur == null) {
        dur = Math.round((Date.parse(ended) - Date.parse(started)) / 60000);
        w.push('duration_min calculée depuis started_at et ended_at');
      }
    }
    const assetPath = text(pick(r, 'asset_path'), 'asset_path', e);
    return {
      source:        text(pick(r, 'source'), 'source', e),
      event_id:      text(pick(r, 'event_id'), 'event_id', e, true),
      asset_path:    assetPath,
      equipment_tag: (assetPath.split('/').pop() ?? '').toUpperCase() || null,
      event_type:    text(pick(r, 'event_type', 'type'), 'type', e) || 'downtime',
      severity:      text(pick(r, 'severity'), 'severity', e) || 'low',
      reason_code:   text(pick(r, 'reason_code'), 'reason_code', e) || null,
      started_at:    started,
      ended_at:      ended,
      duration_min:  dur,
      description:   text(pick(r, 'description'), 'description', e) || null,
      work_order_id: text(pick(r, 'work_order_id'), 'work_order_id', e) || null,
      operator:      text(pick(r, 'operator'), 'operator', e) || null,
    };
  },

  work_orders: (r, e) => ({
    source:         text(pick(r, 'source'), 'source', e),
    wo_id:          text(pick(r, 'wo_id'), 'wo_id', e, true),
    asset_path:     text(pick(r, 'asset_path'), 'asset_path', e),
    wo_type:        text(pick(r, 'wo_type', 'type'), 'type', e) || 'corrective',
    priority:       num(pick(r, 'priority'), 'priority', e, { min: 0 }),
    created_at_src: optTimestamp(pick(r, 'created_at_src', 'created_at'), 'created_at', e),
    scheduled_at:   optTimestamp(pick(r, 'scheduled_at'), 'scheduled_at', e),
    status:         text(pick(r, 'status'), 'status', e) || 'planned',
    assignee:       text(pick(r, 'assignee'), 'assignee', e) || null,
    description:    text(pick(r, 'description'), 'description', e) || null,
  }),

  shifts: (r, e) => {
    const crewRaw = pick(r, 'crew');
    const crew = Array.isArray(crewRaw) ? crewRaw
      : typeof crewRaw === 'string' && crewRaw ? crewRaw.split(/[;|]/).map(s => s.trim())
      : [];
    return {
      shift_id:              text(pick(r, 'shift_id'), 'shift_id', e, true),
      shift_type:            text(pick(r, 'shift_type', 'type'), 'type', e) || 'day',
      tz:                    text(pick(r, 'tz'), 'tz', e) || 'UTC',
      start_time:            checkTimestamp(pick(r, 'start_time', 'start'), 'start', e),
      end_time:              optTimestamp(pick(r, 'end_time', 'end'), 'end', e),
      campaign_id:           text(pick(r, 'campaign_id'), 'campaign_id', e) || null,
      campaign_strategy:     text(pick(r, 'campaign_strategy', 'ore_strategy'), 'ore_strategy', e) || null,
      supervisor:            text(pick(r, 'supervisor'), 'supervisor', e) || null,
      crew,
      target_throughput_t_h: num(pick(r, 'target_throughput_t_h', 'throughput_t_h'), 'throughput_t_h', e, { min: 0 }),
      target_recovery_pct:   num(pick(r, 'target_recovery_pct', 'recovery_pct'), 'recovery_pct', e, { min: 0, max: 100 }),
      target_au_oz:          num(pick(r, 'target_au_oz', 'Au_oz_target'), 'Au_oz_target', e, { min: 0 }),
      notes:                 text(pick(r, 'notes'), 'notes', e) || null,
    };
  },
};

// ═══ Point d'entrée ══════════════════════════════════════════════════════════

/**
 * Valide une liste d'enregistrements déjà extraits (CSV, JSON aplati ou feuille
 * Excel) et produit les lignes prêtes à écrire.
 *
 * C'est le cœur de validation partagé : tous les chemins d'import — collage
 * CSV/JSON comme gabarit .xlsx — passent par ici, pour qu'une règle métier
 * n'existe qu'à un seul endroit.
 */
export function validateRecords(
  dataset: ImportDatasetId,
  records: Array<Record<string, unknown>>,
  format: 'json' | 'csv' | 'xlsx' = 'csv',
): ImportResult {
  const mapper = MAPPERS[dataset];
  const rows: Array<Record<string, unknown>> = [];
  const rejected: ImportRejection[] = [];
  const warnings: ImportWarning[] = [];
  let requiresSignoff = false;

  records.forEach((rec, i) => {
    const rowNo = i + 1;
    const errors: string[] = [];
    const warns: string[] = [];
    const mapped = mapper(rec, errors, warns);

    warns.forEach(m => warnings.push({ row: rowNo, message: m }));

    if (errors.length > 0 || mapped == null) {
      rejected.push({ row: rowNo, reasons: errors.length ? errors : ['ligne non exploitable'], raw: rec });
      return;
    }

    // P754 n°6 : valeur provisoire ou remplaçante → sign-off requis.
    const q = mapped.quality;
    const status = String(pick(rec, 'status') ?? '');
    if (q === 'substitute' || status === 'provisional') {
      requiresSignoff = true;
      warnings.push({ row: rowNo, message: 'valeur provisoire/remplaçante — sign-off requis avant reporting financier (P754 n°6)' });
    }
    if (q === 'missing' || q === 'bad' || q === 'frozen') {
      warnings.push({ row: rowNo, message: `qualité "${q}" — donnée conservée mais exclue des calculs fiables` });
    }

    rows.push(mapped);
  });

  return {
    dataset,
    format,
    rows,
    rejected,
    warnings,
    requiresSignoff,
    summary: { total: records.length, accepted: rows.length, rejected: rejected.length },
    fatal: null,
  };
}

/**
 * Lit un contenu texte CSV ou JSON et produit les lignes prêtes à écrire.
 *
 * Le format est détecté automatiquement : un contenu commençant par `{` ou `[`
 * est traité en JSON, sinon en CSV. Aucune ligne invalide n'est retournée dans
 * `rows` — elle part dans `rejected` avec son motif, pour affichage avant
 * écriture.
 */
export function parseImport(dataset: ImportDatasetId, content: string): ImportResult {
  const empty: ImportResult = {
    dataset, format: 'csv', rows: [], rejected: [], warnings: [],
    requiresSignoff: false, summary: { total: 0, accepted: 0, rejected: 0 }, fatal: null,
  };

  const trimmed = content.trim();
  if (!trimmed) return { ...empty, fatal: 'Fichier vide.' };

  const isJson = trimmed.startsWith('{') || trimmed.startsWith('[');

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return { ...empty, format: 'json', fatal: `JSON invalide : ${(err as Error).message}` };
    }
    const records = Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : flattenJson(dataset, parsed);
    if (records.length === 0) {
      const def = IMPORT_DATASETS.find(d => d.id === dataset);
      return { ...empty, format: 'json', fatal: `Aucun enregistrement trouvé — structure attendue pour « ${def?.label} » : ${def?.hint}` };
    }
    return validateRecords(dataset, records, 'json');
  }

  const records = parseCsv(trimmed);
  if (records.length === 0) {
    return { ...empty, fatal: 'CSV illisible : en-tête et au moins une ligne de données sont requis.' };
  }
  return validateRecords(dataset, records, 'csv');
}

/** Définition d'un jeu de données par son identifiant. */
export function datasetDef(id: ImportDatasetId): ImportDatasetDef {
  return IMPORT_DATASETS.find(d => d.id === id)!;
}
