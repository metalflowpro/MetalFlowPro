// ─────────────────────────────────────────────────────────────────────────────
// Barre « scénarios sauvegardés » partagée par les panneaux de réconciliation.
//
// Metal accounting = fonction de gouvernance : P754 exige une piste d'audit.
// Ce composant sauvegarde/recharge un scénario complet (entrées + extrait de
// résultat) via `lib/cos/reconciliationRuns`. Si la table Supabase est absente,
// il DÉGRADE GRACIEUSEMENT en affichant comment l'activer, sans rien casser.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { Save, FolderOpen, Trash2, Database, Clock } from 'lucide-react';
import {
  listReconciliationRuns, saveReconciliationRun, deleteReconciliationRun,
  type ReconciliationRun, type ReconMethod,
} from '../../lib/cos/reconciliationRuns';

interface Props {
  projectId: string;
  method: ReconMethod;
  /** Snapshot des entrées courantes (nœuds + flux + options), pour rechargement. */
  getInput: () => Record<string, unknown>;
  /** Extrait du résultat courant pour l'audit (clôtures, erreurs grossières…). */
  getSummary: () => Record<string, unknown>;
  /** Recharge un scénario : reçoit l'`input` sauvegardé. */
  onLoad: (input: Record<string, unknown>) => void;
}

const METHOD_LABEL: Record<ReconMethod, string> = {
  network: 'Réseau',
  bilinear: 'Bilinéaire',
  bilinear_iter: 'Bilinéaire itératif',
  serial: 'Élimination sérielle',
};

export function ReconciliationRunsBar({ projectId, method, getInput, getSummary, onLoad }: Props) {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { runs, tableMissing } = await listReconciliationRuns(projectId);
      setRuns(runs);
      setTableMissing(tableMissing);
    } catch {
      // erreur transitoire : on n'interrompt pas la saisie de l'ingénieur
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleSave() {
    setBusy(true);
    try {
      const { tableMissing } = await saveReconciliationRun({
        projectId,
        label: label.trim() || `${METHOD_LABEL[method]} — ${new Date().toLocaleString('fr-CA')}`,
        method,
        input: getInput(),
        resultSummary: getSummary(),
      });
      setTableMissing(tableMissing);
      if (!tableMissing) { setLabel(''); await refresh(); setOpen(true); }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      const { tableMissing } = await deleteReconciliationRun(id);
      setTableMissing(tableMissing);
      if (!tableMissing) await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="section-title flex items-center gap-2"><Database size={15} className="text-blue-400" /> Scénarios sauvegardés (piste d'audit P754)</div>
        <div className="flex items-center gap-2">
          <input
            className="input-field text-xs py-1 w-48" placeholder="Nom du scénario…"
            value={label} onChange={e => setLabel(e.target.value)} disabled={busy} />
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={busy}><Save size={13} /> Sauvegarder</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setOpen(o => !o)}><FolderOpen size={13} /> {runs.length} enregistré(s)</button>
        </div>
      </div>

      {tableMissing && (
        <div className="mt-3 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-3 py-2">
          Table <code>cos_reconciliation_runs</code> absente — exécuter la migration <code>..._cos_reconciliation_runs.sql</code> dans Supabase pour activer la sauvegarde.
        </div>
      )}

      {open && !tableMissing && (
        runs.length === 0 ? (
          <div className="mt-3 text-xs text-mf-txt4">Aucun scénario sauvegardé pour ce projet.</div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                  <th className="py-1.5 pr-3">Scénario</th><th className="py-1.5 pr-3">Méthode</th>
                  <th className="py-1.5 pr-3">Date</th><th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b border-mf-border/30">
                    <td className="py-1.5 pr-3 text-mf-txt2 font-medium">{r.label}</td>
                    <td className="py-1.5 pr-3 text-mf-txt3">{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td className="py-1.5 pr-3 text-mf-txt4"><span className="inline-flex items-center gap-1"><Clock size={11} />{new Date(r.created_at).toLocaleString('fr-CA')}</span></td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <button className="btn btn-secondary btn-sm mr-1" onClick={() => onLoad(r.input)}><FolderOpen size={12} /> Charger</button>
                      <button className="text-mf-txt4 hover:text-red-400 p-1" onClick={() => handleDelete(r.id)} disabled={busy}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
