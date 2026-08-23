import { useState } from 'react';
import { ArrowRight, Star, CheckCircle2, Lock, BarChart3, Layers, DollarSign, Mountain } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { resolvePublicRuntimeConfig } from '../lib/config/appConfig';

interface LandingPageProps { onAuth: () => void; }

const PIPELINE_STEPS = [
  { label: 'BLOC\nMODÈLE', sub: 'Géologie',   color: '#2ECC8A', bg: 'bg-emerald-500/20 border-emerald-500/30' },
  { label: 'LIMS\nTests',  sub: 'Labo',        color: '#5BA4F5', bg: 'bg-blue-500/20 border-blue-500/30' },
  { label: 'CRITÈRES\nDESIGN', sub: 'Ingénierie', color: '#F59E0B', bg: 'bg-amber-500/20 border-amber-500/30' },
  { label: 'BILAN\nMASSIQUE', sub: 'Procédé',  color: '#5BA4F5', bg: 'bg-blue-500/20 border-blue-500/30' },
  { label: 'SIM &\nOPTIM', sub: 'Monte Carlo', color: '#9D78F0', bg: 'bg-purple-500/20 border-purple-500/30' },
  { label: 'NI 43-101\nRapport', sub: 'CIM / JORC', color: '#F59E0B', bg: 'bg-amber-500/20 border-amber-500/30' },
];

const FEATURES = [
  { icon: Layers,    title: '60+ Opérations unitaires',     desc: 'Concassage, broyage, gravité, flottation, CIL/CIP, élution, électrolyse' },
  { icon: BarChart3, title: 'Bilan massique dynamique',      desc: 'Monte Carlo 5 000 sims · empreinte carbone · eau · réactifs intégrés' },
  { icon: DollarSign,title: 'MER 400+ postes CAPEX',        desc: 'Registre mécanique complet : WBS, vendeurs, facteurs de contingence' },
  { icon: Mountain,  title: 'Intelligence géométallurgique', desc: 'Block Model → LOM 15 ans → NPV · optimisation GADE · IMBO' },
];

export function LandingPage({ onAuth }: LandingPageProps) {
  const [tab, setTab]         = useState<'login' | 'register'>('login');
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [notice, setNotice]   = useState('');

  async function handleForgotPassword() {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Saisissez votre adresse courriel pour réinitialiser le mot de passe.');
      return;
    }
    setLoading(true);
    try {
      const { siteUrl } = resolvePublicRuntimeConfig(import.meta.env as Record<string, string | undefined>);
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${siteUrl}/`,
      });
      if (err) { setError(err.message); return; }
      setNotice('Si un compte existe pour cet e-mail, un lien de réinitialisation vient d’être envoyé.');
    } finally { setLoading(false); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (tab === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) { setError(err.message); return; }
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password,
          options: { data: { full_name: name } }
        });
        if (err) { setError(err.message); return; }
        // L'accès n'est PAS immédiat : un administrateur doit valider le compte.
        setNotice('Compte créé. Un administrateur doit valider votre accès avant que vous puissiez utiliser la plateforme. Vous serez alors connecté à votre prochaine tentative.');
        setTab('login');
        setPassword('');
        return;
      }
      onAuth();
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-[#0A0E17] text-mf-txt flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-mf-border/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
            <Layers size={18} className="text-[#0A0E17]" />
          </div>
          <div>
            <div className="text-sm font-bold text-mf-txt tracking-wide leading-tight">MetalFlow Pro</div>
            <div className="text-[9px] font-semibold text-amber-500 uppercase tracking-widest">MPDPMS V4.0</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/30 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs font-medium text-teal-400">NI 43-101 Compliant</span>
          </div>
          <div className="px-3 py-1.5 border border-mf-border rounded-full text-xs font-medium text-mf-txt3">
            Stage-Gate EPCM
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex items-start gap-12 px-12 py-12 max-w-7xl mx-auto w-full">
        {/* Left: Hero */}
        <div className="flex-1 space-y-8">
          <div>
            <div className="inline-flex items-center gap-2 px-4 py-2 border border-amber-500/30 rounded-full bg-amber-500/8 mb-6">
              <Star size={12} className="text-amber-400 fill-amber-400" />
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-widest">
                Plateforme Métallurgique Professionnelle
              </span>
            </div>
            <h1 className="text-5xl font-bold leading-tight text-mf-txt">
              De la géologie au<br />
              <span className="text-amber-400">lingot d'or</span> — en un seul outil
            </h1>
            <p className="mt-4 text-base text-mf-txt3 max-w-lg leading-relaxed">
              MetalFlow Pro unifie le <strong className="text-mf-txt">LIMS</strong>, les critères de conception, le bilan
              massique, la simulation procédé et l'optimisation Mine-to-Mill dans une
              seule plateforme conforme <strong className="text-mf-txt">NI 43-101</strong>.
            </p>
          </div>

          {/* Mine-to-Mill pipeline diagram */}
          <div className="rounded-xl border border-mf-border bg-mf-card/60 p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-mf-txt4 mb-4">
              Flux Mine-to-Mill Intégré
            </div>
            <div className="flex items-center gap-1">
              {PIPELINE_STEPS.map((step, i) => (
                <div key={i} className="flex items-center gap-1 flex-1">
                  <div className={`flex-1 flex flex-col items-center justify-center p-2.5 rounded-lg border ${step.bg} text-center min-h-[56px]`}>
                    <div className="text-[10px] font-bold leading-tight whitespace-pre" style={{ color: step.color }}>
                      {step.label}
                    </div>
                    <div className="text-[9px] text-mf-txt4 mt-1">{step.sub}</div>
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <ArrowRight size={12} className="text-mf-txt4 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="p-4 rounded-xl border border-mf-border bg-mf-card/50 hover:bg-mf-card transition-all">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center mb-3">
                  <f.icon size={16} className="text-amber-400" />
                </div>
                <div className="text-sm font-semibold text-mf-txt mb-1">{f.title}</div>
                <div className="text-xs text-mf-txt4 leading-relaxed">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Auth card */}
        <div className="w-[400px] shrink-0 sticky top-8">
          <div className="rounded-2xl border border-mf-border bg-mf-card shadow-card p-8">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                <Layers size={28} className="text-amber-400" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-mf-txt text-center mb-1">Accéder à MetalFlow Pro</h2>
            <p className="text-sm text-mf-txt4 text-center mb-6">Plateforme réservée aux ingénieurs métallurgistes</p>

            {/* Tab toggle */}
            <div className="flex rounded-lg overflow-hidden border border-mf-border mb-6">
              <button
                onClick={() => { setTab('login'); setError(''); }}
                className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tab === 'login' ? 'bg-amber-500 text-mf-bg' : 'bg-mf-panel text-mf-txt3 hover:text-mf-txt2'}`}
              >
                Se connecter
              </button>
              <button
                onClick={() => { setTab('register'); setError(''); }}
                className={`flex-1 py-2.5 text-sm font-semibold transition-all ${tab === 'register' ? 'bg-amber-500 text-mf-bg' : 'bg-mf-panel text-mf-txt3 hover:text-mf-txt2'}`}
              >
                Créer un compte
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {tab === 'register' && (
                <div>
                  <label className="label">Nom complet</label>
                  <input className="input-field" placeholder="Dr. M. Kofi" value={name}
                    onChange={e => setName(e.target.value)} required />
                </div>
              )}
              <div>
                <label className="label">Adresse courriel</label>
                <input className="input-field" type="email" placeholder="ingenieur@minier.com"
                  value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
              </div>
              <div>
                <label className="label">Mot de passe</label>
                <input className="input-field" type="password" placeholder="••••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} />
              </div>

              {tab === 'login' && (
                <div className="text-right">
                  <button type="button" onClick={handleForgotPassword} disabled={loading}
                    className="text-xs text-mf-txt4 hover:text-mf-txt3">
                    Mot de passe oublié ?
                  </button>
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  {error}
                </div>
              )}

              {notice && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                  {notice}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full btn btn-primary justify-center py-3 text-sm font-semibold"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-mf-bg border-t-transparent rounded-full animate-spin" />
                ) : (
                  <><ArrowRight size={16} /> {tab === 'login' ? 'Se connecter' : 'Créer mon compte'}</>
                )}
              </button>
            </form>

            {tab === 'login' && (
              <p className="text-center text-xs text-mf-txt4 mt-4">
                Pas encore de compte ?{' '}
                <button onClick={() => setTab('register')} className="text-amber-400 font-semibold hover:underline">
                  Inscrivez-vous gratuitement →
                </button>
              </p>
            )}

            {/* Security badges */}
            <div className="mt-6 pt-5 border-t border-mf-border flex items-center justify-center gap-5 text-[11px] text-mf-txt4">
              <div className="flex items-center gap-1.5">
                <Lock size={11} className="text-mf-txt4" />
                Connexion sécurisée JWT
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={11} className="text-mf-txt4" />
                Données isolées par projet
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
