import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, GitBranch, AlertTriangle, CheckCircle2, RefreshCw, Plus } from 'lucide-react';
import { supabaseDynamic } from '../../lib/supabase';
import {
  WORKFLOW_STATES, STATE_LABEL, ROLE_LABEL, allowedTransitions, requiresNewVersion,
  canPublish, isPublishingTransition, stateIndex,
  type WorkflowState, type Role,
} from '../../lib/simulation/validationWorkflow';
import type { ProcessNode, StreamEdge, SimRunResult } from '../../lib/simulation/types';

/** Tolérance de fermeture des bilans pour autoriser une publication (fraction). */
const CLOSURE_TOLERANCE = 0.01;

interface VersionRow { id: string; version: number; name: string; status: WorkflowState; created_at: string; }
interface ValidationRow { id: string; state: WorkflowState; role: string | null; decision: string | null; comment: string | null; created_at: string; }

interface Props {
  projectId: string;
  flowsheetId: string | null;
  flowsheetName: string;
  processNodes: ProcessNode[];
  streamEdges: StreamEdge[];
  lastRun: SimRunResult | null;
}

export default function ValidationTab({ projectId, flowsheetId, flowsheetName, processNodes, streamEdges, lastRun }: Props) {
  const [role, setRole] = useState<Role>('process_engineer');
  const [version, setVersion] = useState<VersionRow | null>(null);
  const [history, setHistory] = useState<ValidationRow[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!flowsheetId) { setVersion(null); setHistory([]); return; }
    setLoading(true); setError(null);
    try {
      const { data: vRows, error: vErr } = await supabaseDynamic
        .from('sim_flowsheet_versions').select('*')
        .eq('flowsheet_id', flowsheetId).eq('project_id', projectId)
        .order('version', { ascending: false }).limit(1);
      if (vErr) throw vErr;
      const v = (vRows?.[0] ?? null) as VersionRow | null;
      setVersion(v);
      if (v) {
        const { data: hRows, error: hErr } = await supabaseDynamic
          .from('sim_validations').select('*')
          .eq('flowsheet_id', flowsheetId).eq('project_id', projectId)
          .order('created_at', { ascending: false });
        if (hErr) throw hErr;
        setHistory((hRows ?? []) as ValidationRow[]);
      } else {
        setHistory([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [flowsheetId, projectId]);

  useEffect(() => { void load(); }, [load]);

  async function createVersion(nextStatus: WorkflowState = 'draft') {
    if (!flowsheetId) return;
    setBusy(true); setError(null);
    try {
      const nextVersion = (version?.version ?? 0) + 1;
      const { error: insErr } = await supabaseDynamic.from('sim_flowsheet_versions').insert({
        flowsheet_id: flowsheetId,
        project_id: projectId,
        version: nextVersion,
        name: flowsheetName,
        status: nextStatus,
        topology: { nodes: processNodes, edges: streamEdges },
      });
      if (insErr) throw insErr;
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: WorkflowState, decision?: 'approve' | 'reject' | 'comment') {
    if (!flowsheetId || !version) return;

    // Règle §11 : pas de publication (validé/approuvé) sans bilans fermés.
    if (isPublishingTransition(to)) {
      const closure = lastRun?.convergence_error ?? 1;
      const converged = lastRun?.status === 'converged';
      const gate = canPublish({ massClosureError: closure, goldClosureError: closure, tolerance: CLOSURE_TOLERANCE });
      if (!converged || !gate.ok) {
        setError(gate.reason ?? 'Aucune simulation convergée : impossible de publier tant que les bilans ne sont pas fermés.');
        return;
      }
    }

    setBusy(true); setError(null);
    try {
      const { error: valErr } = await supabaseDynamic.from('sim_validations').insert({
        project_id: projectId,
        flowsheet_id: flowsheetId,
        flowsheet_version: version.version,
        state: to,
        role,
        decision: decision ?? 'comment',
        comment: comment || null,
      });
      if (valErr) throw valErr;
      const { error: updErr } = await supabaseDynamic.from('sim_flowsheet_versions')
        .update({ status: to }).eq('id', version.id).eq('project_id', projectId);
      if (updErr) throw updErr;
      setComment('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const state = version?.status ?? null;
  const transitions = state ? allowedTransitions(state, role) : [];

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-4xl space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-400" />
          <h3 className="section-title">Validation & versions</h3>
          {loading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
        </div>

        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {!flowsheetId ? (
          <div className="card text-sm text-slate-400">
            Enregistrez d'abord le flowsheet (onglet Éditeur → « Enregistrer ») pour le versionner et le valider.
          </div>
        ) : !version ? (
          <div className="card">
            <p className="text-sm text-slate-400 mb-3">Aucune version enregistrée pour ce flowsheet.</p>
            <button onClick={() => createVersion('draft')} disabled={busy} className="btn btn-primary text-sm">
              <Plus size={14} /> Créer la version 1 (brouillon)
            </button>
          </div>
        ) : (
          <>
            {/* Rôle courant */}
            <div className="card">
              <label className="label">Votre rôle</label>
              <select className="input-field max-w-xs" value={role} onChange={e => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <div className="text-[11px] text-slate-500 mt-1">
                Les transitions autorisées dépendent du rôle (§11). Un flowsheet approuvé ne se modifie plus : il faut créer une nouvelle version.
              </div>
            </div>

            {/* Frise des états */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-white flex items-center gap-2">
                  <GitBranch size={15} /> Version {version.version} — {version.name}
                </h4>
                <span className="badge badge-info">{STATE_LABEL[version.status]}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {WORKFLOW_STATES.map(s => {
                  const done = stateIndex(s) <= stateIndex(version.status);
                  const current = s === version.status;
                  return (
                    <span key={s}
                      className={`px-2 py-0.5 text-[11px] rounded-full border ${current ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : done ? 'bg-slate-700/60 border-slate-600 text-slate-300' : 'border-slate-700 text-slate-500'}`}>
                      {done && !current && <CheckCircle2 size={10} className="inline mr-1" />}
                      {STATE_LABEL[s]}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="card">
              <h4 className="font-semibold text-white mb-3">Actions</h4>
              {requiresNewVersion(version.status) ? (
                <div className="space-y-2">
                  <p className="text-sm text-amber-300 flex items-center gap-2">
                    <AlertTriangle size={14} /> Cet état ({STATE_LABEL[version.status]}) est verrouillé — toute modification crée une nouvelle version.
                  </p>
                  <button onClick={() => createVersion('draft')} disabled={busy} className="btn btn-secondary text-sm">
                    <Plus size={14} /> Créer la version {version.version + 1} (brouillon)
                  </button>
                </div>
              ) : transitions.length === 0 ? (
                <p className="text-sm text-slate-500">Aucune action disponible pour le rôle « {ROLE_LABEL[role]} » depuis cet état.</p>
              ) : (
                <>
                  <textarea className="input-field mb-3" rows={2} placeholder="Commentaire (optionnel)"
                    value={comment} onChange={e => setComment(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    {transitions.map(t => (
                      <button key={t.to} onClick={() => transition(t.to, t.decision)} disabled={busy}
                        className={`btn text-sm ${t.decision === 'reject' ? 'btn-secondary' : 'btn-primary'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {isPublishingTransition(transitions[0]?.to) && (
                    <div className="text-[11px] text-slate-500 mt-2">
                      La validation/approbation exige une simulation convergée avec bilans fermés (tolérance {(CLOSURE_TOLERANCE * 100).toFixed(0)} %).
                      {lastRun ? ` Dernière simulation : ${lastRun.status}.` : ' Aucune simulation lancée.'}
                    </div>
                  )}
                </>
              )}
              <div className="mt-3">
                <button onClick={() => createVersion('draft')} disabled={busy} className="text-xs text-slate-400 hover:text-slate-200 underline">
                  + Nouvelle version à partir du flowsheet courant
                </button>
              </div>
            </div>

            {/* Historique */}
            {history.length > 0 && (
              <div className="card">
                <h4 className="font-semibold text-white mb-3">Historique de validation</h4>
                <div className="space-y-2">
                  {history.map(h => (
                    <div key={h.id} className="flex items-start justify-between gap-3 p-2 rounded bg-slate-800 text-sm">
                      <div>
                        <span className="text-white">{STATE_LABEL[h.state] ?? h.state}</span>
                        {h.role && <span className="text-slate-500"> · {ROLE_LABEL[h.role as Role] ?? h.role}</span>}
                        {h.comment && <div className="text-xs text-slate-400 mt-0.5">« {h.comment} »</div>}
                      </div>
                      <div className="text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(h.created_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
