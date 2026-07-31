import { describe, it, expect } from 'vitest';
import {
  parseImport, parseCsv, isCanonicalUnit, datasetDef,
  IMPORT_DATASETS, CANONICAL_UNITS,
} from './ingestionImport';

// ─── Payloads de référence, calqués sur les templates de l'onglet Ingestion ───

const TAGS_JSON = JSON.stringify({
  source: 'opcua:opc-server-01',
  site: 'site-au-001',
  asset_path: 'plant/grinding/sag-mill-01',
  period: { from: '2026-07-22T14:00:00Z', to: '2026-07-22T14:01:00Z' },
  tags: [
    { tag: 'SAG01.PWR', unit: 'kW', ts: '2026-07-22T14:00:10Z', value: 4820.5, quality: 'good', confidence: 0.99 },
    { tag: 'SAG01.P80', unit: 'um', ts: '2026-07-22T14:00:10Z', value: 150, quality: 'substitute', confidence: 0.82, lineage: 'soft-sensor:model-p80-v3' },
    { tag: 'SAG01.BALL_LVL', unit: '%', ts: '2026-07-22T14:00:10Z', value: null, quality: 'missing', confidence: 0 },
  ],
});

const MOVEMENTS_CSV = [
  'movement_id,ts,from,to,lot_id,tonnage_wet_t,moisture_pct,tonnage_dry_t,truck_id,operator',
  'MV-001,2026-07-22T14:20:00Z,mine/vein-norte/B-1140,SP-ROM-01,ORELOT-014,82.0,7.5,75.85,TR-2041,operator:mah',
  'MV-002,2026-07-22T14:24:00Z,mine/vein-norte/B-1140,SP-ROM-01,ORELOT-014,80.5,7.5,,TR-2038,operator:mah',
].join('\n');

const REAGENTS_JSON = JSON.stringify({
  source: 'opcua:opc-server-03',
  period: { from: '2026-07-22T14:00:00Z', to: '2026-07-22T15:00:00Z' },
  reagents: [
    { reagent: 'NaCN', asset_path: 'plant/leaching/cil-train-A/dosing', consumed_kg: 142.5, dose_kg_t: 0.34, stock_t: 12.4, quality: 'good' },
    { reagent: 'O2', asset_path: 'plant/leaching/cil-train-A/oxygen', consumed_Nm3: 240.0, quality: 'good' },
  ],
  utilities: [
    { utility: 'electricity', asset_path: 'plant', consumed_kWh: 6420.0 },
  ],
});

const EVENTS_JSON = JSON.stringify({
  source: 'cmms:maximo-prod',
  events: [
    {
      event_id: 'EVT-001', asset_path: 'plant/grinding/sag-mill-01', type: 'downtime',
      severity: 'medium', reason_code: 'MECH_BRAKE_BLOCKAGE',
      started_at: '2026-07-22T14:50:00Z', ended_at: '2026-07-22T15:08:00Z',
      description: 'Blocage tampon de frein', operator: 'operator:mah',
    },
  ],
});

const SHIFTS_JSON = JSON.stringify({
  shifts: [{
    shift_id: 'SHIFT-2026-07-22-D', type: 'day', tz: 'America/Toronto',
    start: '2026-07-22T12:00:00Z', end: '2026-07-22T20:00:00Z',
    campaign_id: 'CAMP-2026-H2', supervisor: 'shift-lead:rgomez',
    crew: ['operator:mah', 'metallurgist:jperez'],
    targets: { throughput_t_h: 415, recovery_pct: 93.0, Au_oz_target: 320 },
  }],
  campaigns: [{ campaign_id: 'CAMP-2026-H2', ore_strategy: 'stabilize_feed_blend_PRC_diluted', notes: 'Minéralogie mixte' }],
});

const ORE_LOTS_JSON = JSON.stringify({
  source: 'mining:geomet-db',
  ore_lots: [{
    lot_id: 'ORELOT-014',
    origin: { mine: 'vein-norte', bench: 'B-1140', block: 'BLK-7731' },
    tonnage_dry_t: 5200,
    characterization: { Au_g_t: 4.1, S_sulfide_pct: 2.2, As_pct: 0.18, Corg_PRC_pct: 0.45, BWi_kWh_t: 14.8, SPI_min: 95, clay_pct: 3.1 },
    stockpile_id: 'SP-ROM-01',
  }],
});

// ─── Catalogue ────────────────────────────────────────────────────────────────

describe('IMPORT_DATASETS', () => {
  it('covers the eight importable template families with a target table', () => {
    expect(IMPORT_DATASETS.length).toBe(8);
    for (const d of IMPORT_DATASETS) {
      expect(d.table).toMatch(/^cos_/);
      expect(d.formats.length).toBeGreaterThan(0);
    }
  });
  it('exposes each definition by id', () => {
    expect(datasetDef('tags').table).toBe('cos_tag_readings');
    expect(datasetDef('shifts').table).toBe('cos_shifts');
  });
});

describe('isCanonicalUnit', () => {
  it('accepts every documented canonical unit', () => {
    for (const list of Object.values(CANONICAL_UNITS)) {
      for (const u of list) expect(isCanonicalUnit(u)).toBe(true);
    }
  });
  it('rejects non-canonical units', () => {
    expect(isCanonicalUnit('lb/h')).toBe(false);
    expect(isCanonicalUnit('ppm')).toBe(false);
  });
});

// ─── CSV ──────────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('detects the separator and maps headers', () => {
    const rows = parseCsv('a;b;c\n1;2;3');
    expect(rows).toEqual([{ a: '1', b: '2', c: '3' }]);
  });
  it('honours double-quoted fields containing the separator', () => {
    const rows = parseCsv('id,description\nWO-1,"blocage, frein"');
    expect(rows[0].description).toBe('blocage, frein');
  });
  it('returns nothing without a data row', () => {
    expect(parseCsv('a,b')).toEqual([]);
  });
});

// ─── Tags temps réel ──────────────────────────────────────────────────────────

describe('parseImport — tags (§1)', () => {
  it('flattens the batch payload and inherits source/asset_path from the envelope', () => {
    const r = parseImport('tags', TAGS_JSON);
    expect(r.fatal).toBeNull();
    expect(r.format).toBe('json');
    expect(r.summary.accepted).toBe(3);
    expect(r.rows[0].source).toBe('opcua:opc-server-01');
    expect(r.rows[0].asset_path).toBe('plant/grinding/sag-mill-01');
    expect(r.rows[0].tag).toBe('SAG01.PWR');
  });

  it('raises the P754 sign-off flag on a substitute value', () => {
    const r = parseImport('tags', TAGS_JSON);
    expect(r.requiresSignoff).toBe(true);
    expect(r.warnings.some(w => w.message.includes('sign-off'))).toBe(true);
  });

  it('keeps a missing value (null) but warns it is excluded from reliable computations', () => {
    const r = parseImport('tags', TAGS_JSON);
    const ballLvl = r.rows.find(x => x.tag === 'SAG01.BALL_LVL')!;
    expect(ballLvl.value).toBeNull();
    expect(ballLvl.quality).toBe('missing');
    expect(r.warnings.some(w => w.message.includes('missing'))).toBe(true);
  });

  it('rejects a non-canonical unit rather than converting silently', () => {
    const bad = JSON.stringify({ tags: [{ tag: 'X.FLOW', unit: 'gpm', ts: '2026-07-22T14:00:00Z', value: 10 }] });
    const r = parseImport('tags', bad);
    expect(r.summary.accepted).toBe(0);
    expect(r.rejected[0].reasons.join(' ')).toContain("incohérence d'unité");
  });

  it('rejects a timestamp that is not UTC ISO-8601', () => {
    const bad = JSON.stringify({ tags: [{ tag: 'X.PWR', unit: 'kW', ts: '2026-07-22 14:00:00', value: 10 }] });
    const r = parseImport('tags', bad);
    expect(r.summary.accepted).toBe(0);
    expect(r.rejected[0].reasons.join(' ')).toContain('ISO-8601');
  });

  it('rejects an unknown quality flag', () => {
    const bad = JSON.stringify({ tags: [{ tag: 'X.PWR', unit: 'kW', ts: '2026-07-22T14:00:00Z', value: 10, quality: 'maybe' }] });
    const r = parseImport('tags', bad);
    expect(r.rejected[0].reasons.join(' ')).toContain('quality "maybe" inconnu');
  });

  it('rejects a confidence outside [0,1]', () => {
    const bad = JSON.stringify({ tags: [{ tag: 'X.PWR', unit: 'kW', ts: '2026-07-22T14:00:00Z', value: 10, confidence: 4 }] });
    const r = parseImport('tags', bad);
    expect(r.rejected[0].reasons.join(' ')).toContain('hors plage');
  });
});

// ─── Mouvements ───────────────────────────────────────────────────────────────

describe('parseImport — ore_movements (§3.2)', () => {
  it('reads the CSV and derives the missing dry tonnage', () => {
    const r = parseImport('ore_movements', MOVEMENTS_CSV);
    expect(r.format).toBe('csv');
    expect(r.summary.accepted).toBe(2);
    expect(r.rows[0].tonnage_dry_t).toBeCloseTo(75.85, 2);
    // 2e ligne : dry absent → recalculé 80.5 × (1 − 7.5/100)
    expect(r.rows[1].tonnage_dry_t).toBeCloseTo(74.4625, 3);
    expect(r.warnings.some(w => w.message.includes('recalculé'))).toBe(true);
  });

  it('rejects a dry tonnage greater than the wet tonnage', () => {
    const bad = 'movement_id,ts,tonnage_wet_t,tonnage_dry_t\nMV-9,2026-07-22T14:20:00Z,50,60';
    const r = parseImport('ore_movements', bad);
    expect(r.summary.accepted).toBe(0);
    expect(r.rejected[0].reasons.join(' ')).toContain('supérieur à tonnage_wet_t');
  });
});

// ─── Réactifs ─────────────────────────────────────────────────────────────────

describe('parseImport — reagents (§5)', () => {
  it('merges reagents and utilities, inferring the unit from the quantity field', () => {
    const r = parseImport('reagents', REAGENTS_JSON);
    expect(r.summary.accepted).toBe(3);
    const nacn = r.rows.find(x => x.name === 'NaCN')!;
    expect(nacn.kind).toBe('reagent');
    expect(nacn.consumed_unit).toBe('kg');
    expect(nacn.consumed_qty).toBe(142.5);
    const o2 = r.rows.find(x => x.name === 'O2')!;
    expect(o2.consumed_unit).toBe('Nm3');
    const elec = r.rows.find(x => x.name === 'electricity')!;
    expect(elec.kind).toBe('utility');
    expect(elec.consumed_unit).toBe('kWh');
  });

  it('carries the envelope period onto each row', () => {
    const r = parseImport('reagents', REAGENTS_JSON);
    expect(r.rows[0].period_from).toBe('2026-07-22T14:00:00Z');
    expect(r.rows[0].period_to).toBe('2026-07-22T15:00:00Z');
  });
});

// ─── CMMS ─────────────────────────────────────────────────────────────────────

describe('parseImport — cmms_events (§6)', () => {
  it('computes the duration and derives the equipment tag from the asset path', () => {
    const r = parseImport('cmms_events', EVENTS_JSON);
    expect(r.summary.accepted).toBe(1);
    expect(r.rows[0].duration_min).toBe(18);
    expect(r.rows[0].equipment_tag).toBe('SAG-MILL-01');
    expect(r.warnings.some(w => w.message.includes('duration_min calculée'))).toBe(true);
  });

  it('rejects an event ending before it started', () => {
    const bad = JSON.stringify({ events: [{ event_id: 'E1', started_at: '2026-07-22T15:00:00Z', ended_at: '2026-07-22T14:00:00Z' }] });
    const r = parseImport('cmms_events', bad);
    expect(r.rejected[0].reasons.join(' ')).toContain('antérieur');
  });
});

// ─── Quarts ───────────────────────────────────────────────────────────────────

describe('parseImport — shifts (§7)', () => {
  it('flattens targets and joins the campaign strategy', () => {
    const r = parseImport('shifts', SHIFTS_JSON);
    expect(r.summary.accepted).toBe(1);
    const s = r.rows[0];
    expect(s.shift_id).toBe('SHIFT-2026-07-22-D');
    expect(s.target_throughput_t_h).toBe(415);
    expect(s.target_au_oz).toBe(320);
    expect(s.campaign_strategy).toBe('stabilize_feed_blend_PRC_diluted');
    expect(s.crew).toEqual(['operator:mah', 'metallurgist:jperez']);
  });

  it('rejects a recovery target above 100 %', () => {
    const bad = JSON.stringify({ shifts: [{ shift_id: 'S1', start: '2026-07-22T12:00:00Z', targets: { recovery_pct: 140 } }] });
    const r = parseImport('shifts', bad);
    expect(r.rejected[0].reasons.join(' ')).toContain('hors plage');
  });
});

// ─── Lots de minerai ──────────────────────────────────────────────────────────

describe('parseImport — ore_lots (§3.1)', () => {
  it('flattens characterization and converts As% to ppm', () => {
    const r = parseImport('ore_lots', ORE_LOTS_JSON);
    expect(r.summary.accepted).toBe(1);
    const lot = r.rows[0];
    expect(lot.lot_id).toBe('ORELOT-014');
    expect(lot.au_g_t).toBe(4.1);
    expect(lot.tonnage_t).toBe(5200);
    expect(lot.bwi).toBe(14.8);
    expect(lot.arsenic_ppm).toBeCloseTo(1800, 0); // 0.18 % → 1800 ppm
    expect(lot.is_available).toBe(true);
  });

  it('rejects a lot without a grade', () => {
    const bad = JSON.stringify({ ore_lots: [{ lot_id: 'L1', tonnage_dry_t: 100 }] });
    const r = parseImport('ore_lots', bad);
    expect(r.rejected[0].reasons.join(' ')).toContain('au_g_t est obligatoire');
  });
});

// ─── Erreurs de fichier ───────────────────────────────────────────────────────

describe('parseImport — erreurs bloquantes', () => {
  it('reports an empty file', () => {
    expect(parseImport('tags', '   ').fatal).toContain('vide');
  });
  it('reports malformed JSON', () => {
    expect(parseImport('tags', '{ "tags": [').fatal).toContain('JSON invalide');
  });
  it('explains the expected structure when nothing matches', () => {
    const r = parseImport('tags', JSON.stringify({ autre_chose: [] }));
    expect(r.fatal).toContain('Aucun enregistrement');
    expect(r.fatal).toContain('Tags temps réel');
  });
  it('reports a CSV without data rows', () => {
    expect(parseImport('work_orders', 'wo_id,asset_path').fatal).toContain('CSV illisible');
  });
});

// ─── Invariants transverses ───────────────────────────────────────────────────

describe('invariants', () => {
  it('never returns an invalid row in rows — every reject carries a reason', () => {
    const mixed = JSON.stringify({
      tags: [
        { tag: 'OK.PWR', unit: 'kW', ts: '2026-07-22T14:00:00Z', value: 1 },
        { tag: '', unit: 'kW', ts: '2026-07-22T14:00:00Z', value: 2 },
        { tag: 'BAD.TS', unit: 'kW', ts: 'hier', value: 3 },
      ],
    });
    const r = parseImport('tags', mixed);
    expect(r.summary.total).toBe(3);
    expect(r.summary.accepted).toBe(1);
    expect(r.summary.rejected).toBe(2);
    expect(r.rows.length + r.rejected.length).toBe(r.summary.total);
    for (const rej of r.rejected) expect(rej.reasons.length).toBeGreaterThan(0);
  });

  it('accepts a JSON array as an alternative to the enveloped form', () => {
    const arr = JSON.stringify([
      { tag: 'A.PWR', unit: 'kW', ts: '2026-07-22T14:00:00Z', value: 1, quality: 'good' },
    ]);
    const r = parseImport('tags', arr);
    expect(r.summary.accepted).toBe(1);
  });

  it('does not require sign-off when every value is good', () => {
    const clean = JSON.stringify({ tags: [{ tag: 'A.PWR', unit: 'kW', ts: '2026-07-22T14:00:00Z', value: 1, quality: 'good' }] });
    expect(parseImport('tags', clean).requiresSignoff).toBe(false);
  });
});
