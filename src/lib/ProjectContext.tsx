import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Project } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSettings {
  id?: string;
  hours_per_year: number | null;
  discount_rate_pct: number | null;
  sustaining_capex_musd_yr: number | null;
  contingency_pct: number | null;
  lom_years: number | null;
  debt_equity_ratio_pct: number | null;
  grid_ef_kg_co2_kwh: number | null;
  nacn_co2_factor: number | null;
  cao_co2_factor: number | null;
  diesel_co2_l: number | null;
  refinery_charge_usd_oz: number | null;
  royalty_pct: number | null;
  working_capital_pct: number | null;
  smelting_charge_pct: number | null;
}

export interface ModuleStatus {
  module_id: string;
  completion_pct: number;
  record_count: number;
  last_updated: string | null;
  is_linked: boolean;
  linked_from: string[] | null;
  metadata: Record<string, unknown> | null;
}

export interface LimsCampaign {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  sample_count_target: number | null;
  is_active: boolean;
}

export interface LimsDomain {
  id: string;
  name: string;
  code: string | null;
  color: string;
  description: string | null;
}

export interface ProcessFactor {
  id: string;
  equipment_type: string;
  energy_kwh_t: number | null;
  nacn_kg_t: number | null;
  cao_kg_t: number | null;
  water_m3_t: number | null;
  balls_kg_t: number | null;
  source: string;
  notes: string | null;
}

export interface CapexLine {
  id: string;
  category: string;
  sub_category: string | null;
  description: string;
  value_musd: number;
  contingency_pct: number;
  source: string;
  notes: string | null;
  sort_order: number;
}

export interface OpexLine {
  id: string;
  category: string;
  description: string;
  value_usd_t: number;
  source: string;
  notes: string | null;
  sort_order: number;
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface ProjectContextValue {
  project: Project;
  settings: ProjectSettings | null;
  moduleStatuses: ModuleStatus[];
  campaigns: LimsCampaign[];
  domains: LimsDomain[];
  processFactors: ProcessFactor[];
  capexLines: CapexLine[];
  opexLines: OpexLine[];
  loading: boolean;

  saveSettings: (s: Partial<ProjectSettings>) => Promise<void>;
  upsertModuleStatus: (moduleId: string, patch: Partial<ModuleStatus>) => Promise<void>;
  addCampaign: (name: string, opts?: Partial<LimsCampaign>) => Promise<LimsCampaign | null>;
  deleteCampaign: (id: string) => Promise<void>;
  addDomain: (name: string, opts?: Partial<LimsDomain>) => Promise<LimsDomain | null>;
  deleteDomain: (id: string) => Promise<void>;
  upsertProcessFactor: (equip: string, patch: Partial<ProcessFactor>) => Promise<void>;
  addCapexLine: (line: Omit<CapexLine, 'id' | 'sort_order'>) => Promise<CapexLine | null>;
  updateCapexLine: (id: string, patch: Partial<CapexLine>) => Promise<void>;
  deleteCapexLine: (id: string) => Promise<void>;
  addOpexLine: (line: Omit<OpexLine, 'id' | 'sort_order'>) => Promise<OpexLine | null>;
  updateOpexLine: (id: string, patch: Partial<OpexLine>) => Promise<void>;
  deleteOpexLine: (id: string) => Promise<void>;
  refresh: () => Promise<void>;

  // Derived / synergy helpers
  getModuleStatus: (id: string) => ModuleStatus | null;
  totalCapex: number;
  totalOpex: number;
  annualProduction: number; // troy oz/yr derived from project + settings
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ProjectProvider({ project, children }: { project: Project; children: ReactNode }) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [moduleStatuses, setModuleStatuses] = useState<ModuleStatus[]>([]);
  const [campaigns, setCampaigns] = useState<LimsCampaign[]>([]);
  const [domains, setDomains] = useState<LimsDomain[]>([]);
  const [processFactors, setProcessFactors] = useState<ProcessFactor[]>([]);
  const [capexLines, setCapexLines] = useState<CapexLine[]>([]);
  const [opexLines, setOpexLines] = useState<OpexLine[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const pid = project.id;
    const [settRes, modRes, camRes, domRes, pfRes, cxRes, oxRes] = await Promise.all([
      supabase.from('project_settings').select('*').eq('project_id', pid).maybeSingle(),
      supabase.from('module_status').select('*').eq('project_id', pid),
      supabase.from('lims_campaigns').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('lims_domains').select('*').eq('project_id', pid).order('name'),
      supabase.from('process_factors').select('*').eq('project_id', pid).order('equipment_type'),
      supabase.from('capex_lines').select('*').eq('project_id', pid).order('sort_order'),
      supabase.from('opex_lines').select('*').eq('project_id', pid).order('sort_order'),
    ]);
    if (settRes.data) setSettings(settRes.data as ProjectSettings);
    else setSettings(null);
    setModuleStatuses((modRes.data ?? []) as ModuleStatus[]);
    setCampaigns((camRes.data ?? []) as LimsCampaign[]);
    setDomains((domRes.data ?? []) as LimsDomain[]);
    setProcessFactors((pfRes.data ?? []) as ProcessFactor[]);
    setCapexLines((cxRes.data ?? []) as CapexLine[]);
    setOpexLines((oxRes.data ?? []) as OpexLine[]);
    setLoading(false);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  async function saveSettings(patch: Partial<ProjectSettings>) {
    const merged = { ...settings, ...patch } as ProjectSettings;
    const payload = { project_id: project.id, ...merged, updated_at: new Date().toISOString() };
    if (settings?.id) {
      await supabase.from('project_settings').update(payload).eq('id', settings.id);
    } else {
      const { data } = await supabase.from('project_settings').insert(payload).select('*').maybeSingle();
      if (data) setSettings(data as ProjectSettings);
      return;
    }
    setSettings(merged);
  }

  async function upsertModuleStatus(moduleId: string, patch: Partial<ModuleStatus>) {
    const existing = moduleStatuses.find(m => m.module_id === moduleId);
    const payload = {
      project_id: project.id,
      module_id: moduleId,
      completion_pct: patch.completion_pct ?? existing?.completion_pct ?? 0,
      record_count: patch.record_count ?? existing?.record_count ?? 0,
      last_updated: new Date().toISOString(),
      is_linked: patch.is_linked ?? existing?.is_linked ?? false,
      linked_from: patch.linked_from ?? existing?.linked_from ?? null,
      metadata: patch.metadata ?? existing?.metadata ?? null,
    };
    await supabase.from('module_status').upsert(payload, { onConflict: 'project_id,module_id' });
    setModuleStatuses(prev => {
      const idx = prev.findIndex(m => m.module_id === moduleId);
      const updated = { ...payload } as ModuleStatus;
      if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
      return [...prev, updated];
    });
  }

  async function addCampaign(name: string, opts: Partial<LimsCampaign> = {}) {
    const { data } = await supabase.from('lims_campaigns').insert({
      project_id: project.id, name, ...opts,
    }).select('*').maybeSingle();
    if (data) setCampaigns(prev => [...prev, data as LimsCampaign]);
    return data as LimsCampaign | null;
  }

  async function deleteCampaign(id: string) {
    await supabase.from('lims_campaigns').delete().eq('id', id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
  }

  async function addDomain(name: string, opts: Partial<LimsDomain> = {}) {
    const { data } = await supabase.from('lims_domains').insert({
      project_id: project.id, name, ...opts,
    }).select('*').maybeSingle();
    if (data) setDomains(prev => [...prev, data as LimsDomain]);
    return data as LimsDomain | null;
  }

  async function deleteDomain(id: string) {
    await supabase.from('lims_domains').delete().eq('id', id);
    setDomains(prev => prev.filter(d => d.id !== id));
  }

  async function upsertProcessFactor(equip: string, patch: Partial<ProcessFactor>) {
    const existing = processFactors.find(p => p.equipment_type === equip);
    const payload = { project_id: project.id, equipment_type: equip, ...patch, updated_at: new Date().toISOString() };
    const { data } = await supabase.from('process_factors')
      .upsert(payload, { onConflict: 'project_id,equipment_type' })
      .select('*').maybeSingle();
    if (data) {
      setProcessFactors(prev => {
        const idx = prev.findIndex(p => p.equipment_type === equip);
        const next = [...prev];
        if (idx >= 0) { next[idx] = data as ProcessFactor; } else { next.push(data as ProcessFactor); }
        return next;
      });
    }
  }

  async function addCapexLine(line: Omit<CapexLine, 'id' | 'sort_order'>) {
    const maxOrder = capexLines.reduce((m, l) => Math.max(m, l.sort_order), 0);
    const { data } = await supabase.from('capex_lines').insert({
      project_id: project.id, ...line, sort_order: maxOrder + 1,
    }).select('*').maybeSingle();
    if (data) setCapexLines(prev => [...prev, data as CapexLine]);
    return data as CapexLine | null;
  }

  async function updateCapexLine(id: string, patch: Partial<CapexLine>) {
    await supabase.from('capex_lines').update(patch).eq('id', id);
    setCapexLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  async function deleteCapexLine(id: string) {
    await supabase.from('capex_lines').delete().eq('id', id);
    setCapexLines(prev => prev.filter(l => l.id !== id));
  }

  async function addOpexLine(line: Omit<OpexLine, 'id' | 'sort_order'>) {
    const maxOrder = opexLines.reduce((m, l) => Math.max(m, l.sort_order), 0);
    const { data } = await supabase.from('opex_lines').insert({
      project_id: project.id, ...line, sort_order: maxOrder + 1,
    }).select('*').maybeSingle();
    if (data) setOpexLines(prev => [...prev, data as OpexLine]);
    return data as OpexLine | null;
  }

  async function updateOpexLine(id: string, patch: Partial<OpexLine>) {
    await supabase.from('opex_lines').update(patch).eq('id', id);
    setOpexLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  async function deleteOpexLine(id: string) {
    await supabase.from('opex_lines').delete().eq('id', id);
    setOpexLines(prev => prev.filter(l => l.id !== id));
  }

  function getModuleStatus(id: string): ModuleStatus | null {
    return moduleStatuses.find(m => m.module_id === id) ?? null;
  }

  const totalCapex = capexLines.reduce((s, l) => s + l.value_musd * (1 + l.contingency_pct / 100), 0);
  const totalOpex = opexLines.reduce((s, l) => s + l.value_usd_t, 0);
  const hoursPerYear = settings?.hours_per_year ?? null;
  const annualTonnes = hoursPerYear != null ? project.target_tph * hoursPerYear * (project.availability_pct / 100) : null;
  const annualProduction = annualTonnes != null
    ? annualTonnes * project.gold_grade_g_t * (project.recovery_pct / 100) / 31.1035
    : 0;

  return (
    <ProjectContext.Provider value={{
      project, settings, moduleStatuses, campaigns, domains, processFactors,
      capexLines, opexLines, loading,
      saveSettings, upsertModuleStatus,
      addCampaign, deleteCampaign,
      addDomain, deleteDomain,
      upsertProcessFactor,
      addCapexLine, updateCapexLine, deleteCapexLine,
      addOpexLine, updateOpexLine, deleteOpexLine,
      refresh: load,
      getModuleStatus,
      totalCapex, totalOpex, annualProduction,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}
