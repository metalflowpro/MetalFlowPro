import { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Drill, Upload, Trash2, RefreshCw, AlertCircle, FileSpreadsheet, Ruler, Layers as LayersIcon,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import type { Project, DhCollarRow, DhSurveyRow, DhLithoRow, DhAssayRow } from '../types';
import { desurveyHole, type SurveyStation } from '../lib/drilling/desurvey';
import { compositeByLength } from '../lib/drilling/compositing';
import { isKnownMetal, getMetal } from '../lib/metals/registry';
import { formatDecimalGrouped } from '../lib/format/number';

type Tab = 'collars' | 'survey' | 'litho' | 'assay' | 'composites' | 'section';

const TABS: { id: Tab; label: string }[] = [
  { id: 'collars',    label: 'Colliers' },
  { id: 'survey',     label: 'Déviation (Survey)' },
  { id: 'litho',      label: 'Géologie (Litho)' },
  { id: 'assay',      label: 'Analyses' },
  { id: 'composites', label: 'Composites' },
  { id: 'section',    label: 'Coupe & Desurvey' },
];

/** Table cible d'un import, avec ses colonnes attendues (1re = clé). */
const IMPORT_SPECS = {
  dh_collar: { label: 'Colliers', cols: ['hole_id', 'x', 'y', 'z', 'max_depth', 'hole_type', 'diameter', 'drilled_on'], num: ['x', 'y', 'z', 'max_depth'] },
  dh_survey: { label: 'Déviation', cols: ['hole_id', 'depth', 'azimuth', 'dip'], num: ['depth', 'azimuth', 'dip'] },
  dh_litho:  { label: 'Géologie',  cols: ['hole_id', 'from_m', 'to_m', 'lithology', 'alteration', 'mineralization'], num: ['from_m', 'to_m'] },
  dh_assay:  { label: 'Analyses',  cols: ['hole_id', 'from_m', 'to_m', 'element', 'value', 'unit', 'lab_job', 'qaqc_type'], num: ['from_m', 'to_m', 'value'] },
} as const;

type ImportTable = keyof typeof IMPORT_SPECS;

/** Lit un CSV/XLSX en lignes-objets clés par en-tête (minuscules). */
function parseSheet(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' }) as (string | number)[][];
        if (rows.length < 2) return resolve([]);
        const headers = rows[0].map(h => String(h).trim().toLowerCase());
        const out = rows.slice(1)
          .filter(r => r.some(c => String(c).trim() !== ''))
          .map(r => {
            const o: Record<string, string> = {};
            headers.forEach((h, i) => { o[h] = String(r[i] ?? '').trim(); });
            return o;
          });
        resolve(out);
      } catch {
        reject(new Error('Lecture impossible. Vérifiez le format CSV ou XLSX.'));
      }
    };
    reader.onerror = () => reject(new Error('Erreur de lecture du fichier.'));
    reader.readAsBinaryString(file);
  });
}

export function Drilling({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>('collars');
  const [collars, setCollars] = useState<DhCollarRow[]>([]);
  const [surveys, setSurveys] = useState<DhSurveyRow[]>([]);
  const [lithos, setLithos] = useState<DhLithoRow[]>([]);
  const [assays, setAssays] = useState<DhAssayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s, l, a] = await Promise.all([
        supabase.from('dh_collar').select('*').eq('project_id', project.id).order('hole_id'),
        supabase.from('dh_survey').select('*').eq('project_id', project.id).order('hole_id').order('depth'),
        supabase.from('dh_litho').select('*').eq('project_id', project.id).order('hole_id').order('from_m'),
        supabase.from('dh_assay').select('*').eq('project_id', project.id).order('hole_id').order('from_m'),
      ]);
      if (c.error) throw c.error;
      setCollars(c.data ?? []);
      setSurveys(s.data ?? []);
      setLithos(l.data ?? []);
      setAssays(a.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement des forages impossible.');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const elements = useMemo(
    () => Array.from(new Set(assays.map(a => a.element))).sort(),
    [assays],
  );

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Forages"
        subtitle="Ingestion terrain : colliers, déviation, géologie et analyses — desurvey et compositage"
        breadcrumb={['Projet', 'Données', 'Forages']}
        icon={<Drill size={20} />}
        actions={
          <>
            <button className="mf-btn-ghost" onClick={load} title="Recharger">
              <RefreshCw size={14} /> Recharger
            </button>
            <button className="mf-btn-primary" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Importer
            </button>
          </>
        }
      />

      <div className="px-8 pt-4">
        <div className="flex gap-1 border-b border-mf-border">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id ? 'border-mf-gold text-mf-txt' : 'border-transparent text-mf-txt3 hover:text-mf-txt'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {error && (
          <div className="mf-alert-error mb-4"><AlertCircle size={16} /> {error}</div>
        )}
        {loading ? (
          <div className="text-mf-txt3 text-sm">Chargement…</div>
        ) : collars.length === 0 && tab !== 'section' && tab !== 'composites' ? (
          <EmptyDrilling onImport={() => setImportOpen(true)} />
        ) : (
          <>
            {tab === 'collars'    && <CollarTable rows={collars} />}
            {tab === 'survey'     && <SurveyTable rows={surveys} />}
            {tab === 'litho'      && <LithoTable rows={lithos} />}
            {tab === 'assay'      && <AssayTable rows={assays} />}
            {tab === 'composites' && <CompositesTab collars={collars} assays={assays} elements={elements} />}
            {tab === 'section'    && <SectionTab collars={collars} surveys={surveys} assays={assays} elements={elements} />}
          </>
        )}
      </div>

      {importOpen && (
        <ImportModal
          project={project}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyDrilling({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Drill size={40} className="text-mf-txt4 mb-4" />
      <h3 className="text-lg font-semibold text-mf-txt mb-1">Aucun forage</h3>
      <p className="text-sm text-mf-txt3 max-w-md mb-5">
        Importez les 4 tables (colliers, déviation, géologie, analyses) au format CSV ou XLSX
        pour reconstruire la trace 3D des trous et préparer l'estimation de ressource.
      </p>
      <button className="mf-btn-primary" onClick={onImport}><Upload size={14} /> Importer des forages</button>
    </div>
  );
}

// ─── Tables ───────────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-semibold text-mf-txt3 px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1.5 whitespace-nowrap text-mf-txt2">{children}</td>;
}
function DataTable({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div>
      <div className="text-xs text-mf-txt4 mb-2">{formatDecimalGrouped(count)} lignes</div>
      <div className="overflow-auto border border-mf-border rounded-lg">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

function CollarTable({ rows }: { rows: DhCollarRow[] }) {
  return (
    <DataTable count={rows.length}>
      <thead className="bg-mf-panel"><tr>
        <Th>Trou</Th><Th>X (Est)</Th><Th>Y (Nord)</Th><Th>Z (Élév.)</Th><Th>Prof. max</Th><Th>Type</Th><Th>Ø</Th>
      </tr></thead>
      <tbody>
        {rows.slice(0, 500).map(r => (
          <tr key={r.id} className="border-t border-mf-border">
            <Td>{r.hole_id}</Td><Td>{formatDecimalGrouped(r.x)}</Td><Td>{formatDecimalGrouped(r.y)}</Td>
            <Td>{formatDecimalGrouped(r.z)}</Td><Td>{r.max_depth ?? '—'}</Td><Td>{r.hole_type}</Td><Td>{r.diameter ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function SurveyTable({ rows }: { rows: DhSurveyRow[] }) {
  return (
    <DataTable count={rows.length}>
      <thead className="bg-mf-panel"><tr><Th>Trou</Th><Th>Profondeur (m)</Th><Th>Azimut (°)</Th><Th>Pendage (°)</Th></tr></thead>
      <tbody>
        {rows.slice(0, 500).map(r => (
          <tr key={r.id} className="border-t border-mf-border">
            <Td>{r.hole_id}</Td><Td>{r.depth}</Td><Td>{r.azimuth}</Td><Td>{r.dip}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function LithoTable({ rows }: { rows: DhLithoRow[] }) {
  return (
    <DataTable count={rows.length}>
      <thead className="bg-mf-panel"><tr><Th>Trou</Th><Th>De (m)</Th><Th>À (m)</Th><Th>Lithologie</Th><Th>Altération</Th><Th>Minéralisation</Th></tr></thead>
      <tbody>
        {rows.slice(0, 500).map(r => (
          <tr key={r.id} className="border-t border-mf-border">
            <Td>{r.hole_id}</Td><Td>{r.from_m}</Td><Td>{r.to_m}</Td><Td>{r.lithology ?? '—'}</Td><Td>{r.alteration ?? '—'}</Td><Td>{r.mineralization ?? '—'}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function AssayTable({ rows }: { rows: DhAssayRow[] }) {
  return (
    <DataTable count={rows.length}>
      <thead className="bg-mf-panel"><tr><Th>Trou</Th><Th>De (m)</Th><Th>À (m)</Th><Th>Élément</Th><Th>Valeur</Th><Th>Unité</Th><Th>QA/QC</Th></tr></thead>
      <tbody>
        {rows.slice(0, 500).map(r => (
          <tr key={r.id} className="border-t border-mf-border">
            <Td>{r.hole_id}</Td><Td>{r.from_m}</Td><Td>{r.to_m}</Td><Td>{r.element}</Td>
            <Td>{r.value ?? '—'}</Td><Td>{r.unit}</Td><Td>{r.qaqc_type}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

// ─── Composites ───────────────────────────────────────────────────────────────

function CompositesTab({ collars, assays, elements }: { collars: DhCollarRow[]; assays: DhAssayRow[]; elements: string[] }) {
  const [element, setElement] = useState(elements[0] ?? '');
  const [length, setLength] = useState(2);

  useEffect(() => { if (!element && elements.length) setElement(elements[0]); }, [elements, element]);

  const result = useMemo(() => {
    if (!element) return null;
    const holes = collars.map(c => c.hole_id);
    let count = 0, sumLen = 0, sumMetal = 0, min = Infinity, max = -Infinity;
    for (const hole of holes) {
      const samples = assays
        .filter(a => a.hole_id === hole && a.element === element && a.qaqc_type === 'sample')
        .map(a => ({ from: a.from_m, to: a.to_m, value: a.value }));
      if (samples.length === 0) continue;
      const comps = compositeByLength(samples, { length });
      for (const c of comps) {
        count++; sumLen += c.length; sumMetal += c.value * c.length;
        min = Math.min(min, c.value); max = Math.max(max, c.value);
      }
    }
    if (count === 0) return { count: 0, mean: 0, min: 0, max: 0, sumLen: 0 };
    return { count, mean: sumMetal / sumLen, min, max, sumLen };
  }, [collars, assays, element, length]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-end gap-4 mb-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-mf-txt3">Élément</span>
          <select className="mf-input" value={element} onChange={e => setElement(e.target.value)}>
            {elements.map(el => <option key={el} value={el}>{el}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-mf-txt3">Longueur de composite (m)</span>
          <input type="number" min={0.5} step={0.5} className="mf-input w-40" value={length}
            onChange={e => setLength(Math.max(0.5, Number(e.target.value) || 0.5))} />
        </label>
      </div>

      {!element ? (
        <div className="text-mf-txt3 text-sm">Aucune analyse à composite. Importez des analyses d'abord.</div>
      ) : result && result.count === 0 ? (
        <div className="text-mf-txt3 text-sm">Aucun composite « sample » pour {element}.</div>
      ) : result && (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Composites" value={formatDecimalGrouped(result.count)} />
          <Stat label={`Teneur moyenne (${element})`} value={result.mean.toFixed(3)} />
          <Stat label="Min" value={result.min.toFixed(3)} />
          <Stat label="Max" value={result.max.toFixed(3)} />
        </div>
      )}
      <p className="text-xs text-mf-txt4 mt-4">
        Compositage pondéré par la longueur (moteur <code>lib/drilling/compositing</code>). La longueur de
        composite est un paramètre — elle n'est pas figée dans l'application.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-mf-border rounded-lg p-4 bg-mf-panel">
      <div className="text-xs text-mf-txt4 mb-1">{label}</div>
      <div className="text-xl font-bold text-mf-txt tabular-nums">{value}</div>
    </div>
  );
}

// ─── Coupe & desurvey (SVG plan X–Z) ──────────────────────────────────────────

function SectionTab({ collars, surveys, assays, elements }: {
  collars: DhCollarRow[]; surveys: DhSurveyRow[]; assays: DhAssayRow[]; elements: string[];
}) {
  const [element, setElement] = useState(elements[0] ?? '');
  useEffect(() => { if (!element && elements.length) setElement(elements[0]); }, [elements, element]);

  const traces = useMemo(() => {
    return collars.map(c => {
      const st: SurveyStation[] = surveys
        .filter(s => s.hole_id === c.hole_id)
        .map(s => ({ depth: s.depth, azimuth: s.azimuth, dip: s.dip }));
      try {
        return { holeId: c.hole_id, trace: desurveyHole({ holeId: c.hole_id, x: c.x, y: c.y, z: c.z, maxDepth: c.max_depth ?? undefined }, st) };
      } catch {
        return { holeId: c.hole_id, trace: [] };
      }
    }).filter(t => t.trace.length > 0);
  }, [collars, surveys]);

  if (collars.length === 0) {
    return <div className="text-mf-txt3 text-sm">Aucun collier. Importez au moins la table des colliers.</div>;
  }

  // Emprise (X en abscisse, Z en ordonnée) — coupe est-ouest projetée.
  const xs = traces.flatMap(t => t.trace.map(p => p.x));
  const zs = traces.flatMap(t => t.trace.map(p => p.z));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const W = 760, H = 420, pad = 40;
  const sx = (x: number) => pad + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * (W - 2 * pad);
  const sz = (z: number) => pad + (maxZ === minZ ? 0.5 : (maxZ - z) / (maxZ - minZ)) * (H - 2 * pad);

  const gradeMax = Math.max(0.0001, ...assays.filter(a => a.element === element && a.value != null).map(a => a.value as number));
  const unit = isKnownMetal(element) ? getMetal(element).gradeUnit : '';

  return (
    <div>
      <div className="flex items-end gap-4 mb-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-mf-txt3">Colorer par élément</span>
          <select className="mf-input" value={element} onChange={e => setElement(e.target.value)}>
            {elements.length === 0 && <option value="">—</option>}
            {elements.map(el => <option key={el} value={el}>{el}</option>)}
          </select>
        </label>
        <div className="text-xs text-mf-txt4 flex items-center gap-2">
          <Ruler size={13} /> Coupe X–Z (Est en abscisse, élévation en ordonnée)
        </div>
      </div>

      <div className="border border-mf-border rounded-lg bg-mf-panel overflow-auto">
        <svg width={W} height={H} className="block">
          {/* traces */}
          {traces.map(t => (
            <polyline
              key={t.holeId}
              points={t.trace.map(p => `${sx(p.x)},${sz(p.z)}`).join(' ')}
              fill="none" stroke="#3a4a63" strokeWidth={1.2}
            />
          ))}
          {/* points d'analyse colorés */}
          {element && assays.filter(a => a.value != null).map(a => {
            const t = traces.find(tt => tt.holeId === a.hole_id);
            if (!t || a.element !== element) return null;
            const md = (a.from_m + a.to_m) / 2;
            // interpolation locale simple via desurvey pointAtDepth
            const p = pointAtDepthLocal(t.trace, md);
            if (!p) return null;
            const g = (a.value as number) / gradeMax;
            const col = `hsl(${(1 - g) * 210}, 80%, 55%)`;
            return <circle key={a.id} cx={sx(p.x)} cy={sz(p.z)} r={2.4} fill={col} />;
          })}
        </svg>
      </div>
      <p className="text-xs text-mf-txt4 mt-3">
        Trace reconstruite par « minimum curvature » (moteur <code>lib/drilling/desurvey</code>). Échelle de couleur :
        bleu = faible teneur, rouge = teneur élevée{unit ? ` (${element} en ${unit})` : ''}.
      </p>
    </div>
  );
}

/** Interpolation locale X–Z à une profondeur (évite d'ré-importer pointAtDepth pour typer). */
function pointAtDepthLocal(trace: { md: number; x: number; y: number; z: number }[], md: number) {
  if (trace.length === 0) return null;
  if (md <= trace[0].md) return trace[0];
  const last = trace[trace.length - 1];
  if (md >= last.md) return last;
  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1], b = trace[i];
    if (md <= b.md) {
      const t = (md - a.md) / (b.md - a.md);
      return { md, x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
    }
  }
  return last;
}

// ─── Import modal ─────────────────────────────────────────────────────────────

function ImportModal({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<ImportTable | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(table: ImportTable, file: File) {
    setErr(null);
    setBusy(table);
    try {
      const spec = IMPORT_SPECS[table];
      const parsed = await parseSheet(file);
      if (parsed.length === 0) throw new Error('Fichier vide ou sans données.');

      const rows = parsed.map(r => {
        const o: Record<string, unknown> = { project_id: project.id };
        for (const col of spec.cols) {
          const raw = r[col] ?? '';
          if ((spec.num as readonly string[]).includes(col)) {
            o[col] = raw === '' ? null : Number(raw);
          } else {
            o[col] = raw === '' ? null : raw;
          }
        }
        return o;
      }).filter(o => o.hole_id);

      if (rows.length === 0) throw new Error('Aucune ligne avec un hole_id valide (vérifiez l’en-tête).');

      // Remplacement : on vide la table du projet puis on insère par lots.
      await supabase.from(table).delete().eq('project_id', project.id);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabase.from(table).insert(chunk);
        if (error) throw error;
      }
      setLog(l => [...l, `${spec.label} : ${rows.length} lignes importées.`]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import impossible.');
    } finally {
      setBusy(null);
    }
  }

  function downloadTemplate(table: ImportTable) {
    const spec = IMPORT_SPECS[table];
    const ws = XLSX.utils.aoa_to_sheet([spec.cols as unknown as string[]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, spec.label);
    XLSX.writeFile(wb, `template_${table}.xlsx`);
  }

  return (
    <Modal
      title="Importer des forages"
      subtitle="Chargez chaque table (CSV ou XLSX). L'import remplace les données existantes du projet pour la table concernée."
      onClose={onClose}
      width="lg"
      footer={<button className="mf-btn-primary" onClick={onDone}>Terminer</button>}
    >
      <div className="space-y-3">
        {(Object.keys(IMPORT_SPECS) as ImportTable[]).map(table => {
          const spec = IMPORT_SPECS[table];
          return (
            <div key={table} className="flex items-center justify-between gap-3 border border-mf-border rounded-lg p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-mf-txt flex items-center gap-2">
                  {table === 'dh_litho' ? <LayersIcon size={14} /> : <FileSpreadsheet size={14} />}
                  {spec.label}
                </div>
                <div className="text-xs text-mf-txt4 truncate">Colonnes : {spec.cols.join(', ')}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="mf-btn-ghost text-xs" onClick={() => downloadTemplate(table)}>Template</button>
                <label className={`mf-btn-primary text-xs cursor-pointer ${busy === table ? 'opacity-60 pointer-events-none' : ''}`}>
                  {busy === table ? 'Import…' : <><Upload size={12} /> Fichier</>}
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(table, f); e.currentTarget.value = ''; }} />
                </label>
              </div>
            </div>
          );
        })}

        {err && <div className="mf-alert-error"><AlertCircle size={16} /> {err}</div>}
        {log.length > 0 && (
          <div className="text-xs text-mf-txt3 border-t border-mf-border pt-3 space-y-1">
            {log.map((l, i) => <div key={i} className="flex items-center gap-2"><Trash2 size={11} className="opacity-0" />{l}</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
