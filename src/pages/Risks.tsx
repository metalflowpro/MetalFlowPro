import { useState } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Plus, ShieldAlert, Sparkles, RefreshCw, Edit3, Trash2, X,
  TrendingDown, BarChart3,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ui/ConfirmDialog';
import { useProject } from '../lib/ProjectContext';
import { runMonteCarlo, type Distribution } from '../lib/simulation/monteCarlo';
import { computeProductionMetrics } from '../lib/config/constants';
import type { Project, Risk } from '../types';

const CATEGORIES = ['Technique', 'Environnemental', 'Financier', 'Opérationnel', 'Réglementaire', 'Géopolitique', 'Social'];

const PROB_LABELS = ['', 'Rare', 'Peu probable', 'Modéré', 'Probable', 'Quasi certain'];
const IMPACT_LABELS = ['', 'Négligeable', 'Faible', 'Modéré', 'Majeur', 'Catastrophique'];

function riskColor(p: number, i: number) {
  const score = p * i;
  if (score >= 15) return { text: 'text-red-400',     badge: 'badge-red',    label: 'Critique' };
  if (score >= 8)  return { text: 'text-orange-400',  badge: 'badge-orange', label: 'Élevé'    };
  if (score >= 4)  return { text: 'text-amber-400',   badge: 'badge-gold',   label: 'Modéré'   };
  return              { text: 'text-emerald-400', badge: 'badge-green', label: 'Faible'   };
}

interface RisksProps { project: Project; risks: Risk[]; onRefresh: () => void; }

async function generateRisksFromProject(projectId: string): Promise<Omit<Risk, 'id' | 'project_id' | 'created_at'>[]> {
  const generated: Omit<Risk, 'id' | 'project_id' | 'created_at'>[] = [];

  const [
    { data: limsLeach },
    { data: limsComm },
    { data: mineParams },
    { data: simRuns },
    { data: geoMetDomains },
  ] = await Promise.all([
    supabase.from('lims_test_leaching').select('leach_rec_24h_pct,nacn_consumption_kg_t').eq('project_id', projectId).limit(50),
    supabase.from('lims_test_comminution').select('bwi_kwh_t').eq('project_id', projectId).limit(50),
    supabase.from('mine_params').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('sim_run_results').select('global_results,status').eq('project_id', projectId).order('created_at', { ascending: false }).limit(5),
    supabase.from('lims_samples').select('domain').eq('project_id', projectId).limit(100),
  ]);

  if (limsLeach && limsLeach.length >= 3) {
    const recoveries = limsLeach
      .map((r: { leach_rec_24h_pct: number | null }) => r.leach_rec_24h_pct)
      .filter((v): v is number => v != null);
    if (recoveries.length >= 3) {
      const mean = recoveries.reduce((a, b) => a + b, 0) / recoveries.length;
      const stdDev = Math.sqrt(recoveries.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recoveries.length);
      const cv = stdDev / mean;
      if (cv > 0.15) {
        generated.push({
          description: `Variabilité élevée de récupération Au LIMS (CV=${formatDecimalGrouped((cv * 100), 0)}%, moy=${formatDecimalGrouped(mean, 1)}%) — risque sur prévision de production`,
          category: 'Technique', probability: 4, impact: 4, status: 'open',
          mitigation: 'Densifier la caractérisation par domaine géologique, tests sur composites représentatifs, modélisation variographique',
        });
      }
      const cnVals = limsLeach
        .map((r: { nacn_consumption_kg_t: number | null }) => r.nacn_consumption_kg_t)
        .filter((v): v is number => v != null);
      if (cnVals.length > 0) {
        const maxCN = Math.max(...cnVals);
        if (maxCN > 2) {
          generated.push({
            description: `Consommation de cyanure élevée (max ${formatDecimalGrouped(maxCN, 1)} kg/t NaCN) — impact opex et conformité WAD CN`,
            category: 'Environnemental', probability: 3, impact: 4, status: 'open',
            mitigation: 'Optimiser le pH (10.5–11), aération contrôlée, détox INCO SO₂/Air, monitoring WAD CN résidus ≤ 50 ppm',
          });
        }
      }
    }
  }

  if (limsComm && limsComm.length >= 3) {
    const bwis = limsComm
      .map((r: { bwi_kwh_t: number | null }) => r.bwi_kwh_t)
      .filter((v): v is number => v != null);
    if (bwis.length >= 3) {
      const maxBwi = Math.max(...bwis);
      const minBwi = Math.min(...bwis);
      if (maxBwi - minBwi > 5) {
        generated.push({
          description: `Forte variabilité BWI comminution (${formatDecimalGrouped(minBwi, 1)}–${formatDecimalGrouped(maxBwi, 1)} kWh/t) — sous-dimensionnement circuit broyage possible`,
          category: 'Technique', probability: 3, impact: 4, status: 'open',
          mitigation: `Campagne BWI étendue (≥30 éch.), facteur design 1.15×BWI max, tests SMC/DWT pour validation`,
        });
      }
      if (maxBwi > 18) {
        generated.push({
          description: `Minerai dur (BWI max ${formatDecimalGrouped(maxBwi, 1)} kWh/t) — consommation énergétique circuit broyage sous-estimée`,
          category: 'Opérationnel', probability: 3, impact: 3, status: 'open',
          mitigation: 'Revoir puissance installée broyeurs, tests pilote, optimiser charge broyante et P80 cible',
        });
      }
    }
  }

  if (mineParams) {
    const mp = mineParams as { annual_production_kt?: number; strip_ratio?: number };
    if (mp.annual_production_kt && mp.annual_production_kt > 5000) {
      generated.push({
        description: `Production annuelle élevée (${formatDecimalGrouped((mp.annual_production_kt / 1000), 1)} Mt/an) — risque dépassement capacité traitement usine`,
        category: 'Opérationnel', probability: 3, impact: 4, status: 'open',
        mitigation: 'Valider capacité nominale usine vs débit mine, buffer stocks ROM, stratégie blending pour lisser les teneurs',
      });
    }
    if (mp.strip_ratio && mp.strip_ratio > 6) {
      generated.push({
        description: `Ratio de découverture élevé (${formatDecimalGrouped(mp.strip_ratio, 1)} t/t) — OPEX mine susceptibles de dépasser prévisions`,
        category: 'Financier', probability: 3, impact: 4, status: 'open',
        mitigation: 'Revoir coupure économique et séquençage phases, optimiser transport déblais, analyse sensibilité prix or vs SR',
      });
    }
  }

  if (simRuns && simRuns.length > 0) {
    const simRunsTyped = simRuns as { status: string; global_results?: { overall_recovery?: number; cn_in_tailings?: number } }[];
    const diverged = simRunsTyped.filter(r => r.status === 'diverged');
    if (diverged.length > 0) {
      generated.push({
        description: `${diverged.length} simulation(s) du flowsheet n'ont pas convergé — modèle de procédé potentiellement instable`,
        category: 'Technique', probability: 3, impact: 3, status: 'open',
        mitigation: 'Réviser les conditions aux limites du flowsheet, vérifier les flux de recycle, réduire le pas de convergence',
      });
    }
    const lastRun = simRunsTyped[0];
    const overallRecovery = lastRun?.global_results?.overall_recovery;
    if (overallRecovery !== undefined && overallRecovery < 80) {
      generated.push({
        description: `Récupération globale simulée faible (${formatDecimalGrouped(overallRecovery, 1)}%) — objectif NPV potentiellement compromis`,
        category: 'Technique', probability: 3, impact: 5, status: 'open',
        mitigation: 'Investiguer minerai réfractaire, envisager prétraitement (POX/biox), prolonger temps de lixiviation, optimiser cyanuration',
      });
    }
    const cnInTailings = lastRun?.global_results?.cn_in_tailings;
    if (cnInTailings !== undefined && cnInTailings > 50) {
      generated.push({
        description: `Teneur CN dans résidus simulée ${formatDecimalGrouped(cnInTailings, 0)} ppm — non-conformité réglementaire WAD CN probable`,
        category: 'Environnemental', probability: 4, impact: 5, status: 'open',
        mitigation: 'Circuit DETOX obligatoire (INCO SO₂/Air ou H₂O₂), cible ≤ 50 ppm WAD CN effluents, plan de surveillance continue',
      });
    }
  }

  if (geoMetDomains) {
    const domains = new Set((geoMetDomains as { domain: string | null }[]).map(r => r.domain).filter(Boolean));
    if (domains.size >= 4) {
      generated.push({
        description: `Forte hétérogénéité géométallurgique (${domains.size} domaines LIMS) — risque variabilité performance usine`,
        category: 'Technique', probability: 3, impact: 3, status: 'open',
        mitigation: 'Modèle géométallurgique 3D, stratégie de blending par domaine, prévisions production par bloc minier',
      });
    }
  }

  generated.push({
    description: 'Prix de l\'or < $1 800/oz sur 18 mois consécutifs — flux de trésorerie négatifs en période de montée en régime',
    category: 'Financier', probability: 2, impact: 5, status: 'open',
    mitigation: 'Couverture partielle 20–30% production an 1–3, financement structuré avec covenant OR, analyse sensibilité seuil de rentabilité',
  });

  generated.push({
    description: 'Délai d\'obtention permis exploitation > 18 mois — impact sur calendrier et financement',
    category: 'Réglementaire', probability: 3, impact: 4, status: 'open',
    mitigation: 'Engagement précoce autorités, EIE complète avec FPIC communautaire, équipe allowing dédiée',
  });

  return generated;
}

export function Risks({ project, risks, onRefresh }: RisksProps) {
  const { effectiveRecoveryPct, totalCapex, totalOpex, assumptions } = useProject();
  const confirm = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [editRisk, setEditRisk] = useState<Risk | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [activeTab, setActiveTab] = useState<'register' | 'matrix' | 'quantitative'>('register');
  const [mcResult, setMcResult] = useState<{ p5Npv: number; p50Npv: number; p95Npv: number; meanNpv: number; atRisk: number; histogram: number[] } | null>(null);
  const [runningMC, setRunningMC] = useState(false);

  const [form, setForm] = useState({
    description: '', category: 'Technique', probability: 3, impact: 3,
    mitigation: '', status: 'open' as Risk['status'],
  });

  const displayRisks = risks;
  const filtered = displayRisks.filter(r => {
    const matchS = !filterStatus || r.status === filterStatus;
    const matchC = !filterCat || r.category === filterCat;
    return matchS && matchC;
  });

  const counts = {
    critical: displayRisks.filter(r => r.probability * r.impact >= 15).length,
    high:     displayRisks.filter(r => { const s = r.probability * r.impact; return s >= 8 && s < 15; }).length,
    medium:   displayRisks.filter(r => { const s = r.probability * r.impact; return s >= 4 && s < 8; }).length,
    low:      displayRisks.filter(r => r.probability * r.impact < 4).length,
  };

  function startEdit(r: Risk) {
    setEditRisk(r);
    setForm({
      description: r.description, category: r.category,
      probability: r.probability, impact: r.impact,
      mitigation: r.mitigation ?? '', status: r.status,
    });
    setShowModal(true);
  }

  function startNew() {
    setEditRisk(null);
    setForm({ description: '', category: 'Technique', probability: 3, impact: 3, mitigation: '', status: 'open' });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editRisk) {
        await supabase.from('risks').update({
          description: form.description, category: form.category,
          probability: form.probability, impact: form.impact,
          mitigation: form.mitigation || null, status: form.status,
        }).eq('id', editRisk.id).eq('project_id', project.id);
      } else {
        await supabase.from('risks').insert({
          project_id: project.id, ...form,
          mitigation: form.mitigation || null,
        });
      }
      setShowModal(false);
      onRefresh();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    const risk = risks.find(r => r.id === id);
    const ok = await confirm({
      title: 'Supprimer ce risque ?',
      message: risk
        ? `« ${risk.description} » sera définitivement supprimé du registre.`
        : 'Ce risque sera définitivement supprimé du registre.',
    });
    if (!ok) return;
    await supabase.from('risks').delete().eq('id', id).eq('project_id', project.id);
    onRefresh();
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const generated = await generateRisksFromProject(project.id);
      if (generated.length > 0) {
        await supabase.from('risks').insert(generated.map(r => ({ ...r, project_id: project.id })));
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
    setGenerating(false);
  }

  async function runQuantitative() {
    setRunningMC(true);
    try {
      const { annualTonnes } = computeProductionMetrics(project, assumptions, effectiveRecoveryPct);
      const discRate = assumptions.discountRate;
      const lomYears = assumptions.lomYears;

      const inputs: { name: string; dist: Distribution }[] = [
        { name: 'goldPrice', dist: { kind: 'triangular', min: project.gold_price_usd * 0.6, mode: project.gold_price_usd, max: project.gold_price_usd * 1.5 } },
        { name: 'grade', dist: { kind: 'normal', mean: project.gold_grade_g_t, std: project.gold_grade_g_t * 0.15, min: 0 } },
        { name: 'recovery', dist: { kind: 'triangular', min: Math.max(40, effectiveRecoveryPct - 10), mode: effectiveRecoveryPct, max: Math.min(98, effectiveRecoveryPct + 5) } },
        { name: 'opex', dist: { kind: 'normal', mean: totalOpex, std: totalOpex * 0.2, min: 0 } },
        { name: 'capex', dist: { kind: 'triangular', min: totalCapex * 0.8, mode: totalCapex, max: totalCapex * 1.3 } },
      ];

      const result = runMonteCarlo(inputs, (d) => {
        const oz = computeProductionMetrics({ ...project, gold_grade_g_t: d.grade }, assumptions, d.recovery).annualOz;
        const rev = oz * d.goldPrice;
        const opex = d.opex * annualTonnes / 1_000_000;
        const annualFcf = (rev * (1 - assumptions.royaltyFraction) - opex - assumptions.refineryChargeUsdOz * oz) / 1_000_000 - assumptions.workingCapitalFraction * d.capex;
        const annuityFactor = (1 - Math.pow(1 + discRate, -lomYears)) / discRate;
        return annualFcf * annuityFactor - d.capex;
      }, 3000, 25);

      setMcResult({
        p5Npv: result.p5, p50Npv: result.p50, p95Npv: result.p95,
        meanNpv: result.mean,
        atRisk: result.p5 < 0 ? Math.abs(result.p5) : 0,
        histogram: result.histogram,
      });
    } finally { setRunningMC(false); }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Registre des Risques"
        subtitle={`${displayRisks.length} risques identifiés · ${project.name}`}
        breadcrumb={['Économie & Risques', 'Registre']}
        actions={
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={handleGenerate} disabled={generating}>
              {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {generating ? 'Analyse…' : 'Générer'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={startNew}>
              <Plus size={14} /> Ajouter risque
            </button>
          </div>
        }
      />

      <div className="px-8 py-6 space-y-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Critique', val: counts.critical, color: 'text-red-400', sub: 'Score ≥ 15' },
            { label: 'Élevé', val: counts.high, color: 'text-orange-400', sub: 'Score 8–14' },
            { label: 'Modéré', val: counts.medium, color: 'text-amber-400', sub: 'Score 4–7' },
            { label: 'Faible', val: counts.low, color: 'text-emerald-400', sub: 'Score < 4' },
          ].map(s => (
            <div key={s.label} className="card-sm text-center">
              <div className={`text-3xl font-bold font-mono ${s.color}`}>{s.val}</div>
              <div className="text-sm text-mf-txt2 mt-1 font-medium">{s.label}</div>
              <div className="text-xs text-mf-txt4">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className="tab-bar">
          <button className={`tab ${activeTab === 'register' ? 'active' : ''}`} onClick={() => setActiveTab('register')}>Registre</button>
          <button className={`tab ${activeTab === 'matrix' ? 'active' : ''}`} onClick={() => setActiveTab('matrix')}>Matrice de risques</button>
          <button className={`tab ${activeTab === 'quantitative' ? 'active' : ''}`} onClick={() => setActiveTab('quantitative')}>Analyse quantitative</button>
        </div>

        {activeTab === 'register' && (
          <>
            <div className="flex gap-3">
              <select className="input-field w-40" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">Tous statuts</option>
                <option value="open">Ouvert</option>
                <option value="mitigated">Atténué</option>
                <option value="closed">Fermé</option>
              </select>
              <select className="input-field w-44" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                <option value="">Toutes catégories</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="card overflow-hidden p-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Description</th><th>Catégorie</th>
                    <th className="text-right">Prob.</th><th className="text-right">Impact</th>
                    <th className="text-right">Score</th><th>Sévérité</th><th>Statut</th>
                    <th>Atténuation</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <ShieldAlert size={28} className="text-mf-border" />
                          <p className="text-sm font-medium text-mf-txt3">
                            {risks.length === 0
                              ? 'Aucun risque enregistré — cliquez sur "Ajouter risque" ou utilisez "Générer".'
                              : 'Aucun risque correspond aux filtres.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filtered.map(r => {
                    const cfg = riskColor(r.probability, r.impact);
                    return (
                      <tr key={r.id}>
                        <td className="max-w-xs"><span className="text-mf-txt text-sm">{r.description}</span></td>
                        <td><span className="badge badge-purple text-[10px]">{r.category}</span></td>
                        <td className="num">{r.probability}</td>
                        <td className="num">{r.impact}</td>
                        <td className={`num font-bold ${cfg.text}`}>{r.probability * r.impact}</td>
                        <td><span className={`badge ${cfg.badge}`}>{cfg.label}</span></td>
                        <td>
                          <span className={`badge ${r.status === 'open' ? 'badge-orange' : r.status === 'mitigated' ? 'badge-teal' : 'badge-gray'}`}>
                            {r.status === 'open' ? 'Ouvert' : r.status === 'mitigated' ? 'Atténué' : 'Fermé'}
                          </span>
                        </td>
                        <td className="text-xs text-mf-txt3 max-w-xs truncate">{r.mitigation ?? '—'}</td>
                        <td>
                          <div className="flex gap-1">
                            <button className="text-mf-txt4 hover:text-mf-txt p-1" onClick={() => startEdit(r)}>
                              <Edit3 size={12} />
                            </button>
                            <button className="text-mf-txt4 hover:text-red-400 p-1" onClick={() => handleDelete(r.id)}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {activeTab === 'matrix' && (
          <div className="card">
            <div className="section-title mb-2">Matrice Impact × Probabilité</div>
            <div className="section-sub mb-6">{displayRisks.length} risques positionnés</div>
            <div className="grid grid-cols-6 gap-1 text-xs">
              <div />
              {[1,2,3,4,5].map(i => (
                <div key={i} className="text-center text-mf-txt4 pb-1">{IMPACT_LABELS[i].slice(0, 6)}.</div>
              ))}
              {[5,4,3,2,1].map(p => (
                [
                  <div key={`label-${p}`} className="flex items-center justify-end pr-2 text-mf-txt4">{PROB_LABELS[p].slice(0, 6)}.</div>,
                  ...[1,2,3,4,5].map(i => {
                    const score = p * i;
                    const bg = score >= 15 ? 'bg-red-500/25 border-red-500/30'
                             : score >= 8  ? 'bg-orange-500/20 border-orange-500/30'
                             : score >= 4  ? 'bg-amber-500/15 border-amber-500/25'
                             :               'bg-emerald-500/10 border-emerald-500/20';
                    const cellRisks = displayRisks.filter(r => r.probability === p && r.impact === i);
                    return (
                      <div key={`${p}-${i}`}
                        className={`border rounded h-14 flex flex-col items-center justify-center gap-0.5 ${bg}`}
                        title={cellRisks.map(r => r.description).join('\n')}
                      >
                        <span className="text-sm font-bold text-mf-txt3">{score}</span>
                        {cellRisks.length > 0 && (
                          <span className="text-[10px] font-bold text-white bg-mf-txt4/30 rounded px-1">{cellRisks.length}</span>
                        )}
                      </div>
                    );
                  })
                ]
              ))}
            </div>
            <div className="flex gap-4 mt-4 text-xs text-mf-txt4">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-500/40" /> Critique (≥15)</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-orange-500/35" /> Élevé (8–14)</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500/30" /> Modéré (4–7)</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500/20" /> Faible (&lt;4)</div>
            </div>
          </div>
        )}

        {activeTab === 'quantitative' && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="section-title">VaR projet — Monte Carlo NPV</div>
                <div className="section-sub">Simulation stochastique: prix or, teneur, récupération, OPEX, CAPEX</div>
              </div>
              <button className="btn btn-primary btn-sm" onClick={runQuantitative} disabled={runningMC}>
                {runningMC ? <><RefreshCw size={14} className="animate-spin" /> Simulation…</> : <><BarChart3 size={14} /> Lancer 3000 itérations</>}
              </button>
            </div>

            {mcResult && (
              <>
                <div className="grid grid-cols-4 gap-3">
                  <div className="card-sm text-center">
                    <div className="text-[10px] text-mf-txt4 mb-1">NPV P5 (pessimiste)</div>
                    <div className={`text-xl font-bold font-mono ${mcResult.p5Npv < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {formatDecimalGrouped(mcResult.p5Npv, 0)} M$
                    </div>
                  </div>
                  <div className="card-sm text-center">
                    <div className="text-[10px] text-mf-txt4 mb-1">NPV P50 (médian)</div>
                    <div className="text-xl font-bold font-mono text-mf-txt">
                      {formatDecimalGrouped(mcResult.p50Npv, 0)} M$
                    </div>
                  </div>
                  <div className="card-sm text-center">
                    <div className="text-[10px] text-mf-txt4 mb-1">NPV P95 (optimiste)</div>
                    <div className="text-xl font-bold font-mono text-emerald-400">
                      {formatDecimalGrouped(mcResult.p95Npv, 0)} M$
                    </div>
                  </div>
                  <div className="card-sm text-center">
                    <div className="text-[10px] text-mf-txt4 mb-1">VaR (Value at Risk)</div>
                    <div className={`text-xl font-bold font-mono ${mcResult.atRisk > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {formatDecimalGrouped(mcResult.atRisk, 0)} M$
                    </div>
                  </div>
                </div>

                {mcResult.atRisk > 0 && (
                  <div className="card-sm border-red-500/30 bg-red-500/5 flex items-start gap-3">
                    <TrendingDown size={16} className="text-red-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-sm font-semibold text-red-400">VaR positive détectée</div>
                      <div className="text-xs text-red-300/80 mt-0.5">
                        Au 5e percentile, le NPV projeté est négatif ({formatDecimalGrouped(mcResult.atRisk, 0)} M$ de perte potentielle).
                        Recommandation: renforcer la couverture prix, optimiser l'OPEX, ou revoir le plan LOM.
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-xs text-mf-txt4 mb-2">Distribution NPV (3000 itérations)</div>
                  <div className="flex items-end gap-1 h-32">
                    {mcResult.histogram.map((count, i) => {
                      const maxCount = Math.max(...mcResult.histogram);
                      const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
                      const isNeg = i < mcResult.histogram.length * 0.3;
                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-t ${isNeg ? 'bg-red-500/40' : 'bg-amber-500/50'}`}
                          style={{ height: `${height}%` }}
                          title={`${count} itérations`}
                        />
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {!mcResult && !runningMC && (
              <div className="flex flex-col items-center gap-2 py-8">
                <BarChart3 size={28} className="text-mf-border" />
                <p className="text-sm text-mf-txt3">
                  Lancez la simulation pour calculer la Value-at-Risk du projet
                  à partir des paramètres économiques et LIMS.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <Modal
          title={editRisk ? 'Modifier le risque' : 'Ajouter un risque'}
          onClose={() => setShowModal(false)}
          width="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}><X size={14} /> Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.description}>
                {saving ? '…' : editRisk ? 'Enregistrer' : 'Ajouter'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="label">Description du risque *</label>
              <textarea className="input-field h-20 resize-none" placeholder="Décrivez le risque..."
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Catégorie</label>
                <select className="input-field" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Statut</label>
                <select className="input-field" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as Risk['status'] }))}>
                  <option value="open">Ouvert</option>
                  <option value="mitigated">Atténué</option>
                  <option value="closed">Fermé</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Probabilité (1–5) : {form.probability} — {PROB_LABELS[form.probability]}</label>
                <input type="range" min="1" max="5" value={form.probability} onChange={e => setForm(f => ({ ...f, probability: Number(e.target.value) as Risk['probability'] }))} className="w-full accent-amber-500" />
              </div>
              <div>
                <label className="label">Impact (1–5) : {form.impact} — {IMPACT_LABELS[form.impact]}</label>
                <input type="range" min="1" max="5" value={form.impact} onChange={e => setForm(f => ({ ...f, impact: Number(e.target.value) as Risk['impact'] }))} className="w-full accent-amber-500" />
              </div>
            </div>
            <div className={`p-3 rounded-lg border text-sm font-medium ${riskColor(form.probability, form.impact).badge === 'badge-red' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
              Score de risque : <strong>{form.probability * form.impact}</strong> — {riskColor(form.probability, form.impact).label}
            </div>
            <div>
              <label className="label">Plan d'atténuation</label>
              <textarea className="input-field h-20 resize-none" placeholder="Mesures de mitigation..."
                value={form.mitigation} onChange={e => setForm(f => ({ ...f, mitigation: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
