import React, { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Filter, Search, ShieldCheck, Clock, User, ChevronRight } from 'lucide-react';
import { fetchAuditLogs, type AuditLogEntry, type AuditAction } from '../../lib/audit/auditLog';
import { useProject } from '../../lib/ProjectContext';

export const AuditLogViewer: React.FC = () => {
  const { project } = useProject();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLogs(project?.id);
      setLogs(data);
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filteredLogs = logs.filter(log => {
    if (actionFilter !== 'all' && log.action !== actionFilter) return false;
    if (entityFilter !== 'all' && log.entity_type !== entityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchAction = log.action.toLowerCase().includes(q);
      const matchEntity = log.entity_type.toLowerCase().includes(q);
      const matchMeta = JSON.stringify(log.metadata ?? {}).toLowerCase().includes(q);
      if (!matchAction && !matchEntity && !matchMeta) return false;
    }
    return true;
  });

  const getActionBadgeColor = (action: AuditAction): string => {
    switch (action) {
      case 'create':
      case 'approve_stage':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'update':
      case 'update_settings':
      case 'update_met_constants':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'run_simulation':
      case 'run_reconciliation':
      case 'run_p80_study':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'delete':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <History className="w-5 h-5 text-amber-400" />
            Journal de Traçabilité & Audit (Audit Trail)
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Traçabilité intégrale des modifications de paramètres, exécutions et jalons réglementaires NI 43-101.
          </p>
        </div>

        <button
          onClick={loadLogs}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Rafraîchir
        </button>
      </div>

      {/* Bar de filtre & recherche */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Rechercher dans la traçabilité..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          >
            <option value="all">Toutes les actions</option>
            <option value="update_settings">Modifications de paramètres</option>
            <option value="run_simulation">Exécutions de simulation</option>
            <option value="run_reconciliation">Réconciliations metallurgiques</option>
            <option value="approve_stage">Approbations de jalons</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-500" />
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
          >
            <option value="all">Toutes les entités</option>
            <option value="project_settings">Paramètres Projet</option>
            <option value="project_met_constants">Constantes Métallurgiques</option>
            <option value="simulation_run">Simulations</option>
            <option value="stage_gate">Jalons NI 43-101</option>
          </select>
        </div>
      </div>

      {/* Liste des entrées d'audit */}
      <div className="space-y-2">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-xs">Chargement de la traçabilité...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
            Aucun événement de traçabilité correspondant aux filtres sélectionnés.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            return (
              <div
                key={log.id}
                className="bg-slate-950 border border-slate-800/80 rounded-lg p-3 hover:border-slate-700 transition-colors"
              >
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                >
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${getActionBadgeColor(log.action)}`}>
                      {log.action}
                    </span>
                    <span className="text-xs font-medium text-slate-300">{log.entity_type}</span>
                    {log.entity_id && (
                      <span className="text-[11px] text-slate-500 font-mono">#{log.entity_id.slice(0, 8)}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{log.user_id.slice(0, 8)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800/60 text-xs space-y-2">
                    {log.previous_values && (
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium mb-1">Valeurs Précédentes :</div>
                        <pre className="bg-slate-900 p-2 rounded text-[11px] font-mono text-rose-300/90 overflow-x-auto">
                          {JSON.stringify(log.previous_values, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.new_values && (
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium mb-1">Nouvelles Valeurs :</div>
                        <pre className="bg-slate-900 p-2 rounded text-[11px] font-mono text-emerald-300/90 overflow-x-auto">
                          {JSON.stringify(log.new_values, null, 2)}
                        </pre>
                      </div>
                    )}
                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div>
                        <div className="text-[11px] text-slate-400 font-medium mb-1">Métadonnées d'exécution :</div>
                        <pre className="bg-slate-900 p-2 rounded text-[11px] font-mono text-amber-300/90 overflow-x-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
