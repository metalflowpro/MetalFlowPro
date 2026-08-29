import { useRef, useState } from 'react';
import { Download, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  readWorkbookRows, applyGmaoImport, downloadTemplateCsv, downloadTemplateXlsx,
} from '../../lib/plantopt/importData';
import type { PlantModel } from '../../lib/plantopt/types';

interface Props {
  model: PlantModel;
  onModel: (m: PlantModel) => void;
  /** Débits historiques trouvés à l'import (pour le back-test). */
  onHistorical: (values: number[]) => void;
}

/**
 * IMPORT DE DONNÉES GMAO / HISTORIAN (CSV, Excel). Télécharge un modèle pré-rempli
 * des aires courantes, puis réimporte capacités PERT / OPEX / MTTF / MTTR et débits
 * historiques. Le rapprochement se fait par nom d'aire.
 */
export function DataImportPanel({ model, onModel, onHistorical }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ applied: string[]; skipped: string[]; historical: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');

  async function onFile(file: File) {
    setError(null);
    setFileName(file.name);
    try {
      const rows = await readWorkbookRows(file);
      const res = applyGmaoImport(model, rows);
      onModel(res.model);
      if (res.historical.length) onHistorical(res.historical);
      setStatus({ applied: res.applied, skipped: res.skipped, historical: res.historical.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import impossible');
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-mf-txt4">Pas de fichier ? Téléchargez le modèle, remplissez-le, puis réimportez-le.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => downloadTemplateCsv(model)} className="btn btn-sm btn-secondary"><Download size={13} /> Modèle CSV</button>
        <button onClick={() => downloadTemplateXlsx(model)} className="btn btn-sm btn-secondary"><Download size={13} /> Modèle Excel</button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => inputRef.current?.click()} className="btn btn-sm btn-primary"><Upload size={13} /> Choisir un fichier</button>
        <span className="text-xs text-mf-txt4 truncate">{fileName || 'Aucun fichier choisi'}</span>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      </div>
      <p className="text-[11px] text-mf-txt4">
        Colonnes reconnues : Aire · Min · Mode · Max · OPEX · MTTF · MTTR · Débit historique. La première ligne est l'en-tête.
      </p>
      {error && <div className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={13} /> {error}</div>}
      {status && (
        <div className="text-xs space-y-1 bg-mf-panel/50 rounded-md p-2 border border-mf-border/50">
          <div className="text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={13} /> {status.applied.length} aire(s) mise(s) à jour
            {status.historical > 0 && ` · ${status.historical} débit(s) historique(s)`}
          </div>
          {status.applied.length > 0 && <div className="text-mf-txt4">Appliqué : {status.applied.join(', ')}</div>}
          {status.skipped.length > 0 && <div className="text-amber-400">Ignoré (aire non reconnue) : {status.skipped.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
