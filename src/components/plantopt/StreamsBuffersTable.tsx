import { X } from 'lucide-react';
import {
  findBuffer, setStreamYield, toggleBuffer, setBufferCapacity, deleteStream,
} from '../../lib/plantopt/modelOps';
import type { PlantModel } from '../../lib/plantopt/types';

/** Capacité de tampon par défaut (tonnes) = capacité horaire aval × ce nb d'heures. */
const DEFAULT_BUFFER_HOURS = 1;

function centralValue(params: Record<string, number | number[]>): number {
  const v = params.mode ?? params.mean ?? params.value ?? params.max ?? 0;
  return typeof v === 'number' ? v : 0;
}

interface Props {
  model: PlantModel;
  onModel: (m: PlantModel) => void;
}

/** Table FLUX & TAMPONS : rendement massique, tampon on/off + capacité, par flux. */
export function StreamsBuffersTable({ model, onModel }: Props) {
  if (model.streams.length === 0) {
    return <div className="text-xs text-mf-txt4 py-2">Aucun flux. Utilisez « Connecter des flux » sur le schéma.</div>;
  }
  return (
    <div className="space-y-1.5">
      {model.streams.map(s => {
        const src = model.areas.find(a => a.id === s.sourceAreaId);
        const tgt = model.areas.find(a => a.id === s.targetAreaId);
        const buffer = findBuffer(model, s.sourceAreaId, s.targetAreaId);
        const dsCap = tgt ? centralValue(tgt.capacityDist.params) : 0;
        return (
          <div key={s.id} className="flex items-center gap-2 flex-wrap text-xs bg-mf-panel/50 rounded-md px-3 py-2 border border-mf-border/50">
            <span className="text-mf-txt3 min-w-0 flex-1">
              {src?.name ?? '—'} <span className="text-mf-txt4">→</span> {tgt?.name ?? '—'}
            </span>
            <label className="flex items-center gap-1 text-mf-txt4">
              Rendement %
              <input type="number" min={0} max={100} step={1}
                value={Math.round((s.massYield ?? 1) * 100)}
                onChange={e => onModel(setStreamYield(model, s.id, Math.max(0, Number(e.target.value)) / 100))}
                className="input-field font-mono text-xs py-1 px-2 w-16" />
            </label>
            <label className="flex items-center gap-1 text-mf-txt4">
              <input type="checkbox" checked={!!buffer}
                onChange={() => onModel(toggleBuffer(model, s.sourceAreaId, s.targetAreaId, Math.max(1, Math.round(dsCap * DEFAULT_BUFFER_HOURS))))} />
              Tampon
            </label>
            {buffer && (
              <label className="flex items-center gap-1 text-mf-txt4">
                Capacité (t)
                <input type="number" min={0} step={100} value={Math.round(buffer.capacityTonnes)}
                  onChange={e => onModel(setBufferCapacity(model, buffer.id, Math.max(0, Number(e.target.value))))}
                  className="input-field font-mono text-xs py-1 px-2 w-24" />
              </label>
            )}
            <button onClick={() => onModel(deleteStream(model, s.id))} title="Supprimer le flux" className="text-mf-txt4 hover:text-red-400 p-1 ml-auto">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
