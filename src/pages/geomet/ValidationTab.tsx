import { formatDecimalGrouped } from '../../lib/format/number';
import { Plus, AlertCircle, Trash2,
} from 'lucide-react';



import { GeometDomain, RECON_STATUS_META, ReconEntry } from './model';

import { type ReconRowResult, type ReconSummary } from '../../lib/geomet/reconciliation';
interface ValidationTabProps {
  addReconRow: () => Promise<void>;
  deleteReconRow: (id: string) => Promise<void>;
  domains: GeometDomain[];
  reconForm: Partial<ReconEntry>;
  reconResults: ReconRowResult[];
  reconRows: ReconEntry[];
  reconSaving: boolean;
  reconSuggestions: string[];
  reconSummary: ReconSummary;
  setReconForm: React.Dispatch<React.SetStateAction<Partial<ReconEntry>>>;
}

export function ValidationTab({ addReconRow, deleteReconRow, domains, reconForm, reconResults, reconRows, reconSaving, reconSuggestions, reconSummary, setReconForm }: ValidationTabProps) {
  return (
          <div className="space-y-4">
            {/* Saisie d'une campagne réconciliée */}
            <div className="card-sm">
              <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Ajouter une campagne réconciliée</div>
              <div className="grid grid-cols-6 gap-2 items-end">
                <div className="col-span-2">
                  <label className="label">Domaine</label>
                  <select className="input-field w-full text-xs" value={reconForm.domain_id ?? ''}
                    onChange={e => setReconForm(p => ({ ...p, domain_id: e.target.value || undefined }))}>
                    <option value="">— Sélectionner —</option>
                    {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Campagne</label>
                  <input className="input-field w-full text-xs" placeholder="Q2-2026" value={reconForm.campaign_label ?? ''}
                    onChange={e => setReconForm(p => ({ ...p, campaign_label: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Prédit (%)</label>
                  <input type="number" step="0.1" className="input-field w-full text-xs"
                    placeholder={(() => { const d = domains.find(x => x.id === reconForm.domain_id); return d?.recovery_design != null ? formatDecimalGrouped(d.recovery_design, 1) : 'auto'; })()}
                    value={reconForm.predicted_recovery_pct ?? ''}
                    onChange={e => setReconForm(p => ({ ...p, predicted_recovery_pct: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <label className="label">Observé usine (%) *</label>
                  <input type="number" step="0.1" className="input-field w-full text-xs" value={reconForm.observed_recovery_pct ?? ''}
                    onChange={e => setReconForm(p => ({ ...p, observed_recovery_pct: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} />
                </div>
                <div>
                  <label className="label">Tonnage (t)</label>
                  <input type="number" step="1000" className="input-field w-full text-xs" value={reconForm.observed_tonnage ?? ''}
                    onChange={e => setReconForm(p => ({ ...p, observed_tonnage: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} />
                </div>
              </div>
              <div className="flex justify-end mt-3">
                <button onClick={addReconRow} disabled={reconSaving || reconForm.observed_recovery_pct == null}
                  className="btn btn-teal flex items-center gap-1.5 text-xs">
                  <Plus size={12} /> {reconSaving ? 'Ajout…' : 'Ajouter'}
                </button>
              </div>
            </div>

            {/* Synthèse des écarts */}
            {reconSummary.n > 0 && (
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Biais moyen', val: reconSummary.meanBias, unit: ' pt', signed: true },
                  { label: 'MAE', val: reconSummary.mae, unit: ' pt', signed: false },
                  { label: 'RMSE', val: reconSummary.rmse, unit: ' pt', signed: false },
                ].map(m => (
                  <div key={m.label} className="card-sm text-center">
                    <div className="text-[10px] mf-txt3 uppercase tracking-wider">{m.label}</div>
                    <div className="text-xl font-bold mf-txt mt-1">
                      {m.val != null ? `${m.signed && m.val > 0 ? '+' : ''}${formatDecimalGrouped(m.val, 2)}${m.unit}` : '—'}
                    </div>
                  </div>
                ))}
                <div className="card-sm text-center">
                  <div className="text-[10px] mf-txt3 uppercase tracking-wider">Pire écart</div>
                  <div className="text-xl font-bold text-red-400 mt-1">
                    {reconSummary.worstGap != null ? `${formatDecimalGrouped(reconSummary.worstGap, 1)} pt` : '—'}
                  </div>
                  <div className="text-[10px] mf-txt4 truncate">{reconSummary.worstDomain ?? ''}</div>
                </div>
              </div>
            )}

            {/* Tableau des réconciliations */}
            <div className="card-sm">
              <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Historique de réconciliation</div>
              {reconRows.length === 0 ? (
                <div className="text-center mf-txt3 py-10 text-sm">Aucune campagne réconciliée. Importez les résultats usine ci-dessus.</div>
              ) : (
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['Domaine', 'Campagne', 'Prédit', 'Observé', 'Écart', 'Statut', ''].map(h => (
                        <th key={h} className="text-left px-2 py-1.5 mf-txt3 font-semibold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reconRows.map((r, i) => {
                      const res = reconResults[i];
                      const meta = RECON_STATUS_META[res.status];
                      return (
                        <tr key={r.id} className="border-b border-white/5">
                          <td className="px-2 py-1.5 mf-txt font-semibold">{r.domain_name ?? '—'}</td>
                          <td className="px-2 py-1.5 mf-txt3">{r.campaign_label}{r.period_label ? ` · ${r.period_label}` : ''}</td>
                          <td className="px-2 py-1.5 mf-txt2">{r.predicted_recovery_pct != null ? `${formatDecimalGrouped(r.predicted_recovery_pct, 1)}%` : '—'}</td>
                          <td className="px-2 py-1.5 mf-txt2">{r.observed_recovery_pct != null ? `${formatDecimalGrouped(r.observed_recovery_pct, 1)}%` : '—'}</td>
                          <td className="px-2 py-1.5 font-bold" style={{ color: res.gap == null ? '#6B7280' : Math.abs(res.gap) <= 2 ? '#10B981' : '#F06B6B' }}>
                            {res.gap != null ? `${res.gap > 0 ? '+' : ''}${formatDecimalGrouped(res.gap, 1)} pt` : '—'}
                          </td>
                          <td className="px-2 py-1.5"><span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.bg}`}>{meta.label}</span></td>
                          <td className="px-2 py-1.5 text-right">
                            <button onClick={() => deleteReconRow(r.id)} className="mf-txt4 hover:text-red-400"><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Suggestions de correction */}
            {reconSuggestions.length > 0 && (
              <div className="card-sm bg-amber-400/5 border border-amber-400/20">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 mb-2">
                  <AlertCircle size={13} /> Actions recommandées
                </div>
                <ul className="space-y-1.5">
                  {reconSuggestions.map((s, i) => (
                    <li key={i} className="text-[11px] text-amber-200/90 flex items-start gap-2">
                      <span className="text-amber-400 mt-0.5">•</span> {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
}
