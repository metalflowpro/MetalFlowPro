import { useState } from 'react';
import { FileText, CheckCircle2, Circle, Download } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import type { Project } from '../types';

const NI_SECTIONS = [
  { num: '1',  title: 'Résumé',                              status: 'completed', pages: 8  },
  { num: '2',  title: 'Introduction',                        status: 'completed', pages: 4  },
  { num: '3',  title: 'Accès, Localisation et Physiographie',status: 'completed', pages: 6  },
  { num: '4',  title: 'Histoire',                            status: 'completed', pages: 5  },
  { num: '5',  title: 'Cadre Géologique Régional',           status: 'completed', pages: 12 },
  { num: '6',  title: 'Géologie Locale',                     status: 'completed', pages: 10 },
  { num: '7',  title: 'Dépôt de Minéral',                    status: 'completed', pages: 9  },
  { num: '8',  title: 'Type de Dépôt',                       status: 'completed', pages: 7  },
  { num: '9',  title: 'Exploration',                         status: 'in_progress', pages: 14 },
  { num: '10', title: 'Forage',                              status: 'in_progress', pages: 18 },
  { num: '11', title: 'Préparation des Échantillons, Analyse et Sécurité', status: 'completed', pages: 15 },
  { num: '12', title: 'Vérification des Données',            status: 'completed', pages: 8  },
  { num: '13', title: 'Traitement Minéralurgique',           status: 'in_progress', pages: 22 },
  { num: '14', title: 'Ressources Minérales',                status: 'pending',  pages: 20 },
  { num: '15', title: 'Réserves Minérales',                  status: 'pending',  pages: 18 },
  { num: '16', title: 'Méthodes Minières',                   status: 'pending',  pages: 25 },
  { num: '17', title: 'Recovery Methods',                    status: 'pending',  pages: 30 },
  { num: '18', title: 'Considérations de Marché',            status: 'pending',  pages: 12 },
  { num: '19', title: 'Conclusions Environnementales',       status: 'pending',  pages: 20 },
  { num: '20', title: 'Utilisation des Ressources',          status: 'pending',  pages: 10 },
  { num: '21', title: 'Risques et Opportunités',             status: 'pending',  pages: 15 },
  { num: '22', title: 'Interprétations et Conclusions',      status: 'pending',  pages: 10 },
  { num: '23', title: 'Recommandations',                     status: 'pending',  pages: 6  },
  { num: '24', title: 'Références',                          status: 'completed', pages: 5  },
  { num: '25', title: 'Certificats des Auteurs Qualifiés',   status: 'completed', pages: 4  },
  { num: '26', title: 'Date et Signature',                   status: 'completed', pages: 2  },
];

const STATUS_CFG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  completed:   { icon: CheckCircle2, color: 'text-emerald-400', label: 'Complété' },
  in_progress: { icon: Circle,       color: 'text-amber-400',   label: 'En cours' },
  pending:     { icon: Circle,       color: 'text-mf-txt4',     label: 'En attente' },
};

interface ReportsProps { project: Project }

export function Reports({ project }: ReportsProps) {
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab]   = useState<'ni43101' | 'internal'>('ni43101');

  const completed = NI_SECTIONS.filter(s => s.status === 'completed').length;
  const inProgress = NI_SECTIONS.filter(s => s.status === 'in_progress').length;
  const pending    = NI_SECTIONS.filter(s => s.status === 'pending').length;
  const totalPages = NI_SECTIONS.reduce((s, n) => s + n.pages, 0);

  function handleGenerate() {
    setGenerating(true);
    setTimeout(() => setGenerating(false), 2500);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Conformité & Rapports"
        subtitle={`NI 43-101 · Rapports internes/externes — ${project.name}`}
        breadcrumb={['Conformité & Rapports']}
        actions={
          <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={generating}>
            {generating
              ? <><span className="w-4 h-4 border-2 border-mf-bg border-t-transparent rounded-full animate-spin" /> Génération...</>
              : <><Download size={14} /> Générer PDF</>
            }
          </button>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Summary */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Sections complètes', val: completed,  total: NI_SECTIONS.length, color: 'text-emerald-400' },
            { label: 'En cours',           val: inProgress, total: NI_SECTIONS.length, color: 'text-amber-400' },
            { label: 'En attente',         val: pending,    total: NI_SECTIONS.length, color: 'text-mf-txt4' },
            { label: 'Pages estimées',     val: totalPages, total: null,               color: 'text-blue-400' },
          ].map(s => (
            <div key={s.label} className="card-sm text-center">
              <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}{s.total ? `/${s.total}` : ''}</div>
              <div className="text-xs text-mf-txt4 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Overall progress */}
        <div className="card">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-mf-txt">Progression rapport NI 43-101</span>
            <span className="text-sm font-mono text-amber-400">{Math.round(completed / NI_SECTIONS.length * 100)}%</span>
          </div>
          <div className="progress-bar h-3">
            <div className="progress-fill bg-amber-500/80" style={{ width: `${completed / NI_SECTIONS.length * 100}%` }} />
          </div>
        </div>

        {/* Tabs */}
        <div className="tab-bar">
          <button className={`tab ${activeTab === 'ni43101' ? 'active' : ''}`} onClick={() => setActiveTab('ni43101')}>Rapport NI 43-101</button>
          <button className={`tab ${activeTab === 'internal' ? 'active' : ''}`} onClick={() => setActiveTab('internal')}>Rapports Internes</button>
        </div>

        {activeTab === 'ni43101' && (
          <div className="card overflow-hidden p-0">
            <div className="px-5 py-3 border-b border-mf-border flex items-center justify-between">
              <span className="text-sm font-semibold text-mf-txt">Sections techniques — NI 43-101</span>
              <span className="text-xs text-mf-txt4">{totalPages} pages estimées</span>
            </div>
            <table className="tbl">
              <thead>
                <tr><th>§</th><th>Section</th><th className="text-right">Pages</th><th>Statut</th><th>Auteur qualifié</th></tr>
              </thead>
              <tbody>
                {NI_SECTIONS.map(s => {
                  const cfg = STATUS_CFG[s.status];
                  const Ico = cfg.icon;
                  return (
                    <tr key={s.num}>
                      <td><span className="font-mono text-xs text-mf-txt4 font-bold">{s.num}</span></td>
                      <td className="text-mf-txt">{s.title}</td>
                      <td className="num">{s.pages}</td>
                      <td>
                        <div className={`flex items-center gap-1.5 text-xs ${cfg.color}`}>
                          <Ico size={12} className={s.status === 'in_progress' ? 'animate-pulse' : ''} />
                          {cfg.label}
                        </div>
                      </td>
                      <td className="text-xs text-mf-txt4">
                        {s.status === 'pending' ? '—' : 'Dr. M. Kofi, P.Eng.'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'internal' && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { title: 'Rapport mensuel procédé',    date: '31 Mar 2025', type: 'PDF', status: 'ready', pages: 24 },
              { title: 'Note technique — Bilan eau', date: '28 Mar 2025', type: 'PDF', status: 'ready', pages: 12 },
              { title: 'Résumé exécutif Q1 2025',   date: '01 Avr 2025', type: 'PDF', status: 'ready', pages: 6  },
              { title: 'Rapport LIMS — Campagne C3', date: '15 Mar 2025', type: 'XLS', status: 'ready', pages: 45 },
              { title: 'Analyse risques — v2',       date: '10 Mar 2025', type: 'PDF', status: 'ready', pages: 18 },
              { title: 'Budget révisé CAPEX FY2025', date: '05 Mar 2025', type: 'XLS', status: 'ready', pages: 32 },
            ].map(r => (
              <div key={r.title} className="card-sm flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <FileText size={16} className="text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-mf-txt">{r.title}</div>
                    <div className="text-xs text-mf-txt4 mt-0.5">{r.date} · {r.type} · {r.pages} p.</div>
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm justify-center mt-auto">
                  <Download size={12} /> Télécharger
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
