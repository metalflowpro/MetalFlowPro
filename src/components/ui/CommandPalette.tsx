import { useState, useEffect, useMemo, useRef } from 'react';
import {
  LayoutDashboard, GitBranch, FlaskConical, Boxes, BarChart3,
  Layers, Cpu, Scale, Wrench, Activity, Mountain,
  TrendingUp, ShieldAlert, FileText, ClipboardList,
  Network, Pickaxe, LineChart, Search, CornerDownLeft,
  Plus, SlidersHorizontal, LogOut, FolderOpen, Drill,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ALL_NAV_ITEMS } from '../../lib/navConfig';
import type { Page } from '../../types';

const ICON_MAP: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, stagegates: GitBranch, drilling: Drill, lims: FlaskConical,
  resource: Layers, blockmodel: Boxes, analytics: BarChart3, granulometry: LineChart,
  criteria: Layers, flowsheet: Network, massbalance: Scale, equipment: Wrench,
  simulation: Activity, geomet: Mountain, mineopt: Pickaxe,
  cos: Cpu, economics: TrendingUp, risks: ShieldAlert, ni43101: FileText,
  reports: ClipboardList,
};

/** An action row is either a module jump or a project-level command. */
interface Command {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
}

export interface CommandPaletteActions {
  open: boolean;
  setOpen: (open: boolean) => void;
  onNavigate: (page: Page) => void;
  onNewProject: () => void;
  onEditProject: () => void;
  onBackToProjects: () => void;
  onSignOut: () => void;
}

/**
 * Global Ctrl/⌘+K launcher. Fuzzy-searches the 19 modules plus project-level
 * actions, navigable entirely from the keyboard (↑ ↓ Enter Esc). Open state is
 * lifted to App so a visible sidebar button can toggle it too. Mounted once
 * inside the authenticated Layout.
 */
export function CommandPalette({
  open, setOpen, onNavigate, onNewProject, onEditProject, onBackToProjects, onSignOut,
}: CommandPaletteActions) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global hotkey: Ctrl+K / ⌘+K toggles the palette from anywhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  // Reset transient state each time the palette opens; focus the input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = ALL_NAV_ITEMS.map(item => ({
      id: `nav:${item.id}`,
      label: item.label,
      hint: item.group,
      icon: ICON_MAP[item.icon] ?? Layers,
      keywords: `${item.label} ${item.group} ${item.id}`.toLowerCase(),
      run: () => onNavigate(item.id),
    }));
    const actions: Command[] = [
      { id: 'act:new',   label: 'Nouveau projet',            hint: 'Action', icon: Plus,             keywords: 'nouveau projet créer new',        run: onNewProject },
      { id: 'act:edit',  label: 'Paramètres du projet',      hint: 'Action', icon: SlidersHorizontal, keywords: 'paramètres réglages tonnage teneur settings', run: onEditProject },
      { id: 'act:back',  label: 'Retour à la liste projets', hint: 'Action', icon: FolderOpen,       keywords: 'projets liste retour back',       run: onBackToProjects },
      { id: 'act:out',   label: 'Déconnexion',               hint: 'Action', icon: LogOut,           keywords: 'déconnexion logout sortir quitter', run: onSignOut },
    ];
    return [...nav, ...actions];
  }, [onNavigate, onNewProject, onEditProject, onBackToProjects, onSignOut]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    // Every whitespace-separated token must appear — cheap, predictable fuzzy.
    const tokens = q.split(/\s+/);
    return commands.filter(c => tokens.every(t => c.keywords.includes(t)));
  }, [query, commands]);

  // Keep the cursor in range as results shrink.
  useEffect(() => { setCursor(c => Math.min(c, Math.max(0, results.length - 1))); }, [results.length]);

  function choose(cmd: Command | undefined) {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[cursor]);
    }
  }

  // Scroll the active row into view as the cursor moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
      style={{ animation: 'fadeIn 0.15s ease-out' }}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Palette de commandes"
    >
      <div
        className="w-full max-w-xl bg-mf-card border border-mf-border rounded-2xl shadow-card overflow-hidden"
        style={{ animation: 'slideUp 0.18s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-mf-border">
          <Search size={16} className="text-mf-txt4 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            placeholder="Aller à un module ou lancer une action…"
            className="flex-1 bg-transparent border-0 p-0 text-sm text-mf-txt placeholder-mf-txt4 focus:ring-0 focus:border-0"
            aria-label="Rechercher une commande"
            aria-controls="cmd-results"
          />
          <kbd className="text-[10px] text-mf-txt4 border border-mf-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} id="cmd-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-mf-txt4">Aucun résultat</div>
          ) : (
            results.map((cmd, i) => {
              const Icon = cmd.icon;
              const active = i === cursor;
              return (
                <button
                  key={cmd.id}
                  data-idx={i}
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(cmd)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    active ? 'bg-amber-500/10 text-amber-300' : 'text-mf-txt2 hover:bg-mf-hover/50'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-amber-400' : 'text-mf-txt4'} />
                  <span className="flex-1 text-sm truncate">{cmd.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-mf-txt4">{cmd.hint}</span>
                  {active && <CornerDownLeft size={13} className="text-amber-400/70" />}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-mf-border text-[10px] text-mf-txt4">
          <span className="flex items-center gap-1"><kbd className="border border-mf-border rounded px-1">↑</kbd><kbd className="border border-mf-border rounded px-1">↓</kbd> naviguer</span>
          <span className="flex items-center gap-1"><kbd className="border border-mf-border rounded px-1">↵</kbd> ouvrir</span>
          <span className="ml-auto">{results.length} résultat{results.length > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
