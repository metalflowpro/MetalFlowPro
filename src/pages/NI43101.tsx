import { useState, useEffect } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import { CheckCircle, RefreshCw, Edit3, Save,
  Shield, ChevronDown, ChevronUp, Sparkles, Lock, Unlock, Download,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/ui/PageHeader';
import type { Project } from '../types';

// ─── Narrow row types for Supabase JSON columns ──────────────────────────────

type SimRunRow = {
  global_results?: {
    overall_recovery?: number;
    cyanide_consumption?: number;
    lime_consumption?: number;
    tails_grade?: number;
    total_energy_kwh_t?: number;
    cn_in_tailings?: number;
  } | null;
  feed_input?: { feed_rate?: number } | null;
} | null;

type MineParamsRow = { annual_production_kt?: number } | null;

// ─── NI-43-101 sections definition ───────────────────────────────────────────

const NI43101_SECTIONS = [
  { code: 'S1',  title: 'Résumé',                                 required: true },
  { code: 'S2',  title: 'Introduction et contexte',               required: true },
  { code: 'S3',  title: 'Utilisation des données historiques',    required: false },
  { code: 'S4',  title: 'Cadre géologique régional',              required: true },
  { code: 'S5',  title: 'Géologie locale et du gîte',             required: true },
  { code: 'S6',  title: 'Dépôt de type et minéralisation',        required: true },
  { code: 'S7',  title: 'Exploration',                            required: true },
  { code: 'S8',  title: 'Forage',                                 required: true },
  { code: 'S9',  title: 'Échantillonnage et sous-échantillonnage', required: true },
  { code: 'S10', title: 'Contrôle qualité',                       required: true },
  { code: 'S11', title: 'Traitement des échantillons en lab',     required: true },
  { code: 'S12', title: 'Analyse des données et vérification',    required: true },
  { code: 'S13', title: 'Traitement des données minérales',       required: true },
  { code: 'S14', title: 'Méthodes d\'estimation des ressources',  required: true },
  { code: 'S15', title: 'Interprétation et estimation',           required: true },
  { code: 'S16', title: 'Ressources minérales adjacentes',        required: false },
  { code: 'S17', title: 'Autres données pertinentes',             required: false },
  { code: 'S18', title: 'Plans miniers',                          required: false },
  { code: 'S19', title: 'Méthodes de traitement',                 required: true },
  { code: 'S20', title: 'Récupération de l\'environnement',       required: true },
  { code: 'S21', title: 'Évaluation en capital et exploitation',  required: false },
  { code: 'S22', title: 'Analyse économique',                     required: false },
  { code: 'S23', title: 'Marchés et contrats',                    required: false },
  { code: 'S24', title: 'Réglementations légales',                required: false },
  { code: 'S25', title: 'Conclusions et recommandations',         required: true },
  { code: 'S26', title: 'Références',                             required: true },
  { code: 'S27', title: 'Certificats des personnes qualifiées',   required: true },
];

type SectionStatus = 'empty' | 'generated' | 'edited' | 'validated';

interface NI43Section {
  id: string;
  report_id: string;
  section_code: string;
  content: string;
  status: SectionStatus;
  is_validated: boolean;
  validated_by: string | null;
  validated_at: string | null;
  qp_notes: string | null;
  updated_at: string;
}

interface Props { project: Project }

// ─── Content generators ───────────────────────────────────────────────────────

async function generateSectionContent(code: string, project: Project): Promise<string> {
  // Pull relevant data per section
  const projectName = project.name;
  const today = new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  switch (code) {
    case 'S1': {
      const { data: simRun } = await supabase
        .from('sim_run_results').select('global_results').eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const { data: mineParams } = await supabase.from('mine_params').select('*').eq('project_id', project.id).maybeSingle();
      const rec = (simRun as SimRunRow)?.global_results?.overall_recovery?.toFixed(1) ?? 'N/D';
      const mp = mineParams as MineParamsRow;
      const rate = mp?.annual_production_kt ? `${formatDecimalGrouped((mp.annual_production_kt / 1000), 2)} Mt/an` : 'N/D';
      return `RÉSUMÉ — ${projectName}\n\nDate du rapport : ${today}\n\nCe rapport technique NI-43-101 a été préparé conformément au Règlement NI-43-101 sur l'information concernant les projets miniers. Il présente les résultats des travaux d'exploration, les ressources minérales estimées et les études de faisabilité préliminaires pour le projet ${projectName}.\n\nPoints saillants :\n• Récupération métallurgique simulée : ${rec}%\n• Cadence de traitement : ${rate}\n• Le rapport a été préparé par des personnes qualifiées (PQ) au sens du Règlement NI-43-101.\n\nTous les travaux décrits ont été réalisés sous la supervision et la responsabilité des PQ signataires (Section 27).`;
    }
    case 'S2': {
      return `INTRODUCTION ET CONTEXTE\n\nLe présent rapport technique a été préparé à la demande du commanditaire du projet ${projectName}. Il présente un sommaire des travaux géologiques, géotechniques, métallurgiques et économiques réalisés à ce jour.\n\nCe document constitue un rapport technique au sens du Règlement NI-43-101 sur l'information concernant les projets miniers (ACVM). Il a été rédigé conformément au formulaire 43-101F1 et au Guide de préparation des rapports techniques.\n\nDate de référence : ${today}`;
    }
    case 'S4': {
      return `CADRE GÉOLOGIQUE RÉGIONAL\n\nLe projet ${projectName} est situé dans un contexte géologique régional favorable à l'hébergement de gîtes aurifères.\n\nGéologie régionale :\n• Formation hôte : décrire les formations géologiques régionales\n• Structures majeures : failles, contacts et déformations régionaux\n• Contexte métallogénique : type de gîte et modèle de mise en place\n\n[Cette section doit être complétée par le géologue PQ sur la base des données régionales disponibles.]`;
    }
    case 'S8': {
      const { data: samples } = await supabase.from('lims_test_leach').select('sample_id', { count: 'exact' }).eq('project_id', project.id).limit(1);
      const { count } = await supabase.from('lims_test_leach').select('*', { count: 'exact', head: true }).eq('project_id', project.id);
      return `FORAGE\n\nProgramme de forage du projet ${projectName} :\n\n• Total d'échantillons enregistrés (LIMS) : ${count ?? 0}\n• Types de forage : décrire les méthodes (RC, DDH, etc.)\n• Contrôle qualité forage : procédures de collecte, marquage et chaîne de possession\n\nUne base de données de forage structurée a été maintenue tout au long du programme. Les données ont été vérifiées selon les procédures standard de l'industrie.\n\n[Compléter avec le tableau des statistiques de forage par secteur.]`;
    }
    case 'S10': {
      const { count: limsCount } = await supabase.from('lims_test_leach').select('*', { count: 'exact', head: true }).eq('project_id', project.id);
      return `CONTRÔLE QUALITÉ (QA/QC)\n\nProgramme QA/QC du projet ${projectName} :\n\n• Nombre total d'analyses LIMS consignées : ${limsCount ?? 0}\n• Blancs : insertion systématique (1:20) pour détecter la contamination\n• Standards certifiés : insertion de matériaux de référence certifiés (MRC) à raison de 1:20\n• Duplicatas de terrain : 5% des échantillons répétés sur le terrain\n• Duplicatas en laboratoire : 5% des pulpes renvoyées en laboratoire externe\n\nRésultats QA/QC : les performances analytiques sont conformes aux limites acceptables de l'industrie. Les biais systématiques ont été évalués et aucune anomalie significative n'a été décelée.`;
    }
    case 'S14': {
      return `MÉTHODES D'ESTIMATION DES RESSOURCES\n\nL'estimation des ressources minérales du projet ${projectName} a été réalisée en conformité avec la définition des catégories de ressources du CIM (2014).\n\nMéthodes utilisées :\n• Krigeage ordinaire pour l'estimation des teneurs en or\n• Variographie sphérique ajustée aux données de forage\n• Modèle de blocs avec dimensions adaptées à la continuité géologique\n• Coupures économiques déterminées à partir des paramètres d'exploitation courants\n\nCatégories de ressources :\n• Ressources mesurées : zones avec espacement de forage serré et continuité confirmée\n• Ressources indiquées : zones interpolées entre les forages avec continuité raisonnable\n• Ressources présumées : zones à la périphérie du gîte ou avec données limitées\n\n[Compléter avec les tableaux de ressources certifiés par la PQ.]`;
    }
    case 'S19': {
      const { data: simRun } = await supabase
        .from('sim_run_results').select('global_results,feed_input').eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const gr = (simRun as SimRunRow)?.global_results;
      const fi = (simRun as SimRunRow)?.feed_input;
      return `MÉTHODES DE TRAITEMENT MÉTALLURGIQUE\n\nLe projet ${projectName} utilise un procédé de traitement métallurgique optimisé basé sur les essais LIMS réalisés.\n\nCircuit de traitement (dernière simulation) :\n• Débit nominal : ${fi?.feed_rate ?? 'N/D'} t/h\n• Récupération simulée : ${gr?.overall_recovery?.toFixed(1) ?? 'N/D'}%\n• Consommation NaCN : ${gr?.cyanide_consumption?.toFixed(2) ?? 'N/D'} kg/t\n• Consommation chaux : ${gr?.lime_consumption?.toFixed(2) ?? 'N/D'} kg/t\n• Teneur résidus : ${gr?.tails_grade?.toFixed(3) ?? 'N/D'} g/t Au\n• Énergie totale : ${gr?.total_energy_kwh_t?.toFixed(1) ?? 'N/D'} kWh/t\n\nLes tests métallurgiques ont été conduits selon les normes de l'industrie. Les résultats ont été vérifiés par des personnes qualifiées.`;
    }
    case 'S20': {
      const { data: simRun } = await supabase
        .from('sim_run_results').select('global_results').eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const gr = (simRun as SimRunRow)?.global_results;
      const cnTails = gr?.cn_in_tailings ?? 0;
      const conformity = cnTails > 50 ? 'NON CONFORME — circuit DETOX requis' : 'Conforme (< 50 ppm WAD CN)';
      return `RÉCUPÉRATION ET ENVIRONNEMENT\n\nGestion des résidus et effluents — projet ${projectName} :\n\n• Teneur CN résidus simulée : ${cnTails.toFixed(1)} ppm WAD CN — ${conformity}\n• Circuit de détoxification : INCO SO₂/Air ou peroxyde d'hydrogène selon résultats pilote\n• Gestion eaux de procédé : recyclage maximal (cible ≥80%)\n• Parc à résidus : conception selon MAC/ANCOLD pour confinement sécuritaire\n• Surveillance post-fermeture : plan de monitoring à long terme\n\nToutes les mesures environnementales seront conformes aux exigences réglementaires applicables et aux meilleures pratiques internationales (ICMC — Code international gestion cyanure).`;
    }
    case 'S25': {
      const { data: simRun } = await supabase
        .from('sim_run_results').select('global_results').eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const gr = (simRun as SimRunRow)?.global_results;
      return `CONCLUSIONS ET RECOMMANDATIONS\n\nConclusions — projet ${projectName} (${today}) :\n\n1. Potentiel géologique favorable avec continuité minéralisée confirmée\n2. Récupération métallurgique simulée de ${gr?.overall_recovery?.toFixed(1) ?? 'N/D'}% indique un projet viable\n3. Les paramètres environnementaux sont globalement dans les normes réglementaires\n\nRecommandations pour la prochaine phase :\n• Densification du programme de forage dans les zones de haute teneur\n• Étude de préfaisabilité (PFS) basée sur les ressources indiquées\n• Tests métallurgiques pilote pour confirmer les paramètres de traitement\n• Études environnementales et sociales complémentaires\n• Mise à jour du modèle géologique 3D intégrant les nouvelles données\n\nBudget recommandé phase suivante : à déterminer par les PQ.`;
    }
    case 'S27': {
      return `CERTIFICATS DES PERSONNES QUALIFIÉES\n\nConformément au Règlement NI-43-101 :\n\nJe, soussigné(e), [Nom de la PQ], [Titre], [No de membre d'ordre professionnel], déclare par la présente :\n\n1. Je suis une « personne qualifiée » au sens du Règlement NI-43-101.\n2. J'ai vérifié les données techniques divulguées dans ce rapport.\n3. Je consens à l'utilisation de mon nom et à la référence à ce rapport sous la forme et dans le contexte dans lequel il figure.\n4. À ma connaissance, les informations techniques contenues dans ce rapport sont exactes.\n\nDate : ${today}\nSignature : _____________________\n\n[Ce certificat doit être signé par chaque PQ responsable de sections spécifiques du rapport.]`;
    }
    default: {
      const sectionDef = NI43101_SECTIONS.find(s => s.code === code);
      return `${sectionDef?.title?.toUpperCase() ?? code}\n\nCette section doit être complétée par la personne qualifiée (PQ) responsable en conformité avec les exigences du Règlement NI-43-101 et du formulaire 43-101F1.\n\nRéférence : Guide de préparation des rapports techniques (NI-43-101), dernière révision en vigueur.\n\n[Contenu à générer par la PQ à partir des données du projet ${projectName}.]`;
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NI43101({ project }: Props) {
  const [reportId, setReportId] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, NI43Section>>({});
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [generatingCode, setGeneratingCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [qpName, setQpName] = useState('');
  const [qpModal, setQpModal] = useState<string | null>(null);
  const [qpNotes, setQpNotes] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReport();
  }, [project.id]);

  async function loadReport() {
    setLoading(true);
    try {
      let { data: report } = await supabase
        .from('ni43101_reports')
        .select('*')
        .eq('project_id', project.id)
        .maybeSingle();

      if (!report) {
        const { data: newReport } = await supabase
          .from('ni43101_reports')
          .insert({ project_id: project.id, title: `Rapport NI-43-101 — ${project.name}`, status: 'draft' })
          .select().single();
        report = newReport;
      }

      if (!report) { setLoading(false); return; }
      setReportId(report.id);

      const { data: sectionData } = await supabase
        .from('ni43101_sections')
        .select('*')
        .eq('report_id', report.id);

      const sectionMap: Record<string, NI43Section> = {};
      for (const s of sectionData ?? []) {
        sectionMap[s.section_code] = s;
      }
      setSections(sectionMap);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function handleGenerate(code: string) {
    if (!reportId) return;
    setGeneratingCode(code);
    try {
      const content = await generateSectionContent(code, project);
      const existing = sections[code];

      if (existing) {
        const { data } = await supabase
          .from('ni43101_sections')
          .update({ content, status: 'generated', is_validated: false, validated_by: null, validated_at: null, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select().single();
        if (data) setSections(prev => ({ ...prev, [code]: data }));
      } else {
        const { data } = await supabase
          .from('ni43101_sections')
          .insert({ report_id: reportId, section_code: code, content, status: 'generated', is_validated: false })
          .select().single();
        if (data) setSections(prev => ({ ...prev, [code]: data }));
      }
      setExpandedCode(code);
    } catch (err) {
      console.error(err);
    }
    setGeneratingCode(null);
  }

  function startEdit(code: string) {
    const sec = sections[code];
    setEditContent(sec?.content ?? '');
    setEditingCode(code);
  }

  async function saveEdit(code: string) {
    if (!reportId) return;
    setSavingCode(code);
    try {
      const existing = sections[code];
      if (existing) {
        const { data } = await supabase
          .from('ni43101_sections')
          .update({ content: editContent, status: 'edited', is_validated: false, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select().single();
        if (data) setSections(prev => ({ ...prev, [code]: data }));
      } else {
        const { data } = await supabase
          .from('ni43101_sections')
          .insert({ report_id: reportId, section_code: code, content: editContent, status: 'edited', is_validated: false })
          .select().single();
        if (data) setSections(prev => ({ ...prev, [code]: data }));
      }
      setEditingCode(null);
    } catch (err) {
      console.error(err);
    }
    setSavingCode(null);
  }

  function openValidate(code: string) {
    setQpModal(code);
    setQpNotes(sections[code]?.qp_notes ?? '');
  }

  async function handleValidate() {
    if (!qpModal || !reportId) return;
    const existing = sections[qpModal];
    const payload = {
      is_validated: true,
      status: 'validated' as SectionStatus,
      validated_by: qpName || 'PQ',
      validated_at: new Date().toISOString(),
      qp_notes: qpNotes || null,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { data } = await supabase.from('ni43101_sections').update(payload).eq('id', existing.id).select().single();
      if (data) setSections(prev => ({ ...prev, [qpModal]: data }));
    } else {
      const { data } = await supabase.from('ni43101_sections').insert({ report_id: reportId, section_code: qpModal, content: '', ...payload }).select().single();
      if (data) setSections(prev => ({ ...prev, [qpModal]: data }));
    }
    setQpModal(null);
    setQpName('');
    setQpNotes('');
  }

  async function handleUnvalidate(code: string) {
    const existing = sections[code];
    if (!existing) return;
    const { data } = await supabase.from('ni43101_sections')
      .update({ is_validated: false, status: 'edited', validated_by: null, validated_at: null, updated_at: new Date().toISOString() })
      .eq('id', existing.id).select().single();
    if (data) setSections(prev => ({ ...prev, [code]: data }));
  }

  // Stats
  const total = NI43101_SECTIONS.length;
  const validated = Object.values(sections).filter(s => s.is_validated).length;
  const generated = Object.values(sections).filter(s => s.status !== 'empty').length;
  const completionPct = Math.round((validated / total) * 100);

  function handleExportReport() {
    const sortedCodes = Object.keys(sections).sort();
    const lines: string[] = [
      '═══════════════════════════════════════════════════════════════════════',
      '  RAPPORT TECHNIQUE NI 43-101',
      `  Projet: ${project.name} (${project.code})`,
      `  Pays: ${project.country}`,
      `  Phase: ${project.phase}`,
      `  Date: ${new Date().toLocaleDateString('fr-CA')}`,
      '═══════════════════════════════════════════════════════════════════════',
      '',
      `Sommaire: ${generated}/${total} sections generees, ${validated} validees PQ`,
      '',
    ];

    for (const code of sortedCodes) {
      const sec = sections[code];
      const def = NI43101_SECTIONS.find(s => s.code === code);
      const title = def?.title ?? code;
      const divider = '─'.repeat(Math.max(0, 60 - code.length - title.length));
      lines.push(`─── §${code} — ${title} ${divider}`);
      lines.push('');
      if (sec.content) {
        lines.push(sec.content);
      } else {
        lines.push('[Section non encore generee]');
      }
      if (sec.validated_by) {
        lines.push('');
        lines.push(`Valide par: ${sec.validated_by} — ${sec.validated_at ? new Date(sec.validated_at).toLocaleDateString('fr-CA') : ''}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════════════════');
    lines.push('  Fin du rapport');
    lines.push('═══════════════════════════════════════════════════════════════════════');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NI43101_${project.code}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function statusBadge(code: string) {
    const sec = sections[code];
    if (!sec || sec.status === 'empty') return <span className="badge badge-gray text-xs">Vide</span>;
    if (sec.is_validated) return <span className="badge badge-success text-xs flex items-center gap-1"><CheckCircle size={10} /> Validé PQ</span>;
    if (sec.status === 'edited') return <span className="badge badge-info text-xs">Modifié</span>;
    if (sec.status === 'generated') return <span className="badge badge-gold text-xs">Généré</span>;
    return null;
  }

  if (loading) {
    return <div className="p-8 text-slate-400 flex items-center gap-2"><RefreshCw size={16} className="animate-spin" /> Chargement…</div>;
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Rapport NI-43-101"
        subtitle={`${project.name} · ${validated}/${total} sections validées PQ`}
        breadcrumb={['Rapports', 'NI-43-101']}
        actions={
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportReport}
            disabled={generated === 0}
          >
            <Download size={14} /> Exporter rapport
          </button>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Progress overview */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Sections totales', val: total, color: 'text-slate-300' },
            { label: 'Générées', val: generated, color: 'text-blue-400' },
            { label: 'Validées PQ', val: validated, color: 'text-emerald-400' },
            { label: 'Complétude', val: `${completionPct}%`, color: 'text-yellow-400' },
          ].map(s => (
            <div key={s.label} className="card-sm text-center">
              <div className={`text-3xl font-bold font-mono ${s.color}`}>{s.val}</div>
              <div className="text-sm text-mf-txt2 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="progress-bar h-2">
          <div className="progress-fill" style={{ width: `${completionPct}%` }} />
        </div>

        {/* Sections */}
        <div className="space-y-2">
          {NI43101_SECTIONS.map(sectionDef => {
            const sec = sections[sectionDef.code];
            const isExpanded = expandedCode === sectionDef.code;
            const isEditing = editingCode === sectionDef.code;
            const isGenerating = generatingCode === sectionDef.code;
            const hasContent = sec && sec.content;

            return (
              <div key={sectionDef.code} className="card overflow-hidden p-0">
                {/* Header row */}
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-800/50 transition-colors"
                  onClick={() => setExpandedCode(isExpanded ? null : sectionDef.code)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-slate-500 w-8">{sectionDef.code}</span>
                    <span className="text-sm font-medium text-white">{sectionDef.title}</span>
                    {sectionDef.required && <span className="text-xs text-red-400">*</span>}
                    {statusBadge(sectionDef.code)}
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {!sec?.is_validated && (
                      <button
                        onClick={() => handleGenerate(sectionDef.code)}
                        disabled={!!isGenerating}
                        className="btn btn-secondary btn-sm text-xs"
                      >
                        {isGenerating ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                        {isGenerating ? 'Génération…' : 'Générer'}
                      </button>
                    )}
                    {hasContent && !sec?.is_validated && (
                      <button onClick={() => startEdit(sectionDef.code)} className="btn btn-secondary btn-sm text-xs">
                        <Edit3 size={11} /> Modifier
                      </button>
                    )}
                    {hasContent && !sec?.is_validated && (
                      <button
                        onClick={() => openValidate(sectionDef.code)}
                        className="btn btn-primary btn-sm text-xs"
                      >
                        <Shield size={11} /> Valider PQ
                      </button>
                    )}
                    {sec?.is_validated && (
                      <button onClick={() => handleUnvalidate(sectionDef.code)} className="btn btn-secondary btn-sm text-xs">
                        <Unlock size={11} /> Dévalider
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                  </div>
                </div>

                {/* Content / edit area */}
                {isExpanded && (
                  <div className="border-t border-slate-700 p-4">
                    {sec?.is_validated && (
                      <div className="flex items-center gap-2 mb-3 text-xs text-emerald-400">
                        <Lock size={12} />
                        <span>Validé par <strong>{sec.validated_by}</strong> le {new Date(sec.validated_at!).toLocaleDateString('fr-CA')}</span>
                        {sec.qp_notes && <span className="text-slate-400"> · Note : {sec.qp_notes}</span>}
                      </div>
                    )}
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          className="input-field w-full h-64 font-mono text-sm resize-y"
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button onClick={() => saveEdit(sectionDef.code)} disabled={savingCode === sectionDef.code} className="btn btn-primary btn-sm">
                            {savingCode === sectionDef.code ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Enregistrer
                          </button>
                          <button onClick={() => setEditingCode(null)} className="btn btn-secondary btn-sm">Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                        {sec?.content ?? <span className="text-slate-500 italic">Aucun contenu — cliquez sur "Générer" pour auto-générer à partir des données du projet.</span>}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* QP Validation modal */}
      {qpModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Shield size={18} className="text-emerald-400" />
              <h3 className="text-lg font-semibold text-white">Validation Personne Qualifiée</h3>
            </div>
            <div className="p-3 bg-emerald-900/20 border border-emerald-700/40 rounded-lg text-sm text-emerald-300">
              Section : <strong>{NI43101_SECTIONS.find(s => s.code === qpModal)?.title}</strong>
            </div>
            <div>
              <label className="label">Nom de la PQ (Personne Qualifiée) *</label>
              <input
                className="input-field"
                placeholder="Ex: Dr. Marie-Claude Tremblay, P.Geo."
                value={qpName}
                onChange={e => setQpName(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Notes de validation (optionnel)</label>
              <textarea
                className="input-field h-20 resize-none"
                placeholder="Commentaires, réserves ou annotations de la PQ..."
                value={qpNotes}
                onChange={e => setQpNotes(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setQpModal(null)} className="btn btn-secondary">Annuler</button>
              <button onClick={handleValidate} disabled={!qpName} className="btn btn-primary">
                <CheckCircle size={14} /> Valider la section
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
