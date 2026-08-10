import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Check, X, ShieldCheck, Clock, RefreshCw, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AppUser {
  id: string;
  email: string | null;
  status: 'pending' | 'approved' | 'rejected';
  is_admin: boolean;
  created_at: string;
  approved_at: string | null;
}

interface AdminUsersProps {
  currentUserId: string;
  onBack: () => void;
}

const STATUS_META: Record<AppUser['status'], { label: string; cls: string }> = {
  pending:  { label: 'En attente', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  approved: { label: 'Approuvé',   cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  rejected: { label: 'Rejeté',     cls: 'text-red-400 bg-red-500/10 border-red-500/30' },
};

/** Console d'administration : approuver / rejeter les comptes (admins seulement). */
export function AdminUsers({ currentUserId, onBack }: AdminUsersProps) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: err } = await supabase
      .from('app_users')
      .select('id, email, status, is_admin, created_at, approved_at')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    else setUsers((data ?? []) as AppUser[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(u: AppUser, status: AppUser['status']) {
    setBusyId(u.id); setError('');
    const patch = status === 'approved'
      ? { status, approved_at: new Date().toISOString(), approved_by: currentUserId }
      : { status };
    const { error: err } = await supabase.from('app_users').update(patch).eq('id', u.id);
    if (err) setError(err.message);
    else setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status } : x));
    setBusyId(null);
  }

  const pending = users.filter(u => u.status === 'pending');

  return (
    <div className="min-h-screen bg-[#0A0E17] text-mf-txt">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="btn btn-secondary btn-sm gap-1.5"><ArrowLeft size={14} /> Projets</button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2"><Users size={20} className="text-amber-400" /> Administration — Utilisateurs</h1>
              <p className="text-xs text-mf-txt4 mt-0.5">Approuvez ou rejetez les comptes. Un compte non approuvé n'a accès à aucune donnée.</p>
            </div>
          </div>
          <button onClick={load} className="btn btn-secondary btn-sm gap-1.5"><RefreshCw size={13} /> Rafraîchir</button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">{error}</div>}

        {pending.length > 0 && (
          <div className="mb-4 flex items-center gap-2 text-sm text-amber-400">
            <Clock size={15} /> {pending.length} compte(s) en attente de validation
          </div>
        )}

        <div className="card p-0 overflow-hidden">
          <table className="tbl text-sm w-full">
            <thead>
              <tr>
                <th>Courriel</th><th>Statut</th><th>Rôle</th><th>Inscrit le</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-8 text-mf-txt4">Chargement…</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-mf-txt4">Aucun utilisateur.</td></tr>
              ) : users.map(u => {
                const meta = STATUS_META[u.status];
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id}>
                    <td className="font-medium">{u.email ?? '—'}{isSelf && <span className="ml-2 text-[10px] text-mf-txt4">(vous)</span>}</td>
                    <td><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${meta.cls}`}>{meta.label}</span></td>
                    <td>{u.is_admin ? <span className="text-[11px] text-amber-300 flex items-center gap-1"><ShieldCheck size={12} /> Admin</span> : <span className="text-[11px] text-mf-txt4">Utilisateur</span>}</td>
                    <td className="text-mf-txt4 text-xs">{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {u.status !== 'approved' && (
                          <button disabled={busyId === u.id} onClick={() => setStatus(u, 'approved')}
                            className="btn btn-sm gap-1 bg-emerald-600/90 hover:bg-emerald-600 text-white disabled:opacity-40">
                            <Check size={13} /> Approuver
                          </button>
                        )}
                        {u.status !== 'rejected' && !isSelf && (
                          <button disabled={busyId === u.id} onClick={() => setStatus(u, 'rejected')}
                            className="btn btn-sm gap-1 bg-red-600/80 hover:bg-red-600 text-white disabled:opacity-40">
                            <X size={13} /> Rejeter
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
