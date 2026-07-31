import { describe, it, expect } from 'vitest';
import {
  COS_INGESTION_TEMPLATES,
  INGESTION_QUALITY_FLAGS,
  defaultIngestionConfig,
  groupTemplatesBySection,
  shiftWindow,
  type TemplateContext,
} from './ingestionTemplates';
import type { Project, CosEquipmentStatus, CosOreLot, CosStream } from '../../types';

const project: Project = {
  id: 'p1', code: 'AU-TEST', name: 'Projet Test', country: 'CA', phase: 'PFS' as Project['phase'],
  target_tph: 400, gold_grade_g_t: 3.2, availability_pct: 92, recovery_pct: 93,
  ore_sg: 2.7, gold_price_usd: 2400, annual_tonnes: 3000000,
  created_at: '', updated_at: '',
};

const equipment: CosEquipmentStatus[] = [{
  id: 'e1', project_id: 'p1', equipment_tag: 'SAG-01', equipment_name: 'Broyeur SAG',
  section: 'grinding', state: 'running', load_pct: 80, availability_pct: 95,
  utilization_pct: 90, mtbf_h: 500, mttr_h: 6, oee_pct: 85, health_index: 88,
  rul_h: 900, failure_prob_24h: 0.02, failure_prob_72h: 0.05, failure_prob_168h: 0.1,
  is_bottleneck: false, downtime_reason: null, health_components: {},
  last_updated: '', created_at: '',
}];

const oreLots: CosOreLot[] = [{
  id: 'l1', project_id: 'p1', lot_id: 'LOT-A', source_name: 'Stockpile Nord',
  au_g_t: 4.1, spi: 95, bwi: 14.8, sulfides_pct: 2.2, arsenic_ppm: 1800,
  organic_carbon_pct: 0.45, clay_pct: 3.1, tonnage_t: 5200,
  stockpile_id: 'SP-N', is_available: true, created_at: '',
}];

const streams: CosStream[] = [{
  id: 's1', project_id: 'p1', stream_id: 'FEED_MILL', name: 'Alimentation broyeur',
  section: 'grinding', stream_type: 'feed', mass_tph: 412, solids_pct: 72,
  au_g_t: 3.24, moisture_pct: 8, density_t_m3: 1.4, data_quality: 'good',
  confidence_score: 0.98, is_provisional: false, last_updated: '', created_at: '',
}];

const now = new Date('2026-07-22T15:30:00Z');

function makeCtx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    config: defaultIngestionConfig(project),
    project, now, equipment, oreLots, stockpiles: [], streams,
    ...overrides,
  };
}

describe('defaultIngestionConfig', () => {
  it('derives the site code from the project code', () => {
    expect(defaultIngestionConfig(project).site_code).toBe('site-au-test');
  });
  it('falls back to the project name when code is empty', () => {
    expect(defaultIngestionConfig({ code: '', name: 'Ma Mine d\'Or' }).site_code).toBe('site-ma-mine-d-or');
  });
});

describe('shiftWindow', () => {
  it('computes the shift window from config start/duration', () => {
    const cfg = { ...defaultIngestionConfig(project), shift_start_utc_h: 12, shift_duration_h: 8 };
    const sw = shiftWindow(now, cfg);
    expect(sw.from.toISOString()).toBe('2026-07-22T12:00:00.000Z');
    expect(sw.to.toISOString()).toBe('2026-07-22T20:00:00.000Z');
    expect(sw.id).toMatch(/^SHIFT-2026-07-22-/);
  });
  it('rolls back to the previous day before shift start', () => {
    const cfg = { ...defaultIngestionConfig(project), shift_start_utc_h: 20, shift_duration_h: 8 };
    const sw = shiftWindow(new Date('2026-07-22T03:00:00Z'), cfg);
    expect(sw.from.toISOString()).toBe('2026-07-21T20:00:00.000Z');
  });
});

describe('COS_INGESTION_TEMPLATES', () => {
  it('covers the 11 sections of the input-data reference', () => {
    const sections = groupTemplatesBySection(COS_INGESTION_TEMPLATES);
    expect(sections.length).toBe(11);
  });

  it('every JSON template builds valid JSON containing the configured site code', () => {
    const ctx = makeCtx();
    for (const t of COS_INGESTION_TEMPLATES.filter(t => t.format === 'json')) {
      const parsed = JSON.parse(t.build(ctx));
      expect(JSON.stringify(parsed)).toContain('site-au-test');
    }
  });

  it('every CSV template has a header row and at least one data row', () => {
    const ctx = makeCtx();
    for (const t of COS_INGESTION_TEMPLATES.filter(t => t.format === 'csv')) {
      const lines = t.build(ctx).split('\n');
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toContain(',');
    }
  });

  it('nothing is hardcoded: changing the config changes every payload', () => {
    const a = makeCtx();
    const b = makeCtx({
      config: {
        ...defaultIngestionConfig(project),
        site_code: 'site-autre', lab_id: 'lab-x', mine_name: 'mine-x',
        opc_source_grinding: 'opcua:x1', opc_source_leaching: 'opcua:x2',
        opc_source_utilities: 'opcua:x3', lims_source: 'lims:x',
        cmms_source: 'cmms:x', geomet_source: 'mining:x',
      },
    });
    // work-orders is driven by module data (equipment), not by config identifiers
    const configDriven = COS_INGESTION_TEMPLATES.filter(t => t.id !== 'work-orders');
    for (const t of configDriven) {
      expect(t.build(a), `template ${t.id} should react to config changes`).not.toBe(t.build(b));
    }
    // work-orders reacts to imported equipment data instead
    const wo = COS_INGESTION_TEMPLATES.find(t => t.id === 'work-orders')!;
    const otherEquipment = [{ ...equipment[0], equipment_tag: 'BALL-02', section: 'grinding' }];
    expect(wo.build(a)).not.toBe(wo.build(makeCtx({ equipment: otherEquipment })));
  });

  it('imports real module data: equipment tag and ore lot values appear in payloads', () => {
    const ctx = makeCtx();
    const grinding = COS_INGESTION_TEMPLATES.find(t => t.id === 'rt-grinding')!.build(ctx);
    expect(grinding).toContain('SAG01.PWR');
    expect(grinding).toContain('412');
    const lots = COS_INGESTION_TEMPLATES.find(t => t.id === 'ore-lots')!.build(ctx);
    expect(lots).toContain('LOT-A');
    expect(lots).toContain('4.1');
    const blend = COS_INGESTION_TEMPLATES.find(t => t.id === 'blend-request')!.build(ctx);
    expect(blend).toContain('"feed_t_h": 400');
  });

  it('derives values from project parameters when module data is absent', () => {
    const ctx = makeCtx({ equipment: [], oreLots: [], streams: [], stockpiles: [] });
    for (const t of COS_INGESTION_TEMPLATES) {
      const payload = t.build(ctx);
      expect(payload.length).toBeGreaterThan(50);
      if (t.format === 'json') expect(() => JSON.parse(payload)).not.toThrow();
    }
    const recon = JSON.parse(COS_INGESTION_TEMPLATES.find(t => t.id === 'recon-request')!.build(ctx));
    // feed mass = target_tph × shift_duration_h = 400 × 8
    expect(recon.streams[0].mass_dry_t).toBe(3200);
  });

  it('uses UTC ISO-8601 timestamps in every dated template', () => {
    const ctx = makeCtx();
    // blend-request is a pure optimizer request (no timestamps in the reference format)
    const dated = COS_INGESTION_TEMPLATES.filter(t => t.format === 'json' && t.id !== 'blend-request');
    for (const t of dated) {
      const matches = t.build(ctx).match(/"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z"/g);
      expect(matches, `template ${t.id} should contain ISO-8601 UTC timestamps`).not.toBeNull();
    }
  });
});

describe('INGESTION_QUALITY_FLAGS', () => {
  it('defines the 6 P754 quality codes in order', () => {
    expect(INGESTION_QUALITY_FLAGS.map(f => f.code)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(INGESTION_QUALITY_FLAGS.map(f => f.key)).toEqual(
      ['good', 'suspect', 'bad', 'missing', 'frozen', 'substitute'],
    );
  });
});
