import { Trash2, SlidersHorizontal } from 'lucide-react';
import { setCapacityParam, patchArea, deleteArea } from '../../lib/plantopt/modelOps';
import type { PlantModel } from '../../lib/plantopt/types';

/** Champ numérique compact d'une cellule de table. */
function Cell({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input type="number" step={step ?? 1} value={Number.isFinite(value) ? value : 0}
      onChange={e => onChange(Number(e.target.value))}
      className="input-field font-mono text-xs py-1 px-2 w-full" />
  );
}

interface Props {
  model: PlantModel;
  selectedId: string | null;
  onModel: (m: PlantModel) => void;
  onSelect: (id: string) => void;
}

/**
 * Table AIRES (capacité PERT min/mode/max + OPEX). Édition directe de tous les
 * paramètres de capacité, avec accès rapide à l'éditeur détaillé d'une aire.
 */
export function AiresTable({ model, selectedId, onModel, onSelect }: Props) {
  const areas = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);
  const p = (v: number | number[] | undefined) => (typeof v === 'number' ? v : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-mf-txt4 text-left border-b border-mf-border">
            <th className="py-2 pr-2 font-medium">Aire</th>
            <th className="py-2 px-1 font-medium">Min (t/h)</th>
            <th className="py-2 px-1 font-medium">Mode (t/h)</th>
            <th className="py-2 px-1 font-medium">Max (t/h)</th>
            <th className="py-2 px-1 font-medium">OPEX /t</th>
            <th className="py-2 pl-1 font-medium w-16"></th>
          </tr>
        </thead>
        <tbody>
          {areas.map(a => {
            const params = a.capacityDist.params;
            const isTriangular = a.capacityDist.kind === 'triangular' || a.capacityDist.kind === 'pert';
            return (
              <tr key={a.id} className={`border-b border-mf-border/50 ${a.id === selectedId ? 'bg-amber-500/5' : ''}`}>
                <td className="py-1.5 pr-2">
                  <button onClick={() => onSelect(a.id)} className="text-left text-mf-txt2 hover:text-amber-300 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-mf-txt4 shrink-0" />
                    {a.name}
                  </button>
                </td>
                {isTriangular ? (
                  <>
                    <td className="py-1 px-1"><Cell value={p(params.min)} onChange={v => onModel(setCapacityParam(model, a.id, 'min', v))} /></td>
                    <td className="py-1 px-1"><Cell value={p(params.mode)} onChange={v => onModel(setCapacityParam(model, a.id, 'mode', v))} /></td>
                    <td className="py-1 px-1"><Cell value={p(params.max)} onChange={v => onModel(setCapacityParam(model, a.id, 'max', v))} /></td>
                  </>
                ) : (
                  <td colSpan={3} className="py-1 px-1 text-mf-txt4 italic text-[11px]">
                    Loi {a.capacityDist.kind} — éditer dans le panneau détaillé
                  </td>
                )}
                <td className="py-1 px-1"><Cell value={a.opexPerTonne} step={0.1} onChange={v => onModel(patchArea(model, a.id, { opexPerTonne: v }))} /></td>
                <td className="py-1 pl-1">
                  <div className="flex items-center gap-1">
                    <button onClick={() => onSelect(a.id)} title="Éditer en détail" className="text-mf-txt4 hover:text-amber-400 p-1"><SlidersHorizontal size={13} /></button>
                    <button onClick={() => onModel(deleteArea(model, a.id))} title="Supprimer" className="text-mf-txt4 hover:text-red-400 p-1"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
