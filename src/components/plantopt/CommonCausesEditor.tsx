import { Plus, X } from 'lucide-react';
import { addCommonCause, updateCommonCause, deleteCommonCause, toggleCommonCauseArea } from '../../lib/plantopt/modelOps';
import type { CommonCause, PlantModel } from '../../lib/plantopt/types';

/** Intervalle moyen (h) d'une cause = 1/λ de sa loi exponentielle de TTF. */
function meanInterval(cc: CommonCause): number {
  const rate = cc.ttfDist.kind === 'exponential' ? Number(cc.ttfDist.params.rate) : NaN;
  return Number.isFinite(rate) && rate > 0 ? 1 / rate : 0;
}
/** Durée moyenne (h) = moyenne de la loi lognormale de TTR (exp(μ+σ²/2)). */
function meanDuration(cc: CommonCause): number {
  if (cc.ttrDist.kind !== 'lognormal') return 0;
  const mu = Number(cc.ttrDist.params.mu);
  const sigma = Number(cc.ttrDist.params.sigma);
  return Number.isFinite(mu) ? Math.exp(mu + (sigma * sigma) / 2) : 0;
}

interface Props {
  model: PlantModel;
  onModel: (m: PlantModel) => void;
}

/**
 * Éditeur des CAUSES COMMUNES : un événement (coupure électrique, eau…) qui met
 * plusieurs aires à l'arrêt simultanément — modélise la corrélation de défaillance.
 */
export function CommonCausesEditor({ model, onModel }: Props) {
  const areas = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);
  const causes = model.commonCauses ?? [];

  const setInterval = (cc: CommonCause, hours: number) =>
    onModel(updateCommonCause(model, cc.id, { ttfDist: { kind: 'exponential', params: { rate: hours > 0 ? 1 / hours : 0 } } }));
  const setDuration = (cc: CommonCause, hours: number) =>
    onModel(updateCommonCause(model, cc.id, { ttrDist: { kind: 'lognormal', params: { mu: Math.log(Math.max(0.01, hours)) - 0.125, sigma: 0.5 } } }));

  return (
    <div className="space-y-3">
      <button onClick={() => onModel(addCommonCause(model))} className="btn btn-sm btn-secondary">
        <Plus size={13} /> Ajouter une cause commune
      </button>
      {causes.length === 0 && <div className="text-xs text-mf-txt4">Aucune cause commune définie.</div>}
      {causes.map(cc => (
        <div key={cc.id} className="rounded-lg border border-mf-border bg-mf-panel/40 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <input value={cc.name ?? ''} placeholder="Nom (ex. Coupure électrique)"
              onChange={e => onModel(updateCommonCause(model, cc.id, { name: e.target.value }))}
              className="input-field text-xs py-1 flex-1 min-w-[160px]" />
            <label className="flex items-center gap-1 text-mf-txt4">β
              <input type="number" step={0.05} min={0} max={1} value={cc.beta ?? 0}
                onChange={e => onModel(updateCommonCause(model, cc.id, { beta: Number(e.target.value) }))}
                className="input-field font-mono text-xs py-1 px-2 w-16" />
            </label>
            <label className="flex items-center gap-1 text-mf-txt4">Intervalle moy. (h)
              <input type="number" step={100} min={1} value={Math.round(meanInterval(cc))}
                onChange={e => setInterval(cc, Number(e.target.value))}
                className="input-field font-mono text-xs py-1 px-2 w-20" />
            </label>
            <label className="flex items-center gap-1 text-mf-txt4">Durée moy. (h)
              <input type="number" step={0.5} min={0.1} value={Math.round(meanDuration(cc) * 10) / 10}
                onChange={e => setDuration(cc, Number(e.target.value))}
                className="input-field font-mono text-xs py-1 px-2 w-16" />
            </label>
            <button onClick={() => onModel(deleteCommonCause(model, cc.id))} className="text-mf-txt4 hover:text-red-400 p-1"><X size={14} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {areas.map(a => (
              <label key={a.id} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border cursor-pointer ${
                cc.areaIds.includes(a.id) ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-mf-border text-mf-txt4'
              }`}>
                <input type="checkbox" checked={cc.areaIds.includes(a.id)}
                  onChange={() => onModel(toggleCommonCauseArea(model, cc.id, a.id))} className="hidden" />
                {a.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
