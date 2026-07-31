// ─────────────────────────────────────────────────────────────────────────────
// Frontière P80 limitée par la libération — sous-page de « P80 Optimisation ».
//
// Rend visible ce que le moteur de déportation (lib/geomet/deportment.ts) calcule :
// la courbe récupération-vs-P80 ANCRÉE sur la déportation minéralogique mesurée,
// le P80 DE LIBÉRATION (au-delà duquel broyer plus fin ne paie plus), le plafond
// réfractaire, et un drapeau de cohérence entre le broyage courant et ce seuil.
//
// Composant présentationnel : il n'accède ni à Supabase ni au réseau ; il met en
// forme la sortie d'un module pur et testé.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import {
  normalizeDeportment, recoveryVsP80Curve, predictRecoveryAtP80, liberationLimitedP80,
} from '../../lib/geomet/deportment';

interface Props {
  /** Déportation brute de l'essai de libération (nullable). */
  deportment: {
    free: number | null; sulphide: number | null; silicate: number | null;
    oxide?: number | null; occluded: number | null; pregRob: number | null;
  };
  /** P80 (µm) de l'essai de libération. */
  p80RefUm: number | null;
  bwiKwhT: number;
  f80Um: number;
  /** P80 courant / mesuré (µm) pour le drapeau de cohérence. */
  currentP80Um: number | null;
  cOrgPct?: number | null;
  grgPct?: number | null;
  /** Seuil économique (pts de récup. par kWh/t). Défaut 0.05. */
  econThresholdPtPerKwh?: number;
  sampleLabel?: string | null;
}

const W = 460, H = 200, PAD = { l: 40, r: 12, t: 14, b: 28 };

export function LiberationFrontier(props: Props) {
  const dep = useMemo(() => normalizeDeportment({
    free: props.deportment.free, sulphide: props.deportment.sulphide,
    silicate: props.deportment.silicate, oxide: props.deportment.oxide ?? 0,
    occluded: props.deportment.occluded, pregRob: props.deportment.pregRob,
  }), [props.deportment]);

  const p80Ref = props.p80RefUm;

  const model = useMemo(() => {
    if (!dep || !p80Ref || p80Ref <= 0) return null;
    const inp = { p80RefUm: p80Ref, cOrgPct: props.cOrgPct ?? null, grgPct: props.grgPct ?? null };
    const xMax = Math.max(p80Ref * 1.15, props.currentP80Um ?? 0, 60);
    const curve = recoveryVsP80Curve(dep, inp, { p80Min: 15, p80Max: Math.min(xMax, 260), step: 5 });
    const lib = liberationLimitedP80(dep, inp, {
      bwiKwhT: props.bwiKwhT, f80Um: props.f80Um,
      econThresholdPtPerKwh: props.econThresholdPtPerKwh,
    });
    const currentR = props.currentP80Um ? predictRecoveryAtP80(dep, props.currentP80Um, inp) : null;
    return { curve, lib, currentR, inp, xMax: Math.min(xMax, 260) };
  }, [dep, p80Ref, props.cOrgPct, props.grgPct, props.bwiKwhT, props.f80Um, props.currentP80Um, props.econThresholdPtPerKwh]);

  if (!dep || !p80Ref || !model) {
    return (
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-sm font-semibold text-mf-txt mb-1">Frontière P80 — libération</div>
        <div className="text-xs text-mf-txt3">
          Aucune donnée de libération exploitable pour cet échantillon. Ajouter un essai de libération
          (Au libre / sulfures / silicates / occlus / preg-robbing) et son P80 pour ancrer la courbe
          récupération-vs-P80 sur la minéralogie plutôt que sur une heuristique générique.
        </div>
      </div>
    );
  }

  const { curve, lib, currentR, xMax } = model;
  const xMin = 15;
  const xOf = (p: number) => PAD.l + ((p - xMin) / (xMax - xMin)) * (W - PAD.l - PAD.r);
  const yOf = (r: number) => PAD.t + (1 - r / 100) * (H - PAD.t - PAD.b);
  const path = curve.map((pt, i) => `${i === 0 ? 'M' : 'L'}${xOf(pt.p80).toFixed(1)},${yOf(pt.recovery).toFixed(1)}`).join(' ');
  const ceiling = lib?.ceilingPct ?? curve[0].recovery;

  // Drapeau de cohérence : broyage courant vs P80 de libération.
  const cur = props.currentP80Um ?? null;
  let flag: { cls: string; text: string } | null = null;
  if (lib && cur != null) {
    if (!lib.atFineBound && cur < lib.p80Um - 2) {
      flag = { cls: 'text-amber-400', text: `Sur-broyage : P80 courant ${Math.round(cur)} µm < P80 de libération ${Math.round(lib.p80Um)} µm — kWh dépensés sans gain de récupération.` };
    } else if (!lib.atFineBound && cur > lib.p80Um + 2) {
      flag = { cls: 'text-teal-300', text: `Marge de gain : broyer de ${Math.round(cur)} vers ${Math.round(lib.p80Um)} µm reste rentable (libération non atteinte).` };
    } else {
      flag = { cls: 'text-teal-300', text: `Broyage courant ≈ P80 de libération (${Math.round(lib.p80Um)} µm) — réglage cohérent.` };
    }
  }

  return (
    <div className="rounded-xl border border-mf-border bg-mf-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-mf-txt">
          Frontière P80 — limitée par la libération
          {props.sampleLabel && <span className="text-mf-txt3 font-normal"> · {props.sampleLabel}</span>}
        </div>
        <div className="text-xs text-mf-txt3">ancrée sur la déportation minéralogique</div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Courbe récupération vs P80">
        {/* Grille Y (récupération) */}
        {[0, 25, 50, 75, 100].map(r => (
          <g key={r}>
            <line x1={PAD.l} y1={yOf(r)} x2={W - PAD.r} y2={yOf(r)} stroke="currentColor" className="text-mf-border" strokeWidth={0.5} />
            <text x={PAD.l - 5} y={yOf(r) + 3} textAnchor="end" className="fill-mf-txt3" fontSize={9}>{r}</text>
          </g>
        ))}
        {/* Plafond de libération */}
        <line x1={PAD.l} y1={yOf(ceiling)} x2={W - PAD.r} y2={yOf(ceiling)} stroke="#64748b" strokeDasharray="3 3" strokeWidth={1} />
        <text x={W - PAD.r} y={yOf(ceiling) - 3} textAnchor="end" className="fill-mf-txt3" fontSize={9}>plafond {ceiling.toFixed(0)}%</text>
        {/* Courbe récupération-vs-P80 */}
        <path d={path} fill="none" stroke="#14b8a6" strokeWidth={2} />
        {/* P80 de libération */}
        {lib && !lib.atFineBound && (
          <g>
            <line x1={xOf(lib.p80Um)} y1={PAD.t} x2={xOf(lib.p80Um)} y2={H - PAD.b} stroke="#f59e0b" strokeWidth={1.2} strokeDasharray="4 2" />
            <text x={xOf(lib.p80Um)} y={PAD.t + 8} textAnchor="middle" className="fill-amber-400" fontSize={9}>P80 lib. {Math.round(lib.p80Um)}µm</text>
          </g>
        )}
        {/* P80 courant */}
        {cur != null && currentR != null && (
          <g>
            <circle cx={xOf(cur)} cy={yOf(currentR)} r={3.5} fill="#38bdf8" />
            <text x={xOf(cur)} y={yOf(currentR) - 6} textAnchor="middle" className="fill-sky-300" fontSize={9}>{Math.round(cur)}µm · {currentR.toFixed(0)}%</text>
          </g>
        )}
        {/* Axe X ticks */}
        {[xMin, Math.round((xMin + xMax) / 2), Math.round(xMax)].map(p => (
          <text key={p} x={xOf(p)} y={H - PAD.b + 14} textAnchor="middle" className="fill-mf-txt3" fontSize={9}>{p}</text>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 2} textAnchor="middle" className="fill-mf-txt3" fontSize={9}>P80 (µm)</text>
      </svg>

      <div className="mt-2 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] text-mf-txt3 uppercase tracking-wide">P80 de libération</div>
          <div className="text-base font-semibold text-amber-400">{lib && !lib.atFineBound ? `${Math.round(lib.p80Um)} µm` : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] text-mf-txt3 uppercase tracking-wide">Plafond récup.</div>
          <div className="text-base font-semibold text-teal-300">{ceiling.toFixed(1)} %</div>
        </div>
        <div>
          <div className="text-[10px] text-mf-txt3 uppercase tracking-wide">Récup. au P80 courant</div>
          <div className="text-base font-semibold text-sky-300">{currentR != null ? `${currentR.toFixed(1)} %` : '—'}</div>
        </div>
      </div>

      {flag && <div className={`mt-2 text-xs ${flag.cls}`}>{flag.text}</div>}
      {lib && <div className="mt-1 text-[11px] text-mf-txt3 leading-snug">{lib.message}</div>}
    </div>
  );
}
