import {
  LayoutDashboard, GitBranch, FlaskConical, Boxes, BarChart3,
  Layers, Cpu, Scale, Wrench, Activity, Mountain,
  TrendingUp, ShieldAlert, FileText, ClipboardList,
  ChevronDown, Plus, LogOut, Beaker, Network, Pickaxe,
  ChevronLeft, LineChart, SlidersHorizontal, Search, Sun, Moon,
  PanelLeftClose, PanelLeftOpen, Drill,
} from 'lucide-react';
import { useTheme } from '../../lib/theme';
import type { LucideIcon } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { Page, Project } from '../../types';
import { NAV_GROUPS } from '../../lib/navConfig';

const ICON_MAP: Record<string, LucideIcon> = {
  dashboard:   LayoutDashboard,
  stagegates:  GitBranch,
  drilling:    Drill,
  lims:        FlaskConical,
  resource:    Layers,
  blockmodel:  Boxes,
  analytics:   BarChart3,
  granulometry: LineChart,
  criteria:    Layers,
  metparams:   SlidersHorizontal,
  flowsheet:   Network,
  massbalance: Scale,
  equipment:   Wrench,
  simulation:  Activity,
  geomet:      Mountain,
  mineopt:     Pickaxe,
  cos:         Cpu,
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
  onEditProject: () => void;
  onBackToProjects: () => void;
  onSignOut: () => void;
  onOpenSearch: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  user: SupabaseUser;
}

export function Sidebar({
  currentPage,
  onNavigate,
  projects,
  activeProject,
  onSelectProject,
  onNewProject,
  onEditProject,
  onBackToProjects,
  onSignOut,
  onOpenSearch,
  collapsed,
  onToggleCollapse,
  user,
}: SidebarProps) {
  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const initials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const { theme, toggle } = useTheme();

  return (
    <aside className={`no-print flex flex-col h-screen bg-mf-card border-r border-mf-border overflow-y-auto overflow-x-hidden transition-[width] duration-200 ${
      collapsed ? 'w-16 min-w-[64px]' : 'w-60 min-w-[240px]'
    }`}>
      {/* Brand + collapse toggle */}
      <div className={`flex items-center border-b border-mf-border py-5 ${collapsed ? 'flex-col gap-3 px-2' : 'gap-3 px-4'}`}>
        <div className="w-8 h-8 rounded-lg bg-gold-gradient flex items-center justify-center shadow-gold shrink-0">
          <Beaker size={16} className="text-mf-bg" />
        </div>
        {!collapsed && (
          <div className="flex-1">
            <div className="text-sm font-bold text-mf-txt tracking-wide">MetalFlow Pro</div>
            <div className="text-[10px] text-amber-500 font-medium uppercase tracking-widest">MPDPMS V4.0</div>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          title={collapsed ? 'Déplier' : 'Replier'}
          className="text-mf-txt4 hover:text-mf-txt2 transition-colors shrink-0"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Project selector — hidden when collapsed */}
      {!collapsed && (
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
        <div className="flex gap-2 mt-2">
          {activeProject && (
            <button
              onClick={onEditProject}
              title="Modifier les paramètres du projet (tonnage, teneur, etc.)"
              className="btn btn-sm btn-secondary justify-center text-[11px] px-2.5"
            >
              <SlidersHorizontal size={12} /> Paramètres
            </button>
          )}
          <button
            onClick={onNewProject}
            className="flex-1 btn btn-sm btn-secondary justify-center text-[11px]"
          >
            <Plus size={12} /> Nouveau projet
          </button>
        </div>
      </div>
      )}

      {/* Global search launcher (⌘K) */}
      <div className={collapsed ? 'px-2 pt-3' : 'px-3 pt-3'}>
        <button
          onClick={onOpenSearch}
          title="Rechercher (⌘K)"
          className={`w-full flex items-center rounded-lg bg-mf-panel border border-mf-border
                     text-xs text-mf-txt4 hover:text-mf-txt3 hover:border-mf-hover transition-colors ${
                       collapsed ? 'justify-center py-2' : 'gap-2 px-3 py-2'
                     }`}
        >
          <Search size={13} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Rechercher…</span>
              <kbd className="text-[10px] border border-mf-border rounded px-1 py-0.5">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="mb-1">
            {!collapsed && <div className="sidebar-group-label">{group.label}</div>}
            {group.items.map(item => {
              const Icon = ICON_MAP[item.icon];
              const active = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id as Page)}
                  title={collapsed ? item.label : undefined}
                  className={`nav-item w-full text-left ${active ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  {Icon && <Icon size={15} className={active ? 'text-amber-400' : 'text-mf-txt4'} />}
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User info footer */}
      <div className={`py-4 border-t border-mf-border ${collapsed ? 'px-2' : 'px-3'}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0"
                 title={`${displayName} · ${user.email}`}>
              <span className="text-[11px] font-bold text-amber-400">{initials}</span>
            </div>
            <button onClick={toggle} title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
                    aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
                    className="nav-item justify-center px-0 w-full text-mf-txt4 hover:text-amber-400">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button onClick={onSignOut} title="Déconnexion" aria-label="Déconnexion"
                    className="nav-item justify-center px-0 w-full text-mf-txt4 hover:text-mf-red">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg mb-2">
              <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-amber-400">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-mf-txt truncate">{displayName}</div>
                <div className="text-[10px] text-mf-txt4 truncate">{user.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onSignOut}
                className="nav-item flex-1 text-left text-mf-txt4 hover:text-mf-red"
              >
                <LogOut size={14} className="shrink-0" />
                <span>Déconnexion</span>
              </button>
              <button
                onClick={toggle}
                aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
                title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
                className="nav-item shrink-0 justify-center px-2.5 text-mf-txt4 hover:text-amber-400"
              >
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
