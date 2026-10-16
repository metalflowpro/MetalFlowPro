import { formatDecimalGrouped } from '../../lib/format/number';
import { CheckCircle2, AlertCircle,
} from 'lucide-react';
import { isCompositeDomain } from '../../lib/geomet/domains';



import { GeometDomain } from './model';

interface GidTabProps {
  domains: GeometDomain[];
}

export function GidTab({ domains }: GidTabProps) {
  return (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines géométallurgiques</div>
            ) : (
              <>
                <div className="text-xs mf-txt3 font-semibold uppercase tracking-wider">Association Domaine ↔ Code GID (Modèle de blocs)</div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['', 'Domaine', 'Code GID', 'Échantillons', 'GRG (%)', 'Leach (%)', 'BWi (kWh/t)', 'SAI (kWh/t)', 'Argile (%)', 'Sulfures (%)', 'Preg-Rob.', 'Récupération', 'Importé'].map(h => (
                          <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map(d => (
                        <tr key={d.id} className="border-b border-white/5 hover:bg-white/4">
                          <td className="px-3 py-2"><div className="w-4 h-4 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} /></td>
                          <td className="px-3 py-2 font-semibold mf-txt">
                            <div className="flex items-center gap-1.5">
                              {d.name}
                              {isCompositeDomain(d.name) && (
                                <span className="text-[9px] font-medium text-violet-300 bg-violet-400/10 border border-violet-400/20 rounded px-1.5 py-0.5"
                                  title="Domaine composite : combinaison des domaines primaires. Exclu des allocations de blend et de la simulation LOM pour éviter de compter le même minerai deux fois.">
                                  COMPOSITE
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-amber-300">{d.gid_code ?? '—'}</td>
                          <td className="px-3 py-2 mf-txt3">{d.sample_count ?? '—'}</td>
                          <td className="px-3 py-2 text-amber-400">{d.avg_grg_pct != null ? `${formatDecimalGrouped(d.avg_grg_pct, 1)}%` : '—'}</td>
                          <td className="px-3 py-2 text-emerald-400">{d.avg_cil_pct != null ? `${formatDecimalGrouped(d.avg_cil_pct, 1)}%` : '—'}</td>
                          <td className="px-3 py-2 text-sky-400">{d.avg_bwi_kwh_t != null ? formatDecimalGrouped(d.avg_bwi_kwh_t, 1) : '—'}</td>
                          <td className="px-3 py-2 text-sky-300">{d.sai_kwh_t != null ? formatDecimalGrouped(d.sai_kwh_t, 2) : '—'}</td>
                          <td className="px-3 py-2 text-orange-300">{d.clay_pct != null ? `${formatDecimalGrouped(d.clay_pct, 1)}%` : '—'}</td>
                          <td className="px-3 py-2 mf-txt3">{d.sulphide_pct != null ? `${formatDecimalGrouped(d.sulphide_pct, 1)}%` : '—'}</td>
                          {/* Tri-state: unknown (no chem/liberation testwork) must not read as "no". */}
                          <td className="px-3 py-2">
                            {d.preg_robbing === true
                              ? <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-1.5 py-0.5">OUI</span>
                              : d.preg_robbing === false
                                ? <span className="text-[10px] text-emerald-400/80">NON</span>
                                : <span className="mf-txt4" title="Aucun essai de libération ni carbone organique pour ce domaine">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-white/5 rounded-full h-2 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${d.recovery_design ?? 0}%`, backgroundColor: d.color ?? '#6B7280' }} />
                              </div>
                              <span className="text-xs font-semibold" style={{ color: d.color ?? '#9CA3AF' }}>
                                {d.recovery_design != null ? `${formatDecimalGrouped(d.recovery_design, 1)}%` : '—'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">{d.is_imported ? <CheckCircle2 size={13} className="text-emerald-400" /> : <span className="mf-txt4">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 items-start text-xs mf-txt3 bg-white/5 rounded-md p-3">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span>Le code GID correspond au champ de lithologie dans votre modèle de blocs. Il permet d'assigner automatiquement une récupération métallurgique et un BWi à chaque bloc lors de la simulation de pit shell.</span>
                </div>
              </>
            )}
          </div>
        );
}
