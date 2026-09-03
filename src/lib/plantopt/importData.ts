// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Import de données GMAO / Historian (CSV, Excel)
//
// Permet d'alimenter le modèle avec des données terrain plutôt que des lois
// posées à la main : capacités PERT (min/mode/max) et OPEX par aire, temps moyens
// entre pannes (MTTF) et de réparation (MTTR), et débits historiques (pour le
// back-test). Le rapprochement se fait par NOM d'aire (insensible à la casse), ce
// qui n'écrase que les aires reconnues et laisse les autres intactes.
//
// Formats CSV et XLSX via la lib `xlsx` déjà utilisée par Drilling/BlockModel.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from '@e965/xlsx';
import { gammaFn } from './distributions';
import type { FailureMode, PlantModel } from './types';

/** Forme Weibull par défaut d'un TTF importé (usure ; surchargée si colonne fournie). */
const IMPORT_TTF_SHAPE = 1.4;
/** σ lognormale par défaut d'un TTR importé. */
const IMPORT_TTR_SIGMA = 0.5;

type Cell = string | number;

/** Lit un fichier CSV/XLSX en matrice de cellules (première feuille). */
export function readWorkbookRows(file: File): Promise<Cell[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: '' }) as Cell[][];
        resolve(rows);
      } catch {
        reject(new Error('Lecture impossible. Vérifiez le format CSV ou XLSX.'));
      }
    };
    reader.onerror = () => reject(new Error('Erreur de lecture du fichier.'));
    reader.readAsBinaryString(file);
  });
}

/** Normalise un libellé d'en-tête (minuscule, sans accents ni ponctuation). */
function norm(s: Cell): string {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function toNum(v: Cell): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Trouve l'index de la première colonne dont l'en-tête contient un des mots-clés. */
function findCol(header: string[], keywords: string[]): number {
  return header.findIndex(h => keywords.some(k => h.includes(k)));
}

export interface GmaoImportResult {
  model: PlantModel;
  /** Noms d'aires effectivement mis à jour. */
  applied: string[];
  /** Lignes de données ignorées (aire non reconnue). */
  skipped: string[];
  /** Débits historiques extraits (colonne débit), pour le back-test. */
  historical: number[];
}

/**
 * Applique une matrice importée au modèle. En-têtes reconnus (souples) :
 * aire/area/unité · min · mode/nominal · max · opex · mttf/ttf · mttr/ttr · débit.
 */
export function applyGmaoImport(model: PlantModel, rows: Cell[][]): GmaoImportResult {
  const applied: string[] = [];
  const skipped: string[] = [];
  const historical: number[] = [];
  if (rows.length < 2) return { model, applied, skipped, historical };

  const header = rows[0].map(norm);
  const cAire = findCol(header, ['aire', 'area', 'unite', 'unit', 'atelier']);
  const cMin = findCol(header, ['min']);
  const cMode = findCol(header, ['mode', 'nominal', 'moy']);
  const cMax = findCol(header, ['max']);
  const cOpex = findCol(header, ['opex', 'cout', 'cost']);
  const cMttf = findCol(header, ['mttf', 'ttf', 'entre panne']);
  const cMttr = findCol(header, ['mttr', 'ttr', 'reparation', 'repair']);
  const cDebit = findCol(header, ['debit', 'throughput', 'tph']);

  // Index des aires par nom normalisé.
  const areaByName = new Map<string, string>();
  for (const a of model.areas) areaByName.set(norm(a.name), a.id);

  let areas = model.areas;
  let failureModes = model.failureModes ?? [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Débit historique (colonne dédiée) — indépendant du rapprochement d'aire.
    if (cDebit >= 0) {
      const d = toNum(row[cDebit]);
      if (d !== null && d > 0) historical.push(d);
    }
    if (cAire < 0) continue;
    const name = norm(row[cAire]);
    if (!name) continue;
    const areaId = areaByName.get(name);
    if (!areaId) {
      if (String(row[cAire]).trim()) skipped.push(String(row[cAire]).trim());
      continue;
    }

    const min = cMin >= 0 ? toNum(row[cMin]) : null;
    const mode = cMode >= 0 ? toNum(row[cMode]) : null;
    const max = cMax >= 0 ? toNum(row[cMax]) : null;
    const opex = cOpex >= 0 ? toNum(row[cOpex]) : null;
    const mttf = cMttf >= 0 ? toNum(row[cMttf]) : null;
    const mttr = cMttr >= 0 ? toNum(row[cMttr]) : null;

    if (min !== null || mode !== null || max !== null || opex !== null) {
      areas = areas.map(a => {
        if (a.id !== areaId) return a;
        const params = { ...a.capacityDist.params };
        if (min !== null) params.min = min;
        if (mode !== null) params.mode = mode;
        if (max !== null) params.max = max;
        return {
          ...a,
          opexPerTonne: opex !== null ? opex : a.opexPerTonne,
          capacityDist: (min !== null || mode !== null || max !== null)
            ? { kind: 'triangular', params }
            : a.capacityDist,
        };
      });
    }

    if (mttf !== null || mttr !== null) {
      const existing = failureModes.find(f => f.areaId === areaId);
      const ttf = mttf !== null
        ? { kind: 'weibull' as const, params: { shape: IMPORT_TTF_SHAPE, scale: mttf / gammaFn(1 + 1 / IMPORT_TTF_SHAPE) } }
        : existing?.ttfDist ?? { kind: 'weibull' as const, params: { shape: 1.4, scale: 300 } };
      const ttr = mttr !== null
        ? { kind: 'lognormal' as const, params: { mu: Math.log(mttr) - (IMPORT_TTR_SIGMA * IMPORT_TTR_SIGMA) / 2, sigma: IMPORT_TTR_SIGMA } }
        : existing?.ttrDist ?? { kind: 'lognormal' as const, params: { mu: 1.8, sigma: 0.6 } };
      if (existing) {
        failureModes = failureModes.map(f => (f.id === existing.id ? { ...f, ttfDist: ttf, ttrDist: ttr } : f));
      } else {
        const fm: FailureMode = { id: `fm-import-${areaId}`, areaId, residualCapacity: 0, ttfDist: ttf, ttrDist: ttr };
        failureModes = [...failureModes, fm];
      }
    }

    applied.push(model.areas.find(a => a.id === areaId)!.name);
  }

  return { model: { ...model, areas, failureModes }, applied: [...new Set(applied)], skipped: [...new Set(skipped)], historical };
}

/** Lignes du modèle d'import (en-tête + une ligne par aire courante, capacités pré-remplies). */
function templateRows(model: PlantModel): Cell[][] {
  const header: Cell[] = ['Aire', 'Min (t/h)', 'Mode (t/h)', 'Max (t/h)', 'OPEX (/t)', 'MTTF (h)', 'MTTR (h)', 'Débit historique (t/h)'];
  const rows: Cell[][] = [header];
  for (const a of [...model.areas].sort((x, y) => x.processOrder - y.processOrder)) {
    const p = a.capacityDist.params;
    rows.push([
      a.name,
      typeof p.min === 'number' ? Math.round(p.min) : '',
      typeof p.mode === 'number' ? Math.round(p.mode) : '',
      typeof p.max === 'number' ? Math.round(p.max) : '',
      a.opexPerTonne,
      '', '', '',
    ]);
  }
  return rows;
}

/** Télécharge un modèle d'import Excel pré-rempli des aires courantes. */
export function downloadTemplateXlsx(model: PlantModel): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(templateRows(model));
  XLSX.utils.book_append_sheet(wb, ws, 'Aires');
  XLSX.writeFile(wb, 'plant_optimizer_import.xlsx');
}

/** Télécharge un modèle d'import CSV pré-rempli des aires courantes. */
export function downloadTemplateCsv(model: PlantModel): void {
  const ws = XLSX.utils.aoa_to_sheet(templateRows(model));
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plant_optimizer_import.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse une liste de débits historiques saisis (une valeur/ligne ou séparés). */
export function parseHistoricalText(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map(s => Number(s.replace(',', '.')))
    .filter(n => Number.isFinite(n) && n > 0);
}
