import { useState } from 'react';
import { Trash2, AlertTriangle, Loader, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { supabase } from '../../lib/supabase';
import { ALL_FAMILIES, ALL_TEST_TABLES } from '../../lib/limsTestFamilies';
import type { Project, LimsSample } from '../../types';

interface Props {
  project: Project;
  samples: LimsSample[];
  onSuccess: () => void;
  onClose: () => void;
}

type Mode = 'samples' | 'tests';

export function DeleteModal({ project, samples, onSuccess, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('samples');
  const [campaign, setCampaign] = useState('');
  const [testFamily, setTestFamily] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<{ deleted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const campaigns = [...new Set(samples.map(s => s.campaign).filter(Boolean))] as string[];
  const samplesInCampaign = samples.filter(s => s.campaign === campaign);

  async function handleDelete() {
    if (!campaign) return;
    setDeleting(true);
    setError(null);
    try {
      if (mode === 'samples') {
        // Delete all test results for samples in this campaign, then delete the samples
        const sampleIds = samplesInCampaign.map(s => s.id);

        if (sampleIds.length > 0) {
          for (const table of ALL_TEST_TABLES) {
            await supabase.from(table as never).delete().in('sample_id', sampleIds);
          }
          // Also clear legacy test tables
          for (const table of ['lims_test_head', 'lims_test_gravity', 'lims_test_leach']) {
            await supabase.from(table as never).delete().in('sample_id', sampleIds);
          }
        }

        const { error: delErr } = await supabase
          .from('lims_samples')
          .delete()
          .eq('project_id', project.id)
          .eq('campaign', campaign);
        if (delErr) throw delErr;

        setDone({ deleted: sampleIds.length });
      } else {
        // Delete only test results for a specific family + campaign
        if (!testFamily) return;
        const sampleIds = samplesInCampaign.map(s => s.id);
        const family = ALL_FAMILIES.find(f => f.code === testFamily);
        if (!family || sampleIds.length === 0) { setDone({ deleted: 0 }); return; }

        const { error: delErr } = await supabase
          .from(family.table as never)
          .delete()
          .in('sample_id', sampleIds);
        if (delErr) throw delErr;

        setDone({ deleted: sampleIds.length });
      }

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setDeleting(false);
    }
  }

  const canDelete =
    campaign &&
    confirmed &&
    (mode === 'samples' || testFamily) &&
    samplesInCampaign.length > 0;

  return (
    <Modal
      title="Suppression par campagne"
      subtitle="Supprimez en masse des échantillons ou des résultats de tests"
      onClose={onClose}
      width="md"
      footer={
        done ? (
          <button className="btn btn-primary" onClick={onClose}>Fermer</button>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button
              className="btn btn-sm px-4 py-2 rounded-lg font-medium text-sm bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting
                ? <><Loader size={13} className="animate-spin" /> Suppression…</>
                : <><Trash2 size={13} /> Supprimer</>}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center justify-center py-8 space-y-4">
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle2 size={30} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-mf-txt">Suppression effectuée</div>
            <div className="text-sm text-mf-txt3 mt-1">
              {mode === 'samples'
                ? `${done.deleted} échantillon${done.deleted !== 1 ? 's' : ''} et leurs résultats supprimés`
                : `Résultats de tests supprimés pour ${done.deleted} échantillon${done.deleted !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Mode selector */}
          <div>
            <label className="label mb-2">Que voulez-vous supprimer ?</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'samples', label: 'Échantillons', sub: 'Supprime les échantillons ET tous leurs résultats de tests' },
                { id: 'tests',   label: 'Résultats de tests', sub: 'Supprime uniquement les résultats d\'une famille de tests' },
              ] as const).map(m => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    mode === m.id
                      ? 'border-red-500/40 bg-red-500/8 text-mf-txt'
                      : 'border-mf-border text-mf-txt3 hover:bg-mf-hover/30'
                  }`}
                >
                  <div className="text-xs font-semibold">{m.label}</div>
                  <div className="text-[10px] text-mf-txt4 mt-0.5 leading-snug">{m.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Campaign selector */}
          <div>
            <label className="label">Campagne *</label>
            <select
              className="input-field"
              value={campaign}
              onChange={e => { setCampaign(e.target.value); setConfirmed(false); }}
            >
              <option value="">— Sélectionner une campagne —</option>
              {campaigns.map(c => (
                <option key={c} value={c}>
                  {c} ({samples.filter(s => s.campaign === c).length} éch.)
                </option>
              ))}
            </select>
          </div>

          {/* Test family selector (only for 'tests' mode) */}
          {mode === 'tests' && (
            <div>
              <label className="label">Famille de tests *</label>
              <select
                className="input-field"
                value={testFamily}
                onChange={e => { setTestFamily(e.target.value); setConfirmed(false); }}
              >
                <option value="">— Sélectionner une famille —</option>
                {ALL_FAMILIES.map(f => (
                  <option key={f.code} value={f.code}>{f.shortLabel}</option>
                ))}
              </select>
            </div>
          )}

          {/* Impact preview */}
          {campaign && samplesInCampaign.length > 0 && (
            <div className="p-3 rounded-xl border border-orange-500/20 bg-orange-500/8 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-orange-400">
                <AlertTriangle size={13} /> Impact de la suppression
              </div>
              {mode === 'samples' ? (
                <>
                  <div className="text-xs text-mf-txt3">
                    <span className="font-bold text-red-400">{samplesInCampaign.length} échantillon{samplesInCampaign.length !== 1 ? 's' : ''}</span> de la campagne <span className="font-mono text-amber-400">{campaign}</span>
                  </div>
                  <div className="text-[11px] text-mf-txt4">
                    Tous les résultats de tests associés seront également supprimés. Action irréversible.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-mf-txt3">
                    Résultats <span className="font-bold text-red-400">{ALL_FAMILIES.find(f => f.code === testFamily)?.shortLabel ?? testFamily}</span> pour <span className="font-mono text-amber-400">{campaign}</span>
                    {' '}({samplesInCampaign.length} échantillon{samplesInCampaign.length !== 1 ? 's' : ''})
                  </div>
                  <div className="text-[11px] text-mf-txt4">
                    Les échantillons eux-mêmes ne seront PAS supprimés.
                  </div>
                </>
              )}
            </div>
          )}

          {campaign && samplesInCampaign.length === 0 && (
            <div className="text-xs text-mf-txt4 p-3 rounded-lg border border-mf-border text-center">
              Aucun échantillon trouvé pour cette campagne
            </div>
          )}

          {/* Confirmation checkbox */}
          {campaign && samplesInCampaign.length > 0 && (
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                className="mt-0.5 accent-red-500"
                checked={confirmed}
                onChange={e => setConfirmed(e.target.checked)}
              />
              <span className="text-xs text-mf-txt3 group-hover:text-mf-txt transition-colors">
                Je confirme vouloir supprimer ces données. Cette action est <strong className="text-red-400">irréversible</strong>.
              </span>
            </label>
          )}

          {error && (
            <div className="text-xs text-red-300 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
