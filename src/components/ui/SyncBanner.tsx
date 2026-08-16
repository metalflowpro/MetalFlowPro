import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  moduleSyncStatus, DOWNSTREAM_LABELS, DOWNSTREAM_SOURCE,
  type ChainTimestamps, type DownstreamModule,
} from '../../lib/flowsheet/syncStatus';

/**
 * Signale qu'un module dérivé des critères de conception reflète un état ancien.
 *
 * Les critères alimentent Flowsheet, puis Bilan massique et Équipements — mais
 * rien ne propage : chaque module a son bouton « Générer ». Cocher le rebroyage
 * dans l'assistant ne faisait donc rien apparaître en aval, sans qu'aucun écran
 * ne le signale.
 *
 * On ne régénère PAS automatiquement : les générateurs suppriment les lignes
 * existantes avant de réinsérer, et effaceraient les capacités, puissances et
 * commentaires saisis à la main. On signale, l'ingénieur décide — et le message
 * rappelle l'ORDRE de la chaîne, qu'on ne peut pas deviner devant trois boutons
 * indépendants.
 */
export function SyncBanner({
  projectId, module, onRegenerate, regenerating,
}: {
  projectId: string;
  module: DownstreamModule;
  /** Action de régénération du module — le bouton n'apparaît que si fournie. */
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  const [ts, setTs] = useState<ChainTimestamps | null>(null);

  const load = useCallback(async () => {
    // `maybeSingle` + tri décroissant : on veut la dernière génération de chaque
    // artefact. Fail-open — une table vide ou en erreur vaut « jamais généré ».
    const latest = async (table: string, col: string): Promise<string | null> => {
      const { data, error } = await supabase
        .from(table as never)
        .select(col)
        .eq('project_id', projectId)
        .order(col, { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return (data as Record<string, string | null>)[col] ?? null;
    };
    const [criteriaAt, flowsheetAt, massBalanceAt, equipmentAt] = await Promise.all([
      latest('dc_draft', 'updated_at'),
      latest('project_flowsheets', 'updated_at'),
      latest('mass_balance_streams', 'updated_at'),
      latest('equipment_items', 'created_at'),
    ]);
    setTs({ criteriaAt, flowsheetAt, massBalanceAt, equipmentAt });
  }, [projectId]);

  useEffect(() => { load(); }, [load, regenerating]);

  if (!ts) return null;
  const status = moduleSyncStatus(module, ts);
  if (status.state === 'current') return null;

  const chainHint = DOWNSTREAM_SOURCE[module] === 'flowsheet'
    ? ` Régénérez d'abord ${DOWNSTREAM_LABELS.flowsheet} si les critères ont changé, puis ce module.`
    : '';

  const missing = status.state === 'missing';
  return (
    <div className={`rounded-xl border p-3 mb-4 flex items-start gap-3 ${
      missing ? 'border-mf-border bg-mf-hover/20' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <AlertTriangle size={15} className={missing ? 'text-mf-txt4 shrink-0 mt-0.5' : 'text-amber-400 shrink-0 mt-0.5'} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-mf-txt">
          {missing ? `${status.label} — jamais généré` : `${status.label} n'est plus à jour`}
          {status.behindMinutes > 0 && (
            <span className="text-mf-txt4 font-normal"> · {status.behindMinutes} min de retard</span>
          )}
        </div>
        <div className="text-[10px] text-mf-txt4 mt-0.5 leading-relaxed">
          {status.message}{chainHint}
        </div>
      </div>
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="btn btn-teal btn-sm gap-1.5 shrink-0"
          title={`Régénérer ${status.label} depuis ${status.sourceLabel}`}
        >
          <RefreshCw size={12} className={regenerating ? 'animate-spin' : ''} />
          {regenerating ? 'Génération…' : 'Régénérer'}
        </button>
      )}
    </div>
  );
}
