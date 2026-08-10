import { Clock, ShieldX, LogOut, Layers } from 'lucide-react';

interface PendingApprovalProps {
  email: string;
  status: 'pending' | 'rejected';
  onSignOut: () => void;
}

/**
 * Écran affiché après connexion lorsqu'un compte n'est pas encore approuvé (ou a
 * été rejeté). L'accès aux données est de toute façon bloqué côté base (RLS) —
 * cet écran est l'explication côté utilisateur.
 */
export function PendingApproval({ email, status, onSignOut }: PendingApprovalProps) {
  const rejected = status === 'rejected';
  return (
    <div className="min-h-screen bg-[#0A0E17] text-mf-txt flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-mf-border bg-mf-card shadow-card p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${
            rejected ? 'bg-red-500/15 border-red-500/25' : 'bg-amber-500/15 border-amber-500/25'
          }`}>
            {rejected ? <ShieldX size={28} className="text-red-400" /> : <Clock size={28} className="text-amber-400" />}
          </div>
        </div>

        <h1 className="text-xl font-bold mb-2">
          {rejected ? 'Accès refusé' : 'Compte en attente de validation'}
        </h1>

        <p className="text-sm text-mf-txt3 leading-relaxed mb-6">
          {rejected ? (
            <>Votre demande d'accès à MetalFlow Pro n'a pas été approuvée. Contactez l'administrateur si vous pensez qu'il s'agit d'une erreur.</>
          ) : (
            <>Votre compte <span className="text-mf-txt font-medium">{email}</span> a bien été créé. Un administrateur doit
            l'approuver avant que vous puissiez accéder à la plateforme. Vous recevrez l'accès dès la validation — reconnectez-vous alors.</>
          )}
        </p>

        <button onClick={onSignOut} className="w-full btn btn-secondary justify-center py-2.5 text-sm font-semibold gap-2">
          <LogOut size={15} /> Se déconnecter
        </button>

        <div className="mt-6 pt-5 border-t border-mf-border flex items-center justify-center gap-2 text-[11px] text-mf-txt4">
          <Layers size={12} className="text-amber-500/70" /> MetalFlow Pro · accès contrôlé
        </div>
      </div>
    </div>
  );
}
