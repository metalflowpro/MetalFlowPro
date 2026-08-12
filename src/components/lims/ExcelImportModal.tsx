import { useState, useRef, useCallback } from 'react';
import {
  Download, Upload, CheckCircle2, XCircle, AlertTriangle,
  FileSpreadsheet, ChevronRight, RotateCcw, Loader,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { supabase, supabaseDynamic } from '../../lib/supabase';
import {
  LIMS_TEMPLATES, downloadXlsxTemplate, parseLimsXlsx,
  type ImportParseResult, type LimsTemplate,
} from '../../lib/limsTemplates';
import type { Project, LimsSample } from '../../types';

interface Props {
  project: Project;
  samples: LimsSample[];
  onSuccess: () => void;
  onClose: () => void;
}

type Step = 'select' | 'upload' | 'preview' | 'done';

export function ExcelImportModal({ project, samples, onSuccess, onClose }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [selectedTemplate, setSelectedTemplate] = useState<LimsTemplate | null>(null);
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ inserted: number; skipped: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const knownSamples = samples.map(s => ({ id: s.id, sample_id: s.sample_id }));

  function selectTemplate(tmpl: LimsTemplate) {
    setSelectedTemplate(tmpl);
    setParseResult(null);
    setFileError(null);
    setStep('upload');
  }

  const processFile = useCallback((file: File) => {
    if (!selectedTemplate) return;
    setFileError(null);

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setFileError('Format non supporté — veuillez importer un fichier Excel (.xlsx ou .xls)');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const result = parseLimsXlsx(buffer, selectedTemplate.code, knownSamples, project.id);
        setParseResult(result);
        setStep('preview');
      } catch {
        setFileError('Erreur de lecture du fichier. Vérifiez que le fichier est un Excel valide.');
      }
    };
    reader.onerror = () => setFileError('Impossible de lire le fichier.');
    reader.readAsArrayBuffer(file);
  }, [selectedTemplate, knownSamples, project.id]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  async function handleImport() {
    if (!parseResult || !selectedTemplate) return;
    const validRows = parseResult.rows.filter(r => r.dbRow !== null);
    if (!validRows.length) return;

    setImporting(true);
    setFileError(null);
    try {
      const { error } = await supabaseDynamic.from(selectedTemplate.table).insert(validRows.map(r => r.dbRow!) as never[]);
      if (error) throw error;
      setImportSummary({ inserted: validRows.length, skipped: parseResult.errorRows });
      setStep('done');
      onSuccess();
    } catch (err: unknown) {
      setFileError(`Erreur lors de l'import: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep('select');
    setSelectedTemplate(null);
    setParseResult(null);
    setFileError(null);
    setImportSummary(null);
  }

  // ─── Step indicators ──────────────────────────────────────────────────────

  const STEPS = [
    { id: 'select',  label: 'Type de données' },
    { id: 'upload',  label: 'Gabarit & fichier' },
    { id: 'preview', label: 'Aperçu' },
    { id: 'done',    label: 'Résultat' },
  ];
  const stepIdx = STEPS.findIndex(s => s.id === step);

  return (
    <Modal
      title="Importation Excel — LIMS"
      subtitle="Téléchargez le gabarit .xlsx, remplissez vos données dans Excel, puis importez le fichier"
      onClose={onClose}
      width="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button className="btn btn-secondary" onClick={step === 'select' ? onClose : reset}>
            {step === 'select' ? 'Fermer' : <><RotateCcw size={13} /> Recommencer</>}
          </button>
          <div className="flex gap-2">
            {step === 'upload' && (
              <button className="btn btn-secondary" onClick={() => selectedTemplate && downloadXlsxTemplate(selectedTemplate.code)}>
                <Download size={13} /> Télécharger le gabarit .xlsx
              </button>
            )}
            {step === 'upload' && (
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                <Upload size={13} /> Sélectionner fichier Excel
              </button>
            )}
            {step === 'preview' && parseResult && (
              <button
                className="btn btn-primary"
                onClick={handleImport}
                disabled={importing || parseResult.validRows === 0}
              >
                {importing
                  ? <><Loader size={13} className="animate-spin" /> Import en cours…</>
                  : <><CheckCircle2 size={13} /> Importer {parseResult.validRows} ligne{parseResult.validRows !== 1 ? 's' : ''}</>
                }
              </button>
            )}
            {step === 'done' && (
              <button className="btn btn-primary" onClick={onClose}>Fermer</button>
            )}
          </div>
        </div>
      }
    >
      {/* Progress breadcrumb */}
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

      {/* ── STEP 1: SELECT TEMPLATE ──────────────────────────────────────── */}
      {step === 'select' && (
        <div className="space-y-4">
          <p className="text-xs text-mf-txt3">
            Sélectionnez le type de données à importer. Un gabarit Excel (.xlsx) sera disponible à l'étape suivante.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {LIMS_TEMPLATES.map(tmpl => (
              <button
                key={tmpl.code}
                onClick={() => selectTemplate(tmpl)}
                className="flex items-center gap-4 p-4 rounded-xl border border-mf-border hover:border-mf-accent/40 bg-mf-card hover:bg-mf-hover/30 text-left transition-all group"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${tmpl.color}15` }}
                >
                  <FileSpreadsheet size={18} style={{ color: tmpl.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-mf-txt">{tmpl.label}</div>
                  <div className="text-[11px] text-mf-txt4 mt-0.5 truncate">
                    {tmpl.columns.map(c => c.header).join(' · ')}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md" style={{ backgroundColor: `${tmpl.color}20`, color: tmpl.color }}>
                    {tmpl.columns.filter(c => c.required).length} champs req.
                  </span>
                  <ChevronRight size={14} className="text-mf-txt4 group-hover:text-mf-txt transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 2: DOWNLOAD TEMPLATE + UPLOAD ───────────────────────────── */}
      {step === 'upload' && selectedTemplate && (
        <div className="space-y-5">
          {/* Instructions */}
          <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-2">
            <div className="text-xs font-semibold text-blue-400 mb-2">Mode d'emploi</div>
            {[
              `Téléchargez le gabarit "${selectedTemplate.label}" (.xlsx) ci-dessous`,
              'Ouvrez le fichier dans Microsoft Excel ou Google Sheets',
              'L\'onglet "Guide" décrit chaque colonne — ne le supprimez pas',
              'Remplissez vos données dans l\'onglet "Données" (supprimez les lignes d\'exemple)',
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

          {/* Column reference */}
          <div>
            <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">
              Colonnes du gabarit — {selectedTemplate.label}
            </div>
            <div className="rounded-xl border border-mf-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-mf-card border-b border-mf-border">
                    <th className="text-left px-3 py-2 text-mf-txt3 font-medium">Colonne Excel</th>
                    <th className="text-left px-3 py-2 text-mf-txt3 font-medium">Description</th>
                    <th className="px-3 py-2 text-mf-txt3 font-medium text-center">Req.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mf-border/40">
                  {selectedTemplate.columns.map(col => (
                    <tr key={col.key} className="hover:bg-mf-hover/20">
                      <td className="px-3 py-2 font-mono text-mf-txt whitespace-nowrap">{col.header}</td>
                      <td className="px-3 py-2 text-mf-txt4">
                        {col.description}
                        {col.validValues && (
                          <span className="ml-1 text-amber-400/80">
                            ({col.validValues.join(', ')})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {col.required
                          ? <span className="text-red-400 font-bold">✱</span>
                          : <span className="text-mf-txt4">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Drop zone */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none ${
              isDragging
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-mf-border hover:border-mf-accent/40 hover:bg-mf-hover/20'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${isDragging ? 'bg-blue-500/20' : 'bg-mf-hover/40'}`}>
              <FileSpreadsheet size={24} className={isDragging ? 'text-blue-400' : 'text-mf-txt4'} />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium text-mf-txt">
                Glissez-déposez votre fichier Excel ici
              </div>
              <div className="text-xs text-mf-txt4 mt-1">ou cliquez pour parcourir — formats: .xlsx, .xls</div>
            </div>
          </div>

          {fileError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
              <XCircle size={14} className="shrink-0 mt-0.5" /> {fileError}
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: PREVIEW ──────────────────────────────────────────────── */}
      {step === 'preview' && parseResult && selectedTemplate && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Lignes lues',     val: parseResult.totalRows, color: 'text-mf-txt' },
              { label: 'Lignes valides',  val: parseResult.validRows, color: 'text-emerald-400' },
              { label: 'Erreurs',         val: parseResult.errorRows, color: parseResult.errorRows > 0 ? 'text-red-400' : 'text-mf-txt4' },
              { label: 'ID introuvables', val: parseResult.unknownSamples.length, color: parseResult.unknownSamples.length > 0 ? 'text-orange-400' : 'text-mf-txt4' },
            ].map(s => (
              <div key={s.label} className="card-sm text-center py-3">
                <div className={`text-xl font-bold font-mono ${s.color}`}>{s.val}</div>
                <div className="text-[10px] text-mf-txt4 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Unknown samples warning */}
          {parseResult.unknownSamples.length > 0 && (
            <div className="p-3 rounded-xl border border-orange-500/20 bg-orange-500/8">
              <div className="flex items-center gap-2 text-xs font-semibold text-orange-400 mb-1.5">
                <AlertTriangle size={13} /> Échantillons introuvables dans LIMS
              </div>
              <p className="text-[11px] text-mf-txt3 mb-2">
                Ces IDs n'ont pas de correspondance — leurs lignes seront ignorées.
                Créez ces échantillons d'abord, ou importez-les via le gabarit "Échantillons".
              </p>
              <div className="flex flex-wrap gap-1">
                {parseResult.unknownSamples.map(id => (
                  <span key={id} className="badge badge-orange text-[10px] font-mono">{id}</span>
                ))}
              </div>
            </div>
          )}

          {fileError && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
              <XCircle size={14} className="shrink-0 mt-0.5" /> {fileError}
            </div>
          )}

          {/* Data preview */}
          <div>
            <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">
              Aperçu — {Math.min(parseResult.rows.length, 10)} premières lignes
            </div>
            <div className="rounded-xl border border-mf-border overflow-hidden overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-mf-card border-b border-mf-border">
                    <th className="px-3 py-2 text-mf-txt3 font-medium text-center w-8">OK</th>
                    {selectedTemplate.columns.map(col => (
                      <th key={col.key} className="px-3 py-2 text-left text-mf-txt3 font-medium font-mono whitespace-nowrap">
                        {col.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-mf-border/40">
                  {parseResult.rows.slice(0, 10).map(row => (
                    <tr key={row.lineNumber} className={row.dbRow ? 'hover:bg-mf-hover/20' : 'bg-red-500/5'}>
                      <td className="px-3 py-2 text-center">
                        {row.errors.length === 0
                          ? <CheckCircle2 size={13} className="text-emerald-400 mx-auto" />
                          : <XCircle size={13} className="text-red-400 mx-auto" />
                        }
                      </td>
                      {selectedTemplate.columns.map(col => (
                        <td key={col.key} className={`px-3 py-2 font-mono whitespace-nowrap ${
                          !row.display[col.key] && col.required ? 'text-red-400' : 'text-mf-txt3'
                        }`}>
                          {row.display[col.key] || <span className="text-mf-txt4 italic text-[10px]">vide</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parseResult.rows.length > 10 && (
              <p className="text-[10px] text-mf-txt4 mt-1.5 text-right">
                + {parseResult.rows.length - 10} autres lignes non affichées
              </p>
            )}
          </div>

          {/* Error detail */}
          {parseResult.rows.filter(r => r.errors.length > 0).length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Détail des erreurs</div>
              {parseResult.rows.filter(r => r.errors.length > 0).slice(0, 5).map(row => (
                <div key={row.lineNumber} className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/8 border border-red-500/15 text-xs text-red-300">
                  <XCircle size={12} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-mono text-mf-txt4 mr-2">Ligne {row.lineNumber}</span>
                    {row.errors.join(' · ')}
                  </div>
                </div>
              ))}
              {parseResult.rows.filter(r => r.errors.length > 0).length > 5 && (
                <p className="text-[10px] text-mf-txt4 pl-1">
                  + {parseResult.rows.filter(r => r.errors.length > 0).length - 5} autres erreurs…
                </p>
              )}
            </div>
          )}

          {parseResult.validRows === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/8 border border-orange-500/20 text-xs text-orange-300">
              <AlertTriangle size={14} />
              Aucune ligne valide à importer. Corrigez le fichier et réessayez.
            </div>
          )}
        </div>
      )}

      {/* ── STEP 4: DONE ─────────────────────────────────────────────────── */}
      {step === 'done' && importSummary && (
        <div className="flex flex-col items-center justify-center py-10 space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={36} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-mf-txt">Import réussi</div>
            <div className="text-sm text-mf-txt3 mt-1">
              {importSummary.inserted} ligne{importSummary.inserted !== 1 ? 's' : ''} importée{importSummary.inserted !== 1 ? 's' : ''} dans la base
            </div>
            {importSummary.skipped > 0 && (
              <div className="text-xs text-orange-400 mt-1">
                {importSummary.skipped} ligne{importSummary.skipped !== 1 ? 's' : ''} ignorée{importSummary.skipped !== 1 ? 's' : ''} (erreurs)
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={reset}>
            <Upload size={13} /> Importer d'autres données
          </button>
        </div>
      )}
    </Modal>
  );
}
