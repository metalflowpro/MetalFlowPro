// ─────────────────────────────────────────────────────────────────────────────
// En-tête « Granular Silence » de la section P80 Optimisation.
//
// Remplace les quatre cartes-KPI par une seule planche visuelle : la décision
// (P80 usine) en chiffre unique, et la courbe granulométrique comme pièce
// maîtresse — le seuil des 80 %, la granulométrie mesurée et la cible de broyage
// lues d'un coup d'œil sur le même axe. Le détail chiffré vit ailleurs ; ici on
// montre, on n'explique pas.
//
// Composant présentationnel pur : il ne calcule aucune donnée métier, il met en
// forme ce que le pipeline a déjà résolu.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, type ReactNode } from 'react';
import { formatDecimalGrouped } from '../../lib/format/number';
import type { ConfidenceLevel } from '../../lib/geomet/p80Optimization';

interface Props {
  /** Courbe granulométrique affichée (µm, % passant cumulé). */
  curve: Array<{ sieve: number; passing: number }>;
  sampleLabel: string | null;
  /** P80 de la courbe affichée (µm), là où elle croise 80 % passant. */
  measuredP80Um: number | null;
  /** P80 labo représentatif (courbe combinée), pour annotation. */
  representativeP80Um: number | null;
  labTargetP80Um: number;
  /** LA décision : P80 optimal usine (µm). */
  plantP80Um: number;
  kIndus: number;
  energyKwhT: number;
  powerKw: number | null;
  designDeltaPct: number | null;
  throughputTph: number;
  scenarioLabel: string;
  confidence: ConfidenceLevel;
  /** Réglage compact du facteur usine K_indus, rendu sous la dérivation. */
  kIndusControl?: ReactNode;
}

const CONF: Record<ConfidenceLevel, { label: string; cls: string }> = {
  high:   { label: 'confiance élevée',  cls: 'text-emerald-400' },
  medium: { label: 'confiance moyenne', cls: 'text-amber-400' },
  low:    { label: 'confiance faible',  cls: 'text-red-400' },
};

// ── Géométrie de la planche ──────────────────────────────────────────────────
const VW = 760, VH = 320;
const PL = 44, PR = 20, PT = 18, PB = 40;
const PW = VW - PL - PR, PH = VH - PT - PB;
const SMIN = 10, SMAX = 1000;
const TEAL = '#2dd4bf', TEAL_DIM = 'rgba(45,212,191,0.30)';
const CURVE = '#c9d2dd', MUTE = '#8b93a1';

const xlog = (s: number) => PL + (Math.log10(clamp(s, SMIN, SMAX)) - Math.log10(SMIN)) / (Math.log10(SMAX) - Math.log10(SMIN)) * PW;
const ypct = (p: number) => PT + (1 - p / 100) * PH;
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// petit générateur déterministe pour le champ granulaire (stable au rendu)
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function P80GranulometricHero(props: Props) {
  const {
    curve, sampleLabel, measuredP80Um, representativeP80Um, labTargetP80Um,
    plantP80Um, kIndus, energyKwhT, powerKw, designDeltaPct, throughputTph,
    scenarioLabel, confidence, kIndusControl,
  } = props;

  const conf = CONF[confidence];

  // Courbe cumulée triée + polyligne.
  const curvePath = useMemo(() => {
    const pts = [...curve].filter(p => p.sieve > 0 && Number.isFinite(p.passing)).sort((a, b) => a.sieve - b.sieve);
    if (pts.length < 2) return null;
    return pts.map((p, i) => `${i ? 'L' : 'M'}${xlog(p.sieve).toFixed(1)},${ypct(p.passing).toFixed(1)}`).join(' ');
  }, [curve]);

  // Champ granulaire : la masse passée, sous la courbe, tassée vers le bas.
  const grains = useMemo(() => {
    const pts = [...curve].filter(p => p.sieve > 0).sort((a, b) => a.sieve - b.sieve);
    if (pts.length < 2) return [];
    const passingAt = (s: number) => {
      if (s <= pts[0].sieve) return pts[0].passing;
      if (s >= pts[pts.length - 1].sieve) return pts[pts.length - 1].passing;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (s >= a.sieve && s <= b.sieve) {
          const f = Math.log(s / a.sieve) / Math.log(b.sieve / a.sieve);
          return a.passing + f * (b.passing - a.passing);
        }
      }
      return pts[pts.length - 1].passing;
    };
    const rnd = mulberry32(80);
    const out: Array<{ x: number; y: number; o: number }> = [];
    for (let i = 0; i < 620; i++) {
      const lx = Math.log10(SMIN) + rnd() * (Math.log10(SMAX) - Math.log10(SMIN));
      const s = 10 ** lx;
      const p = rnd() * 100;
      if (p > passingAt(s) - 1) continue;
      const xn = (lx - Math.log10(SMIN)) / (Math.log10(SMAX) - Math.log10(SMIN));
      const o = (0.07 + 0.16 * (1 - p / 100)) * (1 - 0.5 * xn);
      out.push({ x: xlog(s), y: ypct(p), o });
    }
    return out;
  }, [curve]);

  const measX = measuredP80Um != null ? xlog(measuredP80Um) : null;
  const plantX = xlog(plantP80Um);
  const ticks = [10, 20, 50, 100, 200, 500, 1000];

  return (
    <div className="rounded-2xl border border-mf-border bg-mf-card overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_1fr]">
        {/* ── La décision, en un chiffre ─────────────────────────────────── */}
        <div className="p-5 lg:border-r border-mf-border flex flex-col justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-teal-400/80 font-medium">
              Consigne usine · P₈₀
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-6xl font-light tracking-tight text-teal-300 tabular-nums leading-none">
                {Math.round(plantP80Um)}
              </span>
              <span className="text-lg font-light text-mf-txt3">µm</span>
            </div>
            <div className="mt-2 font-mono text-[11px] text-mf-txt4">
              {Math.round(labTargetP80Um)} µm cible labo × K {kIndus.toFixed(2)}
            </div>
            <div className="mt-0.5 text-[10px] text-mf-txt4/80">
              P₈₀ cible (meilleure réponse métallurgique), pas le P₈₀ mesuré
            </div>
            {kIndusControl && <div className="mt-3">{kIndusControl}</div>}
          </div>

          {/* lecture clinique — pas de cartes, juste des repères */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px]">
            <Read label="Énergie broyage" value={`${formatDecimalGrouped(energyKwhT, 1)} kWh/t`}
              sub={powerKw != null ? `${formatDecimalGrouped(powerKw, 0)} kW @ ${throughputTph} t/h` : undefined}
              subCls={designDeltaPct != null ? (designDeltaPct > 0 ? 'text-red-400' : 'text-emerald-400') : undefined}
              sub2={designDeltaPct != null ? `${designDeltaPct > 0 ? '+' : ''}${formatDecimalGrouped(designDeltaPct, 0)} % design` : undefined} />
            <Read label="Arbitrage" value={scenarioLabel} valueCls="text-mf-txt2 text-xs font-semibold"
              sub={conf.label} subCls={conf.cls} />
          </dl>
        </div>

        {/* ── La planche : granulométrie mesurée → seuil → consigne ──────── */}
        <div className="p-3 sm:p-4">
          <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ height: 'auto' }} role="img"
            aria-label={`Courbe granulométrique. P80 mesuré ${measuredP80Um != null ? Math.round(measuredP80Um) : 'n/d'} µm, consigne usine ${Math.round(plantP80Um)} µm.`}>
            {/* grille % */}
            {[0, 20, 40, 60, 80, 100].map(p => (
              <g key={p}>
                <line x1={PL} y1={ypct(p)} x2={VW - PR} y2={ypct(p)} stroke="rgba(255,255,255,0.05)" />
                <text x={PL - 8} y={ypct(p) + 3} fill={MUTE} fontSize="9" textAnchor="end" fontFamily="monospace">{p}</text>
              </g>
            ))}
            {/* grille tailles + ticks */}
            {ticks.map(t => (
              <g key={t}>
                <line x1={xlog(t)} y1={PT} x2={xlog(t)} y2={PT + PH} stroke="rgba(255,255,255,0.04)" />
                <text x={xlog(t)} y={PT + PH + 15} fill={MUTE} fontSize="9" textAnchor="middle" fontFamily="monospace">{t}</text>
              </g>
            ))}
            <text x={PL} y={VH - 5} fill={MUTE} fontSize="8.5" fontFamily="monospace" opacity="0.8">
              OUVERTURE (µm) · LOG
            </text>

            {/* champ granulaire — la masse passée */}
            {grains.map((g, i) => (
              <circle key={i} cx={g.x} cy={g.y} r="0.9" fill="#dfe5ec" opacity={g.o} />
            ))}

            {/* courbe cumulée */}
            {curvePath && <path d={curvePath} fill="none" stroke={CURVE} strokeWidth="1.6" />}

            {/* consigne usine — LA décision : ligne verticale accent */}
            <line x1={plantX} y1={PT} x2={plantX} y2={PT + PH} stroke={TEAL} strokeWidth="1.6" strokeDasharray="1 4" opacity="0.9" />
            <path d={`M${plantX},${PT + PH} l-5,9 l10,0 z`} fill={TEAL} />
            <text x={plantX} y={PT + PH + 30} fill={TEAL} fontSize="10" textAnchor="middle" fontFamily="monospace" fontWeight="700">
              {Math.round(plantP80Um)}
            </text>

            {/* seuil 80 % + nœud sur la granulométrie mesurée (contexte) */}
            {measX != null && (
              <g>
                <line x1={PL} y1={ypct(80)} x2={measX} y2={ypct(80)} stroke={TEAL_DIM} strokeWidth="1.2" />
                <line x1={measX} y1={ypct(80)} x2={measX} y2={PT + PH} stroke={MUTE} strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
                <text x={PL + 4} y={ypct(80) - 5} fill={TEAL} fontSize="9" fontFamily="monospace" fontWeight="700">80 %</text>
                <circle cx={measX} cy={ypct(80)} r="4.5" fill="none" stroke={MUTE} strokeWidth="1.4" />
                <circle cx={measX} cy={ypct(80)} r="1.6" fill={MUTE} />
                <text x={measX} y={PT + PH + 30} fill={MUTE} fontSize="9" textAnchor="middle" fontFamily="monospace">
                  {Math.round(measuredP80Um!)}
                </text>
              </g>
            )}

            {/* l'écart de broyage : de la granulométrie actuelle vers la consigne */}
            {measX != null && measuredP80Um != null && Math.abs(measuredP80Um - plantP80Um) > 2 && (
              <g opacity="0.9">
                <line x1={measX} y1={ypct(9)} x2={plantX + 6} y2={ypct(9)} stroke={MUTE} strokeWidth="1" />
                <path d={`M${plantX},${ypct(9)} l7,-3.5 l0,7 z`} fill={MUTE} />
                <text x={(measX + plantX) / 2} y={ypct(9) - 5} fill={MUTE} fontSize="8.5" textAnchor="middle" fontFamily="monospace">
                  broyer −{Math.round(measuredP80Um - plantP80Um)} µm
                </text>
              </g>
            )}
          </svg>

          {/* légende chuchotée — une ligne, pas un paragraphe */}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-mf-txt4 font-mono">
            <span className="flex items-center gap-1.5"><Swatch c={MUTE} /> mesuré {measuredP80Um != null ? `${Math.round(measuredP80Um)} µm` : 'n/d'}{sampleLabel ? ` · ${sampleLabel}` : ''}</span>
            <span className="flex items-center gap-1.5"><Swatch c={TEAL} /> consigne {Math.round(plantP80Um)} µm</span>
            {representativeP80Um != null && <span>P₈₀ combiné {Math.round(representativeP80Um)} µm</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Read({ label, value, valueCls, sub, sub2, subCls }: {
  label: string; value: string; valueCls?: string; sub?: string; sub2?: string; subCls?: string;
}) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-mf-txt4">{label}</dt>
      <dd className={`font-mono font-semibold text-mf-txt2 ${valueCls ?? 'text-sm'}`}>{value}</dd>
      {(sub || sub2) && (
        <dd className="text-[10px] text-mf-txt4 leading-tight">
          {sub}{sub2 && <span className={subCls}> · {sub2}</span>}
        </dd>
      )}
    </div>
  );
}

function Swatch({ c }: { c: string }) {
  return <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ backgroundColor: c }} />;
}
