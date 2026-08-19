import { useState, useEffect, useCallback } from 'react';
import { Layers, Plus, ChevronLeft, ChevronRight, FlaskConical } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useProject } from '../lib/ProjectContext';
import {
  listStudies, createStudy, updateStudy,
  type P80Study, type StudyStatus,
} from '../lib/db/p80Study';
import { WORKFLOW_STEPS, statusRank } from '../components/granulometry/study/workflow';
import { ConfigStep } from '../components/granulometry/study/ConfigStep';
import { SamplesStep } from '../components/granulometry/study/SamplesStep';
import { TestPlanStep } from '../components/granulometry/study/TestPlanStep';
import { ResultsStep } from '../components/granulometry/study/ResultsStep';
import { OptimisationStep } from '../components/granulometry/study/OptimisationStep';
import { ReportStep } from '../components/granulometry/study/ReportStep';
import type { Project } from '../types';

interface Props { project: Project; }

/**
 * Granulométrie / Étude P80 — module d'optimisation P80 projet-centré.
 *
 * Une ÉTUDE (p80_study) enchaîne les 6 sous-modules : configuration → sélection
 * d'échantillons LIMS → plan d'essais → résultats & calculs → optimisation
 * labo/usine → rapport & approbation. Le LIMS reste la source officielle : le
 * module ne stocke que des références et ses propres calculs/décisions.
 */
export function Granulometry({ project }: Props) {
  const { effectiveRecoveryPct } = useProject();
  const [studies, setStudies] = useState<P80Study[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const loadStudies = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listStudies(project.id);
      setStudies(rows);
      setActiveId(prev => prev && rows.some(r => r.id === prev) ? prev : rows[0]?.id ?? null);
    } catch (e) {
      console.error('[p80 studies load]', e);
    } finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { setActiveId(null); void loadStudies(); }, [loadStudies]);

  const active = studies.find(s => s.id === activeId) ?? null;

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const created = await createStudy(project.id, { study_name: name });
    setNewName(''); setCreating(false);
    await loadStudies();
    setActiveId(created.id); setStep(0);
  };

  const saveConfig = async (patch: Partial<P80Study>) => {
    if (!active) return;
    await updateStudy(active, patch);
    await loadStudies();
  };

  /** Avance le statut de l'étude si l'étape cible est plus loin que le statut courant. */
  const advanceTo = useCallback(async (status: StudyStatus) => {
    if (!active) return;
    if (statusRank(status) > statusRank(active.status)) {
      await updateStudy(active, { status });
      await loadStudies();
    }
  }, [active, loadStudies]);

  const goStep = async (i: number) => {
    const clamped = Math.max(0, Math.min(WORKFLOW_STEPS.length - 1, i));
    const forward = i > step;
    setStep(clamped);
    if (active && forward) await advanceTo(WORKFLOW_STEPS[clamped].status);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Granulométrie / Étude P80"
        subtitle={`${project.code} · ${studies.length} étude(s) P80 · LIMS = source officielle`}
        breadcrumb={['Données', 'Granulométrie / Étude P80']}
        icon={<Layers size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <select className="input-field text-xs w-56" value={activeId ?? ''}
              onChange={e => { setActiveId(e.target.value || null); setStep(0); }}>
              <option value="">— Choisir une étude —</option>
              {studies.map(s => <option key={s.id} value={s.id}>{s.study_name} ({s.status})</option>)}
            </select>
            <button onClick={() => setCreating(v => !v)} className="btn btn-primary gap-1.5 text-xs py-1.5">
              <Plus size={13} /> Nouvelle étude
            </button>
          </div>
        }
      />

      {creating && (
        <div className="mx-6 mt-3 flex items-center gap-2 bg-mf-card border border-mf-border rounded-xl px-4 py-3">
          <input autoFocus className="input-field text-sm flex-1 max-w-md" placeholder="Nom de l'étude (ex. Optimisation broyage minerai primaire)"
            value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && void create()} />
          <button onClick={() => void create()} className="btn btn-primary text-xs py-1.5">Créer</button>
          <button onClick={() => setCreating(false)} className="btn btn-secondary text-xs py-1.5">Annuler</button>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-mf-txt4 text-sm">Chargement des études…</div>
      ) : !active ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <FlaskConical size={34} className="text-mf-txt4" />
          <p className="text-sm font-semibold text-mf-txt">Aucune étude P80</p>
          <p className="text-xs text-mf-txt4 max-w-sm">Créez une étude d'optimisation P80. Elle s'appuiera sur les échantillons et résultats validés du LIMS, sans les modifier.</p>
        </div>
      ) : (
        <>
          {/* Stepper */}
          <div className="border-b border-mf-border px-6 flex gap-1 mt-4 overflow-x-auto">
            {WORKFLOW_STEPS.map((s, i) => {
              const reached = statusRank(active.status) >= statusRank(s.status);
              return (
                <button key={s.status} onClick={() => void goStep(i)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                    step === i ? 'border-teal-400 text-teal-400'
                    : reached ? 'border-transparent text-mf-txt3 hover:text-mf-txt'
                    : 'border-transparent text-mf-txt4 hover:text-mf-txt3'}`}>
                  <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center ${step === i ? 'bg-teal-400 text-black' : reached ? 'bg-mf-hover text-mf-txt3' : 'bg-mf-hover/50 text-mf-txt4'}`}>{i + 1}</span>
                  {s.short}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {step === 0 && <ConfigStep study={active} onSave={saveConfig} />}
            {step === 1 && <SamplesStep study={active} onChanged={loadStudies} />}
            {step === 2 && <TestPlanStep study={active} onChanged={loadStudies} />}
            {step === 3 && <ResultsStep study={active} onChanged={loadStudies} />}
            {step === 4 && <OptimisationStep study={active} project={project} recoveryCeilingPct={effectiveRecoveryPct} onChanged={loadStudies} />}
            {step === 5 && <ReportStep study={active} onChanged={loadStudies} onAdvance={advanceTo} />}
          </div>

          {/* Navigation */}
          <div className="border-t border-mf-border px-6 py-3 flex items-center justify-between">
            <button onClick={() => void goStep(step - 1)} disabled={step === 0}
              className="btn btn-secondary gap-1.5 text-xs py-1.5 disabled:opacity-40">
              <ChevronLeft size={14} /> Précédent
            </button>
            <span className="text-xs text-mf-txt4">{WORKFLOW_STEPS[step].label}</span>
            <button onClick={() => void goStep(step + 1)} disabled={step === WORKFLOW_STEPS.length - 1}
              className="btn btn-primary gap-1.5 text-xs py-1.5 disabled:opacity-40">
              Suivant <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
