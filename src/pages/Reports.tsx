import { useState, useEffect, useCallback } from 'react';
import {
  FileText, CheckCircle2, Circle, Download, Plus, Trash2, RefreshCw,
  FileSpreadsheet, AlertCircle, Edit3, X,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { PrintButton } from '../components/ui/PrintButton';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ui/ConfirmDialog';
import type { Project, ReportDocument } from '../types';

const REPORT_TYPE_LABELS: Record<string, string> = {
  ni43101: 'NI 43-101', internal: 'Interne', monthly: 'Mensuel', technical: 'Technique',
  budget: 'Budget', water: 'Bilan Eau', lims: 'LIMS', risk: 'Risques',
  flowsheet: 'Flowsheet', economics: 'Économie',
};

const REPORT_TYPE_ICONS: Record<string, typeof FileText> = {
  ni43101: FileText, internal: FileSpreadsheet, monthly: FileText, technical: FileText,
  budget: FileSpreadsheet, water: FileText, lims: FileText, risk: FileText,
  flowsheet: FileText, economics: FileSpreadsheet,
};

const STATUS_CFG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  draft:     { icon: Circle,       color: 'text-mf-txt4',     label: 'Brouillon' },
  generated: { icon: FileText,     color: 'text-amber-400',   label: 'Généré' },
  validated: { icon: CheckCircle2, color: 'text-sky-400',     label: 'Validé' },
  published: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Publié' },
};

interface ReportsProps { project: Project }

export function Reports({ project }: ReportsProps) {
  const confirm = useConfirm();
  const [reports, setReports] = useState<ReportDocument[]>([]);
  const [niSections, setNiSections] = useState<{ section_number: string; section_title: string; status: string; validated_by: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'ni43101' | 'internal'>('ni43101');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<ReportDocument | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({
    title: '', report_type: 'internal' as ReportDocument['report_type'],
    author_name: '', pages_estimated: '0',
  });

  const loadReports = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('report_documents')
      .select('*')
      .eq('project_id', project.id)
      .order('updated_at', { ascending: false });
    setReports((data ?? []) as ReportDocument[]);

    const { data: sections } = await supabase
      .from('ni43101_sections')
      .select('section_number,section_title,status,validated_by')
      .eq('project_id', project.id)
      .order('section_number');
    setNiSections(sections ?? []);

    setLoading(false);
  }, [project.id]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const niCompleted = niSections.filter(s => s.status === 'validated' || s.status === 'generated').length;
  const niInProgress = niSections.filter(s => s.status === 'draft').length;
  const niPending = niSections.filter(s => s.status === 'pending').length;
  const _totalPages = niSections.length * 8;

  async function handleCreate() {
    const payload = {
      project_id: project.id,
      title: newForm.title,
      report_type: newForm.report_type,
      author_name: newForm.author_name || null,
      pages_estimated: parseInt(newForm.pages_estimated) || 0,
      status: 'draft' as const,
    };
    await supabase.from('report_documents').insert(payload);
    setShowNew(false);
    setNewForm({ title: '', report_type: 'internal', author_name: '', pages_estimated: '0' });
    loadReports();
  }

  async function handleDelete(id: string) {
    const doc = reports.find(r => r.id === id);
    const ok = await confirm({
      title: 'Supprimer ce rapport ?',
      message: doc ? `« ${doc.title} » sera définitivement supprimé.` : 'Ce document sera définitivement supprimé.',
    });
    if (!ok) return;
    await supabase.from('report_documents').delete().eq('id', id).eq('project_id', project.id);
    loadReports();
  }

  async function handleGenerate(report: ReportDocument) {
    setGenerating(report.id);
    try {
      const snapshot: Record<string, unknown> = { project_name: project.name, generated_at: new Date().toISOString() };

      if (report.report_type === 'ni43101') {
        const { data: niReport } = await supabase
          .from('ni43101_reports')
          .select('id')
          .eq('project_id', project.id)
          .maybeSingle();
        const { data: sections } = niReport
          ? await supabase
              .from('ni43101_sections')
              .select('section_number,section_title,content,validated_by')
              .eq('report_id', niReport.id)
              .eq('project_id', project.id)
          : { data: [] };
        snapshot.sections = sections ?? [];
        snapshot.sections_total = sections?.length ?? 0;
        snapshot.sections_completed = sections?.filter(s => s.content != null).length ?? 0;
      } else if (report.report_type === 'economics') {
        const { data: capex } = await supabase.from('capex_lines').select('*').eq('project_id', project.id);
        const { data: opex } = await supabase.from('opex_lines').select('*').eq('project_id', project.id);
        snapshot.capex_lines = capex ?? [];
        snapshot.opex_lines = opex ?? [];
      } else if (report.report_type === 'lims') {
        const { count } = await supabase.from('lims_samples').select('*', { count: 'exact', head: true }).eq('project_id', project.id);
        snapshot.sample_count = count ?? 0;
      } else if (report.report_type === 'risk') {
        const { data: risks } = await supabase.from('risks').select('*').eq('project_id', project.id);
        snapshot.risks = risks ?? [];
      }

      const pages = snapshot.sections_total
        ? Math.max(10, (snapshot.sections_total as number) * 8)
        : report.pages_estimated || 10;

      await supabase.from('report_documents').update({
        status: 'generated',
        content_snapshot: snapshot,
        pages_estimated: pages,
        sections_total: snapshot.sections_total as number ?? 0,
        sections_completed: snapshot.sections_completed as number ?? 0,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never).eq('id', report.id).eq('project_id', project.id);

      downloadReport(report, snapshot);
      loadReports();
    } finally {
      setGenerating(null);
    }
  }

  function downloadReport(report: ReportDocument, snapshot: Record<string, unknown>) {
    const lines: string[] = [
      `MetalFlow Pro — ${report.title}`,
      `Projet: ${project.name} (${project.code})`,
      `Type: ${REPORT_TYPE_LABELS[report.report_type]}`,
      `Date: ${new Date().toLocaleString('fr-CA')}`,
      report.author_name ? `Auteur: ${report.author_name}` : '',
      '',
      '═══════════════════════════════════════════════════════════',
      '',
    ];

    if (snapshot.sections && Array.isArray(snapshot.sections)) {
      for (const s of snapshot.sections as { section_number: string; section_title: string; content?: string }[]) {
        lines.push(`§${s.section_number} — ${s.section_title}`);
        lines.push(s.content ?? '[Section non encore rédigée]');
        lines.push('');
      }
    } else {
      for (const [key, value] of Object.entries(snapshot)) {
        if (Array.isArray(value)) {
          lines.push(`${key}:`);
          for (const item of value) {
            lines.push(`  - ${typeof item === 'object' ? JSON.stringify(item) : item}`);
          }
        } else {
          lines.push(`${key}: ${value}`);
        }
        lines.push('');
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Conformité & Rapports"
        subtitle={`NI 43-101 · Rapports internes/externes — ${project.name}`}
        breadcrumb={['Conformité & Rapports']}
        actions={
          <>
            <PrintButton documentTitle={`Rapport — ${project.code}`} label="Exporter PDF" />
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
              <Plus size={14} /> Nouveau rapport
            </button>
          </>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-mf-txt4">
            <RefreshCw size={14} className="animate-spin" /> Chargement…
          </div>
        )}

        {!loading && (
          <>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Sections NI 43-101 complètes', val: niCompleted, total: niSections.length, color: 'text-emerald-400' },
                { label: 'En cours', val: niInProgress, total: niSections.length, color: 'text-amber-400' },
                { label: 'En attente', val: niPending, total: niSections.length, color: 'text-mf-txt4' },
                { label: 'Rapports générés', val: reports.filter(r => r.status === 'generated' || r.status === 'validated').length, total: null, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="card-sm text-center">
                  <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}{s.total ? `/${s.total}` : ''}</div>
                  <div className="text-xs text-mf-txt4 mt-1">{s.label}</div>
                </div>
              ))}
            </div>

            {niSections.length > 0 && (
              <div className="card">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-mf-txt">Progression rapport NI 43-101</span>
                  <span className="text-sm font-mono text-amber-400">{niSections.length > 0 ? Math.round(niCompleted / niSections.length * 100) : 0}%</span>
                </div>
                <div className="progress-bar h-3">
                  <div className="progress-fill bg-amber-500/80" style={{ width: `${niSections.length > 0 ? (niCompleted / niSections.length * 100) : 0}%` }} />
                </div>
              </div>
            )}

            {niSections.length === 0 && (
              <div className="card border-amber-500/30 bg-amber-400/5 flex items-start gap-3">
                <AlertCircle size={15} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold text-amber-300 mb-1">Aucune section NI 43-101 configurée</div>
                  <div className="text-xs text-amber-300/80">
                    Accédez au module NI 43-101 pour générer et valider les sections techniques.
                    Les rapports générés ici refléteront l'état réel des sections.
                  </div>
                </div>
              </div>
            )}

            <div className="tab-bar">
              <button className={`tab ${activeTab === 'ni43101' ? 'active' : ''}`} onClick={() => setActiveTab('ni43101')}>Rapport NI 43-101</button>
              <button className={`tab ${activeTab === 'internal' ? 'active' : ''}`} onClick={() => setActiveTab('internal')}>Tous les rapports ({reports.length})</button>
            </div>

            {activeTab === 'ni43101' && niSections.length > 0 && (
              <div className="card overflow-hidden p-0">
                <div className="px-5 py-3 border-b border-mf-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-mf-txt">Sections techniques — NI 43-101</span>
                  <span className="text-xs text-mf-txt4">{niSections.length} sections</span>
                </div>
                <table className="tbl">
                  <thead>
                    <tr><th>§</th><th>Section</th><th>Statut</th><th>Validé par</th></tr>
                  </thead>
                  <tbody>
                    {niSections.map(s => {
                      const cfg = STATUS_CFG[s.status === 'validated' ? 'validated' : s.status === 'generated' ? 'generated' : s.status === 'draft' ? 'draft' : 'draft'] ?? STATUS_CFG.draft;
                      const Ico = cfg.icon;
                      return (
                        <tr key={s.section_number}>
                          <td><span className="font-mono text-xs text-mf-txt4 font-bold">{s.section_number}</span></td>
                          <td className="text-mf-txt">{s.section_title}</td>
                          <td>
                            <div className={`flex items-center gap-1.5 text-xs ${cfg.color}`}>
                              <Ico size={12} />
                              {cfg.label}
                            </div>
                          </td>
                          <td className="text-xs text-mf-txt4">{s.validated_by ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'internal' && (
              <div className="grid grid-cols-3 gap-4">
                {reports.length === 0 && (
                  <div className="col-span-3 card flex flex-col items-center gap-2 py-12">
                    <FileText size={28} className="text-mf-border" />
                    <p className="text-sm text-mf-txt3">Aucun rapport. Cliquez sur "Nouveau rapport" pour commencer.</p>
                  </div>
                )}
                {reports.map(r => {
                  const Ico = REPORT_TYPE_ICONS[r.report_type] ?? FileText;
                  const cfg = STATUS_CFG[r.status] ?? STATUS_CFG.draft;
                  return (
                    <div key={r.id} className="card-sm flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <Ico size={16} className="text-blue-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-mf-txt truncate">{r.title}</div>
                          <div className="text-xs text-mf-txt4 mt-0.5">
                            {REPORT_TYPE_LABELS[r.report_type]} · {r.pages_estimated} p.
                          </div>
                          <div className={`flex items-center gap-1 text-[10px] mt-1 ${cfg.color}`}>
                            <cfg.icon size={10} /> {cfg.label}
                          </div>
                        </div>
                      </div>
                      {r.author_name && <div className="text-[10px] text-mf-txt4">Auteur: {r.author_name}</div>}
                      {r.generated_at && <div className="text-[10px] text-mf-txt4">Généré: {new Date(r.generated_at).toLocaleDateString('fr-CA')}</div>}
                      <div className="flex gap-2 mt-auto">
                        <button
                          className="btn btn-primary btn-sm flex-1 justify-center"
                          onClick={() => handleGenerate(r)}
                          disabled={generating === r.id}
                        >
                          {generating === r.id
                            ? <><span className="w-3 h-3 border-2 border-mf-bg border-t-transparent rounded-full animate-spin" /> Génération…</>
                            : <><Download size={12} /> Générer</>
                          }
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(r)}>
                          <Edit3 size={12} />
                        </button>
                        <button className="btn btn-secondary btn-sm text-red-400" onClick={() => handleDelete(r.id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {showNew && (
        <Modal
          title="Nouveau rapport"
          onClose={() => setShowNew(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newForm.title}>Créer</button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="label">Titre du rapport *</label>
              <input className="input-field" placeholder="Rapport mensuel procédé…"
                value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Type</label>
                <select className="input-field" value={newForm.report_type}
                  onChange={e => setNewForm(f => ({ ...f, report_type: e.target.value as ReportDocument['report_type'] }))}>
                  {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Pages estimées</label>
                <input type="number" className="input-field" value={newForm.pages_estimated}
                  onChange={e => setNewForm(f => ({ ...f, pages_estimated: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Auteur (QP)</label>
              <input className="input-field" placeholder="Dr. M. Kofi, P.Eng."
                value={newForm.author_name} onChange={e => setNewForm(f => ({ ...f, author_name: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <EditReportModal report={editing} projectId={project.id} onClose={() => setEditing(null)} onSaved={loadReports} />
      )}
    </div>
  );
}

function EditReportModal({ report, projectId, onClose, onSaved }: {
  report: ReportDocument;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(report.title);
  const [author, setAuthor] = useState(report.author_name ?? '');
  const [pages, setPages] = useState(String(report.pages_estimated));
  const [status, setStatus] = useState(report.status);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await supabase.from('report_documents').update({
      title, author_name: author || null,
      pages_estimated: parseInt(pages) || 0,
      status, updated_at: new Date().toISOString(),
    }).eq('id', report.id).eq('project_id', projectId);
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <Modal
      title="Modifier le rapport"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}><X size={14} /> Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? '…' : 'Enregistrer'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Titre</label>
          <input className="input-field" value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Auteur</label>
            <input className="input-field" value={author} onChange={e => setAuthor(e.target.value)} />
          </div>
          <div>
            <label className="label">Statut</label>
            <select className="input-field" value={status} onChange={e => setStatus(e.target.value as ReportDocument['status'])}>
              <option value="draft">Brouillon</option>
              <option value="generated">Généré</option>
              <option value="validated">Validé</option>
              <option value="published">Publié</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Pages estimées</label>
          <input type="number" className="input-field" value={pages} onChange={e => setPages(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
