import { useState, useMemo } from 'react';
import { SlidersHorizontal, Save, RotateCcw, CheckCircle2, Info } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useProject } from '../lib/ProjectContext';
import { MET_CONSTANT_GROUPS, type MetConstantsOverrides, type RouteStageEfficiencies } from '../lib/config/metConstants';
import { formatDecimalGrouped } from '../lib/format/number';
import type { Project } from '../types';

/**
 * Éditeur des constantes métallurgiques surchargées par projet. Data-driven
 * depuis MET_CONSTANT_GROUPS : chaque champ affiche le défaut de l'application et
 * la valeur effective ; une surcharge vide = retour au défaut. Les calculs
 * (estimation des routes, récupération partagée) consomment ces valeurs.
 */
export function MetallurgyParams({ project }: { project: Project }) {
  const { metOverrides, saveMetOverrides } = useProject();

  // État local d'édition (surcharges partielles). Seed depuis le stocké.
  const [draft, setDraft] = useState<MetConstantsOverrides>(() => structuredClone(metOverrides));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const routeDraft = draft.routeStageEfficiencies ?? {};
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(metOverrides), [draft, metOverrides]);

  function setField(key: keyof RouteStageEfficiencies, raw: string) {
    setSaved(false);
    setDraft(prev => {
      const rse: Partial<RouteStageEfficiencies> = { ...(prev.routeStageEfficiencies ?? {}) };
      if (raw.trim() === '') delete rse[key];               // vide → retour au défaut
      else { const n = Number(raw); if (Number.isFinite(n)) rse[key] = n; }
      const next: MetConstantsOverrides = { ...prev };
      if (Object.keys(rse).length) next.routeStageEfficiencies = rse; else delete next.routeStageEfficiencies;
      return next;
    });
  }

  function resetField(key: keyof RouteStageEfficiencies) { setField(key, ''); }

  function resetAll() {
    setSaved(false);
    setDraft({});
  }

  async function save() {
    setSaving(true);
    await saveMetOverrides(draft);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const overrideCount = Object.keys(routeDraft).length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Paramètres métallurgiques"
        subtitle={`Surcharge des constantes de procédé — ${project.name}`}
        breadcrumb={['Design Procédé', 'Paramètres métallurgiques']}
      />

      <div className="p-6 space-y-5 max-w-5xl">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/8 border border-blue-500/20 text-xs text-mf-txt3">
          <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
          <span>
            Chaque gisement répond différemment aux réactifs. Ajustez ces valeurs aux essais du site : elles
            surchargent les défauts de l'application et sont consommées par les calculs (routes métallurgiques,
            récupération partagée). Un champ laissé vide reprend le défaut.
          </span>
        </div>

        {MET_CONSTANT_GROUPS.map(group => (
          <div key={group.id} className="card">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-mf-txt">
                <SlidersHorizontal size={15} className="text-amber-400" /> {group.label}
              </div>
              <span className="text-[10px] text-mf-txt4">{overrideCount} surcharge(s) active(s)</span>
            </div>
            <p className="text-xs text-mf-txt4 mb-4">{group.description}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              {group.fields.map(f => {
                const overridden = f.key in routeDraft;
                const value = overridden ? String(routeDraft[f.key]) : '';
                return (
                  <div key={f.key} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-mf-txt truncate">{f.label}</div>
                      <div className="text-[10px] text-mf-txt4">
                        défaut {formatDecimalGrouped(f.default, f.step < 1 ? 2 : 0)} {f.unit} · plage {f.min}–{f.max}
                      </div>
                    </div>
                    <input
                      type="number"
                      className={`input-field text-xs text-right w-24 py-1 ${overridden ? 'border-amber-500/50 text-amber-300' : ''}`}
                      placeholder={String(f.default)}
                      value={value}
                      min={f.min} max={f.max} step={f.step}
                      onChange={e => setField(f.key, e.target.value)}
                    />
                    <button
                      onClick={() => resetField(f.key)}
                      disabled={!overridden}
                      title="Revenir au défaut"
                      className="p-1 rounded text-mf-txt4 hover:text-mf-txt disabled:opacity-25"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving || !dirty} className="btn btn-primary gap-1.5 disabled:opacity-40">
            <Save size={14} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button onClick={resetAll} disabled={overrideCount === 0} className="btn btn-secondary gap-1.5 disabled:opacity-40">
            <RotateCcw size={14} /> Tout réinitialiser
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 size={15} /> Enregistré — les calculs utilisent ces valeurs
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
