import { useState, useEffect } from 'react';
import { Globe, ChevronRight, ChevronDown, AlertCircle } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { supabase } from '../../lib/supabase';
import type { Project } from '../../types';

/**
 * Onglet Régimes fiscaux d'Economics — extrait de la page pour la garder lisible.
 *
 * Possède son propre état (régimes chargés depuis `fiscal_regimes`, régime
 * sélectionné persisté dans `project_fiscal_selection`, groupes repliés). Les
 * grandeurs économiques dérivées (production, revenu, EBITDA…) sont reçues en
 * props depuis la page. Aucun changement de comportement vs. l'inline précédent.
 */

interface FiscalRegime {
  id: string;
  country: string;
  region: string | null;
  corp_tax_pct: number;
  mining_tax_pct: number;
  royalty_pct: number;
  depletion_pct: number;
  notes: string | null;
  regime_group: string;
  is_active: boolean;
  sort_order: number;
}

interface Props {
  project: Project;
  annualOz: number;
  annualTonnes: number;
  goldPrice: number;
  revenueM: number | null;
  ebitdaM: number | null;
  totalOpex: number;
  refinery: number;
}

export function FiscalTab({ project, annualOz, annualTonnes, goldPrice, revenueM, ebitdaM, totalOpex, refinery }: Props) {
  const [fiscalRegimes, setFiscalRegimes] = useState<FiscalRegime[]>([]);
  const [selectedFiscalId, setSelectedFiscalId] = useState<string>('ca-qc');
  const [fiscalCollapsed, setFiscalCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data: regimes } = await supabase
        .from('fiscal_regimes')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      setFiscalRegimes((regimes ?? []) as unknown as FiscalRegime[]);

      const { data: sel } = await supabase
        .from('project_fiscal_selection')
        .select('regime_id')
        .eq('project_id', project.id)
        .maybeSingle();
      if (sel?.regime_id) setSelectedFiscalId(sel.regime_id);
    })();
  }, [project.id]);

  async function selectFiscal(regimeId: string) {
    setSelectedFiscalId(regimeId);
    await supabase
      .from('project_fiscal_selection')
      .upsert({ project_id: project.id, regime_id: regimeId, updated_at: new Date().toISOString() },
        { onConflict: 'project_id' });
  }

  const regime = fiscalRegimes.find(r => r.id === selectedFiscalId) ?? fiscalRegimes[0];
  if (!regime) return <div className="card text-sm text-mf-txt4">Chargement des régimes fiscaux…</div>;
  const effectiveTotal = regime.corp_tax_pct + regime.mining_tax_pct + regime.royalty_pct;
  const groups = [...new Set(fiscalRegimes.map(r => r.regime_group))];
  const annOz = annualOz ?? 0;
  const annRevM = revenueM ?? 0;
  const royaltyImpactM = annOz > 0 ? (annOz * goldPrice * regime.royalty_pct / 100) / 1e6 : 0;
  const miningTaxImpactM = ebitdaM != null ? ebitdaM * regime.mining_tax_pct / 100 : 0;
  const corpTaxImpactM = ebitdaM != null ? Math.max(0, ebitdaM - miningTaxImpactM) * regime.corp_tax_pct / 100 : 0;
  const totalTaxM = royaltyImpactM + miningTaxImpactM + corpTaxImpactM;
  const netCashM = (ebitdaM ?? 0) - totalTaxM;
  const aiscFiscal = annOz > 0 ? ((totalOpex * (annualTonnes ?? 0)) + totalTaxM * 1e6 + refinery * annOz) / annOz : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-3">
          {groups.map(group => (
            <div key={group} className="card-sm">
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setFiscalCollapsed(p => ({ ...p, [group]: !p[group] }))}
              >
                <div className="flex items-center gap-2">
                  <Globe size={12} className="text-amber-400" />
                  <span className="text-xs font-semibold mf-txt2 uppercase tracking-wider">{group}</span>
                  <span className="text-[10px] mf-txt4">({fiscalRegimes.filter(r => r.regime_group === group).length} juridictions)</span>
                </div>
                {fiscalCollapsed[group] ? <ChevronRight size={12} className="mf-txt4" /> : <ChevronDown size={12} className="mf-txt4" />}
              </button>

              {!fiscalCollapsed[group] && (
                <div className="mt-3 overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['', 'Juridiction', 'IS Corp. (%)', 'Taxe minière (%)', 'Redevance (%)', 'Dépréciation (%)', 'Charge totale (%)', 'Notes'].map(h => (
                          <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fiscalRegimes.filter(r => r.regime_group === group).map(reg => {
                        const total = reg.corp_tax_pct + reg.mining_tax_pct + reg.royalty_pct;
                        const isSelected = reg.id === selectedFiscalId;
                        return (
                          <tr
                            key={reg.id}
                            onClick={() => selectFiscal(reg.id)}
                            className={`border-b border-white/5 cursor-pointer transition-colors ${isSelected ? 'bg-amber-400/10 border-amber-400/30' : 'hover:bg-white/4'}`}
                          >
                            <td className="px-2 py-1.5">
                              <div className={`w-3 h-3 rounded-full border-2 transition-colors ${isSelected ? 'border-amber-400 bg-amber-400' : 'border-white/20'}`} />
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="font-semibold mf-txt">{reg.country}</div>
                              {reg.region && <div className="text-[10px] mf-txt4">{reg.region}</div>}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono mf-txt3">{formatDecimalGrouped(reg.corp_tax_pct, 1)}%</td>
                            <td className="px-2 py-1.5 text-right font-mono mf-txt3">{reg.mining_tax_pct > 0 ? `${formatDecimalGrouped(reg.mining_tax_pct, 1)}%` : '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-amber-300">{reg.royalty_pct > 0 ? `${formatDecimalGrouped(reg.royalty_pct, 1)}%` : '—'}</td>
                            <td className="px-2 py-1.5 text-right font-mono mf-txt4">{reg.depletion_pct > 0 ? `${formatDecimalGrouped(reg.depletion_pct, 0)}%` : '—'}</td>
                            <td className="px-2 py-1.5 text-right">
                              <span className={`font-bold ${total > 40 ? 'text-red-400' : total > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {formatDecimalGrouped(total, 1)}%
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-[10px] mf-txt4 max-w-xs">{reg.notes}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right panel — impact calculation */}
        <div className="space-y-3">
          <div className="card-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="text-xs font-semibold mf-txt">{regime.country}{regime.region ? ` — ${regime.region}` : ''}</div>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Impôt sur les sociétés', val: `${formatDecimalGrouped(regime.corp_tax_pct, 1)}%`, color: 'mf-txt2' },
                { label: 'Taxe minière spécifique', val: regime.mining_tax_pct > 0 ? `${formatDecimalGrouped(regime.mining_tax_pct, 1)}%` : 'N/A', color: 'mf-txt2' },
                { label: 'Redevance sur revenus', val: regime.royalty_pct > 0 ? `${formatDecimalGrouped(regime.royalty_pct, 1)}%` : 'N/A', color: 'text-amber-400' },
                { label: 'Dépréciation accélérée', val: regime.depletion_pct > 0 ? `${formatDecimalGrouped(regime.depletion_pct, 0)}%` : 'N/A', color: 'text-emerald-400' },
              ].map(f => (
                <div key={f.label} className="flex justify-between text-xs">
                  <span className="mf-txt3">{f.label}</span>
                  <span className={`font-semibold ${f.color}`}>{f.val}</span>
                </div>
              ))}
              <div className="border-t border-white/10 pt-2 flex justify-between text-xs">
                <span className="mf-txt3 font-semibold">Charge totale</span>
                <span className={`font-bold ${effectiveTotal > 40 ? 'text-red-400' : effectiveTotal > 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {formatDecimalGrouped(effectiveTotal, 1)}%
                </span>
              </div>
            </div>
            <div className="mt-3 text-[10px] mf-txt4 italic leading-relaxed">{regime.notes ?? ''}</div>
          </div>

          {annRevM > 0 && (
            <div className="card-sm space-y-2">
              <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">Impact financier estimé</div>
              {[
                { label: 'Redevances', val: royaltyImpactM, color: 'text-amber-400' },
                { label: 'Taxe minière', val: miningTaxImpactM, color: 'text-red-300' },
                { label: "Impôt sur bénéfices", val: corpTaxImpactM, color: 'text-red-400' },
              ].map(f => (
                <div key={f.label} className="flex justify-between text-xs">
                  <span className="mf-txt3">{f.label}</span>
                  <span className={`font-semibold ${f.color}`}>{f.val > 0 ? `−${formatDecimalGrouped(f.val, 1)} M$` : '—'}</span>
                </div>
              ))}
              <div className="border-t border-white/10 pt-2 flex justify-between text-xs">
                <span className="font-semibold mf-txt">Total taxes</span>
                <span className="font-bold text-red-400">{totalTaxM > 0 ? `−${formatDecimalGrouped(totalTaxM, 1)} M$` : '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="mf-txt3">Cash-flow net après taxes</span>
                <span className={`font-bold ${netCashM > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatDecimalGrouped(netCashM, 1)} M$</span>
              </div>
              {aiscFiscal != null && (
                <div className="flex justify-between text-xs border-t border-white/10 pt-2">
                  <span className="mf-txt3">AISC all-in (taxes incl.)</span>
                  <span className="font-bold text-amber-400">${formatDecimalGrouped(aiscFiscal, 0)}/oz</span>
                </div>
              )}
            </div>
          )}

          {annRevM === 0 && (
            <div className="card-sm text-xs text-amber-300 flex items-center gap-2">
              <AlertCircle size={11} /> Configurez OPEX + CAPEX + paramètres pour calculer l'impact fiscal.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
