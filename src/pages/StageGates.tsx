import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, CheckSquare, Square, Loader2, ThumbsUp,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/ui/PageHeader';
import { AuditLogViewer } from '../components/compliance/AuditLogViewer';
import { logAuditEvent } from '../lib/audit/auditLog';
import type { Project } from '../types';

interface ChecklistGroup {
  label: string;
  color: string;
  items: string[];
}

interface GateDef {
  num: number;
  name: string;
  phase: string;
  objective: string;
  deliverable: string;
  criteria: string;
  groups: ChecklistGroup[];
}

const GATE_DEFS: GateDef[] = [
  {
    num: 1,
    name: 'Porte 1 — Exploration & Scoping',
    phase: 'SCOPING',
    objective: 'Valider la pertinence économique préliminaire et la faisabilité géologique du projet.',
    deliverable: 'Rapport de scoping, estimations ressources inférées, revue de marché initiale.',
    criteria: 'Teneur de coupure positive, accès au terrain confirmé, aucun obstacle réglementaire majeur identifié.',
    groups: [
      {
        label: 'MÉTALLURGIE & TESTWORK',
        color: '#F59E0B',
        items: [
          'Premiers essais de broyabilité (Bond Wi) disponibles',
          'Tests de lixiviation en bouteille réalisés (n ≥ 5)',
          'Cinétique de lixiviation préliminaire documentée',
          'Identification des minéraux interférents (As, Sb, Cu)',
        ],
      },
      {
        label: 'INGÉNIERIE PROCÉDÉS',
        color: '#5BA4F5',
        items: [
          'Flowsheet conceptuel sélectionné (CIL, Heap, Gravity…)',
          'Critères de design préliminaires définis',
          'Consommation d\'eau et réactifs estimée (ordre de grandeur)',
        ],
      },
      {
        label: 'ESTIMATION & ÉCONOMIE',
        color: '#2ECC8A',
        items: [
          'CAPEX ordre de grandeur ±50% calculé',
          'OPEX unitaire estimé ($/t ou $/oz)',
          'Analyse de sensibilité au prix de l\'or effectuée',
        ],
      },
      {
        label: 'ENVIRONNEMENT & PERMIS',
        color: '#F88A44',
        items: [
          'Cadre réglementaire du pays identifié',
          'Enjeux environnementaux préliminaires listés',
        ],
      },
      {
        label: 'RESSOURCES & GÉOLOGIE',
        color: '#9D78F0',
        items: [
          'Ressources minérales inférées (NI 43-101 / JORC)',
          'Modèle géologique préliminaire disponible',
          'Plan de forages d\'infill approuvé',
        ],
      },
    ],
  },
  {
    num: 2,
    name: 'Porte 2 — Pré-Faisabilité (PFS)',
    phase: 'PRE-FEASIBILITY',
    objective: 'Confirmer la viabilité technique et économique avec une précision d\'estimation de ±25%.',
    deliverable: 'Étude de pré-faisabilité complète, ressources indiquées, flowsheet validé.',
    criteria: 'VAN positive au prix de base, AISC < prix spot, IRR > coût du capital.',
    groups: [
      {
        label: 'MÉTALLURGIE & TESTWORK',
        color: '#F59E0B',
        items: [
          'Programme de testwork Phase 2 complété (n ≥ 25 essais)',
          'Essais de gravité (GRG, spirales) documentés',
          'Flottation différentielle testée si Cu/As présent',
          'Essais CIL/CIP : temps de rétention optimisé',
          'Cinétique d\'élution et électro-déposition validée',
          'Taux de récupération global confirmé ± 3%',
          'Tests de rétention d\'eau sur résidus (Ksp)',
        ],
      },
      {
        label: 'INGÉNIERIE PROCÉDÉS',
        color: '#5BA4F5',
        items: [
          'P&ID de procédé niveau conceptuel approuvé',
          'Critères de conception mis à jour (Critères v1.0)',
          'Bilan massique statique bouclé (circuit fermé)',
          'Consommation eau process ≤ limit réglementaire',
          'Footprint usine préliminaire tracé',
        ],
      },
      {
        label: 'ESTIMATION & ÉCONOMIE',
        color: '#2ECC8A',
        items: [
          'CAPEX ±25% avec facteurs de contingence (15-20%)',
          'WBS niveau 3 défini',
          'OPEX détaillé par poste (énergie, réactifs, main-d\'œuvre)',
          'Modèle économique LOM 10 ans finalisé',
          'NPV / IRR / Payback calculés (3 scénarios)',
        ],
      },
      {
        label: 'ENVIRONNEMENT & PERMIS',
        color: '#F88A44',
        items: [
          'EIE préliminaire soumise',
          'Plan de gestion des résidus (TMF) conceptuel',
          'Consultation communautaire Phase 1 complétée',
          'Permis de construction en cours d\'obtention',
        ],
      },
      {
        label: 'RESSOURCES & GÉOLOGIE',
        color: '#9D78F0',
        items: [
          'Ressources indiquées ≥ 80% du tonnage LOM',
          'Block model validé par QP indépendant',
          'Géotechnique : campagne de sondages complétée',
          'Plan minier préliminaire (LOM 10 ans) approuvé',
        ],
      },
    ],
  },
  {
    num: 3,
    name: 'Porte 3 — Faisabilité (FS / BFS)',
    phase: 'FEASIBILITY',
    objective: 'Valider la décision d\'investissement avec une précision d\'estimation de ±15%.',
    deliverable: 'Étude de faisabilité bancable, rapport NI 43-101 complet, MER 400 postes.',
    criteria: 'CAPEX finançable, tous permis obtenus, package ingénierie FEED approuvé.',
    groups: [
      {
        label: 'MÉTALLURGIE & TESTWORK',
        color: '#F59E0B',
        items: [
          'Programme de testwork Phase 3 complété (n ≥ 50)',
          'Essais en continu (Pilot plant) réalisés',
          'Récupération par domaine géométallurgique documentée',
          'Variabilité minéralogique sur LOM intégrée au bilan',
          'Essais de stabilité des résidus (PAG/NAG) complétés',
          'Consommation NaCN, chaux, acide validée en pilote',
          'Rapport de spécialiste métallurgiste (QP) déposé',
        ],
      },
      {
        label: 'INGÉNIERIE PROCÉDÉS',
        color: '#5BA4F5',
        items: [
          'P&ID détaillé niveau FEED (60%) approuvé',
          'Critères de conception v2.0 gelés',
          'Bilan massique dynamique bouclé (Monte Carlo)',
          'Modèle hydraulique eau process/eau recyclée validé',
          'Sélection équipements clés (broyeurs, cuves) confirmée',
          'Registre mécanique 400 postes CAPEX complété',
        ],
      },
      {
        label: 'ESTIMATION & ÉCONOMIE',
        color: '#2ECC8A',
        items: [
          'CAPEX ±15% avec contingences par discipline',
          'Appels d\'offres budgétaires (3 fournisseurs minimum)',
          'OPEX annualisé validé par exploitant référence',
          'Sensibilité au CAPEX ±20%, grade ±15%, prix ±25%',
          'Financement de projet structuré (debt/equity)',
        ],
      },
      {
        label: 'ENVIRONNEMENT & PERMIS',
        color: '#F88A44',
        items: [
          'Tous permis environnementaux obtenus',
          'ESMS (Environmental & Social Management System) approuvé',
          'Plan de fermeture et réhabilitation budgété',
          'ESIA rapport final approuvé par autorités',
        ],
      },
      {
        label: 'RESSOURCES & GÉOLOGIE',
        color: '#9D78F0',
        items: [
          'Ressources mesurées & indiquées (rapport NI 43-101 final)',
          'Réserves prouvées & probables déclarées',
          'Optimisation de la fosse finale (Whittle/GADE)',
          'Plan minier LOM final approuvé',
          'Études géotechniques et hydrogéologie complètes',
        ],
      },
    ],
  },
  {
    num: 4,
    name: 'Porte 4 — Décision d\'Investissement Final (DFS/FID)',
    phase: 'DFS',
    objective: 'Autorisation finale de financement et début de l\'ingénierie de détail (EPC/EPCM).',
    deliverable: 'Package FEED complet, contrats EPCM signés, financement bouclé.',
    criteria: 'Tous permis confirmés, contrats clés signés, financement sécurisé.',
    groups: [
      {
        label: 'MÉTALLURGIE & TESTWORK',
        color: '#F59E0B',
        items: [
          'Rapport final métallurgie approuvé par Conseil',
          'Protocole de contrôle qualité usine (SOP) rédigé',
          'Base de données LIMS complète et auditée',
        ],
      },
      {
        label: 'INGÉNIERIE PROCÉDÉS',
        color: '#5BA4F5',
        items: [
          'P&ID de détail (90%) approuvé',
          'Spécifications équipements gelées',
          'Simulations procédé validées (DynSim / METSIM)',
          'Plan de mise en service (commissioning) approuvé',
        ],
      },
      {
        label: 'ESTIMATION & ÉCONOMIE',
        color: '#2ECC8A',
        items: [
          'Contrats EPCM signés avec prix fixe ou GMP',
          'Budget définitif approuvé par Conseil',
          'Facilité de crédit syndiqué close',
        ],
      },
      {
        label: 'ENVIRONNEMENT & PERMIS',
        color: '#F88A44',
        items: [
          'Permis de construction définitif émis',
          'Accord social (IBA / CBA) signé',
          'Plan de gestion HSE chantier approuvé',
        ],
      },
      {
        label: 'RESSOURCES & GÉOLOGIE',
        color: '#9D78F0',
        items: [
          'Rapport NI 43-101 final publié (SEDAR)',
          'Convention minière signée avec gouvernement',
          'Droits miniers (lease) confirmés pour durée LOM',
        ],
      },
    ],
  },
  {
    num: 5,
    name: 'Porte 5 — Construction & Mise en Service',
    phase: 'CONSTRUCTION',
    objective: 'Suivi de la construction et validation des systèmes avant démarrage commercial.',
    deliverable: 'Usine construite, tests SAT réussis, certificat de mise en service émis.',
    criteria: 'Mise en service dans les délais et budgets approuvés, HSE sans incident majeur.',
    groups: [
      {
        label: 'MÉTALLURGIE & TESTWORK',
        color: '#F59E0B',
        items: [
          'Essais à eau claire (Cold commissioning) complétés',
          'Essais à minerai (Hot commissioning) : 72h validées',
          'Récupération conforme aux projections (≥ 95% du design)',
        ],
      },
      {
        label: 'INGÉNIERIE PROCÉDÉS',
        color: '#5BA4F5',
        items: [
          'Tous équipements installés et alignés',
          'Tests FAT/SAT complétés pour équipements clés',
          'DCS/SCADA opérationnel et validé',
          'Boucles de contrôle calibrées',
        ],
      },
      {
        label: 'ESTIMATION & ÉCONOMIE',
        color: '#2ECC8A',
        items: [
          'Coûts de construction dans budget ±10%',
          'Claims / variations contractuelles résolues',
          'Assurances construction et opération en place',
        ],
      },
      {
        label: 'ENVIRONNEMENT & PERMIS',
        color: '#F88A44',
        items: [
          'Audit HSE construction réussi',
          'Systèmes de gestion des eaux opérationnels',
          'Certificat de conformité environnementale émis',
        ],
      },
      {
        label: 'RESSOURCES & GÉOLOGIE',
        color: '#9D78F0',
        items: [
          'Stocks de minerai (ROM pad) constitués',
          'Modèle de blocs mis à jour pré-production',
          'Plan minier Year 1 approuvé et financé',
        ],
      },
    ],
  },
  {
    num: 6,
    name: 'Porte 6 — Production Commerciale (COD)',
    phase: 'COMMISSIONING',
    objective: 'Déclaration de la production commerciale et transition vers opérations courantes.',
    deliverable: 'COD atteint, rapport de performance 90 jours, équipe opérationnelle formée.',
    criteria: 'Débit nominal atteint 3 jours consécutifs, or produit vendu, comptes rendus conformes.',
    groups: [
      {
        label: 'MÉTALLURGIE & TESTWORK',
        color: '#F59E0B',
        items: [
          'Débit nominal (t/h design) atteint sur 72h',
          'Récupération ≥ 95% du design pendant 30 jours',
          'Qualité bullion (≥ 99.5% Au) confirmée',
        ],
      },
      {
        label: 'INGÉNIERIE PROCÉDÉS',
        color: '#5BA4F5',
        items: [
          'Tous systèmes en mode automatique stable',
          'Disponibilité mécanique ≥ 90% sur 30 jours',
          'Rapport de performance 90 jours déposé',
        ],
      },
      {
        label: 'ESTIMATION & ÉCONOMIE',
        color: '#2ECC8A',
        items: [
          'Première livraison d\'or effectuée (dore bar)',
          'AISC réel vs. modèle réconcilié',
          'Rapport annuel (MD&A) préparé',
        ],
      },
      {
        label: 'ENVIRONNEMENT & PERMIS',
        color: '#F88A44',
        items: [
          'Permis d\'exploitation définitif émis',
          'Rapports de conformité environnementale T+1 soumis',
          'Fonds de fermeture (closure bond) constitué',
        ],
      },
      {
        label: 'RESSOURCES & GÉOLOGIE',
        color: '#9D78F0',
        items: [
          'Réconciliation grade modèle vs. grade mill (±10%)',
          'Rapport géologique annuel produit',
          'Plan de forage infill Year 2 approuvé',
        ],
      },
    ],
  },
];

const PHASE_ORDER = ['SCOPING', 'PRE-FEASIBILITY', 'FEASIBILITY', 'BFS', 'DFS', 'CONSTRUCTION', 'COMMISSIONING'];

function gateStatus(gatePhase: string, projectPhase: string): 'completed' | 'active' | 'locked' {
  const gi = PHASE_ORDER.indexOf(gatePhase);
  const pi = PHASE_ORDER.indexOf(projectPhase);
  if (gi < pi) return 'completed';
  if (gi === pi) return 'active';
  return 'locked';
}

interface StageGatesProps { project: Project }

export function StageGates({ project }: StageGatesProps) {
  const [expandedGate, setExpandedGate] = useState<number>(
    GATE_DEFS.findIndex(g => gateStatus(g.phase, project.phase) === 'active') + 1 || 1
  );
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loadingItems, setLoadingItems] = useState(true);

  const loadChecks = useCallback(async () => {
    setLoadingItems(true);
    const { data } = await supabase
      .from('stage_gate_items')
      .select('*')
      .eq('project_id', project.id);
    const map: Record<string, boolean> = {};
    (data ?? []).forEach((row: { gate_num: number; item_key: string; completed: boolean }) => {
      map[`${row.gate_num}:${row.item_key}`] = row.completed;
    });
    setCheckedItems(map);
    setLoadingItems(false);
  }, [project.id]);

  useEffect(() => {
    loadChecks();
  }, [loadChecks]);

  async function toggleItem(gateNum: number, itemKey: string, current: boolean) {
    const key = `${gateNum}:${itemKey}`;
    setSaving(s => ({ ...s, [key]: true }));
    setCheckedItems(c => ({ ...c, [key]: !current }));

    const { error } = await supabase.from('stage_gate_items').upsert({
      project_id: project.id,
      gate_num:   gateNum,
      item_key:   itemKey,
      completed:  !current,
    }, { onConflict: 'project_id,gate_num,item_key' });

    if (error) {
      setCheckedItems(c => ({ ...c, [key]: current }));
    } else {
      await logAuditEvent({
        projectId: project.id,
        action: 'update',
        entityType: 'stage_gate',
        entityId: `gate_${gateNum}_${itemKey}`,
        previousValues: { completed: current },
        newValues: { completed: !current },
      });
    }
    setSaving(s => ({ ...s, [key]: false }));
  }

  async function approveGate(gateNum: number) {
    const gate = GATE_DEFS.find(g => g.num === gateNum)!;
    const allKeys: string[] = [];
    gate.groups.forEach(grp =>
      grp.items.forEach((_, idx) => allKeys.push(`${grp.label}:${idx}`))
    );
    const upserts = allKeys.map(ik => ({
      project_id: project.id,
      gate_num:   gateNum,
      item_key:   ik,
      completed:  true,
    }));
    await supabase.from('stage_gate_items').upsert(upserts, { onConflict: 'project_id,gate_num,item_key' });
    await logAuditEvent({
      projectId: project.id,
      action: 'approve_stage',
      entityType: 'stage_gate',
      entityId: `gate_${gateNum}`,
      newValues: { name: gate.name, gateNum, phase: gate.phase },
    });
    await loadChecks();
  }

  function gateCompletion(gateNum: number) {
    const gate = GATE_DEFS.find(g => g.num === gateNum)!;
    let total = 0, done = 0;
    gate.groups.forEach(grp =>
      grp.items.forEach((_, idx) => {
        total++;
        if (checkedItems[`${gateNum}:${grp.label}:${idx}`]) done++;
      })
    );
    return { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
  }

  const STATUS_CONFIG = {
    completed: { dot: 'bg-emerald-500', text: 'text-emerald-400', bar: '#2ECC8A', label: 'Approuvé' },
    active:    { dot: 'bg-amber-500',   text: 'text-amber-400',   bar: '#F59E0B', label: 'En cours' },
    locked:    { dot: 'bg-mf-txt4',     text: 'text-mf-txt4',     bar: '#56657A', label: 'Verrouillé' },
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Stage-Gates & Checklists"
        subtitle={`Gouvernance EPCM — ${project.name}`}
        breadcrumb={['Vue Exécutive', 'Stage-Gates']}
      />

      {/* Gate summary strip */}
      <div className="px-8 mb-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {GATE_DEFS.map((gate, i) => {
            const status = gateStatus(gate.phase, project.phase);
            const { pct } = gateCompletion(gate.num);
            const cfg = STATUS_CONFIG[status];
            const isActive = expandedGate === gate.num;
            return (
              <div key={gate.num} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setExpandedGate(isActive ? 0 : gate.num)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                      : status === 'completed'
                      ? 'bg-emerald-500/8 border-emerald-500/20 text-mf-txt3 hover:bg-emerald-500/12'
                      : status === 'active'
                      ? 'bg-mf-card border-mf-border text-mf-txt3 hover:bg-mf-hover'
                      : 'bg-mf-card border-mf-border/50 text-mf-txt4 hover:bg-mf-hover/50'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  <span>G{gate.num}</span>
                  <span className="hidden sm:inline text-mf-txt4 font-normal">·</span>
                  <span className={`hidden sm:inline font-mono ${cfg.text}`}>{pct}%</span>
                </button>
                {i < GATE_DEFS.length - 1 && (
                  <div className={`w-4 h-px ${status === 'completed' ? 'bg-emerald-500/40' : 'bg-mf-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-8 pb-8 space-y-3">
        {GATE_DEFS.map(gate => {
          const status = gateStatus(gate.phase, project.phase);
          const { total, done, pct } = gateCompletion(gate.num);
          const cfg = STATUS_CONFIG[status];
          const isOpen = expandedGate === gate.num;

          return (
            <div
              key={gate.num}
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                isOpen ? 'border-amber-500/30 bg-mf-card' : 'border-mf-border bg-mf-card/60'
              }`}
            >
              {/* Gate header */}
              <button
                className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-mf-hover/30 transition-colors"
                onClick={() => setExpandedGate(isOpen ? 0 : gate.num)}
              >
                {/* Number badge */}
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                  status === 'completed' ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                  : status === 'active'  ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                  :                        'bg-mf-panel border border-mf-border text-mf-txt4'
                }`}>
                  {String(gate.num).padStart(2, '0')}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-sm font-semibold ${isOpen ? 'text-mf-txt' : 'text-mf-txt2'}`}>
                      {gate.name}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      status === 'completed' ? 'bg-emerald-500/15 border-emerald-500/25 text-emerald-400'
                      : status === 'active'  ? 'bg-amber-500/15 border-amber-500/25 text-amber-400'
                      :                        'bg-mf-border/30 border-mf-border/40 text-mf-txt4'
                    }`}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <div className="flex-1 max-w-xs h-1.5 bg-mf-border rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: cfg.bar }}
                      />
                    </div>
                    <span className={`text-xs font-mono shrink-0 ${cfg.text}`}>
                      {done}/{total} · {pct}%
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-mf-txt4">
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>

              {/* Expanded body */}
              {isOpen && (
                <div className="px-6 pb-6 space-y-5 border-t border-mf-border/60 pt-5">
                  {/* Objective / deliverable / criteria */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Objectif', text: gate.objective, accent: 'text-blue-400', bg: 'bg-blue-500/8 border-blue-500/20' },
                      { label: 'Livrables', text: gate.deliverable, accent: 'text-amber-400', bg: 'bg-amber-500/8 border-amber-500/20' },
                      { label: 'Critères de passage', text: gate.criteria, accent: 'text-emerald-400', bg: 'bg-emerald-500/8 border-emerald-500/20' },
                    ].map(card => (
                      <div key={card.label} className={`p-3.5 rounded-xl border ${card.bg}`}>
                        <div className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${card.accent}`}>{card.label}</div>
                        <p className="text-xs text-mf-txt3 leading-relaxed">{card.text}</p>
                      </div>
                    ))}
                  </div>

                  {/* Checklist groups */}
                  {loadingItems ? (
                    <div className="flex items-center gap-2 text-sm text-mf-txt4 py-4">
                      <Loader2 size={14} className="animate-spin" />
                      Chargement des critères…
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {gate.groups.map(grp => {
                        const grpDone = grp.items.filter((_, idx) =>
                          checkedItems[`${gate.num}:${grp.label}:${idx}`]
                        ).length;
                        return (
                          <div key={grp.label} className="rounded-xl border border-mf-border bg-mf-panel/60 p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: grp.color }}>
                                {grp.label}
                              </div>
                              <span className="text-[10px] font-mono text-mf-txt4">{grpDone}/{grp.items.length}</span>
                            </div>
                            <div className="space-y-1.5">
                              {grp.items.map((item, idx) => {
                                const key = `${gate.num}:${grp.label}:${idx}`;
                                const checked = !!checkedItems[key];
                                const isSaving = !!saving[key];
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => toggleItem(gate.num, `${grp.label}:${idx}`, checked)}
                                    disabled={isSaving || status === 'locked'}
                                    className={`w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-all ${
                                      checked
                                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                                        : 'border border-transparent hover:bg-mf-hover/60'
                                    } ${status === 'locked' ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                                  >
                                    {isSaving ? (
                                      <Loader2 size={14} className="text-mf-txt4 animate-spin shrink-0 mt-0.5" />
                                    ) : checked ? (
                                      <CheckSquare size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                                    ) : (
                                      <Square size={14} className="text-mf-txt4 shrink-0 mt-0.5" />
                                    )}
                                    <span className={`text-xs leading-relaxed ${checked ? 'text-mf-txt2 line-through decoration-emerald-500/40' : 'text-mf-txt3'}`}>
                                      {item}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Approve button */}
                  {status === 'active' && (
                    <div className="flex justify-end pt-2">
                      <button
                        onClick={() => approveGate(gate.num)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-mf-bg text-sm font-semibold rounded-xl transition-all shadow-gold"
                      >
                        <ThumbsUp size={15} />
                        Approuver Porte {gate.num}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Audit Log & Traceability Engine Section */}
        <div className="pt-6">
          <AuditLogViewer />
        </div>
      </div>
    </div>
  );
}
