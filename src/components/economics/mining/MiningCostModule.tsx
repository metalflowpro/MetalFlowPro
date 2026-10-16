// Module « Coûts miniers » de l'Économie : CAPEX et OPEX de la mine (ciel
// ouvert ou souterrain) calculés à partir des données du projet, affichés dans
// l'onglet CAPEX (vue capital) et l'onglet OPEX (vue exploitation), puis
// injectés dans le modèle économique à côté de la partie métallurgie.

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Mountain, Pickaxe, RotateCcw, Save, Send } from 'lucide-react';
import { formatDecimalGrouped } from '../../../lib/format/number';
import { notifyError, notifySuccess } from '../../../lib/notify';
import { miningCapexLines, miningOpexLines, miningSustainingMusdPerYear } from '../../../lib/mining/economicLines';
import type { MiningCostResult } from '../../../lib/mining/projectInputs';
import type { OpenPitResult } from '../../../lib/mining/openPit';
import type { UndergroundResult } from '../../../lib/mining/underground';
import { MiningInputsEditor } from './MiningInputsEditor';
import { ProvenanceBadge } from './fields';
import type { MiningCostState } from './useMiningCostModel';

const M = (usd: number, d = 2) => formatDecimalGrouped(usd / 1e6, d);
/** Années du plan : « An −1 », « An 0 » en pré-production (affichées en orange), puis « An 1 »… */
const yearLabel = (y: number) => `An ${y}`;
const PRE_PRODUCTION_HINT = 'Pré-production — dépenses capitalisées';

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card-sm">
      <div className="text-[10px] mf-txt3 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold text-amber-400">{value}</div>
      {note && <div className="text-[10px] mf-txt4">{note}</div>}
    </div>
  );
}

function ProjectDataCard({ state }: { state: MiningCostState }) {
  const rows: { path: string; label: string; value: string }[] = [];
  const m = state.model!;
  const s = m.schedule;
  rows.push({ path: 'schedule.annualOreTonnes', label: 'Minerai alimenté', value: `${formatDecimalGrouped(s.annualOreTonnes / 1e6, 3)} Mt/an` });
  rows.push({ path: 'schedule.lomYears', label: 'Durée de vie', value: `${s.lomYears} ans` });
  rows.push({ path: 'schedule.reservesTonnes', label: 'Réserves', value: s.reservesTonnes > 0 ? `${formatDecimalGrouped(s.reservesTonnes / 1e6, 2)} Mt` : '—' });
  if (m.method === 'open_pit') {
    rows.push({ path: 'schedule.strippingRatio', label: 'Ratio de découverture', value: `${formatDecimalGrouped(s.strippingRatio, 2)} t/t` });
    rows.push({ path: 'openPit.benchHeightM', label: 'Hauteur de banc', value: `${formatDecimalGrouped(m.openPit.benchHeightM, 1)} m` });
    rows.push({ path: 'openPit.oreSgTpm3', label: 'Densité du minerai', value: `${formatDecimalGrouped(m.openPit.oreSgTpm3, 2)} t/m³` });
    rows.push({ path: 'openPit.contingencyPct', label: 'Contingence', value: `${formatDecimalGrouped(m.openPit.contingencyPct, 1)} %` });
  } else {
    rows.push({ path: 'underground.capitalHeading', label: 'Densité de la roche', value: `${formatDecimalGrouped(m.underground.capitalHeading.rockSgTpm3, 2)} t/m³` });
    rows.push({ path: 'underground.paidHoursPerYear', label: 'Heures payées / ETP', value: `${m.underground.paidHoursPerYear} h` });
    rows.push({ path: 'underground.contingencyPct', label: 'Contingence', value: `${formatDecimalGrouped(m.underground.contingencyPct, 1)} %` });
  }
  rows.push({ path: 'schedule.rampUpY1Pct', label: 'Montée en cadence', value: `${s.rampUpY1Pct} % / ${s.rampUpY2Pct} %` });
  return (
    <div className="card-sm">
      <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">Données du projet utilisées</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1">
        {rows.map(r => (
          <div key={r.path} className="flex items-center gap-1.5 text-xs" title={state.provenance[r.path]?.source}>
            <span className="mf-txt3">{r.label}</span>
            <span className="font-semibold mf-txt">{r.value}</span>
            <ProvenanceBadge p={state.isOverridden(r.path) ? { origin: 'override', source: 'Saisi' } : state.provenance[r.path]} />
          </div>
        ))}
      </div>
      {!state.hasMineParams && (
        <div className="mt-2 text-[11px] text-amber-300 flex items-center gap-1.5">
          <AlertCircle size={12} /> Aucun paramètre dans Mine & Optimisation : méthode, ratio de découverture et réserves prennent leurs valeurs de repli — renseignez-les pour un chiffrage du projet.
        </div>
      )}
    </div>
  );
}

function CapexView({ r }: { r: MiningCostResult }) {
  const byCat = new Map<string, { initial: number; sustaining: number }>();
  for (const c of r.capex) {
    const e = byCat.get(c.category) ?? { initial: 0, sustaining: 0 };
    e.initial += c.initialUsd; e.sustaining += c.sustainingUsd;
    byCat.set(c.category, e);
  }
  const items = r.capex.filter(c => c.initialUsd + c.sustainingUsd > 0);
  const totalBy = r.periods.map((_, i) => r.capex.reduce((s, c) => s + c.byPeriod[i], 0));
  return (
    <div className="space-y-3">
      <div className="card-sm overflow-x-auto">
        <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">CAPEX minier par catégorie (M US$)</div>
        <table className="tbl w-full text-xs">
          <thead><tr>{['Catégorie', 'Initial', 'Maintien (LOM)', 'Total'].map(h => <th key={h} className="text-left px-3 py-1.5 mf-txt3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {[...byCat.entries()].filter(([, v]) => v.initial + v.sustaining > 0).map(([cat, v]) => (
              <tr key={cat} className="border-b border-white/5">
                <td className="px-3 py-1">{cat}</td>
                <td className="px-3 py-1 text-amber-300 font-semibold">{M(v.initial)}</td>
                <td className="px-3 py-1 mf-txt2">{M(v.sustaining)}</td>
                <td className="px-3 py-1 mf-txt">{M(v.initial + v.sustaining)}</td>
              </tr>
            ))}
            <tr className="bg-white/5 font-semibold">
              <td className="px-3 py-1">Total</td>
              <td className="px-3 py-1 text-amber-400">{M(r.totals.initialCapexUsd)}</td>
              <td className="px-3 py-1">{M(r.totals.sustainingCapexUsd)}</td>
              <td className="px-3 py-1">{M(r.totals.initialCapexUsd + r.totals.sustainingCapexUsd)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card-sm overflow-x-auto">
        <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">Échéancier du capital (M US$) <span className="normal-case font-normal text-amber-300">— en orange : pré-production (capital initial)</span></div>
        <table className="tbl w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-left px-2 py-1 mf-txt3 font-semibold sticky left-0">Poste</th>
              {r.periods.map(p => <th key={p.index} title={p.preProduction ? PRE_PRODUCTION_HINT : undefined} className={`text-right px-2 py-1 font-semibold whitespace-nowrap ${p.preProduction ? 'text-amber-300' : 'mf-txt3'}`}>{yearLabel(p.year)}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map(c => (
              <tr key={c.key} className="border-b border-white/5">
                <td className="px-2 py-0.5 mf-txt2 whitespace-nowrap">{c.label}</td>
                {c.byPeriod.map((v, i) => <td key={i} className="px-2 py-0.5 text-right">{v > 0 ? M(v, 1) : ''}</td>)}
              </tr>
            ))}
            <tr className="bg-white/5 font-semibold">
              <td className="px-2 py-0.5">Total</td>
              {totalBy.map((v, i) => <td key={i} className="px-2 py-0.5 text-right text-amber-300">{v > 0 ? M(v, 1) : ''}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpexView({ r }: { r: MiningCostResult }) {
  const oreT = r.totals.productionOreTonnes;
  const totT = r.totals.productionTotalTonnes;
  const years = Math.max(1, r.totals.productionYears);
  const total = r.totals.productionOpexUsd || 1;
  return (
    <div className="space-y-3">
      <div className="card-sm overflow-x-auto">
        <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">OPEX minier par centre de coût (période de production)</div>
        <table className="tbl w-full text-xs">
          <thead>
            <tr>{['Centre de coût', 'M US$/an (moy.)', 'US$/t minerai', r.method === 'open_pit' ? 'US$/t déplacée' : 'US$/t excavée', '% du total'].map(h => <th key={h} className="text-left px-3 py-1.5 mf-txt3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {r.opex.map(o => (
              <tr key={o.key} className="border-b border-white/5">
                <td className="px-3 py-1">{o.label}</td>
                <td className="px-3 py-1">{M(o.productionUsd / years)}</td>
                <td className="px-3 py-1 text-amber-300 font-semibold">{formatDecimalGrouped(oreT > 0 ? o.productionUsd / oreT : 0, 2)}</td>
                <td className="px-3 py-1 mf-txt2">{formatDecimalGrouped(totT > 0 ? o.productionUsd / totT : 0, 2)}</td>
                <td className="px-3 py-1 mf-txt3">{formatDecimalGrouped((o.productionUsd / total) * 100, 1)} %</td>
              </tr>
            ))}
            <tr className="bg-white/5 font-semibold">
              <td className="px-3 py-1">Total</td>
              <td className="px-3 py-1">{M(r.totals.productionOpexUsd / years)}</td>
              <td className="px-3 py-1 text-amber-400">{formatDecimalGrouped(r.totals.opexUsdPerOreTonne, 2)}</td>
              <td className="px-3 py-1">{formatDecimalGrouped(r.totals.opexUsdPerTotalTonne, 2)}</td>
              <td className="px-3 py-1">100 %</td>
            </tr>
          </tbody>
        </table>
        <div className="text-[10px] mf-txt4 mt-1">Les coûts des années de pré-production sont capitalisés (onglet CAPEX) et exclus de cette moyenne.</div>
      </div>
      <PhysicalsView r={r} />
    </div>
  );
}

function PhysicalsView({ r }: { r: MiningCostResult }) {
  const kt = (t: number) => formatDecimalGrouped(t / 1000, 0);
  const rows: { label: string; values: string[] }[] = [
    { label: 'Minerai (kt)', values: r.oreTonnes.map(kt) },
  ];
  if (r.method === 'open_pit') {
    const op = r as OpenPitResult;
    rows.push({ label: 'Stérile (kt)', values: op.totalTonnes.map((t, i) => kt(t - op.oreTonnes[i])) });
    for (const f of op.fleet) rows.push({ label: `${f.label} (unités)`, values: f.units.map(u => (u ? String(u) : '')) });
    for (const h of op.headcount) rows.push({ label: h.label, values: h.byPeriod.map(v => (v ? String(Math.round(v)) : '')) });
  } else {
    const ug = r as UndergroundResult;
    const m = (v: number) => (v > 0 ? formatDecimalGrouped(v, 0) : '');
    rows.push({ label: 'Latéral capital (m)', values: ug.physicals.capLateralM.map(m) });
    rows.push({ label: "Latéral d'exploitation (m)", values: ug.physicals.opLateralM.map(m) });
    rows.push({ label: 'Vertical (m)', values: ug.physicals.verticalM.map(m) });
    rows.push({ label: 'Stérile de développement (kt)', values: ug.physicals.devWasteT.map(kt) });
    rows.push({ label: 'Remblai (kt)', values: ug.physicals.backfillT.map(kt) });
    for (const f of ug.fleet.filter(f => f.units.some(u => u > 0))) rows.push({ label: `${f.label} (unités)`, values: f.units.map(u => (u ? String(u) : '')) });
  }
  return (
    <div className="card-sm overflow-x-auto">
      <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">Physique, flotte et effectifs par année</div>
      <table className="tbl w-full text-[11px]">
        <thead>
          <tr>
            <th className="text-left px-2 py-1 mf-txt3 font-semibold">Grandeur</th>
            {r.periods.map(p => <th key={p.index} title={p.preProduction ? PRE_PRODUCTION_HINT : undefined} className={`text-right px-2 py-1 font-semibold whitespace-nowrap ${p.preProduction ? 'text-amber-300' : 'mf-txt3'}`}>{yearLabel(p.year)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.label} className="border-b border-white/5">
              <td className="px-2 py-0.5 mf-txt2 whitespace-nowrap">{row.label}</td>
              {row.values.map((v, i) => <td key={i} className="px-2 py-0.5 text-right">{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplyPanel({ state }: { state: MiningCostState }) {
  const [includeSustaining, setIncludeSustaining] = useState(true);
  const r = state.result!;
  const m = state.model!;
  const contingency = m.method === 'underground' ? m.underground.contingencyPct : m.openPit.contingencyPct;
  const capex = miningCapexLines(r, contingency);
  const opex = miningOpexLines(r);
  const capexTotal = capex.reduce((s, l) => s + l.value_musd * (1 + l.contingency_pct / 100), 0);
  const opexTotal = opex.reduce((s, l) => s + l.value_usd_t, 0);
  const injectedCapex = state.injectedCapex.reduce((s, l) => s + l.value_musd * (1 + l.contingency_pct / 100), 0);
  const injectedOpex = state.injectedOpex.reduce((s, l) => s + l.value_usd_t, 0);
  const stale = state.injectedCapex.length + state.injectedOpex.length > 0
    && (Math.abs(injectedCapex - capexTotal) > 0.01 || Math.abs(injectedOpex - opexTotal) > 0.005);

  async function apply() {
    try {
      const res = await state.applyToEconomics({ includeSustaining });
      notifySuccess('Coûts miniers injectés dans le modèle économique',
        `${res.capex} lignes CAPEX, ${res.opex} lignes OPEX${res.sustaining != null ? `, capital de maintien du projet : ${formatDecimalGrouped(res.sustaining, 2)} M$/an` : ''}.`);
    } catch (e) {
      notifyError("Échec de l'injection des coûts miniers", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="card-sm border-amber-400/30">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-xs mf-txt flex-1 min-w-[260px]">
          <div className="font-semibold mb-0.5">Injection dans le modèle économique</div>
          <div className="mf-txt3">
            {capex.length} lignes CAPEX « Travaux miniers » ({formatDecimalGrouped(capexTotal, 2)} M$ contingence incluse) ·
            {' '}{opex.length} lignes OPEX « Mine » ({formatDecimalGrouped(opexTotal, 2)} $/t alimentée) ·
            capital de maintien minier {formatDecimalGrouped(miningSustainingMusdPerYear(r), 2)} M$/an
          </div>
          {state.row?.result_summary && (
            <div className={`mt-0.5 text-[11px] ${stale ? 'text-amber-300' : 'text-emerald-400'} flex items-center gap-1`}>
              {stale ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
              Dernière injection le {new Date(state.row.result_summary.appliedAt).toLocaleString('fr-CA')}
              {stale ? ' — les lignes de l’Économie ne reflètent plus ce calcul.' : ' — à jour.'}
            </div>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs mf-txt3">
          <input type="checkbox" checked={includeSustaining} onChange={e => setIncludeSustaining(e.target.checked)} />
          Ajouter au capital de maintien du projet
        </label>
        <button onClick={apply} disabled={state.applying || capex.length + opex.length === 0}
          className="btn btn-secondary text-xs flex items-center gap-1.5 border-amber-400/40 text-amber-300 hover:border-amber-400">
          <Send size={12} /> {state.applying ? 'Injection…' : 'Injecter dans CAPEX / OPEX'}
        </button>
      </div>
    </div>
  );
}

export function MiningCostModule({ state, view }: { state: MiningCostState; view: 'capex' | 'opex' }) {
  const [showInputs, setShowInputs] = useState(false);
  if (state.loading) return <div className="text-xs mf-txt3 py-10 text-center">Chargement des données minières du projet…</div>;
  if (state.error) return <div className="card-sm text-xs text-red-400">{state.error}</div>;
  if (!state.model || !state.result) return null;
  const r = state.result;
  const m = state.model;

  async function save() {
    try { await state.save(); notifySuccess('Hypothèses minières enregistrées'); }
    catch (e) { notifyError("Échec de l'enregistrement", e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border mf-border overflow-hidden">
          {([['open_pit', 'Ciel ouvert', <Mountain key="m" size={12} />], ['underground', 'Souterrain', <Pickaxe key="p" size={12} />]] as const).map(([id, label, icon]) => (
            <button key={id} onClick={() => state.setMethod(id)}
              className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 ${m.method === id ? 'bg-amber-400/15 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>
              {icon}{label}
            </button>
          ))}
        </div>
        <ProvenanceBadge p={state.provenance.method} />
        <div className="flex-1" />
        {state.dirty && <span className="text-[11px] text-amber-300">Modifications non enregistrées</span>}
        <button onClick={() => setShowInputs(s => !s)} className="btn btn-secondary text-xs">{showInputs ? 'Masquer les hypothèses' : 'Hypothèses & référentiel'}</button>
        <button onClick={state.resetAll} title="Revenir aux données du projet et au référentiel" className="btn btn-secondary text-xs flex items-center gap-1"><RotateCcw size={12} /> Réinitialiser</button>
        <button onClick={save} disabled={state.saving || !state.dirty} className="btn btn-teal text-xs flex items-center gap-1"><Save size={12} /> {state.saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>

      <ProjectDataCard state={state} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="CAPEX initial minier" value={`${M(r.totals.initialCapexUsd, 1)} M$`} note="contingence incluse" />
        <Kpi label="Capital de maintien" value={`${M(r.totals.sustainingUsdPerYear, 1)} M$/an`} note={`moyenne sur ${r.totals.productionYears} ans de production`} />
        <Kpi label="OPEX minier" value={`${formatDecimalGrouped(r.totals.opexUsdPerOreTonne, 2)} $/t`} note="par tonne de minerai alimentée" />
        <Kpi label={m.method === 'open_pit' ? 'OPEX par t déplacée' : 'OPEX par t excavée'} value={`${formatDecimalGrouped(r.totals.opexUsdPerTotalTonne, 2)} $/t`} note={m.method === 'open_pit' ? 'minerai + stérile' : 'minerai + stérile de développement'} />
      </div>

      {r.warnings.length > 0 && (
        <div className="card-sm border-amber-400/30 bg-amber-400/5 text-[11px] text-amber-300 space-y-0.5">
          {r.warnings.map(w => <div key={w} className="flex items-start gap-1.5"><AlertCircle size={12} className="mt-0.5 shrink-0" />{w}</div>)}
        </div>
      )}

      <ApplyPanel state={state} />

      {view === 'capex' ? <CapexView r={r} /> : <OpexView r={r} />}

      {showInputs && <MiningInputsEditor state={state} />}
    </div>
  );
}
