import { useState, useRef, useEffect } from 'react';
import { Sparkles, X, CornerDownLeft, Loader2 } from 'lucide-react';
import { askCopilot, COPILOT_ENABLED } from '../../lib/copilot';
import type { Project } from '../../types';

interface CopilotPanelProps {
  project: Project;
  /** Extra derived metrics (KPIs, recovery, economics) to ground answers. */
  context?: Record<string, unknown>;
}

interface Turn { role: 'user' | 'assistant'; text: string; }

/**
 * Floating LLM copilot (T1). Renders only when VITE_COPILOT_ENABLED === 'true'
 * (i.e. the Edge Function is deployed), so it is inert in production until
 * explicitly activated. Answers are grounded on the compact project context.
 */
export function CopilotPanel({ project, context }: CopilotPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  if (!COPILOT_ENABLED) return null;

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    setTurns(t => [...t, { role: 'user', text: q }]);
    setBusy(true);
    try {
      const { answer } = await askCopilot(q, {
        project: {
          code: project.code, name: project.name, country: project.country, phase: project.phase,
          target_tph: project.target_tph, gold_grade_g_t: project.gold_grade_g_t,
          availability_pct: project.availability_pct, recovery_pct: project.recovery_pct,
          ore_sg: project.ore_sg, gold_price_usd: project.gold_price_usd,
        },
        ...context,
      });
      setTurns(t => [...t, { role: 'assistant', text: answer || '(réponse vide)' }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      setTurns(t => [...t, { role: 'assistant', text: `⚠️ ${msg}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ouvrir le copilote"
          className="no-print fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-3 rounded-full
                     bg-gold-gradient text-mf-bg font-semibold shadow-gold hover:brightness-110 active:scale-95 transition"
        >
          <Sparkles size={16} /> Copilote
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="no-print fixed bottom-5 right-5 z-40 w-[380px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[80vh]
                        flex flex-col bg-mf-card border border-mf-border rounded-2xl shadow-card overflow-hidden"
             role="dialog" aria-label="Copilote MetalFlow">
          <div className="flex items-center justify-between px-4 py-3 border-b border-mf-border">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-amber-400" />
              <span className="text-sm font-semibold text-mf-txt">Copilote MetalFlow</span>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Fermer" className="btn btn-ghost btn-sm rounded-lg">
              <X size={15} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {turns.length === 0 && (
              <div className="text-xs text-mf-txt4 space-y-2">
                <p>Posez une question sur <span className="text-mf-txt3">{project.code}</span> :</p>
                <ul className="space-y-1">
                  {['Quel est mon AISC si l\'or passe à 1 900 $/oz ?',
                    'Explique ma récupération globale.',
                    'Rédige le résumé procédé pour le NI 43-101.'].map(s => (
                    <li key={s}>
                      <button onClick={() => setInput(s)} className="text-left text-amber-400/80 hover:text-amber-300">— {s}</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`text-sm ${t.role === 'user' ? 'text-mf-txt' : 'text-mf-txt2'}`}>
                <div className="text-[10px] uppercase tracking-wider text-mf-txt4 mb-0.5">
                  {t.role === 'user' ? 'Vous' : 'Copilote'}
                </div>
                <div className="whitespace-pre-wrap leading-relaxed">{t.text}</div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-mf-txt4">
                <Loader2 size={13} className="animate-spin" /> Analyse…
              </div>
            )}
          </div>

          <div className="p-3 border-t border-mf-border">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={2}
                placeholder="Votre question…"
                className="input-field flex-1 resize-none text-sm"
              />
              <button onClick={send} disabled={busy || !input.trim()} className="btn btn-sm btn-primary" aria-label="Envoyer">
                <CornerDownLeft size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
