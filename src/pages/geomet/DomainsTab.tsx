import { formatDecimalGrouped } from '../../lib/format/number';
import { Plus, AlertCircle, Download,
  Database, Layers, Trash2, Edit2, X,
} from 'lucide-react';



import { BlockModelAggregate, GeometDomain, LimsAggregate } from './model';

interface DomainsTabProps {
  bmAggs: BlockModelAggregate[];
  deleteDomain: (id: string) => Promise<void>;
  domains: GeometDomain[];
  importLoading: boolean;
  importedCount: number;
  limsAggs: LimsAggregate[];
  loading: boolean;
  openCreate: () => void;
  openEdit: (d: GeometDomain) => void;
  setSyncError: React.Dispatch<React.SetStateAction<string>>;
  syncAllData: () => Promise<void>;
  syncError: string;
}

export function DomainsTab({ bmAggs, deleteDomain, domains, importLoading, importedCount, limsAggs, loading, openCreate, openEdit, setSyncError, syncAllData, syncError }: DomainsTabProps) {
  return (
          <>
            {syncError && (
              <div className="mb-4 p-3 rounded-lg bg-red-400/8 border border-red-400/20 flex items-start gap-3">
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-red-300">{syncError}</div>
                <button onClick={() => setSyncError('')} className="text-red-400/50 hover:text-red-400"><X size={13} /></button>
              </div>
            )}
            {(limsAggs.length > 0 || bmAggs.length > 0) && importedCount < Math.max(limsAggs.length, bmAggs.length) && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-400/8 border border-emerald-400/20 flex items-start gap-3">
                <Database size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <div className="text-emerald-300 font-semibold mb-0.5">
                    {limsAggs.length > 0 && `${limsAggs.length} domaine(s) LIMS`}
                    {limsAggs.length > 0 && bmAggs.length > 0 && ' · '}
                    {bmAggs.length > 0 && `${bmAggs.length} domaine(s) Block Model`}
                    {' '}détectés
                  </div>
                  <div className="mf-txt3">
                    {limsAggs.length > 0 && `${limsAggs.reduce((s, a) => s + a.n_leach + a.n_grg + a.n_bwi + a.n_ai + a.n_flot, 0)} tests LIMS`}
                    {limsAggs.length > 0 && bmAggs.length > 0 && ' · '}
                    {bmAggs.length > 0 && `${bmAggs.reduce((s, a) => s + a.n_blocks, 0)} blocs BM`}
                    {' '}disponibles
                  </div>
                </div>
                <button onClick={syncAllData} disabled={importLoading} className="btn btn-teal text-xs flex items-center gap-1.5 shrink-0">
                  <Download size={11} /> Sync LIMS + Block Model
                </button>
              </div>
            )}

            {loading ? (
              <div className="text-center mf-txt3 py-16 text-sm">Chargement…</div>
            ) : domains.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
                  <Layers size={36} className="mf-txt4" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold mf-txt2 mb-1">Aucun domaine géométallurgique</div>
                  <div className="text-xs mf-txt4 max-w-xs">Importez depuis le LIMS pour créer automatiquement les domaines, ou créez-en manuellement.</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={syncAllData} className="btn btn-teal flex items-center gap-1.5 text-xs">
                    <Database size={12} /> Sync LIMS + Block Model
                  </button>
                  <button onClick={openCreate} className="btn btn-secondary flex items-center gap-1.5 text-xs">
                    <Plus size={12} /> Créer manuellement
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Domaines', val: domains.length, color: 'text-sky-400' },
                    { label: 'Échantillons LIMS', val: domains.reduce((s, d) => s + (d.sample_count ?? 0), 0), color: 'text-emerald-400' },
                    { label: 'Récup. moy.', val: domains.filter(d => d.recovery_design != null).length ? `${formatDecimalGrouped((domains.reduce((s, d) => s + (d.recovery_design ?? 0), 0) / domains.filter(d => d.recovery_design != null).length), 1)}%` : '—', color: 'text-amber-400' },
                    { label: 'BWi moy.', val: domains.filter(d => d.avg_bwi_kwh_t != null).length ? `${formatDecimalGrouped((domains.reduce((s, d) => s + (d.avg_bwi_kwh_t ?? 0), 0) / domains.filter(d => d.avg_bwi_kwh_t != null).length), 1)} kWh/t` : '—', color: 'text-purple-400' },
                  ].map(k => (
                    <div key={k.label} className="card-sm py-2">
                      <div className="text-[10px] mf-txt4 mb-0.5">{k.label}</div>
                      <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {domains.map(d => {
                    const lims = limsAggs.find(a => a.domain.toLowerCase() === d.name.toLowerCase());
                    return (
                      <div key={d.id} className="card-sm space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                          <span className="font-semibold text-sm mf-txt">{d.name}</span>
                          {d.gid_code && <span className="text-[10px] mf-txt3 border border-white/15 rounded px-1.5 py-0.5 font-mono">{d.gid_code}</span>}
                          {d.is_imported && <span className="text-[10px] text-emerald-400 bg-emerald-400/10 rounded px-1.5 py-0.5 flex items-center gap-1"><Database size={9} /> LIMS</span>}
                          {d.preg_robbing && <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-1.5 py-0.5">PR</span>}
                          <div className="ml-auto flex gap-1.5">
                            <button onClick={() => openEdit(d)} className="text-white/30 hover:text-white/70 transition-colors"><Edit2 size={11} /></button>
                            <button onClick={() => deleteDomain(d.id)} className="text-red-400/30 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-xs">
                          {[
                            { label: 'Échantillons', val: d.sample_count ?? '—', color: 'mf-txt' },
                            { label: 'LOM (%)', val: d.lom_pct != null ? `${formatDecimalGrouped(d.lom_pct, 0)}%` : '—', color: 'mf-txt' },
                            { label: 'GRG (%)', val: d.avg_grg_pct != null ? `${formatDecimalGrouped(d.avg_grg_pct, 1)}%` : '—', color: 'text-amber-300' },
                            { label: 'Leach (%)', val: d.avg_cil_pct != null ? `${formatDecimalGrouped(d.avg_cil_pct, 1)}%` : '—', color: 'text-emerald-300' },
                            { label: 'BWi (kWh/t)', val: d.avg_bwi_kwh_t != null ? formatDecimalGrouped(d.avg_bwi_kwh_t, 1) : '—', color: 'text-sky-300' },
                            { label: 'SAI (kWh/t)', val: d.sai_kwh_t != null ? formatDecimalGrouped(d.sai_kwh_t, 1) : '—', color: 'text-sky-400' },
                            { label: 'ABI (abrasion)', val: d.abi != null ? formatDecimalGrouped(d.abi, 3) : '—', color: 'text-orange-300' },
                            { label: 'Récup. design', val: d.recovery_design != null ? `${formatDecimalGrouped(d.recovery_design, 1)}%` : '—', color: 'text-emerald-400 font-bold' },
                          ].map(f => (
                            <div key={f.label}>
                              <div className="mf-txt4 mb-0.5 text-[10px]">{f.label}</div>
                              <div className={`text-xs ${f.color}`}>{f.val}</div>
                            </div>
                          ))}
                        </div>

                        {d.recovery_design != null && (
                          <div>
                            <div className="flex justify-between text-[10px] mf-txt4 mb-1">
                              <span>Récupération</span>
                              <span style={{ color: d.color ?? '#9CA3AF' }}>{formatDecimalGrouped(d.recovery_design, 1)}%</span>
                            </div>
                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${d.recovery_design}%`, backgroundColor: d.color ?? '#10B981' }} />
                            </div>
                          </div>
                        )}

                        {lims && (
                          <div className="pt-1.5 border-t border-white/5 flex gap-3 text-[10px] mf-txt4">
                            {lims.n_leach > 0 && <span className="text-emerald-400">{lims.n_leach} lixiv.</span>}
                            {lims.n_grg > 0   && <span className="text-amber-400">{lims.n_grg} GRG</span>}
                            {lims.n_bwi > 0   && <span className="text-sky-400">{lims.n_bwi} BWi</span>}
                            {lims.n_ai > 0    && <span className="text-orange-400">{lims.n_ai} abrasion</span>}
                            {lims.n_flot > 0  && <span className="text-purple-400">{lims.n_flot} flott.</span>}
                          </div>
                        )}
                        {d.notes && <div className="text-[10px] mf-txt4 italic">{d.notes}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        );
}
