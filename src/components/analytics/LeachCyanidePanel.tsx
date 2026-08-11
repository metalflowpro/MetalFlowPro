// ─────────────────────────────────────────────────────────────────────────────
// Cinétique de lixiviation + consommation de cyanure — sous-page « Prédiction IA ».
//
// Deux lectures que l'app ne faisait pas : (1) la cinétique de lixiviation ajustée
// sur les points 2→48 h (R∞, k, temps de séjour économique, réfractarité
// cinétique) ; (2) l'estimation stœchiométrique de la consommation de NaCN à
// partir du cuivre soluble, réconciliée avec le mesuré. Modules purs et testés.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { fitLeachKinetics, leachAt, type LeachPoint } from '../../lib/analytics/leachKinetics';
import { estimateCyanide, type CyanideModel } from '../../lib/analytics/cyanideConsumer';

interface Props {
  leachPoints: LeachPoint[];
  cuPct?: number | null;
  sSulfidePct?: number | null;
  measuredNaCnKgT?: number | null;
  cuSolubleFraction?: number | null;
  /** Modèle cyanure surchargé par le projet (éditeur de constantes). */
  cyanideModel?: CyanideModel;
}

const W = 300, H = 130, PAD = { l: 30, r: 8, t: 10, b: 20 };
const SLOW_STYLE: Record<string, string> = {
  rapide: 'text-emerald-400', modere: 'text-teal-300', lent: 'text-amber-400', tres_lent: 'text-red-400',
};
const LOAD_STYLE: Record<string, string> = {
  faible: 'text-emerald-400', moderee: 'text-amber-400', elevee: 'text-red-400',
};

export function LeachCyanidePanel(props: Props) {
  const kin = useMemo(() => fitLeachKinetics(props.leachPoints), [props.leachPoints]);
  const cy = useMemo(() => estimateCyanide({
    cuPct: props.cuPct, sSulfidePct: props.sSulfidePct,
    measuredNaCnKgT: props.measuredNaCnKgT, cuSolubleFraction: props.cuSolubleFraction,
  }, props.cyanideModel), [props.cuPct, props.sSulfidePct, props.measuredNaCnKgT, props.cuSolubleFraction, props.cyanideModel]);

  const curve = useMemo(() => {
    if (!kin) return null;
    const tMax = Math.max(48, ...props.leachPoints.map(p => p.hours));
    const pts: { t: number; r: number }[] = [];
    for (let t = 0; t <= tMax + 1e-9; t += tMax / 40) pts.push({ t, r: leachAt(kin, t) });
    return { pts, tMax };
  }, [kin, props.leachPoints]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Cinétique */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-mf-txt">Cinétique de lixiviation</div>
          {kin && <span className={`text-[11px] ${SLOW_STYLE[kin.slowness]}`}>{kin.slowness.replace('_', ' ')}</span>}
        </div>
        {!kin || !curve ? (
          <div className="text-xs text-mf-txt3">Points de lixiviation temporels insuffisants (il faut ≥ 2 temps : 2/4/8/12/24/48 h).</div>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Courbe cinétique">
              {[0, 50, 100].map(r => {
                const y = PAD.t + (1 - r / 100) * (H - PAD.t - PAD.b);
                return <g key={r}><line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="currentColor" className="text-mf-border" strokeWidth={0.5} /><text x={PAD.l - 4} y={y + 3} textAnchor="end" className="fill-mf-txt3" fontSize={8}>{r}</text></g>;
              })}
              {/* R∞ */}
              <line x1={PAD.l} y1={PAD.t + (1 - kin.rInf / 100) * (H - PAD.t - PAD.b)} x2={W - PAD.r} y2={PAD.t + (1 - kin.rInf / 100) * (H - PAD.t - PAD.b)} stroke="#64748b" strokeDasharray="3 3" strokeWidth={1} />
              {/* Courbe */}
              <path d={curve.pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(PAD.l + (p.t / curve.tMax) * (W - PAD.l - PAD.r)).toFixed(1)},${(PAD.t + (1 - p.r / 100) * (H - PAD.t - PAD.b)).toFixed(1)}`).join(' ')} fill="none" stroke="#10b981" strokeWidth={2} />
              {/* Points mesurés */}
              {props.leachPoints.map(p => (
                <circle key={p.hours} cx={PAD.l + (p.hours / curve.tMax) * (W - PAD.l - PAD.r)} cy={PAD.t + (1 - p.recoveryPct / 100) * (H - PAD.t - PAD.b)} r={2.5} fill="#38bdf8" />
              ))}
              <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" className="fill-mf-txt3" fontSize={8}>temps (h) — max {Math.round(curve.tMax)}</text>
            </svg>
            <div className="mt-1 grid grid-cols-3 gap-2 text-center">
              <div><div className="text-[9px] text-mf-txt3 uppercase">R∞</div><div className="text-sm font-semibold text-emerald-400">{kin.rInf.toFixed(1)}%</div></div>
              <div><div className="text-[9px] text-mf-txt3 uppercase">k</div><div className="text-sm font-semibold text-mf-txt">{kin.k.toFixed(3)} h⁻¹</div></div>
              <div><div className="text-[9px] text-mf-txt3 uppercase">Séjour éco.</div><div className="text-sm font-semibold text-teal-300">{kin.optimalHours.toFixed(0)} h</div></div>
            </div>
            <div className="mt-1.5 text-[11px] text-mf-txt3 leading-snug">{kin.message}</div>
          </>
        )}
      </div>

      {/* Consommation de cyanure */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-mf-txt">Consommation de cyanure (NaCN)</div>
          <span className={`text-[11px] ${LOAD_STYLE[cy.cyanicideLoad]}`}>charge {cy.cyanicideLoad}</span>
        </div>
        {/* Barre empilée base / Cu / sulfures */}
        <div className="h-5 w-full rounded-md overflow-hidden flex bg-mf-panel border border-mf-border">
          {([['base', '#56657a'], ['copper', '#f59e0b'], ['sulphide', '#9d78f0']] as const).map(([k, col]) => {
            const v = cy.breakdown[k];
            const w = cy.predictedKgT > 0 ? (v / cy.predictedKgT) * 100 : 0;
            return <div key={k} title={`${k}: ${v.toFixed(2)} kg/t`} style={{ width: `${w}%`, background: col }} />;
          })}
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
          <div><div className="text-[9px] text-mf-txt3 uppercase">Prédit</div><div className="text-sm font-semibold text-amber-400">{cy.predictedKgT.toFixed(2)} kg/t</div></div>
          <div><div className="text-[9px] text-mf-txt3 uppercase">Mesuré</div><div className="text-sm font-semibold text-sky-300">{cy.measuredKgT != null ? `${cy.measuredKgT.toFixed(2)}` : '—'}</div></div>
          <div><div className="text-[9px] text-mf-txt3 uppercase">Part Cu</div><div className="text-sm font-semibold text-mf-txt">{(cy.copperShare * 100).toFixed(0)} %</div></div>
        </div>
        <div className="mt-1.5 text-[11px] text-mf-txt3 leading-snug">{cy.message}</div>
      </div>
    </div>
  );
}
