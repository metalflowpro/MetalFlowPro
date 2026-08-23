import { useEffect, useState, useCallback } from 'react';
import { Webhook, RefreshCw, Copy, Check } from 'lucide-react';
import {
  getIngestionConfig, upsertIngestionConfig, randomSecret,
  type P80Study, type P80IngestionConfig,
} from '../../../lib/db/p80Study';

interface Props { study: P80Study; }

const ENDPOINT = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''}/functions/v1/lims-webhook`;

/**
 * Configuration du webhook LIMS entrant (Phase 2). Le LIMS externe POST ses
 * résultats publiés sur l'endpoint avec l'en-tête `x-lims-secret`. La fonction
 * edge vérifie ce secret contre cette config puis crée des p80_test_result.
 */
export function WebhookConfigPanel({ study }: Props) {
  const [cfg, setCfg] = useState<P80IngestionConfig | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => { setCfg(await getIngestionConfig(study.id)); }, [study.id]);
  useEffect(() => { void load(); }, [load]);

  const applyCfg = (next: P80IngestionConfig) => {
    setCfg(next);
    if (next.revealedSecret) setRevealed(next.revealedSecret);
  };

  const toggle = async () => {
    setBusy(true);
    try { applyCfg(await upsertIngestionConfig(study.project_id, study.id, { enabled: !(cfg?.enabled) })); }
    finally { setBusy(false); }
  };
  const rotate = async () => {
    setBusy(true);
    try { applyCfg(await upsertIngestionConfig(study.project_id, study.id, { secret: randomSecret() })); }
    finally { setBusy(false); }
  };
  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key); setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rounded-xl border border-mf-border bg-mf-card p-4 max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Webhook size={14} className="text-teal-400" /><span className="text-sm font-semibold text-mf-txt">Webhook LIMS entrant</span></div>
        <label className="flex items-center gap-1.5 text-xs text-mf-txt3">
          <input type="checkbox" checked={!!cfg?.enabled} disabled={busy} onChange={() => void toggle()} />
          {cfg?.enabled ? 'Activé' : 'Désactivé'}
        </label>
      </div>
      <p className="text-[11px] text-mf-txt4 mb-3">
        Le LIMS externe POST ses résultats publiés sur cet endpoint avec l'en-tête <span className="font-mono">x-lims-secret</span> ;
        les résultats sont créés comme références (non révisés) dans cette étude, sans polling.
      </p>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-mf-txt4 block mb-0.5">Endpoint</label>
          <div className="flex items-center gap-2">
            <input readOnly className="input-field text-xs font-mono flex-1" value={ENDPOINT} />
            <button onClick={() => void copy(ENDPOINT, 'url')} className="text-teal-400 hover:text-teal-300">{copied === 'url' ? <Check size={14} /> : <Copy size={14} />}</button>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-mf-txt4 block mb-0.5">Secret (x-lims-secret)</label>
          <div className="flex items-center gap-2">
            <input readOnly className="input-field text-xs font-mono flex-1" type={revealed ? 'text' : 'password'}
              value={revealed ?? (cfg ? '•••••••••••••••• (affiché uniquement à la génération)' : '— générez en activant —')} />
            <button onClick={() => void copy(revealed ?? '', 'sec')} disabled={!revealed} className="text-teal-400 hover:text-teal-300 disabled:opacity-30">{copied === 'sec' ? <Check size={14} /> : <Copy size={14} />}</button>
            <button onClick={() => void rotate()} disabled={busy || !cfg} title="Régénérer le secret" className="text-mf-txt4 hover:text-mf-txt"><RefreshCw size={13} /></button>
          </div>
          {revealed && (
            <p className="text-[10px] text-amber-400/90 mt-1">Copiez ce secret maintenant — il ne sera plus relisible après rechargement.</p>
          )}
        </div>
      </div>
      {cfg?.last_triggered_at && <div className="text-[10px] text-mf-txt4 mt-2">Dernier déclenchement : {new Date(cfg.last_triggered_at).toLocaleString('fr-CA')}</div>}
    </div>
  );
}
