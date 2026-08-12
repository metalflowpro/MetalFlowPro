// ─────────────────────────────────────────────────────────────────────────────
// Panneau d'import de données usine — onglet Ingestion du module COS.
//
// Flux : choix du jeu de données → dépôt fichier (ou collage) → validation par
// le moteur pur (lib/cos/ingestionImport) → aperçu et rejets motivés →
// écriture en base par lots, idempotente via la clé naturelle du jeu.
//
// Rien n'est écrit avant que l'utilisateur ait vu ce qui passe et ce qui est
// rejeté : l'ingestion d'une usine en activité ne doit jamais être un
// « tout ou rien » silencieux.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback } from 'react';
import {
  Upload, FileUp, CheckCircle2, XCircle, AlertTriangle, Database,
  Loader2, ShieldCheck, Trash2,
} from 'lucide-react';
import { supabaseDynamic } from '../../lib/supabase';
import {
  parseImport, datasetDef, IMPORT_DATASETS,
  type ImportDatasetId, type ImportResult,
} from '../../lib/cos/ingestionImport';
import type { Project } from '../../types';

interface Props {
  project: Project;
  onImported: () => void;
}

/** Taille des lots d'insertion — évite les requêtes géantes sur un quart complet. */
const BATCH_SIZE = 500;

export function IngestionImportPanel({ project, onImported }: Props) {
  const [dataset, setDataset] = useState<ImportDatasetId>('tags');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pasted, setPasted] = useState('');
  const [writing, setWriting] = useState(false);
  const [writeReport, setWriteReport] = useState<{ ok: boolean; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const def = datasetDef(dataset);

  const analyse = useCallback((content: string, name: string | null) => {
    setFileName(name);
    setWriteReport(null);
    setResult(parseImport(dataset, content));
  }, [dataset]);

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => analyse(String(reader.result ?? ''), f.name);
    reader.readAsText(f);
  }

  function reset() {
    setResult(null); setFileName(null); setPasted(''); setWriteReport(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function commit() {
    if (!result || result.rows.length === 0) return;
    setWriting(true);
    setWriteReport(null);

    const payload = result.rows.map(r => ({ ...r, project_id: project.id }));
    let written = 0;
    let failure: string | null = null;

    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const chunk = payload.slice(i, i + BATCH_SIZE);
      // Clé naturelle → un ré-import du même fichier met à jour au lieu de dupliquer.
      const { error } = def.conflictKey
        ? await supabaseDynamic.from(def.table).upsert(chunk as never[], { onConflict: def.conflictKey })
        : await supabaseDynamic.from(def.table).insert(chunk as never[]);
      if (error) { failure = error.message; break; }
      written += chunk.length;
    }

    if (failure) {
      setWriteReport({
        ok: false,
        message: `Écriture interrompue après ${written} ligne(s) : ${failure}`,
      });
    } else {
      setWriteReport({
        ok: true,
        message: `${written} ligne(s) écrite(s) dans ${def.table}${result.rejected.length > 0 ? ` · ${result.rejected.length} rejetée(s), non écrite(s)` : ''}.`,
      });
      onImported();
    }
    setWriting(false);
  }

  const previewCols = result && result.rows.length > 0
    ? Object.keys(result.rows[0]).slice(0, 7)
    : [];

  return (
    <div className="card">
      <div className="section-title mb-4 flex items-center gap-2">
        <Upload size={15} className="text-emerald-400" /> Importer des données d'usine
      </div>

      {/* Choix du jeu de données */}
      <div className="mb-3">
        <label className="label">Jeu de données</label>
        <div className="flex flex-wrap gap-1.5">
          {IMPORT_DATASETS.map(d => (
            <button
              key={d.id}
              onClick={() => { setDataset(d.id); reset(); }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                dataset === d.id
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'text-mf-txt4 border-mf-border hover:text-mf-txt2'
              }`}
            >
              <span className="font-mono text-[9px] opacity-70 mr-1">{d.section}</span>
              {d.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-mf-txt4">
          <span>Cible : <span className="font-mono text-mf-txt3">{def.table}</span></span>
          <span>Formats : <span className="font-mono text-mf-txt3">{def.formats.join(' · ').toUpperCase()}</span></span>
          {def.conflictKey && <span className="text-emerald-400/80">Ré-import idempotent ({def.conflictKey.replace('project_id,', '')})</span>}
        </div>
        <div className="mt-1 text-[10px] text-mf-txt4">{def.hint}</div>
      </div>

      {/* Dépôt de fichier */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`rounded-lg border border-dashed p-4 text-center transition-colors ${
          dragOver ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-mf-border bg-mf-panel/30'
        }`}
      >
        <FileUp size={20} className="mx-auto mb-2 text-mf-txt4" />
        <div className="text-xs text-mf-txt3 mb-2">
          Déposez un fichier {def.formats.join(' ou ').toUpperCase()} ici, ou
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,.txt,text/csv,application/json"
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          Choisir un fichier
        </button>
        {fileName && <div className="mt-2 text-[10px] text-emerald-400 font-mono">{fileName}</div>}
      </div>

      {/* Collage direct */}
      <div className="mt-3">
        <label className="label">…ou coller le contenu</label>
        <textarea
          className="input-field font-mono text-[11px] h-20 w-full"
          placeholder={def.formats[0] === 'json' ? '{ "tags": [ … ] }' : 'colonne1,colonne2,…'}
          value={pasted}
          onChange={e => setPasted(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-sm mt-2"
          disabled={!pasted.trim()}
          onClick={() => analyse(pasted, 'saisie directe')}
        >
          Analyser
        </button>
      </div>

      {/* Résultat de l'analyse */}
      {result && (
        <div className="mt-4 pt-4 border-t border-mf-border/60 space-y-3">
          {result.fatal ? (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-xs text-red-400">
              <XCircle size={13} className="mt-0.5 shrink-0" /> {result.fatal}
            </div>
          ) : (
            <>
              {/* Compteurs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-lg bg-mf-panel/50 p-2.5 text-center">
                  <div className="text-[9px] text-mf-txt4 uppercase">Lignes lues</div>
                  <div className="text-lg font-mono font-bold text-mf-txt">{result.summary.total}</div>
                </div>
                <div className="rounded-lg bg-emerald-500/5 p-2.5 text-center">
                  <div className="text-[9px] text-mf-txt4 uppercase">Valides</div>
                  <div className="text-lg font-mono font-bold text-emerald-400">{result.summary.accepted}</div>
                </div>
                <div className={`rounded-lg p-2.5 text-center ${result.summary.rejected > 0 ? 'bg-red-500/5' : 'bg-mf-panel/50'}`}>
                  <div className="text-[9px] text-mf-txt4 uppercase">Rejetées</div>
                  <div className={`text-lg font-mono font-bold ${result.summary.rejected > 0 ? 'text-red-400' : 'text-mf-txt4'}`}>
                    {result.summary.rejected}
                  </div>
                </div>
                <div className="rounded-lg bg-mf-panel/50 p-2.5 text-center">
                  <div className="text-[9px] text-mf-txt4 uppercase">Format</div>
                  <div className="text-lg font-mono font-bold text-sky-300 uppercase">{result.format}</div>
                </div>
              </div>

              {/* Sign-off P754 */}
              {result.requiresSignoff && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300">
                  <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                  Ce lot contient des valeurs <span className="font-mono">substitute</span> / <span className="font-mono">provisional</span> :
                  sign-off requis avant usage dans le reporting financier (AMIRA P754 n°6). Les lignes sont importées et tracées comme telles.
                </div>
              )}

              {/* Rejets */}
              {result.rejected.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-red-400 mb-1.5">
                    Lignes rejetées — non écrites ({result.rejected.length})
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.rejected.slice(0, 50).map((rej, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] px-2 py-1.5 rounded bg-red-500/5">
                        <span className="font-mono text-red-400 shrink-0">L{rej.row}</span>
                        <span className="text-mf-txt3">{rej.reasons.join(' · ')}</span>
                      </div>
                    ))}
                    {result.rejected.length > 50 && (
                      <div className="text-[10px] text-mf-txt4 px-2">… et {result.rejected.length - 50} autre(s).</div>
                    )}
                  </div>
                </div>
              )}

              {/* Avertissements */}
              {result.warnings.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
                    Avertissements ({result.warnings.length})
                  </summary>
                  <div className="mt-1.5 max-h-32 overflow-y-auto space-y-1">
                    {result.warnings.slice(0, 50).map((w, i) => (
                      <div key={i} className="flex items-start gap-2 px-2 py-1 rounded bg-amber-500/5">
                        <AlertTriangle size={11} className="mt-0.5 text-amber-400 shrink-0" />
                        <span className="text-mf-txt3"><span className="font-mono text-amber-400">L{w.row}</span> {w.message}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Aperçu */}
              {result.rows.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-mf-txt4 mb-1.5">
                    Aperçu avant écriture (5 premières lignes)
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-mf-border">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-left text-[9px] text-mf-txt4 uppercase border-b border-mf-border">
                          {previewCols.map(c => <th key={c} className="py-1.5 px-2">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-b border-mf-border/30">
                            {previewCols.map(c => (
                              <td key={c} className="py-1 px-2 font-mono text-mf-txt3 whitespace-nowrap">
                                {row[c] == null ? <span className="text-mf-txt4 italic">null</span> : String(row[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={commit}
                  disabled={writing || result.rows.length === 0}
                >
                  {writing ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
                  {writing ? 'Écriture…' : `Écrire ${result.rows.length} ligne(s) dans ${def.table}`}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={reset} disabled={writing}>
                  <Trash2 size={13} /> Réinitialiser
                </button>
              </div>

              {/* Compte-rendu d'écriture */}
              {writeReport && (
                <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                  writeReport.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-400'
                }`}>
                  {writeReport.ok
                    ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                    : <XCircle size={13} className="mt-0.5 shrink-0" />}
                  {writeReport.message}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
