import { useEffect, useMemo, useState, useCallback } from 'react';
import { Save, AlertTriangle, CheckCircle2, DownloadCloud } from 'lucide-react';
import { p80Interpolation, type PsdPoint } from '../../../lib/geomet/psd';
import { goldRecoveryFromBalance, recoveryGap } from '../../../lib/p80study/recovery';
import {
  listPlans, listResults, upsertResult, listSamples, syncResultsFromLims,
  type P80Study, type P80TestPlan, type P80TestResult,
} from '../../../lib/db/p80Study';
import { AdvancedTestsPanel } from './AdvancedTestsPanel';

interface Props { study: P80Study; onChanged: () => void; }

/** Traduit la méthode d'interpolation en libellé exigé par la spec §5. */
function methodLabel(m: string): { label: string; tone: string } {
  switch (m) {
    case 'exact': return { label: 'mesuré', tone: 'text-emerald-400' };
    case 'log_interpolation': return { label: 'interpolé', tone: 'text-teal-400' };
    case 'out_of_range': return { label: 'hors plage (extrapolation refusée)', tone: 'text-red-400' };
    default: return { label: 'incertain', tone: 'text-amber-400' };
  }
}

/** Parse "150:95, 106:82, 75:60" → points (tamis µm : % passant). */
function parsePsd(raw: string): PsdPoint[] {
  return raw.split(',').map(pair => {
    const [s, p] = pair.split(':').map(x => Number(x.trim()));
    return { sieve: s, passing: p };
  }).filter(pt => Number.isFinite(pt.sieve) && Number.isFinite(pt.passing) && pt.sieve > 0);
}

interface Draft {
  psdRaw: string;
  actualP80: string;
  auFeed: string; auConc: string; auTails: string;
  concMass: string; feedMass: string; tailsMass: string;
  reportedRec: string;
}

const emptyDraft = (r?: P80TestResult): Draft => ({
  psdRaw: '',
  actualP80: r?.actual_p80?.toString() ?? '',
  auFeed: r?.au_feed?.toString() ?? '',
  auConc: r?.au_concentrate?.toString() ?? '',
  auTails: r?.au_tailings?.toString() ?? '',
  concMass: '', feedMass: '', tailsMass: '',
  reportedRec: r?.au_recovery?.toString() ?? '',
});

/**
 * Étape 4 — récupération/saisie des résultats + calculs.
 * Recalcule le P80 sur la courbe (méthode affichée, extrapolation refusée) et la
 * récupération par bilan de métal, avec alerte d'écart vs la valeur rapportée.
 */
export function ResultsStep({ study, onChanged }: Props) {
  const [plans, setPlans] = useState<P80TestPlan[]>([]);
  const [results, setResults] = useState<P80TestResult[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const [p, r] = await Promise.all([listPlans(study.id), listResults(study.id)]);
    setPlans(p);
    setResults(r);
  }, [study.id]);

  useEffect(() => { void load(); }, [load]);

  const resultByPlan = useMemo(() => {
    const m = new Map<string, P80TestResult>();
    for (const r of results) if (r.test_plan_id) m.set(r.test_plan_id, r);
    return m;
  }, [results]);

  const num = (s: string): number | null => {
    const n = Number(s.trim());
    return s.trim() !== '' && Number.isFinite(n) ? n : null;
  };

  const draftFor = (plan: P80TestPlan): Draft =>
    drafts[plan.id] ?? emptyDraft(resultByPlan.get(plan.id));

  const setDraft = (planId: string, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [planId]: { ...(d[planId] ?? emptyDraft(resultByPlan.get(planId))), ...patch } }));

  // Live preview for the open editor
  const preview = (plan: P80TestPlan) => {
    const d = draftFor(plan);
    const psd = parsePsd(d.psdRaw);
    const interp = psd.length >= 2 ? p80Interpolation(psd) : null;
    const computedP80 = interp?.p80Um ?? num(d.actualP80);
    const bal = goldRecoveryFromBalance({
      feedMass: num(d.feedMass), feedGrade: num(d.auFeed),
      concentrateMass: num(d.concMass), concentrateGrade: num(d.auConc),
      tailingsMass: num(d.tailsMass), tailingsGrade: num(d.auTails),
    });
    const gap = recoveryGap(bal.recoveryPct, num(d.reportedRec));
    return { interp, computedP80, bal, gap };
  };

  const save = async (plan: P80TestPlan) => {
    const d = draftFor(plan);
    const { interp, computedP80, bal, gap } = preview(plan);
    const existing = resultByPlan.get(plan.id);
    // Garde-fou : extrapolation hors plage refusée → non conforme.
    const qc_status = interp?.method === 'out_of_range' ? 'non_conforme'
      : gap.flagged ? 'a_revoir' : 'conforme';
    await upsertResult(study.project_id, study.id, {
      id: existing?.id,
      test_plan_id: plan.id,
      target_p80: plan.target_p80,
      actual_p80: num(d.actualP80) ?? computedP80,
      au_feed: num(d.auFeed), au_concentrate: num(d.auConc), au_tailings: num(d.auTails),
      au_recovery: num(d.reportedRec),
      mass_recovery: bal.massRecoveryPct,
      psd_curve: interp ? (interp.curve as unknown as import('../../../lib/database.types').Json) : null,
      computed_p80: computedP80,
      computed_recovery: bal.recoveryPct,
      p80_method: interp?.method ?? null,
      qc_status,
    });
    await load();
    onChanged();
  };

  const tol = recoveryGap(0, 0).tolerancePct;

  const syncFromLims = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const samples = await listSamples(study.id);
      const ids = samples.map(s => s.lims_sample_id).filter((x): x is string => !!x);
      const n = await syncResultsFromLims(study.project_id, study.id, ids);
      setSyncMsg(n > 0 ? `${n} résultat(s) PSD rapatrié(s) du LIMS.` : 'Aucun nouveau résultat PSD à rapatrier.');
      await load(); onChanged();
    } finally { setSyncing(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={() => void syncFromLims()} disabled={syncing} className="btn btn-secondary gap-1.5 text-xs py-1.5">
          <DownloadCloud size={13} className={syncing ? 'animate-pulse' : ''} /> Synchroniser depuis le LIMS
        </button>
        {syncMsg && <span className="text-xs text-teal-300">{syncMsg}</span>}
      </div>
      {plans.length === 0 && <div className="text-sm text-mf-txt4">Générez le plan d'essais, ou rapatriez les résultats PSD depuis le LIMS ci-dessus.</div>}
      {plans.map(plan => {
        const existing = resultByPlan.get(plan.id);
        const open = openId === plan.id;
        const pv = open ? preview(plan) : null;
        const ml = existing?.p80_method ? methodLabel(existing.p80_method) : null;
        return (
          <div key={plan.id} className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
            <button onClick={() => setOpenId(open ? null : plan.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-mf-hover/30">
              <span className="text-xs font-mono text-teal-400">{plan.test_type} · P80 cible {plan.target_p80} µm</span>
              <div className="ml-auto flex items-center gap-4 text-xs">
                {existing?.computed_p80 != null && <span className="text-mf-txt3">P80 calc <strong className="text-teal-400">{Math.round(existing.computed_p80)}</strong> µm {ml && <span className={ml.tone}>({ml.label})</span>}</span>}
                {existing?.computed_recovery != null && <span className="text-mf-txt3">R calc <strong className="text-amber-400">{existing.computed_recovery.toFixed(1)}%</strong></span>}
                {existing && (existing.qc_status === 'conforme'
                  ? <CheckCircle2 size={14} className="text-emerald-400" />
                  : <AlertTriangle size={14} className={existing.qc_status === 'non_conforme' ? 'text-red-400' : 'text-amber-400'} />)}
              </div>
            </button>

            {open && pv && (
              <div className="px-4 pb-4 pt-1 border-t border-mf-border space-y-4">
                <div className="grid grid-cols-2 gap-5">
                  {/* PSD → P80 */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-mf-txt4 uppercase">Courbe PSD → P80</div>
                    <label className="text-[10px] text-mf-txt4 block">Points tamis:passant (µm:%), séparés par virgules</label>
                    <input className="input-field text-xs w-full font-mono" placeholder="150:95, 106:82, 75:60, 53:38"
                      value={draftFor(plan).psdRaw} onChange={e => setDraft(plan.id, { psdRaw: e.target.value })} />
                    <div className="text-[10px] text-mf-txt4">ou P80 mesuré direct :</div>
                    <input className="input-field text-xs w-28" placeholder="P80 µm"
                      value={draftFor(plan).actualP80} onChange={e => setDraft(plan.id, { actualP80: e.target.value })} />
                    {pv.interp && (
                      <div className="text-xs">
                        P80 = <strong className="text-teal-400">{pv.computedP80 != null ? Math.round(pv.computedP80) : '—'} µm</strong>{' '}
                        <span className={methodLabel(pv.interp.method).tone}>({methodLabel(pv.interp.method).label})</span>
                      </div>
                    )}
                  </div>

                  {/* Bilan → récupération */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-mf-txt4 uppercase">Bilan métal → récupération</div>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ['Mf', 'feedMass'], ['Cf (g/t)', 'auFeed'],
                        ['Mc', 'concMass'], ['Cc (g/t)', 'auConc'],
                        ['Mt', 'tailsMass'], ['Ct (g/t)', 'auTails'],
                      ] as Array<[string, keyof Draft]>).map(([lbl, key]) => (
                        <div key={key}>
                          <label className="text-[9px] text-mf-txt4 block">{lbl}</label>
                          <input className="input-field text-xs w-full" value={draftFor(plan)[key]}
                            onChange={e => setDraft(plan.id, { [key]: e.target.value } as Partial<Draft>)} />
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-mf-txt4">R rapportée labo (%)</label>
                      <input className="input-field text-xs w-24" value={draftFor(plan).reportedRec}
                        onChange={e => setDraft(plan.id, { reportedRec: e.target.value })} />
                    </div>
                    {pv.bal.recoveryPct != null && (
                      <div className="text-xs">
                        R calculée (<span className="text-mf-txt4">{pv.bal.basis === 'tailings' ? 'rejets' : 'concentré'}</span>) = <strong className="text-amber-400">{pv.bal.recoveryPct.toFixed(2)}%</strong>
                        {pv.gap.deltaPct != null && (
                          <span className={pv.gap.flagged ? 'text-red-400 ml-2' : 'text-emerald-400 ml-2'}>
                            Δ {pv.gap.deltaPct >= 0 ? '+' : ''}{pv.gap.deltaPct.toFixed(2)} pt {pv.gap.flagged ? `⚠ > ±${tol}` : '✓'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {pv.interp?.method === 'out_of_range' && (
                  <div className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={13} /> La courbe n'encadre pas 80 % passant : extrapolation refusée, résultat marqué non conforme.
                  </div>
                )}
                <button onClick={() => void save(plan)} className="btn btn-primary gap-1.5 text-xs py-1.5">
                  <Save size={13} /> Calculer & enregistrer
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div className="pt-4 border-t border-mf-border">
        <div className="text-xs font-bold text-mf-txt4 uppercase tracking-wider mb-3">Essais avancés</div>
        <AdvancedTestsPanel study={study} />
      </div>
    </div>
  );
}
