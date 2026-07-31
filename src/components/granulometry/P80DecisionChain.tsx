// ─────────────────────────────────────────────────────────────────────────────
// « Cheminement » — écran principal de la section P80 Optimisation.
//
// La section montrait des RÉSULTATS (quatre KPI, quatre sous-onglets) ; la
// logique qui les relie restait implicite, et sa justification vivait en prose
// dans un onglet différent des chiffres qu'elle explique.
//
// Ici la chaîne de raisonnement EST l'interface : sept maillons, du minerai
// mesuré à la consigne machine. Chaque maillon affiche le calcul réellement
// fait, nombres substitués, la provenance de ses entrées et son levier. Le
// maillon le plus fragile est désigné en tête, parce que c'est là qu'un
// ingénieur doit agir en premier.
//
// S'y ajoute la question que la section ne permettait pas de poser : « et si on
// broyait autrement ? ». Le curseur lit la courbe économique déjà calculée —
// pas une nouvelle simulation — et rend l'écart en énergie, en récupération et
// en dollars, à la tonne et à l'année.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import {
  ChevronRight, AlertTriangle, XOctagon, CheckCircle2, Wrench,
  ArrowDown, Sparkles, RotateCcw,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import {
  buildP80Chain, weakestLink, whatIfP80,
  type ChainContext, type ChainStep, type ChainStatus,
} from '../../lib/geomet/p80Chain';
import type { P80OptimizationResult } from '../../lib/geomet/p80Optimization';

interface Props {
  result: P80OptimizationResult;
  ctx: ChainContext;
}

const STATUS_STYLE: Record<ChainStatus, { dot: string; ring: string; text: string; label: string }> = {
  ok:        { dot: 'bg-emerald-400', ring: 'border-mf-border',        text: 'text-emerald-400', label: 'étayé' },
  attention: { dot: 'bg-amber-400',   ring: 'border-amber-500/40',     text: 'text-amber-400',   label: 'à consolider' },
  bloquant:  { dot: 'bg-red-400',     ring: 'border-red-500/50',       text: 'text-red-400',     label: 'incohérent' },
};

function StatusIcon({ status, size = 13 }: { status: ChainStatus; size?: number }) {
  if (status === 'bloquant') return <XOctagon size={size} className="text-red-400 shrink-0" />;
  if (status === 'attention') return <AlertTriangle size={size} className="text-amber-400 shrink-0" />;
  return <CheckCircle2 size={size} className="text-emerald-400 shrink-0" />;
}

// ─── Un maillon ──────────────────────────────────────────────────────────────

function Link({ step, open, onToggle, isLast }: {
  step: ChainStep; open: boolean; onToggle: () => void; isLast: boolean;
}) {
  const st = STATUS_STYLE[step.status];
  return (
    <div className="relative">
      {/* Rail vertical reliant les maillons — le fil du raisonnement. */}
      {!isLast && <div className="absolute left-[15px] top-9 bottom-0 w-px bg-mf-border" aria-hidden />}

      <div className="flex gap-3">
        <div className={`relative z-10 mt-1 h-8 w-8 shrink-0 rounded-full border ${st.ring} bg-mf-card flex items-center justify-center`}>
          <span className="text-xs font-mono font-bold text-mf-txt3">{step.order}</span>
          <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${st.dot}`} />
        </div>

        <div className={`flex-1 min-w-0 rounded-xl border ${st.ring} bg-mf-card mb-3`}>
          <button
            onClick={onToggle}
            aria-expanded={open}
            className="w-full text-left p-3.5 flex items-start gap-3 hover:bg-mf-panel/30 rounded-xl transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-mf-txt4 mb-0.5">{step.question}</div>
              <div className="text-sm font-semibold text-mf-txt">{step.title}</div>
              {step.computation && (
                <div className="mt-1.5 font-mono text-[11px] text-mf-txt3 break-words">{step.computation}</div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="text-right">
                <div className={`text-lg font-mono font-bold ${st.text === 'text-emerald-400' ? 'text-mf-txt' : st.text}`}>
                  {step.value}
                </div>
                <div className="flex items-center justify-end gap-1 text-[10px] text-mf-txt4">
                  <StatusIcon status={step.status} size={10} /> {st.label}
                </div>
              </div>
              <ChevronRight size={15} className={`text-mf-txt4 transition-transform ${open ? 'rotate-90' : ''}`} />
            </div>
          </button>

          {open && (
            <div className="px-3.5 pb-3.5 pt-0 space-y-3 border-t border-mf-border/60 mt-0">
              {step.warning && (
                <div className={`mt-3 flex items-start gap-2 text-[11px] px-3 py-2 rounded-lg ${
                  step.status === 'bloquant' ? 'bg-red-500/5 text-red-300' : 'bg-amber-500/5 text-amber-300'
                }`}>
                  <StatusIcon status={step.status} size={12} />
                  <span>{step.warning}</span>
                </div>
              )}

              <div className={step.warning ? '' : 'pt-3'}>
                <div className="text-[10px] uppercase text-mf-txt4 mb-1">Ce que ça change</div>
                <p className="text-xs text-mf-txt3 leading-relaxed">{step.soWhat}</p>
              </div>

              {step.inputs.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-mf-txt4 mb-1.5">D'où viennent les nombres</div>
                  <div className="flex flex-wrap gap-1.5">
                    {step.inputs.map(i => (
                      <span
                        key={i.label}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] border ${
                          i.isDefault ? 'border-amber-500/30 bg-amber-500/5 text-amber-300' : 'border-mf-border bg-mf-panel/40 text-mf-txt3'
                        }`}
                      >
                        {i.label} <strong className="font-mono">{i.value}</strong>
                        <span className="text-mf-txt4">· {i.origin}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {step.levers.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-mf-txt4 mb-1.5 flex items-center gap-1">
                    <Wrench size={10} /> Pour déplacer cette valeur
                  </div>
                  <ul className="space-y-0.5">
                    {step.levers.map(l => (
                      <li key={l} className="text-[11px] text-mf-txt3 flex gap-1.5">
                        <span className="text-mf-txt4">·</span> {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Simulateur « et si ? » ──────────────────────────────────────────────────

function WhatIf({ result, ctx }: Props) {
  const recommended = Math.round(result.p80OptimalPlantUm);
  const points = result.scenarios.points;

  const [candidate, setCandidate] = useState<number>(recommended);
  // La consigne change quand l'ingénieur modifie les paramètres en amont :
  // on suit ce déplacement tant qu'il n'a pas touché le curseur lui-même.
  const [touched, setTouched] = useState(false);
  const effective = touched ? candidate : recommended;

  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map(p => p.p80);
    return [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))] as [number, number];
  }, [points]);

  const wi = useMemo(
    () => whatIfP80(points, recommended, effective, { throughputTph: ctx.throughputTph }),
    [points, recommended, effective, ctx.throughputTph],
  );

  if (!bounds || !wi) {
    return (
      <div className="rounded-xl border border-mf-border bg-mf-card p-4 text-xs text-mf-txt4">
        Courbe économique indisponible — renseignez une courbe PSD et les paramètres de Bond.
      </div>
    );
  }

  const presets = [
    { label: 'Consigne retenue', p80: recommended },
    ...result.scenarios.scenarios.map(s => ({ label: s.label, p80: s.p80Um })),
  ];

  const Delta = ({ label, value, unit, decimals = 1, goodWhenPositive = true }: {
    label: string; value: number; unit: string; decimals?: number; goodWhenPositive?: boolean;
  }) => {
    const neutral = Math.abs(value) < 10 ** -decimals / 2;
    const good = goodWhenPositive ? value > 0 : value < 0;
    return (
      <div className="rounded-lg bg-mf-bg/40 p-2 text-center">
        <div className="text-[9px] text-mf-txt4">{label}</div>
        <div className={`text-sm font-mono font-semibold ${
          neutral ? 'text-mf-txt3' : good ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {value >= 0 ? '+' : ''}{formatDecimalGrouped(value, decimals)} {unit}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-mf-border bg-mf-card p-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-sm font-semibold text-mf-txt flex items-center gap-2">
          <Sparkles size={14} className="text-purple-400" /> Et si on broyait autrement ?
        </div>
        {touched && effective !== recommended && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setTouched(false); setCandidate(recommended); }}
          >
            <RotateCcw size={12} /> Revenir à la consigne
          </button>
        )}
      </div>
      <div className="text-[10px] text-mf-txt4 mb-3">
        Lecture de la courbe économique déjà calculée — aucune nouvelle simulation. Écarts comptés
        face à la consigne retenue de {recommended} µm.
      </div>

      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-2xl font-mono font-bold text-purple-300">{Math.round(effective)} µm</span>
        <span className="text-[11px] text-mf-txt4">
          {effective < recommended
            ? `plus fin que la consigne (−${recommended - Math.round(effective)} µm)`
            : effective > recommended
              ? `plus grossier que la consigne (+${Math.round(effective) - recommended} µm)`
              : 'la consigne retenue elle-même'}
        </span>
      </div>

      <input
        type="range"
        min={bounds[0]}
        max={bounds[1]}
        step={1}
        value={Math.round(effective)}
        onChange={e => { setTouched(true); setCandidate(+e.target.value); }}
        className="w-full accent-purple-400"
        aria-label="P80 à comparer à la consigne retenue"
      />
      <div className="flex justify-between text-[9px] text-mf-txt4 mb-3">
        <span>{bounds[0]} µm — plus fin</span>
        <span>{bounds[1]} µm — plus grossier</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => { setTouched(true); setCandidate(p.p80); }}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border ${
              Math.round(effective) === Math.round(p.p80)
                ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                : 'text-mf-txt4 border-mf-border hover:text-mf-txt3'
            }`}
          >
            {p.label} · {Math.round(p.p80)} µm
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Delta label="Énergie" value={wi.deltaEnergyKwhT} unit="kWh/t" goodWhenPositive={false} />
        <Delta label="Récupération" value={wi.deltaRecoveryPct} unit="pt" decimals={2} />
        <Delta label="Valeur nette" value={wi.deltaNetUsdT} unit="$/t" decimals={2} />
        <div className="rounded-lg bg-mf-bg/40 p-2 text-center">
          <div className="text-[9px] text-mf-txt4">Sur l'année</div>
          <div className={`text-sm font-mono font-semibold ${
            wi.deltaNetUsdYear == null ? 'text-mf-txt4'
              : Math.abs(wi.deltaNetUsdT) < 0.05 ? 'text-mf-txt3'
              : wi.deltaNetUsdYear > 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {wi.deltaNetUsdYear == null
              ? '—'
              : `${wi.deltaNetUsdYear >= 0 ? '+' : '−'}${formatDecimalGrouped(Math.abs(wi.deltaNetUsdYear) / 1e6, 2)} M$`}
          </div>
        </div>
      </div>

      <div className={`mt-3 flex items-start gap-2 text-xs px-3 py-2 rounded-lg ${
        Math.abs(wi.deltaNetUsdT) < 0.05 ? 'bg-mf-panel/40 text-mf-txt3'
          : wi.better ? 'bg-emerald-500/5 text-emerald-300' : 'bg-red-500/5 text-red-300'
      }`}>
        <ArrowDown size={13} className="mt-0.5 shrink-0" />
        <span>{wi.verdict}</span>
      </div>

      {wi.deltaNetUsdYear != null && (
        <div className="mt-1.5 text-[10px] text-mf-txt4">
          Annualisation à {ctx.throughputTph} t/h × 8 000 h — ordre de grandeur, non un chiffrage financier.
        </div>
      )}
    </div>
  );
}

// ─── Écran ───────────────────────────────────────────────────────────────────

export function P80DecisionChain({ result, ctx }: Props) {
  const steps = useMemo(() => buildP80Chain(result, ctx), [result, ctx]);
  const weak = useMemo(() => weakestLink(steps), [steps]);
  const [openId, setOpenId] = useState<string | null>(null);

  const consigne = Math.round(result.p80OptimalPlantUm);

  return (
    <div className="space-y-4">
      {/* ── Le verdict, en une phrase ────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="text-[10px] uppercase text-emerald-400 font-bold mb-1">Ce que dit le cheminement</div>
        <p className="text-sm text-mf-txt leading-relaxed">
          Broyer à <strong className="font-mono text-emerald-400">{consigne} µm</strong> en usine,
          soit {Math.round(result.labTarget.valueUm)} µm au laboratoire corrigés du facteur usine {result.kIndus.k.toFixed(2)},
          pour {formatDecimalGrouped(result.finalGrindEnergy.totalKwhT, 1)} kWh/t —
          arbitrage « {result.scenarios.selected.label} ».
        </p>
      </div>

      {/* ── Le maillon faible, s'il y en a un ────────────────────────────── */}
      {weak && (
        <button
          onClick={() => setOpenId(weak.id)}
          className={`w-full text-left rounded-xl border p-3 flex items-start gap-2.5 transition-colors ${
            weak.status === 'bloquant'
              ? 'border-red-500/40 bg-red-500/5 hover:bg-red-500/10'
              : 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
          }`}
        >
          <StatusIcon status={weak.status} size={15} />
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-semibold ${weak.status === 'bloquant' ? 'text-red-300' : 'text-amber-300'}`}>
              {weak.status === 'bloquant'
                ? `Étape ${weak.order} — la consigne n'est pas applicable en l'état`
                : `Étape ${weak.order} — c'est ici que le raisonnement est le plus fragile`}
            </div>
            <div className="text-[11px] text-mf-txt3 mt-0.5">{weak.warning ?? weak.soWhat}</div>
          </div>
          <ChevronRight size={14} className="text-mf-txt4 mt-0.5 shrink-0" />
        </button>
      )}

      {/* ── La chaîne ────────────────────────────────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase text-mf-txt4 mb-2">
          Du minerai mesuré à la consigne machine — cliquez un maillon pour l'ouvrir
        </div>
        {steps.map((s, i) => (
          <Link
            key={s.id}
            step={s}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? null : s.id)}
            isLast={i === steps.length - 1}
          />
        ))}
      </div>

      {/* ── Le contrefactuel ─────────────────────────────────────────────── */}
      <WhatIf result={result} ctx={ctx} />
    </div>
  );
}
