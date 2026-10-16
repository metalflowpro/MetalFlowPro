import { formatDecimalGrouped } from '../../lib/format/number';
import { Trash2, Save,
} from 'lucide-react';



import { GeometDomain, ModelVersion } from './model';

interface VersionsTabProps {
  createVersion: () => Promise<void>;
  deleteVersion: (id: string) => Promise<void>;
  domains: GeometDomain[];
  publishVersion: (v: ModelVersion) => Promise<void>;
  setVersionLabel: React.Dispatch<React.SetStateAction<string>>;
  setVersionNote: React.Dispatch<React.SetStateAction<string>>;
  versionLabel: string;
  versionNote: string;
  versionSaving: boolean;
  versions: ModelVersion[];
}

export function VersionsTab({ createVersion, deleteVersion, domains, publishVersion, setVersionLabel, setVersionNote, versionLabel, versionNote, versionSaving, versions }: VersionsTabProps) {
  return (
          <div className="space-y-4">
            {/* Créer un instantané */}
            <div className="card-sm">
              <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Figer une version du modèle géométallurgique</div>
              <div className="text-[11px] mf-txt3 mb-3">
                Un instantané fige les {domains.length} domaine(s) actuels (mappings GID, récupérations, BWi, preg-robbing) et les hypothèses de calcul,
                pour rendre toute prédiction publiée <span className="mf-txt2 font-semibold">reproductible</span>.
              </div>
              <div className="flex gap-2 items-end">
                <div className="w-32">
                  <label className="label">Libellé</label>
                  <input className="input-field w-full text-xs font-mono" placeholder={`v${versions.length + 1}`} value={versionLabel}
                    onChange={e => setVersionLabel(e.target.value)} />
                </div>
                <div className="flex-1">
                  <label className="label">Note</label>
                  <input className="input-field w-full text-xs" placeholder="Ex: après ajout des essais P80 sulfuré réfractaire" value={versionNote}
                    onChange={e => setVersionNote(e.target.value)} />
                </div>
                <button onClick={createVersion} disabled={versionSaving || domains.length === 0}
                  className="btn btn-teal flex items-center gap-1.5 text-xs">
                  <Save size={12} /> {versionSaving ? 'Enregistrement…' : 'Figer la version'}
                </button>
              </div>
            </div>

            {/* Liste des versions */}
            <div className="card-sm">
              <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Historique des versions ({versions.length})</div>
              {versions.length === 0 ? (
                <div className="text-center mf-txt3 py-10 text-sm">Aucune version figée pour ce projet.</div>
              ) : (
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['Version', 'Date', 'Domaines', 'Récup. pondérée', 'Statut', 'Par', ''].map(h => (
                        <th key={h} className="text-left px-2 py-1.5 mf-txt3 font-semibold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map(v => (
                      <tr key={v.id} className="border-b border-white/5">
                        <td className="px-2 py-1.5 font-mono font-semibold mf-txt">{v.version_label}</td>
                        <td className="px-2 py-1.5 mf-txt3">{new Date(v.created_at).toLocaleDateString('fr-CA')}</td>
                        <td className="px-2 py-1.5 mf-txt2">{v.domain_count}</td>
                        <td className="px-2 py-1.5 text-emerald-400 font-semibold">
                          {v.weighted_recovery_pct != null ? `${formatDecimalGrouped(v.weighted_recovery_pct, 1)}%` : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.status === 'published' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 mf-txt3'}`}>
                            {v.status === 'published' ? 'Publiée' : 'Brouillon'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] mf-txt4 truncate max-w-[120px]" title={v.approved_by ?? v.created_by ?? ''}>
                          {v.approved_by ?? v.created_by ?? '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          {v.status === 'draft' && (
                            <button onClick={() => publishVersion(v)} className="text-[10px] text-emerald-400 hover:text-emerald-300 mr-2">Publier</button>
                          )}
                          <button onClick={() => deleteVersion(v.id)} className="mf-txt4 hover:text-red-400"><Trash2 size={12} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        );
}
