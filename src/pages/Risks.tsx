import { useState } from 'react';
import { Plus, ShieldAlert, Sparkles, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import type { Project, Risk } from '../types';

const CATEGORIES = ['Technique', 'Environnemental', 'Financier', 'Opérationnel', 'Réglementaire', 'Géopolitique', 'Social'];

const MOCK_RISKS: Omit<Risk, 'id' | 'project_id' | 'created_at'>[] = [
  { description: 'Variabilité de la teneur en or supérieure à ±20%',   category: 'Technique',    probability: 3, impact: 4, status: 'open',      mitigation: 'Densification programme LIMS et modélisation géostat' },
  { description: 'Dépas. coût CAPEX > 15% contingence',                category: 'Financier',    probability: 3, impact: 5, status: 'open',      mitigation: 'EPCM avec garantie performance, révision mensuelle' },
  { description: 'Non-conformité cyanure WAD > 2 mg/L résidus',         category: 'Environnemental', probability: 2, impact: 5, status: 'mitigated', mitigation: 'DETOX automatique, monitoring continu, plan urgence' },
  { description: 'Retard commandes équipements LLI > 6 mois',          category: 'Opérationnel', probability: 3, impact: 4, status: 'open',      mitigation: 'Commandes anticipées, fournisseurs alternatifs identifiés' },
  { description: 'Résistance communautés locales exploitation',          category: 'Social',       probability: 2, impact: 4, status: 'mitigated', mitigation: 'Plan FPIC, fonds développement communautaire 2%' },
  { description: 'Variabilité indice de broyage BWI ± 3 kWh/t',         category: 'Technique',    probability: 4, impact: 3, status: 'open',      mitigation: 'Campagne BWI étendue (30+ échantillons), facteur 1.2 design' },
  { description: 'Instabilité politique régionale',                      category: 'Géopolitique', probability: 2, impact: 5, status: 'open',      mitigation: 'Assurance investissement MIGA, structure off-shore' },
  { description: 'Prix or < $1 800 sur 18 mois',                         category: 'Financier',    probability: 2, impact: 4, status: 'open',      mitigation: 'Stratégie de couverture partielle 30% production an 1-3' },
  { description: 'Échec essais recyclage eau procédé',                   category: 'Environnemental', probability: 3, impact: 3, status: 'closed', mitigation: 'Système ETP validé, eau douce de secours disponible' },
  { description: 'Glissement talus parc à résidus TSF',                  category: 'Environnemental', probability: 2, impact: 5, status: 'open',   mitigation: 'Géotech suivi instruments TSF, évacuation d\'urgence' },
];

const PROB_LABELS = ['', 'Rare', 'Peu probable', 'Modéré', 'Probable', 'Quasi certain'];
const IMPACT_LABELS = ['', 'Négligeable', 'Faible', 'Modéré', 'Majeur', 'Catastrophique'];

function riskColor(p: number, i: number) {
  const score = p * i;
  if (score >= 15) return { text: 'text-red-400',     bg: 'bg-red-500',     badge: 'badge-red',    label: 'Critique' };
  if (score >= 8)  return { text: 'text-orange-400',  bg: 'bg-orange-500',  badge: 'badge-orange', label: 'Élevé'    };
  if (score >= 4)  return { text: 'text-amber-400',   bg: 'bg-amber-500',   badge: 'badge-gold',   label: 'Modéré'   };
  return              { text: 'text-emerald-400', bg: 'bg-emerald-500', badge: 'badge-green', label: 'Faible'   };
}

interface RisksProps { project: Project; risks: Risk[]; onRefresh: () => void; }

// ─── Auto-risk generation from project data ───────────────────────────────────

async function generateRisksFromProject(projectId: string): Promise<Omit<Risk, 'id' | 'project_id' | 'created_at'>[]> {
  const generated: Omit<Risk, 'id' | 'project_id' | 'created_at'>[] = [];

  // Pull data from multiple modules in parallel
  const [
    { data: limsLeach },
    { data: limsComm },
    { data: mineParams },
    { data: simRuns },
    { data: geoMetDomains },
  ] = await Promise.all([
    supabase.from('lims_test_leach').select('recovery_au,cn_consumption_kg_t,leach_time_h').eq('project_id', projectId).limit(50),
    supabase.from('lims_test_comminution').select('bwi_kwh_t').eq('project_id', projectId).limit(50),
    supabase.from('mine_params').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('sim_run_results').select('global_results,status').eq('project_id', projectId).order('created_at', { ascending: false }).limit(5),
    supabase.from('lims_test_leach').select('domain').eq('project_id', projectId).limit(100),
  ]);

  // ── Technique: LIMS recovery variability ─────────────────────────────────
  if (limsLeach && limsLeach.length >= 3) {
    const recoveries = limsLeach
      .map((r: { recovery_au: number | null }) => r.recovery_au)
      .filter((v): v is number => v != null);
    if (recoveries.length >= 3) {
      const mean = recoveries.reduce((a, b) => a + b, 0) / recoveries.length;
      const stdDev = Math.sqrt(recoveries.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recoveries.length);
      const cv = stdDev / mean;
      if (cv > 0.15) {
        generated.push({
          description: `Variabilité élevée de récupération Au LIMS (CV=${(cv * 100).toFixed(0)}%, moy=${mean.toFixed(1)}%) — risque sur prévision de production`,
          category: 'Technique', probability: 4, impact: 4, status: 'open',
          mitigation: 'Densifier la caractérisation par domaine géologique, tests sur composites représentatifs, modélisation variographique',
        });
      }
      // CN consumption high
      const cnVals = limsLeach
        .map((r: { cn_consumption_kg_t: number | null }) => r.cn_consumption_kg_t)
        .filter((v): v is number => v != null);
      if (cnVals.length > 0) {
        const maxCN = Math.max(...cnVals);
        if (maxCN > 2) {
          generated.push({
            description: `Consommation de cyanure élevée (max ${maxCN.toFixed(1)} kg/t NaCN) — impact opex et conformité WAD CN`,
            category: 'Environnemental', probability: 3, impact: 4, status: 'open',
            mitigation: 'Optimiser le pH (10.5–11), aération contrôlée, détox INCO SO₂/Air, monitoring WAD CN résidus ≤ 50 ppm',
          });
        }
      }
    }
  }

  // ── Technique: BWI variability ─────────────────────────────────────────
  if (limsComm && limsComm.length >= 3) {
    const bwis = limsComm
      .map((r: { bwi_kwh_t: number | null }) => r.bwi_kwh_t)
      .filter((v): v is number => v != null);
    if (bwis.length >= 3) {
      const maxBwi = Math.max(...bwis);
      const minBwi = Math.min(...bwis);
      if (maxBwi - minBwi > 5) {
        generated.push({
          description: `Forte variabilité BWI comminution (${minBwi.toFixed(1)}–${maxBwi.toFixed(1)} kWh/t) — sous-dimensionnement circuit broyage possible`,
          category: 'Technique', probability: 3, impact: 4, status: 'open',
          mitigation: `Campagne BWI étendue (≥30 éch.), facteur design 1.15×BWI max, tests SMC/DWT pour validation`,
        });
      }
      if (maxBwi > 18) {
        generated.push({
          description: `Minerai dur (BWI max ${maxBwi.toFixed(1)} kWh/t) — consommation énergétique circuit broyage sous-estimée`,
          category: 'Opérationnel', probability: 3, impact: 3, status: 'open',
          mitigation: 'Revoir puissance installée broyeurs, tests pilote, optimiser charge broyante et P80 cible',
        });
      }
    }
  }

  // ── Mine: production ramp-up risk ──────────────────────────────────────
  if (mineParams) {
    const mp = mineParams as { annual_production_kt?: number; strip_ratio?: number };
    if (mp.annual_production_kt && mp.annual_production_kt > 5000) {
      generated.push({
        description: `Production annuelle élevée (${(mp.annual_production_kt / 1000).toFixed(1)} Mt/an) — risque dépassement capacité traitement usine`,
        category: 'Opérationnel', probability: 3, impact: 4, status: 'open',
        mitigation: 'Valider capacité nominale usine vs débit mine, buffer stocks ROM, stratégie blending pour lisser les teneurs',
      });
    }
    if (mp.strip_ratio && mp.strip_ratio > 6) {
      generated.push({
        description: `Ratio de découverture élevé (${mp.strip_ratio.toFixed(1)} t/t) — OPEX mine susceptibles de dépasser prévisions`,
        category: 'Financier', probability: 3, impact: 4, status: 'open',
        mitigation: 'Revoir coupure économique et séquençage phases, optimiser transport déblais, analyse sensibilité prix or vs SR',
      });
    }
  }

  // ── Simulation: divergence / low recovery ─────────────────────────────
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
        description: `Récupération globale simulée faible (${overallRecovery.toFixed(1)}%) — objectif NPV potentiellement compromis`,
        category: 'Technique', probability: 3, impact: 5, status: 'open',
        mitigation: 'Investiguer minerai réfractaire, envisager prétraitement (POX/biox), prolonger temps de lixiviation, optimiser cyanuration',
      });
    }
    const cnInTailings = lastRun?.global_results?.cn_in_tailings;
    if (cnInTailings !== undefined && cnInTailings > 50) {
      generated.push({
        description: `Teneur CN dans résidus simulée ${cnInTailings.toFixed(0)} ppm — non-conformité réglementaire WAD CN probable`,
        category: 'Environnemental', probability: 4, impact: 5, status: 'open',
        mitigation: 'Circuit DETOX obligatoire (INCO SO₂/Air ou H₂O₂), cible ≤ 50 ppm WAD CN effluents, plan de surveillance continue',
      });
    }
  }

  // ── Domain count risk (geodiversity) ──────────────────────────────────
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

  // ── Financial: always-present gold price risk ─────────────────────────
  generated.push({
    description: 'Prix de l\'or < $1 800/oz sur 18 mois consécutifs — flux de trésorerie négatifs en période de montée en régime',
    category: 'Financier', probability: 2, impact: 5, status: 'open',
    mitigation: 'Couverture partielle 20–30% production an 1–3, financement structuré avec covenant OR, analyse sensibilité seuil de rentabilité',
  });

  // ── Regulatory ────────────────────────────────────────────────────────
  generated.push({
    description: 'Délai d\'obtention permis exploitation > 18 mois — impact sur calendrier et financement',
    category: 'Réglementaire', probability: 3, impact: 4, status: 'open',
    mitigation: 'Engagement précoce autorités, EIE complète avec FPIC communautaire, équipe permetting dédiée',
  });

  return generated;
}

export function Risks({ project, risks, onRefresh }: RisksProps) {
  const [showModal, setShowModal]       = useState(false);
  const [saving, setSaving]             = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCat, setFilterCat]       = useState('');
  const [activeTab, setActiveTab]       = useState<'register' | 'matrix'>('register');

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

  async function handleSave() {
    setSaving(true);
    try {
      await supabase.from('risks').insert({
        project_id:  project.id,
        description: form.description,
        category:    form.category,
        probability: form.probability,
        impact:      form.impact,
        mitigation:  form.mitigation || null,
        status:      form.status,
      });
      setShowModal(false);
      onRefresh();
    } finally { setSaving(false); }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const generated = await generateRisksFromProject(project.id);
      if (generated.length > 0) {
        await supabase.from('risks').insert(
          generated.map(r => ({ ...r, project_id: project.id }))
        );
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    }
    setGenerating(false);
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
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              <Plus size={14} /> Ajouter risque
            </button>
          </div>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Severity stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Critique',         val: counts.critical, color: 'text-red-400',    sub: 'Score ≥ 15' },
            { label: 'Élevé',            val: counts.high,     color: 'text-orange-400', sub: 'Score 8–14' },
            { label: 'Modéré',           val: counts.medium,   color: 'text-amber-400',  sub: 'Score 4–7' },
            { label: 'Faible',           val: counts.low,      color: 'text-emerald-400',sub: 'Score < 4' },
          ].map(s => (
            <div key={s.label} className="card-sm text-center">
              <div className={`text-3xl font-bold font-mono ${s.color}`}>{s.val}</div>
              <div className="text-sm text-mf-txt2 mt-1 font-medium">{s.label}</div>
              <div className="text-xs text-mf-txt4">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="tab-bar">
          <button className={`tab ${activeTab === 'register' ? 'active' : ''}`} onClick={() => setActiveTab('register')}>Registre</button>
          <button className={`tab ${activeTab === 'matrix'   ? 'active' : ''}`} onClick={() => setActiveTab('matrix')}>Matrice de risques</button>
        </div>

        {activeTab === 'register' && (
          <>
            {/* Filters */}
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

            {/* Table */}
            <div className="card overflow-hidden p-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Description du risque</th>
                    <th>Catégorie</th>
                    <th className="text-right">Prob.</th>
                    <th className="text-right">Impact</th>
                    <th className="text-right">Score</th>
                    <th>Sévérité</th>
                    <th>Statut</th>
                    <th>Atténuation</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <ShieldAlert size={28} className="text-mf-border" />
                          <p className="text-sm font-medium text-mf-txt3">
                            {risks.length === 0
                              ? 'Aucun risque enregistré — cliquez sur "Ajouter risque" ou utilisez "Générer" pour une analyse automatique.'
                              : 'Aucun risque correspond aux filtres sélectionnés.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  {filtered.map(r => {
                    const cfg = riskColor(r.probability, r.impact);
                    return (
                      <tr key={r.id}>
                        <td className="max-w-xs">
                          <span className="text-mf-txt text-sm">{r.description}</span>
                        </td>
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
            <div className="section-sub mb-6">
              {displayRisks.length} risques positionnés
            </div>
            <div className="grid grid-cols-6 gap-1 text-xs">
              {/* Header row */}
              <div />
              {[1,2,3,4,5].map(i => (
                <div key={i} className="text-center text-mf-txt4 pb-1">{IMPACT_LABELS[i].slice(0, 6)}.</div>
              ))}
              {/* Probability rows (high to low) */}
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
      </div>

      {showModal && (
        <Modal
          title="Ajouter un risque"
          onClose={() => setShowModal(false)}
          width="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.description}>
                {saving ? 'Enregistrement...' : 'Ajouter'}
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
