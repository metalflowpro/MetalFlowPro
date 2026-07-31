// ─────────────────────────────────────────────────────────────────────────────
// Bilan mécaniste de récupération — sous-page de « Prédiction IA ».
//
// Là où le modèle OLS rend UN chiffre, ce panneau rend le MÉCANISME : la
// décomposition de la récupération par classe de déportation (cascade), sa
// réconciliation avec la lixiviation MESURÉE, et un indice de réfractarité qui
// oriente la route. S'appuie sur le module pur analytics/recoveryBalance.ts.
//
// Composant présentationnel : aucune dépendance réseau ; il met en forme la
// sortie de fonctions pures et testées.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { normalizeDeportment } from '../../lib/geomet/deportment';
import { recoveryWaterfall, reconcile, refractoriness } from '../../lib/analytics/recoveryBalance';

interface Props {
  deportment: {
    free: number | null; sulphide: number | null; silicate: number | null;
    oxide?: number | null; occluded: number | null; pregRob: number | null;
  };
  p80RefUm: number | null;
  grgPct?: number | null;
  cOrgPct?: number | null;
  measuredRecoveryPct?: number | null;
  leach24hPct?: number | null;
  leach48hPct?: number | null;
}

const CONTRIB_COLOR: Record<string, string> = {
  gravity: '#2ecc8a', cn_free: '#14b8a6', cn_sulphide: '#9d78f0',
  cn_silicate: '#56657a', cn_oxide: '#38bdf8', preg_loss: '#ef4444',
};

const CLASS_STYLE: Record<string, { label: string; cls: string }> = {
  free_milling:          { label: 'Free-milling',        cls: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' },
  legerement_refractaire:{ label: 'Légèrement réfractaire', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  refractaire:           { label: 'Réfractaire',         cls: 'text-orange-400 border-orange-500/40 bg-orange-500/10' },
  double_refractaire:    { label: 'Double réfractaire',  cls: 'text-red-400 border-red-500/40 bg-red-500/10' },
};

const RECON_STYLE: Record<string, string> = {
  coherent: 'text-emerald-400', pertes_inexpliquees: 'text-red-400',
  modele_pessimiste: 'text-amber-400', sans_mesure: 'text-mf-txt3',
};

export function MechanisticRecoveryPanel(props: Props) {
  const dep = useMemo(() => normalizeDeportment({
    free: props.deportment.free, sulphide: props.deportment.sulphide,
    silicate: props.deportment.silicate, oxide: props.deportment.oxide ?? 0,
    occluded: props.deportment.occluded, pregRob: props.deportment.pregRob,
  }), [props.deportment]);

  const p80Ref = props.p80RefUm && props.p80RefUm > 0 ? props.p80RefUm : null;

  const result = useMemo(() => {
    if (!dep || !p80Ref) return null;
    const inp = { p80RefUm: p80Ref, grgPct: props.grgPct ?? null, cOrgPct: props.cOrgPct ?? null };
    const w = recoveryWaterfall(dep, p80Ref, inp);
    const rec = reconcile(w.predictedPct, props.measuredRecoveryPct ?? null);
    const refr = refractoriness(dep, inp, { leach24hPct: props.leach24hPct, leach48hPct: props.leach48hPct }, rec);
    return { w, rec, refr };
  }, [dep, p80Ref, props.grgPct, props.cOrgPct, props.measuredRecoveryPct, props.leach24hPct, props.leach48hPct]);

  if (!dep || !p80Ref || !result) {
    return (
      <div className="card">
        <div className="text-sm font-semibold text-mf-txt mb-1">Bilan mécaniste de récupération</div>
        <div className="text-xs text-mf-txt3">
          Aucun essai de libération exploitable au niveau projet. Ajouter des essais de libération
          (déportation Au libre / sulfures / silicates / occlus / preg-robbing) pour décomposer la
          récupération par mécanisme et la réconcilier avec la lixiviation mesurée.
        </div>
      </div>
    );
  }

  const { w, rec, refr } = result;
  const positive = w.contributions.filter(c => c.points > 0);
  const cls = CLASS_STYLE[refr.class];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-mf-txt">Bilan mécaniste de récupération</div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls.cls}`}>
          {cls.label} · indice {refr.index.toFixed(0)}
        </span>
      </div>

      {/* Cascade des contributions (barre empilée) */}
      <div className="mb-1 flex items-end justify-between">
        <span className="text-[11px] text-mf-txt3">Décomposition (P80 réf. {Math.round(p80Ref)} µm)</span>
        <span className="text-sm font-semibold text-teal-300">R prédite {w.predictedPct.toFixed(1)} %</span>
      </div>
      <div className="h-6 w-full rounded-md overflow-hidden flex bg-mf-panel border border-mf-border" role="img" aria-label="Cascade de récupération">
        {positive.map(c => (
          <div key={c.key} title={`${c.label}: ${c.points.toFixed(1)} pt`}
            style={{ width: `${c.points}%`, background: CONTRIB_COLOR[c.key] }} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {positive.map(c => (
          <span key={c.key} className="text-[10px] text-mf-txt3 inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: CONTRIB_COLOR[c.key] }} />
            {c.label} {c.points.toFixed(1)}
          </span>
        ))}
        {w.gravityRoutePts > 0.05 && (
          <span className="text-[10px] text-emerald-400/80">dont gravité {w.gravityRoutePts.toFixed(1)} pt (protège du preg-robbing)</span>
        )}
      </div>

      {/* Pertes */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {w.losses.map(l => (
          <div key={l.key} className="rounded-md border border-mf-border bg-mf-panel px-2 py-1.5 text-center">
            <div className="text-[9px] text-mf-txt3 uppercase tracking-wide leading-tight">{l.label}</div>
            <div className="text-sm font-semibold text-mf-txt">{l.points.toFixed(1)}</div>
          </div>
        ))}
      </div>

      {/* Réconciliation avec la lixiviation mesurée */}
      <div className="mt-3 rounded-md border border-mf-border bg-mf-panel p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-mf-txt3">Réconciliation vs lixiviation mesurée</span>
          {Number.isFinite(rec.measuredPct) && (
            <span className="text-[11px] text-mf-txt3">
              prédit <strong className="text-teal-300">{rec.predictedPct.toFixed(1)}</strong> · mesuré <strong className="text-sky-300">{rec.measuredPct.toFixed(1)}</strong> · écart <strong className={RECON_STYLE[rec.verdict]}>{rec.residualPct > 0 ? '+' : ''}{rec.residualPct.toFixed(1)} pt</strong>
            </span>
          )}
        </div>
        <div className={`mt-1 text-[11px] leading-snug ${RECON_STYLE[rec.verdict]}`}>{rec.message}</div>
      </div>

      {/* Diagnostic de réfractarité */}
      <div className="mt-2 text-[11px] text-mf-txt3 leading-snug">{refr.message}</div>
    </div>
  );
}
