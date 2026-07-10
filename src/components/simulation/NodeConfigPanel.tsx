import React from 'react';
import { ProcessNode } from '../../lib/simulation/types';
import { getUnit } from '../../lib/simulation/unitRegistry';
import { Trash2 } from 'lucide-react';

interface NodeConfigPanelProps {
  node: ProcessNode | null;
  onUpdate: (nodeId: string, changes: Partial<ProcessNode>) => void;
  onDelete: (nodeId: string) => void;
}

export default function NodeConfigPanel({ node, onUpdate, onDelete }: NodeConfigPanelProps) {
  if (!node) {
    return (
      <div className="w-64 bg-slate-900 border-l border-slate-700 p-4 flex items-center justify-center">
        <p className="text-sm text-slate-500 text-center">Sélectionnez une unité pour configurer ses paramètres</p>
      </div>
    );
  }

  const unit = getUnit(node.unit_type);
  if (!unit) return null;

  return (
    <div className="w-64 bg-slate-900 border-l border-slate-700 overflow-y-auto flex-shrink-0">
      <div className="p-3 border-b border-slate-700 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white flex items-center gap-2">
            <span>{unit.icon}</span>
            <span>{node.label}</span>
          </div>
          <div className="text-xs text-slate-400">{unit.displayName}</div>
        </div>
        <button
          onClick={() => onDelete(node.id)}
          className="p-1.5 rounded text-red-400 hover:bg-red-900/30 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <label className="label">Étiquette</label>
          <input
            className="input-field"
            value={node.label}
            onChange={e => onUpdate(node.id, { label: e.target.value })}
          />
        </div>

        {node.design_capacity !== undefined && (
          <div>
            <label className="label">Capacité design (t/h)</label>
            <input
              type="number"
              className="input-field"
              value={node.design_capacity}
              min={0}
              onChange={e => onUpdate(node.id, { design_capacity: parseFloat(e.target.value) || 0 })}
            />
          </div>
        )}

        {Object.entries(unit.defaultParameters).map(([key, def]) => (
          <div key={key}>
            <label className="label">
              {def.label}
              {def.unit && <span className="text-slate-500 ml-1">({def.unit})</span>}
            </label>
            {def.type === 'select' ? (
              <select
                className="input-field"
                value={(node.parameters[key] as string) ?? def.default}
                onChange={e => onUpdate(node.id, { parameters: { ...node.parameters, [key]: e.target.value } })}
              >
                {def.options?.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : def.type === 'text' ? (
              <input
                className="input-field"
                value={(node.parameters[key] as string) ?? def.default}
                onChange={e => onUpdate(node.id, { parameters: { ...node.parameters, [key]: e.target.value } })}
              />
            ) : (
              <div className="space-y-1">
                <input
                  type="number"
                  className="input-field"
                  value={(node.parameters[key] as number) ?? def.default}
                  min={def.min}
                  max={def.max}
                  step={(def.max && def.min) ? (def.max - def.min) / 100 : 1}
                  onChange={e => onUpdate(node.id, { parameters: { ...node.parameters, [key]: parseFloat(e.target.value) || 0 } })}
                />
                {(def.min !== undefined && def.max !== undefined) && (
                  <input
                    type="range"
                    className="w-full accent-blue-500"
                    value={(node.parameters[key] as number) ?? def.default}
                    min={def.min}
                    max={def.max}
                    step={(def.max - def.min) / 100}
                    onChange={e => onUpdate(node.id, { parameters: { ...node.parameters, [key]: parseFloat(e.target.value) } })}
                  />
                )}
                {def.description && <p className="text-xs text-slate-500">{def.description}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
