import { useState } from 'react';
import { LayoutTemplate, ArrowRight, Eye, CheckCircle2 } from 'lucide-react';
import { FLOWSHEET_TEMPLATES, type FlowsheetTemplate } from '../../lib/simulation/templateLibrary';
import { getUnit } from '../../lib/simulation/unitRegistry';
import type { MaturityLevel } from '../../lib/simulation/generator';

const MATURITY_LABEL: Record<MaturityLevel, string> = {
  conceptual: 'Conceptuel', pea: 'PEA', pre_feasibility: 'Pré-faisabilité',
  feasibility: 'Faisabilité', plant_optimization: 'Optimisation usine',
};

/** Miniature schématique : suite d'icônes d'unités dans l'ordre du procédé. */
function Thumbnail({ template }: { template: FlowsheetTemplate }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-lg leading-none">
      {template.nodes.map((n, i) => {
        const u = getUnit(n.unitType);
        return (
          <span key={n.key} className="flex items-center gap-1">
            <span title={u?.displayName ?? n.unitType}>{u?.icon ?? '▫'}</span>
            {i < template.nodes.length - 1 && <span className="text-slate-600 text-xs">›</span>}
          </span>
        );
      })}
    </div>
  );
}

export default function TemplateLibraryTab({ onUseTemplate }: { onUseTemplate: (templateId: string) => void }) {
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-6xl">
        <div className="flex items-center gap-2 mb-4">
          <LayoutTemplate size={18} className="text-blue-400" />
          <h3 className="section-title">Bibliothèque de templates</h3>
          <span className="text-xs text-slate-500">{FLOWSHEET_TEMPLATES.length} circuits préconfigurés — modifiables après instanciation</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {FLOWSHEET_TEMPLATES.map(t => (
            <div key={t.id} className="card flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-white font-semibold">{t.name}</div>
                <span className="badge badge-info whitespace-nowrap">{MATURITY_LABEL[t.maturityRecommended]}</span>
              </div>

              <div className="mb-2"><Thumbnail template={t} /></div>
              <div className="text-xs text-slate-400 mb-2">{t.mainChain}</div>
              <div className="text-xs text-slate-500 italic mb-3">{t.useCase}</div>

              {preview === t.id && (
                <div className="mb-3 space-y-2 text-xs border-t border-slate-700 pt-2">
                  <div>
                    <div className="text-slate-400 font-medium mb-1">Conditions d'applicabilité</div>
                    <ul className="space-y-0.5">
                      {t.applicability.map((a, i) => (
                        <li key={i} className="flex items-start gap-1 text-slate-300">
                          <CheckCircle2 size={11} className="text-emerald-500 mt-0.5 flex-shrink-0" /> {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium mb-1">Données nécessaires</div>
                    <div className="flex flex-wrap gap-1">
                      {t.dataNeeds.map((d, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{d}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-slate-500">{t.nodes.length} unités · {t.edges.length} courants</div>
                </div>
              )}

              <div className="flex items-center gap-2 mt-auto pt-2">
                <button onClick={() => onUseTemplate(t.id)} className="btn btn-primary text-sm">
                  <ArrowRight size={14} /> Utiliser ce template
                </button>
                <button onClick={() => setPreview(p => p === t.id ? null : t.id)} className="btn btn-secondary text-sm">
                  <Eye size={14} /> {preview === t.id ? 'Masquer' : 'Prévisualiser'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
