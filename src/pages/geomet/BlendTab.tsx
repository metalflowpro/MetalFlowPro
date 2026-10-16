import { formatDecimalGrouped } from '../../lib/format/number';
import {
  BarChart3, CheckCircle2, AlertCircle, TrendingUp, Zap, Target, Save, GitBranch, Sparkles,
} from 'lucide-react';
import { type BlendMetrics } from '../../lib/geomet/blendOptimization';



import { GeometDomain } from './model';

interface BlendTabProps {
  annualOzBlended: number;
  blendSaved: boolean;
  blendSaving: boolean;
  blendSplit: Record<string, number>;
  blendTotal: number;
  blendedBwi: number;
  blendedGrg: number;
  blendedRecovery: number;
  compositeReference: GeometDomain;
  domains: GeometDomain[];
  feedShare: { fromLom: boolean; byId: Record<string, number>; };
  optResult: BlendMetrics | null;
  optimizeBlendAuto: () => void;
  primaryDomains: GeometDomain[];
  saveBlendToLom: () => Promise<void>;
  setBlendSplit: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setOptResult: React.Dispatch<React.SetStateAction<BlendMetrics | null>>;
}

export function BlendTab({ annualOzBlended, blendSaved, blendSaving, blendSplit, blendTotal, blendedBwi, blendedGrg, blendedRecovery, compositeReference, domains, feedShare, optResult, optimizeBlendAuto, primaryDomains, saveBlendToLom, setBlendSplit, setOptResult }: BlendTabProps) {
  return (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines géométallurgiques</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 card-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Proportion de traitement par domaine</div>
                      <div className={`text-xs font-semibold ${Math.abs(blendTotal - 100) < 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                        Total: {formatDecimalGrouped(blendTotal, 0)}%
                      </div>
                    </div>

                    {primaryDomains.map(d => (
                      <div key={d.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <span className="text-xs mf-txt">{d.name}</span>
                            {d.recovery_design != null && <span className="text-[10px] mf-txt4">({formatDecimalGrouped(d.recovery_design, 1)}%)</span>}
                            {d.preg_robbing && <span className="text-[10px] text-red-400">PR</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="number" min="0" max="100" step="0.5" value={blendSplit[d.id] ?? 0}
                              onChange={e => setBlendSplit(prev => ({ ...prev, [d.id]: parseFloat(e.target.value) || 0 }))}
                              className="input-field text-xs text-right w-16 py-0.5" />
                            <span className="text-xs mf-txt4">%</span>
                          </div>
                        </div>
                        <input type="range" min="0" max="100" step="0.5" value={blendSplit[d.id] ?? 0}
                          onChange={e => setBlendSplit(prev => ({ ...prev, [d.id]: parseFloat(e.target.value) }))}
                          className="w-full" style={{ accentColor: d.color ?? '#10B981' }} />
                      </div>
                    ))}

                    <div className="flex items-center gap-3 flex-wrap">
                      <button onClick={optimizeBlendAuto}
                        disabled={primaryDomains.length < 2}
                        className="btn btn-primary text-xs flex items-center gap-1.5 disabled:opacity-40"
                        title="Calcule la meilleure combinaison des domaines (récupération, broyabilité, preg-robbing) pour maximiser les onces annuelles">
                        <Sparkles size={11} /> Optimiser le blend automatiquement
                      </button>

                      <button onClick={() => {
                        const equal = +(100 / Math.max(primaryDomains.length, 1)).toFixed(1);
                        setBlendSplit(Object.fromEntries(primaryDomains.map(d => [d.id, equal])));
                        setOptResult(null);
                      }} className="btn btn-secondary text-xs">Équilibrer (100% / {primaryDomains.length})</button>

                      <button onClick={saveBlendToLom}
                        disabled={blendSaving || Math.abs(blendTotal - 100) > 1}
                        className="btn btn-teal text-xs flex items-center gap-1.5 disabled:opacity-40">
                        <Save size={11} /> {blendSaving ? 'Enregistrement…' : 'Enregistrer comme répartition LOM'}
                      </button>
                      {blendSaved && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 size={12} /> Répartition enregistrée — le BWi et le P80 optimal la suivent
                        </span>
                      )}
                    </div>

                    {optResult && (
                      <div className="p-2.5 rounded-md bg-amber-400/8 border border-amber-400/20 text-[10px] mf-txt3 space-y-1">
                        <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
                          <Sparkles size={11} /> Blend optimisé — {formatDecimalGrouped(optResult.annualOz / 1000, 1)} koz/an
                        </div>
                        <div>
                          Répartition selon le <strong>tonnage de ressource</strong> (Block Model : lithologies coarse
                          réparties sur les sous-domaines de teneur au prorata des échantillons) — sur la vie de la mine
                          on traite tout le gisement. Métallurgie résultante : récup. lixiviation {formatDecimalGrouped(optResult.recoveryPct, 1)} %,
                          BWi mélange {formatDecimalGrouped(optResult.bwiKwhT, 1)} kWh/t → {formatDecimalGrouped(optResult.tph, 0)} t/h
                          {optResult.pregShareFrac > 0 && <> · part preg-robbing {formatDecimalGrouped(optResult.pregShareFrac * 100, 0)} %</>}.
                          Ajustez les curseurs puis enregistrez comme répartition LOM.
                        </div>
                      </div>
                    )}

                    <div className="text-[10px] mf-txt4 space-y-0.5">
                      {compositeReference && (
                        <div>
                          « {compositeReference.name} » est la combinaison de ces {primaryDomains.length} domaines — le blend calculé ci-contre <em>est</em> le mixte.
                        </div>
                      )}
                      <div>
                        {feedShare.fromLom
                          ? <>Répartition <strong className="text-emerald-400/90">enregistrée (lom_pct)</strong> : Granulométrie pondère le BWi et le P80 optimal dessus.</>
                          : <>Aucune répartition enregistrée — <strong className="text-amber-400/90">parts égales par défaut</strong>. Enregistrez-la pour que le BWi et le P80 optimal suivent l'alimentation réelle.</>}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      // ⚠️ « recovery_design » d'un domaine = sa récupération de LIXIVIATION
                      // (avg_leach_pct, 48 h) — PAS la récupération globale usine. Le libellé
                      // le dit explicitement pour lever l'ambiguïté. La récupération GLOBALE
                      // (gravité + transfert usine + adsorption, en série) se calcule dans
                      // « Analyse et Interprétation ».
                      { label: 'Récup. lixiviation blendée', val: `${formatDecimalGrouped(blendedRecovery, 2)}%`, color: 'text-emerald-400', icon: TrendingUp, hint: 'Moyenne des récup. de lixiviation (48 h) pondérée par l\'alimentation — hors gravité/adsorption' },
                      { label: 'BWi blendé', val: `${formatDecimalGrouped(blendedBwi, 2)} kWh/t`, color: 'text-sky-400', icon: Zap, hint: 'Indice de broyabilité moyen du mélange' },
                      { label: 'GRG blendé', val: blendedGrg > 0 ? `${formatDecimalGrouped(blendedGrg, 1)}%` : '—', color: 'text-amber-400', icon: Target, hint: 'Or gravitaire récupérable moyen du mélange' },
                      { label: 'Onces/an (blend)', val: `${formatDecimalGrouped((annualOzBlended / 1000), 1)} koz`, color: 'text-amber-400', icon: BarChart3, hint: 'Sur la base de la récup. de lixiviation ci-dessus' },
                    ].map(k => (
                      <div key={k.label} className="card-sm py-2.5">
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] mf-txt4">
                          <k.icon size={10} className={k.color} /> {k.label}
                        </div>
                        <div className={`text-xl font-bold ${k.color}`}>{k.val}</div>
                        {k.hint && <div className="text-[9px] mf-txt4 mt-0.5 leading-tight">{k.hint}</div>}
                      </div>
                    ))}
                    {Math.abs(blendTotal - 100) > 1 && (
                      <div className="p-2.5 rounded-md bg-red-400/8 border border-red-400/20 text-xs text-red-300 flex items-center gap-2">
                        <AlertCircle size={11} /> Le total doit être 100%
                      </div>
                    )}

                    {/* Measured composite vs computed blend — a validation of the model,
                        not an extra feed source. */}
                    {compositeReference?.recovery_design != null && (() => {
                      const measured = compositeReference.recovery_design;
                      const delta = blendedRecovery - measured;
                      const ok = Math.abs(delta) <= 2;
                      return (
                        <div className="card-sm py-2.5">
                          <div className="flex items-center gap-1.5 mb-1 text-[10px] mf-txt4">
                            <GitBranch size={10} className="text-violet-400" /> Validation — {compositeReference.name} mesuré
                          </div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-bold mf-txt">{formatDecimalGrouped(measured, 1)}%</span>
                            <span className="text-[10px] mf-txt4">mesuré ({compositeReference.sample_count ?? 0} éch.)</span>
                          </div>
                          <div className={`text-[10px] mt-1 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {ok ? '✓' : '⚠'} Écart blend calculé − mesuré : {delta >= 0 ? '+' : ''}{formatDecimalGrouped(delta, 2)} pt
                          </div>
                          {!ok && (
                            <div className="text-[10px] mf-txt4 mt-0.5">
                              Le blend s'écarte du composite testé — vérifier la répartition ou les récupérations par domaine.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Représentation visuelle du blend</div>
                  <div className="flex h-8 rounded-lg overflow-hidden">
                    {primaryDomains.filter(d => (blendSplit[d.id] ?? 0) > 0).map(d => (
                      <div key={d.id} className="h-full transition-all flex items-center justify-center"
                        style={{ width: `${blendSplit[d.id] ?? 0}%`, backgroundColor: d.color ?? '#6B7280' }}
                        title={`${d.name}: ${formatDecimalGrouped((blendSplit[d.id] ?? 0), 1)}%`}>
                        {(blendSplit[d.id] ?? 0) > 10 && <span className="text-[9px] font-bold text-white/90">{formatDecimalGrouped((blendSplit[d.id] ?? 0), 0)}%</span>}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-2.5">
                    {domains.map(d => (
                      <div key={d.id} className="flex items-center gap-1.5 text-[10px] mf-txt3">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                        {d.name}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        );
}
