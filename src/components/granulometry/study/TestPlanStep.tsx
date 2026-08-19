import { useEffect, useMemo, useState, useCallback } from 'react';
import { Wand2, Save, Trash2 } from 'lucide-react';
import {
  listSamples, listPlans, insertPlans, clearPlans,
  type P80Study, type P80StudySample, type P80TestPlan,
} from '../../../lib/db/p80Study';

interface Props {
  study: P80Study;
  onChanged: () => void;
}

const TEST_TYPES = ['cyanuration', 'flottation', 'GRG', 'rebroyage'];

/** Étape 3 — plan d'essais : génération auto de la matrice échantillon × P80. */
export function TestPlanStep({ study, onChanged }: Props) {
  const [samples, setSamples] = useState<P80StudySample[]>([]);
  const [plans, setPlans] = useState<P80TestPlan[]>([]);
  const [testType, setTestType] = useState('cyanuration');
  const [replicates, setReplicates] = useState(2);
  const [methodId, setMethodId] = useState('CYAN-48H');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([listSamples(study.id), listPlans(study.id)]);
    setSamples(s);
    setPlans(p);
  }, [study.id]);

  useEffect(() => { void load(); }, [load]);

  const targets = study.p80_targets_um;
  const preview = useMemo(() => {
    const rows: Array<Partial<P80TestPlan>> = [];
    for (const s of samples) {
      for (const t of targets) {
        rows.push({
          study_sample_id: s.id, test_type: testType, target_p80: t,
          replicate_count: replicates, method_id: methodId,
        });
      }
    }
    return rows;
  }, [samples, targets, testType, replicates, methodId]);

  const generate = async () => {
    if (preview.length === 0) return;
    setBusy(true);
    try {
      await clearPlans(study.project_id, study.id);
      await insertPlans(study.project_id, study.id, preview);
      await load();
      onChanged();
    } finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true);
    try { await clearPlans(study.project_id, study.id); await load(); onChanged(); }
    finally { setBusy(false); }
  };

  const sampleName = (id: string | null) => samples.find(s => s.id === id)?.geological_domain ?? '—';

  return (
    <div className="space-y-5">
      {samples.length === 0 ? (
        <div className="text-sm text-mf-txt4">Sélectionnez d'abord des échantillons (étape précédente).</div>
      ) : targets.length === 0 ? (
        <div className="text-sm text-mf-txt4">Définissez des P80 cibles dans la configuration de l'étude.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[10px] text-mf-txt4 block mb-1">Type d'essai</label>
              <select className="input-field text-xs w-40" value={testType} onChange={e => setTestType(e.target.value)}>
                {TEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-mf-txt4 block mb-1">Réplicats</label>
              <input type="number" min={1} className="input-field text-xs w-20" value={replicates}
                onChange={e => setReplicates(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div>
              <label className="text-[10px] text-mf-txt4 block mb-1">Méthode</label>
              <input className="input-field text-xs w-32" value={methodId} onChange={e => setMethodId(e.target.value)} />
            </div>
            <button onClick={() => void generate()} disabled={busy} className="btn btn-primary gap-1.5 text-xs py-1.5">
              <Wand2 size={13} /> Générer ({preview.length} essais)
            </button>
            {plans.length > 0 && (
              <button onClick={() => void clear()} disabled={busy} className="btn btn-secondary gap-1.5 text-xs py-1.5">
                <Trash2 size={13} /> Vider
              </button>
            )}
          </div>

          <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-mf-border text-xs font-bold text-mf-txt4 uppercase tracking-wider flex items-center gap-2">
              <Save size={12} /> Plan enregistré ({plans.length} essais)
            </div>
            <table className="tbl">
              <thead><tr><th>Domaine</th><th>Type</th><th className="text-right">P80 cible (µm)</th><th className="text-right">Réplicats</th><th>Méthode</th></tr></thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id}>
                    <td className="text-xs">{sampleName(p.study_sample_id)}</td>
                    <td className="text-xs">{p.test_type}</td>
                    <td className="num text-xs">{p.target_p80}</td>
                    <td className="num text-xs">{p.replicate_count}</td>
                    <td className="text-xs font-mono text-mf-txt3">{p.method_id ?? '—'}</td>
                  </tr>
                ))}
                {plans.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-mf-txt4 py-8 text-xs">Aucun essai — générez la matrice ci-dessus.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
