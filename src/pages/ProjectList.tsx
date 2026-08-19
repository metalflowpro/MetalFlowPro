import { useState, useMemo } from 'react';
import {
  Layers, Plus, LogOut, FlaskConical, Activity,
  TrendingUp, ChevronRight, Search, Globe, Mountain, Trash2, Check, X, ShieldCheck,
} from 'lucide-react';
import type { Project } from '../types';
import { HOURS_PER_YEAR, TROY_OZ_GRAMS } from '../lib/config/constants';
import { usePortfolioRecovery } from '../lib/analytics/usePortfolioRecovery';

const PHASE_COLORS: Record<string, string> = {
  SCOPING:        'bg-mf-txt4/20 text-mf-txt4 border-mf-txt4/20',
  'PRE-FEASIBILITY': 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  FEASIBILITY:    'bg-amber-500/15 text-amber-400 border-amber-500/25',
  BFS:            'bg-orange-500/15 text-orange-400 border-orange-500/25',
  DFS:            'bg-purple-500/15 text-mf-purple border-purple-500/25',
  CONSTRUCTION:   'bg-teal-500/15 text-teal-400 border-teal-500/25',
  COMMISSIONING:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
};

const PHASES = ['SCOPING', 'PRE-FEASIBILITY', 'FEASIBILITY', 'BFS', 'DFS', 'CONSTRUCTION', 'COMMISSIONING'];

interface ProjectListProps {
  projects: Project[];
  onSelectProject: (p: Project) => void;
  onNewProject: () => void;
  onDeleteProject: (p: Project) => void | Promise<void>;
  onSignOut: () => void;
  userEmail: string;
  loading?: boolean;
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
}

export function ProjectList({
  projects,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onSignOut,
  userEmail,
  loading = false,
  isAdmin = false,
  onOpenAdmin,
}: ProjectListProps) {
  const [search, setSearch] = useState('');
  const [filterPhase, setFilterPhase] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Récupération LIMS (moyenne 48 h + globale alignée sur 48 h) de chaque projet.
  // Tant que le lot n'est pas chargé, chaque projet retombe sur sa récup. design.
  const { byProject: recByProject } = usePortfolioRecovery(projects);

  async function doDelete(p: Project) {
    setDeletingId(p.id);
    await onDeleteProject(p);
    setDeletingId(null);
    setConfirmDeleteId(null);
  }

  const filtered = projects.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase()) || p.country.toLowerCase().includes(search.toLowerCase());
    const matchPhase = !filterPhase || p.phase === filterPhase;
    return matchSearch && matchPhase;
  });

  const [sortBy, setSortBy] = useState<'name' | 'grade' | 'production' | 'recovery'>('name');

  // ── Portfolio benchmarking metrics ──────────────────────────────────────────
  const portfolio = useMemo(() => {
    if (projects.length === 0) return null;
    const totalOz = projects.reduce((a, p) => a + annualOz(p), 0);
    const avgGrade = projects.reduce((a, p) => a + p.gold_grade_g_t, 0) / projects.length;
    // Récup. moyenne = moyenne des GLOBALES (LIMS/48 h) quand elles existent,
    // repli design sinon — plus la récupération design brute d'avant.
    const effRecovery = (p: Project) => recByProject.get(p.id)?.effectiveRecoveryPct ?? p.recovery_pct;
    const avgRecovery = projects.reduce((a, p) => a + effRecovery(p), 0) / projects.length;
    // Combien de projets ont une globale réellement fondée sur les essais 48 h.
    const withLimsGlobal = projects.filter(p => recByProject.get(p.id)?.globalRecoveryPct != null).length;
    const totalTph = projects.reduce((a, p) => a + p.target_tph, 0);
    const bestProject = projects.reduce((best, p) => annualOz(p) > annualOz(best) ? p : best, projects[0]);
    const countries = new Set(projects.map(p => p.country)).size;
    return { totalOz, avgGrade, avgRecovery, withLimsGlobal, totalTph, bestProject, countries, count: projects.length };
  }, [projects, recByProject]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'grade') arr.sort((a, b) => b.gold_grade_g_t - a.gold_grade_g_t);
    if (sortBy === 'production') arr.sort((a, b) => annualOz(b) - annualOz(a));
    if (sortBy === 'recovery') arr.sort((a, b) => b.recovery_pct - a.recovery_pct);
    return arr;
  }, [filtered, sortBy]);

  function annualOz(p: Project) {
    return Math.round(
      (p.target_tph * (p.availability_pct / 100) * HOURS_PER_YEAR * p.gold_grade_g_t * (p.recovery_pct / 100)) / TROY_OZ_GRAMS / 1000
    );
  }

  return (
    <div className="min-h-screen bg-mf-bg flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-4 bg-mf-card border-b border-mf-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
            <Layers size={18} className="text-[#0A0E17]" />
          </div>
          <div>
            <div className="text-sm font-bold text-mf-txt tracking-wide leading-tight">MetalFlow Pro</div>
            <div className="text-[9px] font-semibold text-amber-500 uppercase tracking-widest">MPDPMS V4.0</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && onOpenAdmin && (
            <button
              onClick={onOpenAdmin}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 text-xs text-amber-300 hover:bg-amber-500/10 transition-all"
            >
              <ShieldCheck size={13} />
              Administration
            </button>
          )}
          <div className="text-xs text-mf-txt3">{userEmail}</div>
          <button
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-mf-border text-xs text-mf-txt3 hover:text-mf-txt hover:bg-mf-hover transition-all"
          >
            <LogOut size={13} />
            Déconnexion
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-6xl mx-auto w-full px-8 py-10">
        {/* Title row */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-mf-txt">Projets aurifères</h1>
            <p className="text-sm text-mf-txt3 mt-1">
              {projects.length} projet{projects.length !== 1 ? 's' : ''} · Plateforme MetalFlow Pro
            </p>
          </div>
          <button onClick={onNewProject} className="btn btn-primary gap-2">
            <Plus size={16} />
            Nouveau projet
          </button>
        </div>

        {/* Portfolio benchmarking strip */}
        {portfolio && (
          <div className="grid grid-cols-6 gap-3 mb-6">
            <div className="rounded-xl border border-mf-border bg-mf-card p-3 text-center">
              <div className="text-lg font-bold font-mono text-mf-txt">{portfolio.count}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">Projets</div>
            </div>
            <div className="rounded-xl border border-mf-border bg-mf-card p-3 text-center">
              <div className="text-lg font-bold font-mono text-teal-400">{portfolio.totalOz.toLocaleString()}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">koz/an total</div>
            </div>
            <div className="rounded-xl border border-mf-border bg-mf-card p-3 text-center">
              <div className="text-lg font-bold font-mono text-amber-400">{portfolio.avgGrade.toFixed(2)}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">Teneur moy (g/t)</div>
            </div>
            <div className="rounded-xl border border-mf-border bg-mf-card p-3 text-center">
              <div className="text-lg font-bold font-mono text-teal-400">{portfolio.avgRecovery.toFixed(1)}%</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">
                Récup. globale moy.
                <span className="block text-[9px] text-mf-txt4/80">
                  {portfolio.withLimsGlobal}/{portfolio.count} sur essais 48 h
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-mf-border bg-mf-card p-3 text-center">
              <div className="text-lg font-bold font-mono text-mf-txt">{portfolio.totalTph.toLocaleString()}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">t/h total</div>
            </div>
            <div className="rounded-xl border border-mf-border bg-mf-card p-3 text-center">
              <div className="text-lg font-bold font-mono text-blue-400">{portfolio.countries}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">Pays</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-txt4" />
            <input
              className="input-field pl-9 text-sm"
              placeholder="Rechercher un projet…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input-field text-sm w-44"
            value={filterPhase}
            onChange={e => setFilterPhase(e.target.value)}
          >
            <option value="">Toutes les phases</option>
            {PHASES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            className="input-field text-sm w-40"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="name">Trier: Nom</option>
            <option value="grade">Trier: Teneur</option>
            <option value="production">Trier: Production</option>
            <option value="recovery">Trier: Récupération</option>
          </select>
        </div>

        {/* Project grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-10 h-10 rounded-full border-2 border-mf-border border-t-amber-500 animate-spin mb-4" />
            <p className="text-sm text-mf-txt3">Chargement des projets…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5">
              <Mountain size={24} className="text-amber-400" />
            </div>
            <h3 className="text-base font-semibold text-mf-txt mb-2">Aucun projet trouvé</h3>
            <p className="text-sm text-mf-txt3 mb-6 max-w-xs">
              {projects.length === 0
                ? 'Créez votre premier projet métallurgique pour commencer.'
                : 'Modifiez vos critères de recherche.'}
            </p>
            {projects.length === 0 && (
              <button className="btn btn-primary" onClick={onNewProject}>Créer mon premier projet</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map(p => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectProject(p)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectProject(p); } }}
                className="group relative text-left rounded-2xl border border-mf-border bg-mf-card hover:bg-mf-hover hover:border-amber-500/30 transition-all duration-200 p-5 flex flex-col gap-4 shadow-card cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-[11px] font-bold text-amber-500 uppercase tracking-widest">
                      {p.code}
                    </span>
                    <h3 className="text-sm font-semibold text-mf-txt mt-0.5 leading-snug">{p.name}</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PHASE_COLORS[p.phase] ?? 'bg-mf-border/20 text-mf-txt4 border-mf-border/30'}`}>
                      {p.phase}
                    </span>
                    <button
                      type="button"
                      aria-label={`Supprimer le projet ${p.name}`}
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-mf-txt4 hover:text-red-400 transition-all p-1 -m-1 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Overlay de confirmation de suppression */}
                {confirmDeleteId === p.id && (
                  <div
                    className="absolute inset-0 z-10 rounded-2xl bg-mf-card/95 backdrop-blur-sm border border-red-500/40 flex flex-col items-center justify-center gap-3 p-5 text-center"
                    onClick={e => e.stopPropagation()}
                  >
                    <Trash2 size={20} className="text-red-400" />
                    <p className="text-sm text-mf-txt">
                      Supprimer <span className="font-semibold">{p.name}</span> ?
                    </p>
                    <p className="text-[11px] text-mf-txt4 -mt-1">
                      Toutes les données du projet seront définitivement supprimées.
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        type="button"
                        disabled={deletingId === p.id}
                        onClick={e => { e.stopPropagation(); doDelete(p); }}
                        className="btn btn-sm gap-1.5 bg-red-500/90 hover:bg-red-500 text-white border-transparent"
                      >
                        <Check size={13} /> {deletingId === p.id ? 'Suppression…' : 'Supprimer'}
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === p.id}
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}
                        className="btn btn-sm btn-secondary gap-1.5"
                      >
                        <X size={13} /> Annuler
                      </button>
                    </div>
                  </div>
                )}

                {/* Country */}
                <div className="flex items-center gap-1.5 text-xs text-mf-txt3">
                  <Globe size={11} className="text-mf-txt4" />
                  {p.country}
                </div>

                {/* Metrics row */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-mf-border/60">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-mf-txt4 uppercase tracking-wider">Débit</span>
                    <span className="text-sm font-bold font-mono text-mf-txt">{p.target_tph}<span className="text-xs text-mf-txt4 font-normal ml-0.5">t/h</span></span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-mf-txt4 uppercase tracking-wider">Teneur</span>
                    <span className="text-sm font-bold font-mono text-amber-400">{p.gold_grade_g_t}<span className="text-xs text-amber-500/60 font-normal ml-0.5">g/t</span></span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-mf-txt4 uppercase tracking-wider">Prod.</span>
                    <span className="text-sm font-bold font-mono text-teal-400">{annualOz(p)}<span className="text-xs text-teal-500/60 font-normal ml-0.5">koz</span></span>
                  </div>
                </div>

                {/* Récupération globale (LIMS/48 h) + moyenne des essais 48 h.
                    Tant que le lot LIMS n'est pas chargé, on retombe sur la
                    récup. design du projet, signalée comme telle. */}
                {(() => {
                  const rec = recByProject.get(p.id);
                  const globalPct = rec?.effectiveRecoveryPct ?? p.recovery_pct;
                  const isFallback = rec?.isDesignFallback ?? true;
                  const leach48 = rec?.leach48Pct ?? null;
                  return (
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-mf-txt4">Récup. globale</span>
                        <span className="text-[10px] font-mono text-mf-txt3">
                          {globalPct.toFixed(1)}%
                          {isFallback
                            ? <span className="ml-1 text-mf-txt4">design</span>
                            : <span className="ml-1 text-emerald-400/80">48 h</span>}
                        </span>
                      </div>
                      <div className="h-1 bg-mf-border rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isFallback
                            ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                            : 'bg-gradient-to-r from-teal-500 to-emerald-400'}`}
                          style={{ width: `${globalPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-[9px] text-mf-txt4">
                        <span>Moy. lixiviation 48 h (LIMS)</span>
                        <span className="font-mono text-mf-txt3">
                          {leach48 != null ? `${leach48.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Footer */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3 text-[10px] text-mf-txt4">
                    <span className="flex items-center gap-1"><FlaskConical size={10} /> LIMS</span>
                    <span className="flex items-center gap-1"><Activity size={10} /> Simulation</span>
                    <span className="flex items-center gap-1"><TrendingUp size={10} /> Économie</span>
                  </div>
                  <ChevronRight size={14} className="text-mf-txt4 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
