// ─────────────────────────────────────────────────────────────────────────────
// Importation Excel — module COS.
//
// Même parcours que l'assistant LIMS, pour que les équipes n'aient qu'un seul
// geste à apprendre : choisir le type de données → télécharger le gabarit .xlsx
// → le remplir dans Excel → le réimporter → contrôler l'aperçu → écrire.
//
// Toute la validation vient de lib/cos/cosTemplates + lib/cos/ingestionImport ;
// ce composant ne fait que présenter le résultat et déclencher l'écriture.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback } from 'react';
import {
  Download, Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  ChevronRight, RotateCcw, Loader, ShieldCheck, Database,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { supabase, supabaseDynamic } from '../../lib/supabase';
import {
  COS_TEMPLATES, downloadCosXlsxTemplate, parseCosXlsx, type CosTemplate,
} from '../../lib/cos/cosTemplates';
import { datasetDef, type ImportResult } from '../../lib/cos/ingestionImport';
import type { Project } from '../../types';

interface Props {
  project: Project;
  onSuccess: () => void;
  onClose: () => void;
  /** Jeu de données présélectionné (depuis une carte de gabarit). */
  initialDataset?: CosTemplate['dataset'] | null;
}

type Step = 'select' | 'upload' | 'preview' | 'done';

/** Taille des lots d'écriture — un quart complet de tags peut être volumineux. */
const BATCH_SIZE = 500;

export function CosExcelImportModal({ project, onSuccess, onClose, initialDataset }: Props) {
  const preset = initialDataset ? COS_TEMPLATES.find(t => t.dataset === initialDataset) ?? null : null;
  const [step, setStep] = useState<Step>(preset ? 'upload' : 'select');
  const [selected, setSelected] = useState<CosTemplate | null>(preset);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<{ written: number; skipped: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function selectTemplate(tmpl: CosTemplate) {
    setSelected(tmpl);
    setResult(null);
    setFileError(null);
    setFileName(null);
    setStep('upload');
  }

  const processFile = useCallback((file: File) => {
    if (!selected) return;
    setFileError(null);

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setFileError('Format non supporté — importez un fichier Excel (.xlsx ou .xls).');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const buffer = e.target?.result as ArrayBuffer;
      const parsed = parseCosXlsx(selected.dataset, buffer);
      setFileName(file.name);
      setResult(parsed);
      if (parsed.fatal) setFileError(parsed.fatal);
      else setStep('preview');
    };
    reader.onerror = () => setFileError('Impossible de lire le fichier.');
    reader.readAsArrayBuffer(file);
  }, [selected]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }

  async function handleImport() {
    if (!result || !selected || result.rows.length === 0) return;
    const def = datasetDef(selected.dataset);

    setImporting(true);
    setFileError(null);

    const payload = result.rows.map(r => ({ ...r, project_id: project.id }));
    let written = 0;
    let failure: string | null = null;

    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      const chunk = payload.slice(i, i + BATCH_SIZE);
      // Clé naturelle → réimporter le même fichier met à jour au lieu de dupliquer.
      const { error } = def.conflictKey
        ? await supabaseDynamic.from(def.table).upsert(chunk as never[], { onConflict: def.conflictKey })
        : await supabaseDynamic.from(def.table).insert(chunk as never[]);
      if (error) { failure = error.message; break; }
      written += chunk.length;
    }

    if (failure) {
      setFileError(`Écriture interrompue après ${written} ligne(s) : ${failure}`);
    } else {
      setSummary({ written, skipped: result.rejected.length });
      setStep('done');
      onSuccess();
    }
    setImporting(false);
  }

  function reset() {
    setStep('select');
    setSelected(null);
    setResult(null);
    setFileError(null);
    setFileName(null);
    setSummary(null);
  }

  const STEPS = [
    { id: 'select',  label: 'Type de données' },
    { id: 'upload',  label: 'Gabarit & fichier' },
    { id: 'preview', label: 'Aperçu' },
    { id: 'done',    label: 'Résultat' },
  ];
  const stepIdx = STEPS.findIndex(s => s.id === step);
  const previewCols = result && result.rows.length > 0 ? Object.keys(result.rows[0]).slice(0, 6) : [];

  return (
    <Modal
      title="Importation Excel — COS"
      subtitle="Téléchargez le gabarit .xlsx, remplissez vos données dans Excel, puis importez le fichier"
      onClose={onClose}
      width="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button className="btn btn-secondary" onClick={step === 'select' ? onClose : reset}>
            {step === 'select' ? 'Fermer' : <><RotateCcw size={13} /> Recommencer</>}
          </button>
          <div className="flex gap-2">
            {step === 'upload' && selected && (
              <>
                <button className="btn btn-secondary" onClick={() => downloadCosXlsxTemplate(selected.dataset)}>
                  <Download size={13} /> Télécharger le gabarit .xlsx
                </button>
                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={13} /> Sélectionner fichier Excel
                </button>
              </>
            )}
            {step === 'preview' && result && (
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={importing || result.rows.length === 0}
              >
                {importing
                  ? <><Loader size={13} className="animate-spin" /> Import en cours…</>
                  : <><CheckCircle2 size={13} /> Importer {result.rows.length} ligne{result.rows.length !== 1 ? 's' : ''}</>}
              </button>
            )}
            {step === 'done' && <button className="btn btn-primary" onClick={onClose}>Fermer</button>}
          </div>
        </div>
      }
    >
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1 mb-6 -mt-1">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-all ${
              i < stepIdx ? 'text-emerald-400' : i === stepIdx ? 'text-mf-txt' : 'text-mf-txt4'
            }`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                i < stepIdx ? 'bg-emerald-500/20 text-emerald-400'
                : i === stepIdx ? 'bg-blue-500/20 text-blue-400'
                : 'bg-mf-border/40 text-mf-txt4'
              }`}>
                {i < stepIdx ? '✓' : i + 1}
              </div>
              <span className="text-[11px] font-medium">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <ChevronRight size={12} className="text-mf-txt4 shrink-0" />}
          </div>
        ))}
      </div>

      {/* ── ÉTAPE 1 : choix du jeu de données ─────────────────────────────── */}
      {step === 'select' && (
        <div className="space-y-4">
          <p className="text-xs text-mf-txt3">
            Sélectionnez le type de données à importer. Un gabarit Excel (.xlsx) sera disponible à l'étape suivante.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {COS_TEMPLATES.map(tmpl => {
              const def = datasetDef(tmpl.dataset);
              return (
                <button
                  key={tmpl.dataset}
                  onClick={() => selectTemplate(tmpl)}
                  className="flex items-center gap-4 p-4 rounded-xl border border-mf-border hover:border-mf-accent/40 bg-mf-card hover:bg-mf-hover/30 text-left transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${tmpl.color}15` }}>
                    <FileSpreadsheet size={18} style={{ color: tmpl.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-mf-txt">
                      <span className="font-mono text-[10px] text-mf-txt4 mr-1.5">{tmpl.section}</span>
                      {tmpl.label}
                    </div>
                    <div className="text-[11px] text-mf-txt4 mt-0.5 truncate">
                      {tmpl.columns.map(c => c.header).join(' · ')}
                    </div>
                    <div className="text-[10px] text-mf-txt4 mt-0.5 font-mono">→ {def.table}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md" style={{ backgroundColor: `${tmpl.color}20`, color: tmpl.color }}>
                      {tmpl.columns.filter(c => c.required).length} champs req.
                    </span>
                    <ChevronRight size={14} className="text-mf-txt4 group-hover:text-mf-txt transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ÉTAPE 2 : gabarit + dépôt du fichier ──────────────────────────── */}
      {step === 'upload' && selected && (
        <div className="space-y-5">
          <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-2">
            <div className="text-xs font-semibold text-blue-400 mb-2">Mode d'emploi</div>
            {[
              `Téléchargez le gabarit « ${selected.label} » (.xlsx) ci-dessous`,
              'Ouvrez le fichier dans Microsoft Excel ou Google Sheets',
              'L\'onglet « Guide » décrit chaque colonne et les règles d\'ingestion — ne le supprimez pas',
              'Remplissez vos données dans l\'onglet « Données » (remplacez les lignes d\'exemple)',
              'Enregistrez le fichier en gardant le format .xlsx',
              'Importez le fichier ici avec le bouton ou par glisser-déposer',
            ].map((txt, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs text-mf-txt3">
                <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {txt}
              </div>
            ))}
          </div>

          {/* Règles d'ingestion — ce qui fait rejeter une ligne */}
          <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-200/90 space-y-1">
            <div className="font-semibold text-amber-400 text-xs mb-1">Règles de validation</div>
            <div>• Horodatages en <span className="font-mono">UTC ISO-8601</span> avec le suffixe Z — ex. <span className="font-mono">2026-07-22T14:00:10Z</span></div>
            <div>• Une unité hors catalogue canonique <strong>fait rejeter la ligne</strong> — aucune conversion silencieuse</div>
            <div>• Qualité : <span className="font-mono">good | suspect | bad | missing | frozen | substitute</span></div>
            <div>• Une valeur <span className="font-mono">substitute</span> impose un sign-off avant reporting financier (P754 n°6)</div>
          </div>

          {/* Référence des colonnes */}
          <div>
            <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">
              Colonnes du gabarit — {selected.label}
            </div>
            <div className="rounded-xl border border-mf-border overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-mf-card border-b border-mf-border">
                    <th className="text-left px-3 py-2 text-mf-txt3 font-medium">Colonne Excel</th>
                    <th className="text-left px-3 py-2 text-mf-txt3 font-medium">Description</th>
                    <th className="px-3 py-2 text-mf-txt3 font-medium text-center">Req.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mf-border/40">
                  {selected.columns.map(col => (
                    <tr key={col.key} className="hover:bg-mf-hover/20">
                      <td className="px-3 py-2 font-mono text-mf-txt whitespace-nowrap">{col.header}</td>
                      <td className="px-3 py-2 text-mf-txt4">
                        {col.description}
                        {col.validValues && (
                          <span className="ml-1 text-amber-400/80">({col.validValues.join(', ')})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {col.required ? <span className="text-red-400 font-bold">✱</span> : <span className="text-mf-txt4">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none ${
              isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-mf-border hover:border-mf-accent/40 hover:bg-mf-hover/20'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${isDragging ? 'bg-blue-500/20' : 'bg-mf-hover/40'}`}>
              <FileSpreadsheet size={24} className={isDragging ? 'text-blue-400' : 'text-mf-txt4'} />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium text-mf-txt">Glissez-déposez votre fichier Excel ici</div>
              <div className="text-xs text-mf-txt4 mt-1">ou cliquez pour parcourir — formats : .xlsx, .xls</div>
            </div>
          </div>

          {fileError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
              <XCircle size={14} className="shrink-0 mt-0.5" /> {fileError}
            </div>
          )}
        </div>
      )}

      {/* ── ÉTAPE 3 : aperçu ──────────────────────────────────────────────── */}
      {step === 'preview' && result && selected && (
        <div className="space-y-4">
          {fileName && (
            <div className="flex items-center gap-2 text-xs text-mf-txt3">
              <FileSpreadsheet size={14} className="text-emerald-400" />
              <span className="font-mono">{fileName}</span>
              <span className="text-mf-txt4">→ {datasetDef(selected.dataset).table}</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-mf-panel/50 p-3 text-center">
              <div className="text-[9px] text-mf-txt4 uppercase">Lignes lues</div>
              <div className="text-xl font-mono font-bold text-mf-txt">{result.summary.total}</div>
            </div>
            <div className="rounded-xl bg-emerald-500/5 p-3 text-center">
              <div className="text-[9px] text-mf-txt4 uppercase">Valides</div>
              <div className="text-xl font-mono font-bold text-emerald-400">{result.summary.accepted}</div>
            </div>
            <div className={`rounded-xl p-3 text-center ${result.summary.rejected > 0 ? 'bg-red-500/5' : 'bg-mf-panel/50'}`}>
              <div className="text-[9px] text-mf-txt4 uppercase">Rejetées</div>
              <div className={`text-xl font-mono font-bold ${result.summary.rejected > 0 ? 'text-red-400' : 'text-mf-txt4'}`}>
                {result.summary.rejected}
              </div>
            </div>
          </div>

          {result.requiresSignoff && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-300">
              <ShieldCheck size={13} className="mt-0.5 shrink-0" />
              Ce lot contient des valeurs <span className="font-mono">substitute</span> : sign-off requis avant usage
              dans le reporting financier (AMIRA P754 n°6). Les lignes sont importées et tracées comme telles.
            </div>
          )}

          {result.rejected.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-red-400 mb-1.5">
                Lignes rejetées — non écrites ({result.rejected.length})
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {result.rejected.slice(0, 50).map((rej, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] px-2 py-1.5 rounded bg-red-500/5">
                    <span className="font-mono text-red-400 shrink-0">Ligne {rej.row + 1}</span>
                    <span className="text-mf-txt3">{rej.reasons.join(' · ')}</span>
                  </div>
                ))}
                {result.rejected.length > 50 && (
                  <div className="text-[10px] text-mf-txt4 px-2">… et {result.rejected.length - 50} autre(s).</div>
                )}
              </div>
            </div>
          )}

          {result.warnings.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-amber-400 text-[10px] font-semibold uppercase tracking-wide">
                Avertissements ({result.warnings.length})
              </summary>
              <div className="mt-1.5 max-h-28 overflow-y-auto space-y-1">
                {result.warnings.slice(0, 50).map((w, i) => (
                  <div key={i} className="flex items-start gap-2 px-2 py-1 rounded bg-amber-500/5">
                    <AlertTriangle size={11} className="mt-0.5 text-amber-400 shrink-0" />
                    <span className="text-mf-txt3">
                      <span className="font-mono text-amber-400">Ligne {w.row + 1}</span> {w.message}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {result.rows.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-mf-txt4 mb-1.5">
                Aperçu avant écriture (5 premières lignes)
              </div>
              <div className="overflow-x-auto rounded-xl border border-mf-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-mf-card border-b border-mf-border text-left text-[9px] text-mf-txt4 uppercase">
                      {previewCols.map(c => <th key={c} className="py-2 px-2.5">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mf-border/40">
                    {result.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {previewCols.map(c => (
                          <td key={c} className="py-1.5 px-2.5 font-mono text-mf-txt3 whitespace-nowrap">
                            {row[c] == null || row[c] === ''
                              ? <span className="text-mf-txt4 italic">vide</span>
                              : String(row[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {fileError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
              <XCircle size={14} className="shrink-0 mt-0.5" /> {fileError}
            </div>
          )}
        </div>
      )}

      {/* ── ÉTAPE 4 : résultat ────────────────────────────────────────────── */}
      {step === 'done' && summary && selected && (
        <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={28} className="text-emerald-400" />
          </div>
          <div>
            <div className="text-base font-semibold text-mf-txt mb-1">Import terminé</div>
            <div className="text-sm text-mf-txt3">
              <span className="text-emerald-400 font-semibold">{summary.written}</span> ligne(s) écrite(s) dans{' '}
              <span className="font-mono text-mf-txt2">{datasetDef(selected.dataset).table}</span>
              {summary.skipped > 0 && (
                <> · <span className="text-red-400">{summary.skipped}</span> rejetée(s), non écrite(s)</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-mf-txt4">
            <Database size={12} />
            {datasetDef(selected.dataset).conflictKey
              ? 'Réimporter ce fichier mettra à jour ces lignes au lieu de les dupliquer.'
              : 'Chaque import ajoute de nouvelles lignes.'}
          </div>
        </div>
      )}
    </Modal>
  );
}
