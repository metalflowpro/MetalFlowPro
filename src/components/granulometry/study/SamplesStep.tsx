import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Trash2, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import {
  addSample, removeSample, listSamples,
  type P80Study, type P80StudySample,
} from '../../../lib/db/p80Study';

interface LimsSample {
  id: string; sample_id: string; domain: string | null; campaign: string | null;
  status: string | null;
}
interface Props {
  study: P80Study;
  onChanged: () => void;
}

/**
 * Étape 2 — sélection des échantillons depuis le LIMS (source officielle).
 * On ne stocke qu'une RÉFÉRENCE (lims_sample_id) + le contexte de sélection.
 * Un indicateur de représentativité est proposé mais la décision reste validée
 * par le métallurgiste (spec §4, étape 2).
 */
export function SamplesStep({ study, onChanged }: Props) {
  const [lims, setLims] = useState<LimsSample[]>([]);
  const [heads, setHeads] = useState<Map<string, number>>(new Map());
  const [selected, setSelected] = useState<P80StudySample[]>([]);
  const [loading, setLoading] = useState(true);
  const [fDomain, setFDomain] = useState('');
  const [fCampaign, setFCampaign] = useState('');
  const [onlyPassed, setOnlyPassed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, chem, sel] = await Promise.all([
        supabase.from('lims_samples').select('id,sample_id,domain,campaign,status').eq('project_id', study.project_id),
        supabase.from('lims_test_chem').select('sample_id,au_g_t').eq('project_id', study.project_id),
        listSamples(study.id),
      ]);
      setLims((s.data ?? []) as LimsSample[]);
      const hm = new Map<string, number>();
      for (const r of (chem.data ?? []) as Array<{ sample_id: string; au_g_t: number | null }>) {
        if (r.au_g_t != null) hm.set(r.sample_id, r.au_g_t);
      }
      setHeads(hm);
      setSelected(sel);
    } finally {
      setLoading(false);
    }
  }, [study.project_id, study.id]);

  useEffect(() => { void load(); }, [load]);

  const selectedIds = useMemo(() => new Set(selected.map(s => s.lims_sample_id)), [selected]);
  const domains = useMemo(() => Array.from(new Set(lims.map(s => s.domain).filter(Boolean))) as string[], [lims]);
  const campaigns = useMemo(() => Array.from(new Set(lims.map(s => s.campaign).filter(Boolean))) as string[], [lims]);

  const filtered = lims.filter(s =>
    (!fDomain || s.domain === fDomain) &&
    (!fCampaign || s.campaign === fCampaign) &&
    (!onlyPassed || s.status === 'passed') &&
    !selectedIds.has(s.id),
  );

  const add = async (s: LimsSample) => {
    // Représentativité indicative : « acceptable » si l'échantillon est validé
    // QA/QC côté LIMS (statut passed), sinon « à vérifier ». Jamais « rejeté »
    // automatiquement — c'est une décision humaine.
    const representativity_status = s.status === 'passed' ? 'acceptable' : 'to_verify';
    await addSample(study.project_id, study.id, {
      lims_sample_id: s.id,
      sample_type: null,
      geological_domain: s.domain,
      head_grade_au: heads.get(s.id) ?? null,
      representativity_status,
      selection_reason: null,
    });
    await load();
    onChanged();
  };

  const remove = async (row: P80StudySample) => {
    await removeSample(row);
    await load();
    onChanged();
  };

  const limsById = useMemo(() => new Map(lims.map(s => [s.id, s])), [lims]);

  return (
    <div className="space-y-5">
      {/* Filtres */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] text-mf-txt4 block mb-1">Domaine géologique</label>
          <select className="input-field text-xs w-40" value={fDomain} onChange={e => setFDomain(e.target.value)}>
            <option value="">Tous</option>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-mf-txt4 block mb-1">Campagne</label>
          <select className="input-field text-xs w-32" value={fCampaign} onChange={e => setFCampaign(e.target.value)}>
            <option value="">Toutes</option>
            {campaigns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-mf-txt3">
          <input type="checkbox" checked={onlyPassed} onChange={e => setOnlyPassed(e.target.checked)} />
          QA/QC validé uniquement (passed)
        </label>
        <button onClick={() => void load()} className="btn btn-secondary gap-1.5 text-xs py-1.5 ml-auto">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualiser LIMS
        </button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Disponibles */}
        <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-mf-border text-xs font-bold text-mf-txt4 uppercase tracking-wider">
            Échantillons LIMS disponibles ({filtered.length})
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="tbl">
              <thead><tr><th>Échantillon</th><th>Domaine</th><th className="text-right">Au tête</th><th>QA/QC</th><th></th></tr></thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td className="font-mono text-teal-400 text-xs">{s.sample_id}</td>
                    <td className="text-xs">{s.domain ?? '—'}</td>
                    <td className="num text-xs">{heads.get(s.id)?.toFixed(2) ?? '—'}</td>
                    <td>{s.status === 'passed'
                      ? <span className="text-emerald-400 text-[10px] flex items-center gap-1"><Check size={11} />validé</span>
                      : <span className="text-amber-400 text-[10px] flex items-center gap-1"><AlertTriangle size={11} />{s.status ?? '—'}</span>}</td>
                    <td><button onClick={() => void add(s)} className="text-teal-400 hover:text-teal-300"><Plus size={15} /></button></td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={5} className="text-center text-mf-txt4 py-8 text-xs">Aucun échantillon LIMS correspondant</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sélectionnés */}
        <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-mf-border text-xs font-bold text-mf-txt4 uppercase tracking-wider">
            Sélectionnés pour l'étude ({selected.length})
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="tbl">
              <thead><tr><th>Échantillon</th><th>Domaine</th><th className="text-right">Au tête</th><th>Représent.</th><th></th></tr></thead>
              <tbody>
                {selected.map(row => {
                  const s = row.lims_sample_id ? limsById.get(row.lims_sample_id) : null;
                  return (
                    <tr key={row.id}>
                      <td className="font-mono text-teal-400 text-xs">{s?.sample_id ?? row.lims_sample_id?.slice(0, 8) ?? '—'}</td>
                      <td className="text-xs">{row.geological_domain ?? '—'}</td>
                      <td className="num text-xs">{row.head_grade_au?.toFixed(2) ?? '—'}</td>
                      <td className="text-[10px]">{row.representativity_status}</td>
                      <td><button onClick={() => void remove(row)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button></td>
                    </tr>
                  );
                })}
                {selected.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-mf-txt4 py-8 text-xs">Ajoutez des échantillons depuis la liste LIMS</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-mf-txt4">
        La représentativité affichée est indicative. La décision d'inclure un échantillon dans une
        recommandation officielle relève du métallurgiste. Seuls les échantillons validés QA/QC
        côté LIMS (statut <span className="font-mono">passed</span>) sont utilisables pour une reco officielle.
      </p>
    </div>
  );
}
