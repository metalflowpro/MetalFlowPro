import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  COS_TEMPLATES, cosTemplate, buildCosWorkbook, recordsFromSheet, parseCosXlsx,
} from './cosTemplates';
import { IMPORT_DATASETS, datasetDef } from './ingestionImport';

/** Sérialise un classeur puis le relit — simule le cycle Excel réel. */
function roundTrip(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Construit un .xlsx à partir d'une matrice brute (feuille « Données »). */
function sheetToBuffer(matrix: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix as never), 'Données');
  return roundTrip(wb);
}

describe('COS_TEMPLATES', () => {
  it('provides one template per importable dataset', () => {
    expect(COS_TEMPLATES.length).toBe(IMPORT_DATASETS.length);
    for (const d of IMPORT_DATASETS) {
      expect(cosTemplate(d.id), `gabarit manquant pour ${d.id}`).toBeDefined();
    }
  });

  it('gives every template unique headers and at least one example row', () => {
    for (const t of COS_TEMPLATES) {
      const headers = t.columns.map(c => c.header);
      expect(new Set(headers).size, `en-têtes dupliqués dans ${t.dataset}`).toBe(headers.length);
      expect(t.exampleRows.length).toBeGreaterThan(0);
      for (const row of t.exampleRows) {
        expect(row.length, `ligne d'exemple mal dimensionnée dans ${t.dataset}`).toBe(t.columns.length);
      }
    }
  });

  it('marks as required exactly the fields the validator demands', () => {
    // Les colonnes obligatoires du gabarit doivent couvrir la clé naturelle.
    for (const t of COS_TEMPLATES) {
      const required = t.columns.filter(c => c.required).map(c => c.key);
      expect(required.length, `aucune colonne obligatoire pour ${t.dataset}`).toBeGreaterThan(0);
    }
  });
});

describe('buildCosWorkbook', () => {
  it('produces the Données and Guide sheets', () => {
    const wb = buildCosWorkbook('tags')!;
    expect(wb.SheetNames).toContain('Données');
    expect(wb.SheetNames).toContain('Guide');
  });

  it('documents the ingestion rules and the target table in the Guide sheet', () => {
    const wb = buildCosWorkbook('tags')!;
    const guide = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Guide, { header: 1, defval: '' });
    const flat = guide.flat().join(' | ');
    expect(flat).toContain('UTC ISO-8601');
    expect(flat).toContain('catalogue canonique');
    expect(flat).toContain('P754');
    expect(flat).toContain(datasetDef('tags').table);
  });

  it('returns null for an unknown dataset', () => {
    // @ts-expect-error — jeu de données inexistant, volontaire
    expect(buildCosWorkbook('inconnu')).toBeNull();
  });
});

describe('cycle complet gabarit → remplissage → import', () => {
  it('accepts the shipped example rows for every dataset', () => {
    for (const t of COS_TEMPLATES) {
      const wb = buildCosWorkbook(t.dataset)!;
      const result = parseCosXlsx(t.dataset, roundTrip(wb));
      expect(result.fatal, `gabarit ${t.dataset} : ${result.fatal}`).toBeNull();
      expect(result.summary.rejected, `lignes rejetées dans ${t.dataset}: ${JSON.stringify(result.rejected)}`).toBe(0);
      expect(result.summary.accepted).toBe(t.exampleRows.length);
      expect(result.format).toBe('xlsx');
    }
  });

  it('maps headers back to canonical keys', () => {
    const wb = buildCosWorkbook('tags')!;
    const r = parseCosXlsx('tags', roundTrip(wb));
    expect(r.rows[0].tag).toBe('SAG01.PWR');
    expect(r.rows[0].unit).toBe('kW');
    expect(r.rows[0].ts).toBe('2026-07-22T14:00:10Z');
    expect(r.rows[0].value).toBe(4820.5);
  });

  it('still applies the P754 sign-off rule through the Excel path', () => {
    const r = parseCosXlsx('tags', roundTrip(buildCosWorkbook('tags')!));
    expect(r.requiresSignoff).toBe(true); // le gabarit contient une ligne « substitute »
  });

  it('derives dry tonnage from the movements template', () => {
    const r = parseCosXlsx('ore_movements', roundTrip(buildCosWorkbook('ore_movements')!));
    // 2e ligne d'exemple : Tonnage_sec_t vide → recalculé 80.5 × (1 − 7.5/100)
    expect(r.rows[1].tonnage_dry_t).toBeCloseTo(74.4625, 3);
    expect(r.warnings.some(w => w.message.includes('recalculé'))).toBe(true);
  });

  it('splits the crew column on semicolons', () => {
    const r = parseCosXlsx('shifts', roundTrip(buildCosWorkbook('shifts')!));
    expect(r.rows[0].crew).toEqual(['operator:mah', 'operator:lduarte', 'metallurgist:jperez']);
  });
});

describe('recordsFromSheet', () => {
  it('ignores unknown columns and tolerates reordering', () => {
    const { records, missingRequired } = recordsFromSheet('tags', [
      ['Colonne_Inconnue', 'Horodatage_UTC', 'Tag', 'Unite', 'Valeur'],
      ['ignoré', '2026-07-22T14:00:00Z', 'A.PWR', 'kW', '12'],
    ]);
    expect(missingRequired).toEqual([]);
    expect(records[0].tag).toBe('A.PWR');
    expect(records[0].ts).toBe('2026-07-22T14:00:00Z');
    expect(records[0]).not.toHaveProperty('Colonne_Inconnue');
  });

  it('reports required headers that are missing', () => {
    const { missingRequired } = recordsFromSheet('tags', [['Unite', 'Valeur'], ['kW', '12']]);
    expect(missingRequired).toContain('Tag');
    expect(missingRequired).toContain('Horodatage_UTC');
  });

  it('skips fully blank rows left over in Excel', () => {
    const { records } = recordsFromSheet('tags', [
      ['Tag', 'Unite', 'Horodatage_UTC', 'Valeur'],
      ['A.PWR', 'kW', '2026-07-22T14:00:00Z', '12'],
      ['', '', '', ''],
      ['   ', '', '', ''],
    ]);
    expect(records.length).toBe(1);
  });
});

describe('parseCosXlsx — erreurs de fichier', () => {
  it('refuses a workbook missing a required column', () => {
    const buf = sheetToBuffer([
      ['Unite', 'Valeur'],
      ['kW', '12'],
    ]);
    const r = parseCosXlsx('tags', buf);
    expect(r.fatal).toContain('obligatoire');
    expect(r.fatal).toContain('Tag');
  });

  it('refuses a header-only sheet', () => {
    const r = parseCosXlsx('tags', sheetToBuffer([['Tag', 'Unite', 'Horodatage_UTC', 'Valeur']]));
    expect(r.fatal).toContain('en-tête');
  });

  it('reports an unreadable file rather than throwing', () => {
    const r = parseCosXlsx('tags', new TextEncoder().encode('ceci n\'est pas un xlsx').buffer);
    expect(r.fatal).not.toBeNull();
    expect(r.rows).toEqual([]);
  });

  it('falls back to the first sheet when « Données » is absent', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Tag', 'Unite', 'Horodatage_UTC', 'Valeur', 'Qualite'],
      ['A.PWR', 'kW', '2026-07-22T14:00:00Z', '12', 'good'],
    ]), 'Feuille1');
    const r = parseCosXlsx('tags', roundTrip(wb));
    expect(r.fatal).toBeNull();
    expect(r.summary.accepted).toBe(1);
  });

  it('rejects bad rows individually while keeping the good ones', () => {
    const buf = sheetToBuffer([
      ['Tag', 'Unite', 'Horodatage_UTC', 'Valeur', 'Qualite'],
      ['A.PWR', 'kW', '2026-07-22T14:00:00Z', '12', 'good'],
      ['B.FLOW', 'gpm', '2026-07-22T14:00:00Z', '5', 'good'],
      ['C.TEMP', 'degC', '22 juillet', '26', 'good'],
    ]);
    const r = parseCosXlsx('tags', buf);
    expect(r.summary.accepted).toBe(1);
    expect(r.summary.rejected).toBe(2);
    expect(r.rejected[0].reasons.join(' ')).toContain("incohérence d'unité");
    expect(r.rejected[1].reasons.join(' ')).toContain('ISO-8601');
  });
});
