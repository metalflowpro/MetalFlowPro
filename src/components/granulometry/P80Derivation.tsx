// ─────────────────────────────────────────────────────────────────────────────
// « D'où vient ce chiffre ? » — le cheminement de chacun des trois P₈₀.
//
// Les trois valeurs de la section P80 ne se calculent PAS de la même façon, et
// les confondre est une erreur classique :
//   • P₈₀ moyen essais  → lecture GRAPHIQUE : interpolation log-linéaire du
//     80 % passant entre les deux tamis qui l'encadrent.
//   • P₈₀ optimal labo  → OPTIMUM d'une courbe : le P₈₀ qui maximise la réponse
//     métallurgique (récupération), pas une lecture de granulométrie.
//   • P₈₀ optimal usine → TRANSPOSITION : le P₈₀ labo × facteur usine K.
//
// Chaque panneau montre donc son propre raisonnement : mini-graphe quand il y a
// une courbe à lire, formule chiffrée sinon. Sur un livrable NI 43-101 un P₈₀
// qu'on ne sait pas justifier n'a pas de valeur.
//
// Composant PUREMENT présentationnel : aucun calcul ici, tout vient des moteurs.
// ─────────────────────────────────────────────────────────────────────────────

import { formatDecimalGrouped } from '../../lib/format/number';
import type { P80Interpolation } from '../../lib/geomet/psd';
import type { ScenarioPoint } from '../../lib/geomet/p80Optimization';

// Géométrie commune des mini-graphes.
const W = 300, H = 150, PL = 34, PR = 10, PT = 10, PB = 26;
const PW = W - PL - PR, PH = H - PT - PB;

function xLog(v: number, min: number, max: number): number {
  if (!(v > 0) || !(min > 0) || max <= min) return PL;
  return PL + (Math.log10(v / min) / Math.log10(max / min)) * PW;
}

/** Cartouche autour d'un mini-graphe + sa formule. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-mf-border bg-mf-panel/40 p-3">
      <div className="text-[9px] uppercase tracking-wider text-mf-txt4 mb-2">{title}</div>
      {children}
    </div>
  );
}

/** Ligne de calcul en police mono, pour que les nombres s'alignent. */
function Formula({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] text-mf-txt3 leading-relaxed">{children}</div>;
}

// ─── 1. Interpolation log-linéaire du 80 % passant ───────────────────────────

export function P80InterpolationPanel({ interp }: { interp: P80Interpolation }) {
  const { curve, lower, upper, fraction, p80Um, method } = interp;

  if (method === 'insufficient_data' || curve.length < 2) {
    return (
      <Panel title="Interpolation du 80 % passant">
        <p className="text-[10px] text-amber-400">
          Moins de deux points de tamisage valides : aucune courbe à interpoler.
        </p>
      </Panel>
    );
  }

  const min = curve[0].sieve, max = curve[curve.length - 1].sieve;
  const y = (passing: number) => PT + PH - (Math.max(0, Math.min(100, passing)) / 100) * PH;
  const path = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${xLog(p.sieve, min, max).toFixed(1)},${y(p.passing).toFixed(1)}`).join(' ');
  const y80 = y(80);

  return (
    <Panel title="Interpolation log-linéaire du 80 % passant">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Courbe granulométrique cumulée ; le 80 % passant est atteint à ${p80Um != null ? Math.round(p80Um) : '—'} µm`}>
        {/* Grille horizontale */}
        {[0, 25, 50, 75, 100].map(v => (
          <g key={v}>
            <line x1={PL} y1={y(v)} x2={PL + PW} y2={y(v)} stroke="#2a2f3a" strokeWidth="1" />
            <text x={PL - 4} y={y(v) + 3} fill="#6b7280" fontSize="8" textAnchor="end">{v}</text>
          </g>
        ))}

        {/* Repère du 80 % passant */}
        <line x1={PL} y1={y80} x2={PL + PW} y2={y80} stroke="#14b8a6" strokeWidth="1" strokeDasharray="4 3" />
        <text x={PL + 2} y={y80 - 3} fill="#14b8a6" fontSize="8">80 %</text>

        {/* Courbe mesurée */}
        <path d={path} fill="none" stroke="#e5e7eb" strokeWidth="1.6" />
        {curve.map(p => (
          <circle key={p.sieve} cx={xLog(p.sieve, min, max)} cy={y(p.passing)} r="1.8" fill="#9ca3af" />
        ))}

        {/* Les deux tamis encadrants, mis en évidence */}
        {lower && upper && [lower, upper].map(p => (
          <circle key={`b${p.sieve}`} cx={xLog(p.sieve, min, max)} cy={y(p.passing)}
            r="4" fill="none" stroke="#f59e0b" strokeWidth="1.6" />
        ))}

        {/* Le P80 obtenu */}
        {p80Um != null && (
          <>
            <line x1={xLog(p80Um, min, max)} y1={y80} x2={xLog(p80Um, min, max)} y2={PT + PH}
              stroke="#14b8a6" strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx={xLog(p80Um, min, max)} cy={y80} r="3.5" fill="#14b8a6" />
            <text x={xLog(p80Um, min, max)} y={PT + PH + 16} fill="#14b8a6" fontSize="9" textAnchor="middle" fontWeight="600">
              {Math.round(p80Um)}
            </text>
          </>
        )}

        <text x={PL + PW / 2} y={H - 2} fill="#6b7280" fontSize="8" textAnchor="middle">
          ouverture de tamis (µm) · échelle log
        </text>
      </svg>

      {method === 'exact' && (
        <Formula>
          Un tamis tombe pile à 80 % passant → P₈₀ = <strong className="text-teal-300">{Math.round(p80Um!)} µm</strong>,
          sans interpolation.
        </Formula>
      )}

      {method === 'out_of_range' && (
        <p className="text-[10px] text-amber-400">
          La courbe n'encadre pas le 80 % passant : le P₈₀ est hors de la plage tamisée.
          Ajouter des tamis {curve[curve.length - 1].passing < 80 ? 'plus grossiers' : 'plus fins'}.
        </p>
      )}

      {method === 'log_interpolation' && lower && upper && fraction != null && p80Um != null && (
        <div className="space-y-1">
          <Formula>
            <span className="text-amber-400">encadrement</span> : {lower.sieve} µm ({formatDecimalGrouped(lower.passing, 1)} %)
            {' → '}{upper.sieve} µm ({formatDecimalGrouped(upper.passing, 1)} %)
          </Formula>
          <Formula>
            f = (80 − {formatDecimalGrouped(lower.passing, 1)}) / ({formatDecimalGrouped(upper.passing, 1)} − {formatDecimalGrouped(lower.passing, 1)})
            {' = '}<strong className="text-mf-txt2">{formatDecimalGrouped(fraction, 3)}</strong>
          </Formula>
          <Formula>
            P₈₀ = exp[ ln({lower.sieve}) + {formatDecimalGrouped(fraction, 3)} × ( ln({upper.sieve}) − ln({lower.sieve}) ) ]
          </Formula>
          <Formula>
            = <strong className="text-teal-300">{formatDecimalGrouped(p80Um, 1)} µm</strong>
          </Formula>
          <p className="text-[9px] text-mf-txt4 leading-snug pt-0.5">
            L'interpolation se fait en <strong>log</strong> de l'ouverture : sur une série de tamis
            géométrique, la courbe est quasi droite en log-taille (comportement
            Gates-Gaudin-Schuhmann). Interpoler linéairement surestimerait le P₈₀.
          </p>
        </div>
      )}
    </Panel>
  );
}

// ─── 2. Optimum de la courbe récupération vs P₈₀ ─────────────────────────────

export function LabOptimumPanel({
  points, labTargetUm, rangeUm, justification,
}: {
  points: ScenarioPoint[];
  labTargetUm: number;
  rangeUm: [number, number];
  justification: string;
}) {
  const pts = points.filter(p => p.p80 > 0 && Number.isFinite(p.recoveryPct));
  if (pts.length < 2) {
    return (
      <Panel title="Optimum de récupération">
        <p className="text-[10px] text-mf-txt4">
          Courbe récupération vs P₈₀ indisponible — l'optimum labo retombe sur la
          règle documentée du moteur.
        </p>
        <Formula>P₈₀ labo = <strong className="text-teal-300">{Math.round(labTargetUm)} µm</strong></Formula>
      </Panel>
    );
  }

  const sorted = [...pts].sort((a, b) => a.p80 - b.p80);
  const min = sorted[0].p80, max = sorted[sorted.length - 1].p80;
  const recs = sorted.map(p => p.recoveryPct);
  const rMin = Math.min(...recs), rMax = Math.max(...recs);
  const span = rMax - rMin || 1;
  const y = (r: number) => PT + PH - ((r - rMin) / span) * PH;
  const path = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${xLog(p.p80, min, max).toFixed(1)},${y(p.recoveryPct).toFixed(1)}`).join(' ');
  const best = sorted.reduce((b, p) => (p.recoveryPct > b.recoveryPct ? p : b), sorted[0]);

  return (
    <Panel title="Optimum de la courbe récupération vs P₈₀">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Récupération en fonction du P80 ; maximum à ${Math.round(best.p80)} µm`}>
        {[rMin, (rMin + rMax) / 2, rMax].map((v, i) => (
          <g key={i}>
            <line x1={PL} y1={y(v)} x2={PL + PW} y2={y(v)} stroke="#2a2f3a" strokeWidth="1" />
            <text x={PL - 4} y={y(v) + 3} fill="#6b7280" fontSize="8" textAnchor="end">{formatDecimalGrouped(v, 0)}</text>
          </g>
        ))}

        {/* Plage acceptable */}
        <rect x={xLog(Math.max(rangeUm[0], min), min, max)} y={PT}
          width={Math.max(0, xLog(Math.min(rangeUm[1], max), min, max) - xLog(Math.max(rangeUm[0], min), min, max))}
          height={PH} fill="#14b8a6" opacity="0.07" />

        <path d={path} fill="none" stroke="#14b8a6" strokeWidth="1.8" />

        {/* Le maximum retenu */}
        <line x1={xLog(labTargetUm, min, max)} y1={PT} x2={xLog(labTargetUm, min, max)} y2={PT + PH}
          stroke="#14b8a6" strokeWidth="1.5" strokeDasharray="4 3" />
        <circle cx={xLog(best.p80, min, max)} cy={y(best.recoveryPct)} r="4" fill="#14b8a6" />
        <text x={xLog(labTargetUm, min, max)} y={PT + PH + 16} fill="#14b8a6" fontSize="9" textAnchor="middle" fontWeight="600">
          {Math.round(labTargetUm)}
        </text>

        <text x={PL + PW / 2} y={H - 2} fill="#6b7280" fontSize="8" textAnchor="middle">
          P₈₀ (µm) · échelle log → récupération (%)
        </text>
      </svg>

      <div className="space-y-1">
        <Formula>
          max récupération = <strong className="text-mf-txt2">{formatDecimalGrouped(best.recoveryPct, 1)} %</strong> à{' '}
          <strong className="text-teal-300">{Math.round(best.p80)} µm</strong>
        </Formula>
        <Formula>
          plage acceptable : {Math.round(rangeUm[0])} – {Math.round(rangeUm[1])} µm
        </Formula>
        <p className="text-[9px] text-mf-txt4 leading-snug pt-0.5">
          Ce P₈₀ n'est <strong>pas</strong> une lecture de granulométrie : c'est le sommet de la
          courbe de réponse métallurgique. {justification}
        </p>
      </div>
    </Panel>
  );
}

// ─── 3. Transposition labo → usine ───────────────────────────────────────────

export function PlantTranspositionPanel({
  labTargetUm, kIndus, plantP80Um, basis,
}: {
  labTargetUm: number;
  kIndus: number;
  plantP80Um: number;
  basis: string[];
}) {
  // Échelle locale couvrant les deux valeurs, avec un peu d'air de chaque côté.
  const min = Math.min(labTargetUm, plantP80Um) * 0.75;
  const max = Math.max(labTargetUm, plantP80Um) * 1.35;
  const yMid = PT + PH / 2;
  const xLab = xLog(labTargetUm, min, max);
  const xPlant = xLog(plantP80Um, min, max);

  return (
    <Panel title="Transposition laboratoire → usine">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Le P80 passe de ${Math.round(labTargetUm)} µm en laboratoire à ${Math.round(plantP80Um)} µm en usine`}>
        {/* Axe */}
        <line x1={PL} y1={yMid} x2={PL + PW} y2={yMid} stroke="#2a2f3a" strokeWidth="1.5" />

        {/* Déplacement labo → usine */}
        <defs>
          <marker id="p80-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#34d399" />
          </marker>
        </defs>
        <line x1={xLab} y1={yMid} x2={xPlant - 6} y2={yMid} stroke="#34d399" strokeWidth="2" markerEnd="url(#p80-arrow)" />

        {/* Repère labo */}
        <circle cx={xLab} cy={yMid} r="4" fill="#14b8a6" />
        <text x={xLab} y={yMid - 12} fill="#14b8a6" fontSize="9" textAnchor="middle" fontWeight="600">{Math.round(labTargetUm)}</text>
        <text x={xLab} y={yMid + 20} fill="#6b7280" fontSize="8" textAnchor="middle">labo</text>

        {/* Repère usine */}
        <circle cx={xPlant} cy={yMid} r="5" fill="#34d399" />
        <text x={xPlant} y={yMid - 12} fill="#34d399" fontSize="10" textAnchor="middle" fontWeight="700">{Math.round(plantP80Um)}</text>
        <text x={xPlant} y={yMid + 20} fill="#6b7280" fontSize="8" textAnchor="middle">usine</text>

        <text x={PL + PW / 2} y={H - 2} fill="#6b7280" fontSize="8" textAnchor="middle">
          P₈₀ (µm) · échelle log — l'usine broie plus grossier
        </text>
      </svg>

      <div className="space-y-1">
        <Formula>
          P₈₀ usine = P₈₀ labo × K = {Math.round(labTargetUm)} × {formatDecimalGrouped(kIndus, 2)}
          {' = '}<strong className="text-emerald-300">{Math.round(plantP80Um)} µm</strong>
        </Formula>
        {basis.length > 0 && (
          <Formula><span className="text-mf-txt4">K : {basis.join(' ')}</span></Formula>
        )}
        <p className="text-[9px] text-mf-txt4 leading-snug pt-0.5">
          K &gt; 1 traduit ce qu'un circuit réel perd face au laboratoire : variabilité
          d'alimentation, classification imparfaite (cyclones), contraintes de débit.
          Retenir la cible labo comme consigne usine surestimerait la finesse atteignable.
        </p>
      </div>
    </Panel>
  );
}
