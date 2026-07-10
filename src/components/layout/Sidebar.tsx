import {
  LayoutDashboard, GitBranch, FlaskConical, Boxes, BarChart3,
  Layers, Cpu, Scale, Wrench, Activity, Mountain,
  TrendingUp, ShieldAlert, FileText, ClipboardList,
  ChevronDown, Plus, LogOut, Beaker, Network, Pickaxe,
  ChevronLeft, LineChart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Page, Project, NavGroup } from '../../types';

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Vue Exécutive',
    items: [
      { id: 'dashboard',   label: 'Tableau de bord',        icon: 'dashboard' },
      { id: 'stagegates',  label: 'Stage-Gates',             icon: 'stagegates' },
    ],
  },
  {
    label: 'Données',
    items: [
      { id: 'lims',         label: 'LIMS / Échantillons',     icon: 'lims' },
      { id: 'blockmodel',  label: 'Block Model',             icon: 'blockmodel' },
      { id: 'granulometry',label: 'Granulométrie / PSD',     icon: 'granulometry' },
      { id: 'analytics',   label: 'Analyse et Interprétation', icon: 'analytics' },
    ],
  },
  {
    label: 'Design Procédé',
    items: [
      { id: 'criteria',    label: 'Critères de conception',  icon: 'criteria' },
      { id: 'flowsheet',   label: 'Flowsheet Ingénierie',    icon: 'flowsheet' },
      { id: 'massbalance', label: 'Bilan massique & eau',    icon: 'massbalance' },
      { id: 'equipment',   label: 'Équipements',             icon: 'equipment' },
    ],
  },
  {
    label: 'Optimisation',
    items: [
      { id: 'circuitai',   label: 'MetaScore Intelligence', icon: 'circuitai' },
      { id: 'simulation',  label: 'Simulation Pro',          icon: 'simulation' },
      { id: 'geomet',      label: 'Géo-Métal. Intelligence', icon: 'geomet' },
      { id: 'mineopt',     label: 'Mine & Optimisation',     icon: 'mineopt' },
    ],
  },
  {
    label: 'Économie & Risques',
    items: [
      { id: 'economics',   label: 'Modèle Économique',       icon: 'economics' },
      { id: 'risks',       label: 'Registre des Risques',    icon: 'risks' },
    ],
  },
  {
    label: 'Conformité & Rapports',
    items: [
      { id: 'ni43101',     label: 'Rapport NI 43-101',       icon: 'ni43101' },
      { id: 'reports',     label: 'Rapports Interne/Ext.',   icon: 'reports' },
    ],
  },
];

const ICON_MAP: Record<string, LucideIcon> = {
  dashboard:   LayoutDashboard,
  stagegates:  GitBranch,
  lims:        FlaskConical,
  blockmodel:  Boxes,
  analytics:   BarChart3,
  granulometry: LineChart,
  criteria:    Layers,
  flowsheet:   Network,
  massbalance: Scale,
  equipment:   Wrench,
  circuitai:   Cpu,
  simulation:  Activity,
  geomet:      Mountain,
  mineopt:     Pickaxe,
  economics:   TrendingUp,
  risks:       ShieldAlert,
  ni43101:     FileText,
  reports:     ClipboardList,
};

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  projects: Project[];
  activeProject: Project | null;
  onSelectProject: (p: Project) => void;
  onNewProject: () => void;
  onBackToProjects: () => void;
  onSignOut: () => void;
  user: SupabaseUser;
}

export function Sidebar({
  currentPage,
  onNavigate,
  projects,
  activeProject,
  onSelectProject,
  onNewProject,
  onBackToProjects,
  onSignOut,
  user,
}: SidebarProps) {
  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <aside className="flex flex-col w-60 min-w-[240px] h-screen bg-mf-card border-r border-mf-border overflow-y-auto">
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-mf-border">
        <div className="w-8 h-8 rounded-lg bg-gold-gradient flex items-center justify-center shadow-gold">
          <Beaker size={16} className="text-mf-bg" />
        </div>
        <div>
          <div className="text-sm font-bold text-mf-txt tracking-wide">MetalFlow Pro</div>
          <div className="text-[10px] text-amber-500 font-medium uppercase tracking-widest">MPDPMS V4.0</div>
        </div>
      </div>

      {/* Project selector */}
      <div className="px-3 py-3 border-b border-mf-border">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-mf-txt4">
            Projet actif
          </div>
          <button
            onClick={onBackToProjects}
            className="flex items-center gap-1 text-[10px] text-mf-txt4 hover:text-mf-txt3 transition-colors"
          >
            <ChevronLeft size={10} />
            Projets
          </button>
        </div>
        {activeProject ? (
          <div className="relative">
            <select
              value={activeProject.id}
              onChange={e => {
                const p = projects.find(x => x.id === e.target.value);
                if (p) onSelectProject(p);
              }}
              className="w-full pl-3 pr-8 py-2.5 text-xs rounded-lg bg-mf-panel border border-mf-border
                         text-mf-txt cursor-pointer appearance-none"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-mf-txt4 pointer-events-none" />
          </div>
        ) : (
          <div className="text-xs text-mf-txt4 italic px-1 mb-1">Aucun projet</div>
        )}
        <button
          onClick={onNewProject}
          className="w-full mt-2 btn btn-sm btn-secondary justify-center text-[11px]"
        >
          <Plus size={12} /> Nouveau projet
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-1">
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(item => {
              const Icon = ICON_MAP[item.icon];
              const active = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id as Page)}
                  className={`nav-item w-full text-left ${active ? 'active' : ''}`}
                >
                  {Icon && <Icon size={15} className={active ? 'text-amber-400' : 'text-mf-txt4'} />}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User info footer */}
      <div className="px-3 py-4 border-t border-mf-border">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg mb-2">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-amber-400">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-mf-txt truncate">{displayName}</div>
            <div className="text-[10px] text-mf-txt4 truncate">{user.email}</div>
          </div>
        </div>
        <button
          onClick={onSignOut}
          className="nav-item w-full text-left text-mf-txt4 hover:text-mf-red"
        >
          <LogOut size={14} className="shrink-0" />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
