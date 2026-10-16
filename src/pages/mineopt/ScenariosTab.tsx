import { formatDecimalGrouped } from '../../lib/format/number';




interface ScenariosTabProps {
  Math: Math;
  sensitivityParam: "gold_price" | "stripping" | "grade" | "opex" | "recovery";
  sensitivityRows: { pct: number; npv: number; irr: number | null; aisc: number; }[];
  setSensitivityParam: React.Dispatch<React.SetStateAction<"gold_price" | "stripping" | "grade" | "opex" | "recovery">>;
}

export function ScenariosTab({ Math, sensitivityParam, sensitivityRows, setSensitivityParam }: ScenariosTabProps) {
  return (
          <div className="space-y-5">
            {/* Sensitivity selector */}
            <div className="card-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Analyse de sensibilité — VAN₁₀</div>
                <div className="flex gap-2 ml-auto">
                  {([
                    { id: 'gold_price', label: 'Prix Or' },
                    { id: 'stripping', label: 'RS' },
                    { id: 'grade', label: 'Teneur' },
                    { id: 'opex', label: 'OpEx' },
                    { id: 'recovery', label: 'Récup.' },
                  ] as { id: typeof sensitivityParam; label: string }[]).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setSensitivityParam(opt.id)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${sensitivityParam === opt.id ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/5 text-mf-txt3 hover:bg-white/8'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <svg viewBox="0 0 640 220" className="w-full">
                {[0, 0.25, 0.5, 0.75, 1].map(f => (
                  <line key={f} x1={60} y1={10 + f * 170} x2={620} y2={10 + f * 170} stroke="#ffffff08" strokeWidth={1} />
                ))}
                {sensitivityRows.map((r, i) => {
                  const bw = 560 / sensitivityRows.length;
                  const x = 60 + i * bw;
                  const maxNpv = Math.max(...sensitivityRows.map(s => Math.abs(s.npv)), 1);
                  const mid = 10 + 85;
                  const h = (Math.abs(r.npv) / maxNpv) * 85;
                  return (
                    <g key={i}>
                      <rect
                        x={x + 4} y={r.npv >= 0 ? mid - h : mid} width={bw - 8} height={h}
                        rx={2} fill={r.npv >= 0 ? '#10B981' : '#F06B6B'} opacity={0.8}
                      />
                      <text x={x + bw / 2} y={210} fill="#6B7280" fontSize={9} textAnchor="middle">{r.pct > 0 ? '+' : ''}{r.pct}%</text>
                      <text x={x + bw / 2} y={r.npv >= 0 ? mid - h - 4 : mid + h + 12} fill="#9CA3AF" fontSize={8} textAnchor="middle">{formatDecimalGrouped(r.npv, 0)}</text>
                    </g>
                  );
                })}
                <line x1={60} y1={95} x2={620} y2={95} stroke="#ffffff30" strokeWidth={1} strokeDasharray="4 2" />
                <text x={10} y={99} fill="#6B7280" fontSize={8}>0</text>
                <text x={320} y={218} fill="#6B7280" fontSize={9} textAnchor="middle">Variation paramètre (%)</text>
              </svg>
            </div>

            {/* Risk register */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Registre des risques miniers</div>
              <div className="space-y-2">
                {[
                  { cat: 'Géotechnique', risk: 'Glissement de talus phase 3', prob: 'Moyen', impact: 'Élevé', level: 'high', mitigation: 'Études renforcement / filets + drains horizontaux' },
                  { cat: 'Hydrogéologie', risk: 'Débit d\'eau supérieur aux estimations', prob: 'Faible', impact: 'Moyen', level: 'medium', mitigation: 'Système pompage dimensionné ×1.5 · monitoring piézométrique' },
                  { cat: 'Ressources', risk: 'Dégradation teneur sous CoG', prob: 'Moyen', impact: 'Élevé', level: 'high', mitigation: 'Forage infill 25m × 25m avant mining · contrôle grade en temps réel' },
                  { cat: 'Économique', risk: 'Baisse prix or sous AISC', prob: 'Faible', impact: 'Critique', level: 'high', mitigation: 'Couverture (hedging) 30% production années 1–3' },
                  { cat: 'Environnement', risk: 'Contamination acide (DMA)', prob: 'Moyen', impact: 'Élevé', level: 'high', mitigation: 'Test NP/PA · co-disposal stériles réactifs avec calcaire' },
                  { cat: 'Réglementaire', risk: 'Retard obtention permis', prob: 'Faible', impact: 'Moyen', level: 'medium', mitigation: 'Plan de consultation communautaire précoce · ESIA phase 2' },
                  { cat: 'Opérationnel', risk: 'Disponibilité flotte < 85%', prob: 'Faible', impact: 'Faible', level: 'low', mitigation: 'Contrat full-service OEM · stock pièces critiques 90 jours' },
                  { cat: 'Géopolitique', risk: 'Instabilité fiscale / redevances', prob: 'Faible', impact: 'Élevé', level: 'medium', mitigation: 'Convention minière stabilitéclause · arbitrage CIRDI' },
                ].map(r => (
                  <div key={r.risk} className="flex items-start gap-3 p-3 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                    <div className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${r.level === 'high' ? 'bg-red-500' : r.level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-mf-txt">{r.risk}</span>
                        <span className="text-[10px] text-mf-txt4 bg-white/5 px-1.5 py-0.5 rounded">{r.cat}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${r.level === 'high' ? 'bg-red-500/15 text-red-400' : r.level === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                          {r.prob} × {r.impact}
                        </span>
                      </div>
                      <div className="text-xs text-mf-txt4 mt-1">{r.mitigation}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
}
