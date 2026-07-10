import { useState, useEffect } from 'react';
import { Layers } from 'lucide-react';
import { supabase } from './lib/supabase';
import { ProjectProvider } from './lib/ProjectContext';
import type { User } from '@supabase/supabase-js';
import { LandingPage } from './pages/LandingPage';
import { ProjectList } from './pages/ProjectList';
import { Layout } from './components/layout/Layout';
import { Modal } from './components/ui/Modal';
import { Dashboard } from './pages/Dashboard';
import { LIMS } from './pages/LIMS';
import { Flowsheet } from './pages/Flowsheet';
import { MassBalance } from './pages/MassBalance';
import { Equipment } from './pages/Equipment';
import Simulation from './pages/Simulation';
import { Economics } from './pages/Economics';
import { Risks } from './pages/Risks';
import { StageGates } from './pages/StageGates';
import { Reports } from './pages/Reports';
import { NI43101 } from './pages/NI43101';
import { Criteria } from './pages/Criteria';
import { CircuitAI } from './pages/CircuitAI';
import { GeoMet } from './pages/GeoMet';
import { MineOpt } from './pages/MineOpt';
import { Analytics } from './pages/Analytics';
import { Granulometry } from './pages/Granulometry';
import { BlockModel } from './pages/BlockModel';
import type { Page, Project, LimsSample, Risk, EquipmentItem } from './types';

const PHASES = ['SCOPING', 'PRE-FEASIBILITY', 'FEASIBILITY', 'BFS', 'DFS', 'CONSTRUCTION', 'COMMISSIONING'];

const EMPTY_FORM = {
  code: '', name: '', country: '', phase: 'SCOPING',
  target_tph: '' as unknown as number,
  gold_grade_g_t: '' as unknown as number,
  availability_pct: '' as unknown as number,
  recovery_pct: '' as unknown as number,
  ore_sg: '' as unknown as number,
  gold_price_usd: '' as unknown as number,
};

export default function App() {
  const [user, setUser]                   = useState<User | null>(null);
  const [authLoading, setAuthLoading]     = useState(true);
  const [currentPage, setCurrentPage]     = useState<Page>('dashboard');
  const [projects, setProjects]           = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [saving, setSaving]               = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [samples, setSamples]     = useState<LimsSample[]>([]);
  const [risks, setRisks]         = useState<Risk[]>([]);
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) { loadProjects(); }
    else { setProjects([]); setActiveProject(null); }
  }, [user]);

  useEffect(() => {
    if (activeProject) loadSubData(activeProject.id);
  }, [activeProject]);

  async function loadProjects() {
    setProjectsLoading(true);
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
    setProjects((data ?? []) as Project[]);
    setProjectsLoading(false);
  }

  async function loadSubData(projectId: string) {
    const [samplesRes, risksRes, equipRes] = await Promise.all([
      supabase.from('lims_samples').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('risks').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('equipment_items').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
    ]);
    setSamples((samplesRes.data ?? []) as LimsSample[]);
    setRisks((risksRes.data ?? []) as Risk[]);
    setEquipment((equipRes.data ?? []) as EquipmentItem[]);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setActiveProject(null);
    setProjects([]);
  }

  function validateForm(): string[] {
    const errs: string[] = [];
    if (!form.code.trim()) errs.push('Code projet requis');
    if (!form.name.trim()) errs.push('Nom du projet requis');
    if (!form.country.trim()) errs.push('Pays requis');
    if (!(form.target_tph > 0)) errs.push('Débit nominal > 0 requis');
    if (!(form.gold_grade_g_t > 0)) errs.push('Teneur Au > 0 requise');
    if (!(form.availability_pct > 0 && form.availability_pct <= 100)) errs.push('Disponibilité entre 0 et 100% requise');
    if (!(form.recovery_pct > 0 && form.recovery_pct <= 100)) errs.push('Récupération entre 0 et 100% requise');
    if (!(form.ore_sg > 0)) errs.push('Densité minerai > 0 requise');
    if (!(form.gold_price_usd > 0)) errs.push('Prix or > 0 requis');
    return errs;
  }

  function openEditProject(p: Project) {
    setForm({
      code: p.code,
      name: p.name,
      country: p.country,
      phase: p.phase,
      target_tph: p.target_tph as unknown as number,
      gold_grade_g_t: p.gold_grade_g_t as unknown as number,
      availability_pct: p.availability_pct as unknown as number,
      recovery_pct: p.recovery_pct as unknown as number,
      ore_sg: p.ore_sg as unknown as number,
      gold_price_usd: p.gold_price_usd as unknown as number,
    });
    setFormErrors([]);
    setEditingProjectId(p.id);
    setShowNewProjectModal(true);
  }

  async function handleSaveProject() {
    const errs = validateForm();
    if (errs.length) { setFormErrors(errs); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        country: form.country.trim(),
        phase: form.phase,
        target_tph: Number(form.target_tph),
        gold_grade_g_t: Number(form.gold_grade_g_t),
        availability_pct: Number(form.availability_pct),
        recovery_pct: Number(form.recovery_pct),
        ore_sg: Number(form.ore_sg),
        gold_price_usd: Number(form.gold_price_usd),
      };
      if (editingProjectId) {
        const { data } = await supabase.from('projects')
          .update(payload).eq('id', editingProjectId).select().maybeSingle();
        if (data) {
          await loadProjects();
          // Keep the edited project active if it is the one open.
          if (activeProject?.id === editingProjectId) setActiveProject(data as Project);
        }
      } else {
        const { data } = await supabase.from('projects').insert(payload).select().maybeSingle();
        if (data) {
          await loadProjects();
          setActiveProject(data as Project);
          setCurrentPage('dashboard');
        }
      }
      setShowNewProjectModal(false);
      setEditingProjectId(null);
      setForm(EMPTY_FORM);
      setFormErrors([]);
    } finally { setSaving(false); }
  }

  // Preview: only show if all numeric fields are filled
  const canPreview = Number(form.target_tph) > 0 && Number(form.gold_grade_g_t) > 0
    && Number(form.recovery_pct) > 0 && Number(form.availability_pct) > 0;
  const previewOz = canPreview
    ? Math.round(Number(form.target_tph) * Number(form.availability_pct) / 100 * 8760
        * Number(form.gold_grade_g_t) * Number(form.recovery_pct) / 100 / 31.1035 / 1000)
    : null;

  function renderPage() {
    if (!activeProject) return null;
    const refresh = () => loadSubData(activeProject.id);
    switch (currentPage) {
      case 'dashboard':    return <Dashboard    project={activeProject} />;
      case 'stagegates':   return <StageGates   project={activeProject} />;
      case 'lims':         return <LIMS         project={activeProject} samples={samples} onRefresh={refresh} />;
      case 'blockmodel':   return <BlockModel   project={activeProject} />;
      case 'analytics':    return <Analytics    project={activeProject} />;
      case 'granulometry': return <Granulometry project={activeProject} />;
      case 'criteria':     return <Criteria     project={activeProject} />;
      case 'flowsheet':    return <Flowsheet    project={activeProject} />;
      case 'massbalance':  return <MassBalance  project={activeProject} />;
      case 'equipment':    return <Equipment    project={activeProject} items={equipment} onRefresh={refresh} />;
      case 'circuitai':    return <CircuitAI    project={activeProject} />;
      case 'simulation':   return <Simulation   project={activeProject} />;
      case 'geomet':       return <GeoMet       project={activeProject} />;
      case 'mineopt':      return <MineOpt      project={activeProject} />;
      case 'economics':    return <Economics    project={activeProject} />;
      case 'risks':        return <Risks        project={activeProject} risks={risks} onRefresh={refresh} />;
      case 'ni43101':      return <NI43101      project={activeProject} />;
      case 'reports':      return <Reports      project={activeProject} />;
      default:             return <Dashboard    project={activeProject} />;
    }
  }

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-mf-bg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gold-gradient flex items-center justify-center shadow-gold">
            <Layers size={16} className="text-mf-bg" />
          </div>
          <div className="text-mf-txt2 animate-pulse">Chargement MetalFlow Pro…</div>
        </div>
      </div>
    );
  }

  if (!user) return <LandingPage onAuth={() => {}} />;

  if (!activeProject) {
    return (
      <>
        <ProjectList
          projects={projects}
          loading={projectsLoading}
          onSelectProject={p => { setActiveProject(p); setCurrentPage('dashboard'); }}
          onNewProject={() => { setEditingProjectId(null); setForm(EMPTY_FORM); setFormErrors([]); setShowNewProjectModal(true); }}
          onSignOut={handleSignOut}
          userEmail={user.email ?? ''}
        />
        {showNewProjectModal && renderNewProjectModal()}
      </>
    );
  }

  return (
    <ProjectProvider project={activeProject}>
      <Layout
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        projects={projects}
        activeProject={activeProject}
        onSelectProject={p => { setActiveProject(p); setCurrentPage('dashboard'); }}
        onNewProject={() => { setEditingProjectId(null); setForm(EMPTY_FORM); setFormErrors([]); setShowNewProjectModal(true); }}
        onEditProject={() => activeProject && openEditProject(activeProject)}
        onBackToProjects={() => setActiveProject(null)}
        onSignOut={handleSignOut}
        user={user}
      >
        {renderPage()}
      </Layout>
      {showNewProjectModal && renderNewProjectModal()}
    </ProjectProvider>
  );

  function renderNewProjectModal() {
    const isEditing = editingProjectId != null;
    const closeModal = () => { setShowNewProjectModal(false); setEditingProjectId(null); setFormErrors([]); };
    return (
      <Modal
        title={isEditing ? 'Modifier les paramètres du projet' : 'Nouveau projet métallurgique'}
        subtitle={isEditing ? 'Ajustez le tonnage, la teneur et les autres paramètres procédé' : 'Tous les champs sont requis — aucune valeur par défaut'}
        onClose={closeModal}
        width="lg"
        footer={
          <>
            <button className="btn btn-secondary" onClick={closeModal}>Annuler</button>
            <button className="btn btn-primary" onClick={handleSaveProject} disabled={saving}>
              {saving ? 'Enregistrement…' : isEditing ? 'Enregistrer les modifications' : 'Créer le projet'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formErrors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 space-y-1">
              {formErrors.map(e => (
                <div key={e} className="text-xs text-red-400 flex items-center gap-1.5">
                  <span className="text-red-500">•</span> {e}
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Code projet *</label>
              <input className="input-field font-mono" placeholder="ex. KMG-001"
                value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="label">Nom du projet *</label>
              <input className="input-field" placeholder="ex. Mine de Kumasi — Zone Nord"
                value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Pays *</label>
              <input className="input-field" placeholder="ex. Ghana, Mali, Côte d'Ivoire"
                value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
            </div>
            <div>
              <label className="label">Phase de projet *</label>
              <select className="input-field" value={form.phase}
                onChange={e => setForm(f => ({ ...f, phase: e.target.value }))}>
                {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="border-t border-mf-border pt-2">
            <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">
              Paramètres procédé <span className="text-red-400 font-normal normal-case">— tous requis</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { key: 'target_tph',       label: 'Débit nominal (t/h)',    type: 'number', step: '1',    placeholder: 'ex. 250' },
                { key: 'gold_grade_g_t',   label: 'Teneur Au (g/t)',        type: 'number', step: '0.01', placeholder: 'ex. 1.85' },
                { key: 'recovery_pct',     label: 'Récupération (%)',       type: 'number', step: '0.1',  placeholder: 'ex. 88.5' },
                { key: 'availability_pct', label: 'Disponibilité (%)',      type: 'number', step: '0.1',  placeholder: 'ex. 91.0' },
                { key: 'ore_sg',           label: 'Densité minerai (t/m³)', type: 'number', step: '0.01', placeholder: 'ex. 2.75' },
                { key: 'gold_price_usd',   label: 'Prix or (USD/oz)',       type: 'number', step: '10',   placeholder: 'ex. 2300' },
              ].map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
                    className="input-field font-mono"
                    type={f.type} step={f.step} placeholder={f.placeholder}
                    value={(form as Record<string, unknown>)[f.key] as string}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
          {canPreview && previewOz != null && (
            <div className="p-3 bg-amber-500/8 border border-amber-500/15 rounded-lg">
              <div className="text-xs text-mf-txt4 mb-1">Aperçu production (basé sur vos valeurs) :</div>
              <div className="text-sm font-mono text-amber-400">
                ~{previewOz} koz Au/an à {Number(form.availability_pct)}% disponibilité
              </div>
              <div className="text-xs text-mf-txt4 mt-0.5">
                Note: heures/an et paramètres financiers à configurer dans Paramètres du projet
              </div>
            </div>
          )}
        </div>
      </Modal>
    );
  }
}
