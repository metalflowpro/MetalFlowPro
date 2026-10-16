import { formatDecimalGrouped } from '../../lib/format/number';
import { CheckCircle2, AlertCircle, Info,
} from 'lucide-react';
import { type QaFinding,
} from '../../lib/geomet/quality';


import { CONFIDENCE_META, GeometDomain } from './model';

import { type CoverageBreakdown, type DomainQuality } from '../../lib/geomet/quality';
interface QualityTabProps {
  coverage: CoverageBreakdown;
  domainQuality: Record<string, DomainQuality>;
  domains: GeometDomain[];
  qaFindings: QaFinding[];
  tonnageByDomain: { byId: Record<string, number>; totalT: number; };
}

export function QualityTab({ coverage, domainQuality, domains, qaFindings, tonnageByDomain }: QualityTabProps) {
  return (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Synchronisez d'abord LIMS + Block Model, ou créez des domaines.</div>
            ) : (
              <>
                {/* Indicateur de couverture (plan §13) */}
                <div className="card-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Couverture géométallurgique</div>
                    <div className="text-[10px] mf-txt4">
                      {tonnageByDomain.totalT > 0
                        ? `${formatDecimalGrouped(tonnageByDomain.totalT / 1e6, 1)} Mt modélisées`
                        : 'Tonnage Block Model indisponible — couverture pondérée par les échantillons'}
                    </div>
                  </div>
                  {/* Barre empilée high / medium / low / none */}
                  <div className="flex h-5 rounded overflow-hidden mb-2">
                    {([
                      { k: 'high' as const,   pct: coverage.highPct },
                      { k: 'medium' as const, pct: coverage.mediumPct },
                      { k: 'low' as const,    pct: coverage.lowPct },
                      { k: 'none' as const,   pct: coverage.nonePct },
                    ]).map(seg => seg.pct > 0 && (
                      <div key={seg.k} style={{ width: `${seg.pct}%`, backgroundColor: CONFIDENCE_META[seg.k].color }}
                        title={`${CONFIDENCE_META[seg.k].label} — ${formatDecimalGrouped(seg.pct, 1)}%`} />
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {([
                      { k: 'high' as const,   v: coverage.highPct },
                      { k: 'medium' as const, v: coverage.mediumPct },
                      { k: 'low' as const,    v: coverage.lowPct },
                      { k: 'none' as const,   v: coverage.nonePct },
                    ]).map(seg => (
                      <div key={seg.k} className="text-center">
                        <div className="text-lg font-bold" style={{ color: CONFIDENCE_META[seg.k].color }}>{formatDecimalGrouped(seg.v, 1)}%</div>
                        <div className="text-[10px] mf-txt3">{CONFIDENCE_META[seg.k].label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t mf-border text-xs mf-txt3">
                    Tonnage couvert par un modèle validé (confiance ≥ moyenne) :
                    <span className="font-bold text-emerald-400 ml-1">{formatDecimalGrouped(coverage.validatedPct, 1)}%</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Confiance par domaine */}
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Confiance par domaine</div>
                    <table className="tbl w-full text-xs">
                      <thead>
                        <tr>
                          {['Domaine', 'Essais', 'Tonnage', 'Variabilité', 'Confiance'].map(h => (
                            <th key={h} className="text-left px-2 py-1.5 mf-txt3 font-semibold text-[10px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map(d => {
                          const q = domainQuality[d.id];
                          const meta = CONFIDENCE_META[q?.confidence ?? 'none'];
                          const varLabel: Record<string, string> = {
                            stable: 'Stable', variable: 'Variable',
                            very_variable: 'Très variable', undercharacterized: 'Insuff. caractérisé',
                          };
                          const t = tonnageByDomain.byId[d.id] ?? 0;
                          return (
                            <tr key={d.id} className="border-b border-white/5">
                              <td className="px-2 py-1.5 flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                                <span className="mf-txt font-semibold">{d.name}</span>
                              </td>
                              <td className="px-2 py-1.5 mf-txt2">{d.sample_count ?? 0}</td>
                              <td className="px-2 py-1.5 mf-txt2">{t > 0 ? `${formatDecimalGrouped(t / 1e6, 2)} Mt` : '—'}</td>
                              <td className="px-2 py-1.5 mf-txt3 text-[10px]">
                                {varLabel[q?.variability ?? 'undercharacterized']}
                                {q?.recoverySpread != null && q.recoverySpread > 0 && (
                                  <span className="mf-txt4"> ({formatDecimalGrouped(q.recoverySpread, 1)} pt)</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.bg}`}>{meta.label}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Contrôles QA/QC */}
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">
                      Contrôles QA/QC ({qaFindings.length})
                    </div>
                    {qaFindings.length === 0 ? (
                      <div className="flex items-center gap-2 text-xs text-emerald-400 py-4">
                        <CheckCircle2 size={14} /> Aucune anomalie détectée — le modèle peut être publié.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-80 overflow-auto">
                        {qaFindings.map((f, i) => {
                          const sev = f.severity === 'error'
                            ? { icon: <AlertCircle size={12} className="text-red-400 shrink-0 mt-0.5" />, c: 'text-red-300' }
                            : f.severity === 'warning'
                            ? { icon: <AlertCircle size={12} className="text-amber-400 shrink-0 mt-0.5" />, c: 'text-amber-300' }
                            : { icon: <Info size={12} className="text-sky-400 shrink-0 mt-0.5" />, c: 'text-sky-300' };
                          return (
                            <div key={i} className="flex items-start gap-2 text-[11px] p-1.5 rounded bg-white/[0.02]">
                              {sev.icon}
                              <div className={sev.c}>
                                {f.domain && <span className="font-semibold">{f.domain} — </span>}
                                {f.message}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        );
}
