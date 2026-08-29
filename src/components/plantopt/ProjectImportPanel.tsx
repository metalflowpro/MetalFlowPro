import { useMemo, useState } from 'react';
import { DownloadCloud, CheckCircle2, Loader2, Info } from 'lucide-react';
import {
  importFromModules, bundleHasData,
  type ProjectDataBundle, type ImportSelection, type ImportSource,
} from '../../lib/plantopt/projectImport';
import type { PlantModel } from '../../lib/plantopt/types';
import { notifySuccess, notifyError } from '../../lib/notify';

const SOURCE_LABELS: Record<ImportSource, { label: string; hint: string; module: string }> = {
  recovery: { label: 'Récupération métallurgique', hint: 'Récupération dérivée des essais → aire de lixiviation', module: 'LIMS / Analytics' },
  horizon:  { label: 'Horizon (heures/an)', hint: 'Heures d\'opération résolues → horizon de simulation', module: 'Paramètres projet' },
  opex:     { label: 'OPEX par aire', hint: 'Coûts $/t par poste → OPEX des aires correspondantes', module: 'Économie' },
  capacity: { label: 'Capacités des aires', hint: 'Capacités des équipements → capacité des aires correspondantes', module: 'Équipements' },
};

interface Props {
  model: PlantModel;
  bundle: ProjectDataBundle | null;
  loading: boolean;
  onModel: (m: PlantModel) => void;
  /** Propage l'horizon importé vers la config de simulation. */
  onHorizon?: (hours: number) => void;
}

/**
 * Import AUTOMATIQUE depuis les autres modules du projet. Coche les sources
 * disponibles et applique récupération, horizon, OPEX et capacités trouvés
 * ailleurs dans MetalFlow Pro — sans ressaisie ni fichier.
 */
export function ProjectImportPanel({ model, bundle, loading, onModel, onHorizon }: Props) {
  const has = useMemo(
    () => (bundle ? bundleHasData(bundle) : { recovery: false, horizon: false, opex: false, capacity: false }),
    [bundle],
  );
  const [sel, setSel] = useState<ImportSelection>({ recovery: true, horizon: true, opex: true, capacity: true });

  const toggle = (k: ImportSource) => setSel(s => ({ ...s, [k]: !s[k] }));

  function apply() {
    if (!bundle) return;
    const selection: ImportSelection = {
      recovery: sel.recovery && has.recovery,
      horizon: sel.horizon && has.horizon,
      opex: sel.opex && has.opex,
      capacity: sel.capacity && has.capacity,
    };
    if (!selection.recovery && !selection.horizon && !selection.opex && !selection.capacity) {
      notifyError('Rien à importer', 'Aucune source disponible ou sélectionnée.');
      return;
    }
    const res = importFromModules(model, bundle, selection);
    onModel(res.model);
    if (selection.horizon && bundle.hoursPerYear > 0) onHorizon?.(bundle.hoursPerYear);
    if (res.messages.length) notifySuccess('Import depuis les modules', res.messages.join(' · '));
    else notifyError('Import sans effet', 'Aucune correspondance trouvée entre les aires et les données des modules.');
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-mf-txt4">
        Récupère automatiquement les données déjà saisies ailleurs dans le projet, sans fichier.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-mf-txt4"><Loader2 size={14} className="animate-spin" /> Lecture des modules…</div>
      ) : (
        <div className="space-y-1.5">
          {(Object.keys(SOURCE_LABELS) as ImportSource[]).map(k => {
            const meta = SOURCE_LABELS[k];
            const available = has[k];
            return (
              <label key={k} className={`flex items-start gap-2 text-xs rounded-md px-3 py-2 border ${
                available ? 'border-mf-border bg-mf-panel/50 cursor-pointer' : 'border-mf-border/40 opacity-50'
              }`}>
                <input type="checkbox" className="mt-0.5" checked={sel[k] && available} disabled={!available} onChange={() => toggle(k)} />
                <span className="flex-1">
                  <span className="text-mf-txt2 font-medium">{meta.label}</span>
                  <span className="text-mf-txt4"> · {meta.module}</span>
                  <span className="block text-[11px] text-mf-txt4">{meta.hint}</span>
                </span>
                {!available && <span className="text-[10px] text-mf-txt4 italic shrink-0">indisponible</span>}
              </label>
            );
          })}
        </div>
      )}
      <button onClick={apply} disabled={loading || !bundle} className="btn btn-sm btn-primary">
        <DownloadCloud size={14} /> Importer depuis les modules
      </button>
      <div className="text-[11px] text-mf-txt4 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        Le rapprochement se fait par nom d'aire ; seules les aires correspondantes sont mises à jour.
      </div>
      {bundle && !loading && !has.recovery && !has.opex && !has.capacity && (
        <div className="text-[11px] text-amber-400/80 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> Peu de données disponibles : renseignez d'abord Équipements / Économie / essais LIMS.
        </div>
      )}
    </div>
  );
}
