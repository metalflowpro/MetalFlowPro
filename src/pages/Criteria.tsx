import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings, Camera, Lock, CheckCircle2,
  ChevronDown, ChevronRight, Info,
  Sparkles, ArrowRight, ArrowLeft, Check, Circle,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';
import { useProject } from '../lib/ProjectContext';
import { runP80Engine } from '../lib/geomet/p80';
import { domainWeightedMean, canonDomain, type DomainWeights, type DomainValue } from '../lib/geomet/domains';
import { CriteriaRow, DesignBasis, EquipSection, FlowContext, Phase, ProjectInputs, commonOps, defaultInputs, phaseSuffix, processRank, productF80 } from './criteria/model';
import { MetSignals, WIZARD_STEPS, WizardStep, buildFlowFromChoices, computeWizardDefaults } from './criteria/wizard';
import { DEFAULT_ACTIVE, GROUP_META, SECTIONS } from './criteria/sections';


// ─── Main component ───────────────────────────────────────────────────────────

interface CriteriaProps { project: Project }

export function Criteria({ project }: CriteriaProps) {
  const { assumptions, effectiveRecoveryPct, recommendedRouteLabel } = useProject();
  const [inputs, setInputs] = useState<ProjectInputs>(() => defaultInputs(project, assumptions.hoursPerYear));

  // project_settings load asynchronously, so the state initialiser above may have
  // run with the code default. Re-sync once the resolved value arrives.
  useEffect(() => {
    setInputs(prev => prev.hours_per_year === assumptions.hoursPerYear
      ? prev
      : { ...prev, hours_per_year: assumptions.hoursPerYear });
  }, [assumptions.hoursPerYear]);

  const [activeEquip, setActiveEquip] = useState<Record<string, boolean>>(DEFAULT_ACTIVE);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [userEdits, setUserEdits] = useState<Record<string, { comment: string; reference: string }>>({});
  const [snapshots, setSnapshots] = useState<{ id: string; label: string; created_at: string }[]>([]);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [limsLoaded, setLimsLoaded] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'assistant'>('table');
  const [flowOrder, setFlowOrder] = useState<string[]>([]);   // user-chosen equipment sequence (ids)
  // Guided assistant state
  const [metExtra, setMetExtra] = useState<{ sulfide: number; cOrg: number; auFree: number }>({ sulfide: 0, cOrg: 0, auFree: 0 });
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardChoices, setWizardChoices] = useState<Record<string, string[]>>({});

  const phase = (project.phase ?? 'FEASIBILITY') as Phase;

  // ── Load saved state ──────────────────────────────────────────────────────
  // Draft first (user-tuned design/operating choices), then measured LIMS/PSD values on
  // top so the real testwork drives the metallurgical constants (BWi, SG, grind P80,
  // recoveries, reagent consumptions) instead of stale defaults.
  const loadLimsData = useCallback(async () => {
    try {
      const [psd, comm, knel, flot, leach, chem, min, samples, lib, doms] = await Promise.all([
        supabase.from('lims_test_psd').select('sample_id,p80_um,d50_um').eq('project_id', project.id),
        supabase.from('lims_test_comminution').select('sample_id,bwi_kwh_t,sg_t_m3').eq('project_id', project.id),
        supabase.from('lims_test_knelson').select('grg_recovery_pct,p80_feed_um').eq('project_id', project.id),
        supabase.from('lims_test_flotation').select('au_recovery_pct').eq('project_id', project.id),
        supabase.from('lims_test_leaching').select('leach_rec_24h_pct,leach_rec_48h_pct,nacn_consumption_kg_t,cao_consumption_kg_t').eq('project_id', project.id),
        supabase.from('lims_test_chem').select('s_sulfide_pct,c_organic_pct').eq('project_id', project.id),
        supabase.from('lims_test_mineralogy').select('au_free_pct').eq('project_id', project.id),
        supabase.from('lims_samples').select('id,domain').eq('project_id', project.id),
        supabase.from('lims_test_liberation').select('sample_id,au_free_pct').eq('project_id', project.id),
        supabase.from('geomet_domains').select('name,lom_pct').eq('project_id', project.id),
      ]);
      const avg = (rows: Record<string, unknown>[] | null, key: string): number | null => {
        const v = (rows ?? []).map(r => r[key]).filter((x): x is number => typeof x === 'number' && x > 0);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      // Domain weighting — same basis as Granulométrie (feed share from GéoMet's
      // saved blend, composites excluded, never weighted by testing effort), so
      // both modules resolve the same BWi and the same optimal P80.
      const domainBySample = new Map((samples.data ?? []).map(s => [s.id as string, s.domain as string | null]));
      const weights: DomainWeights = {};
      for (const d of (doms.data ?? []) as { name: string; lom_pct: number | null }[]) {
        if (d.lom_pct != null && d.lom_pct > 0) weights[canonDomain(d.name)] = d.lom_pct;
      }
      const tagged = (rows: Record<string, unknown>[] | null, key: string): DomainValue[] =>
        (rows ?? []).flatMap(r => {
          const v = r[key];
          return typeof v === 'number' && v > 0
            ? [{ value: v, domain: (typeof r.sample_id === 'string' ? domainBySample.get(r.sample_id) : null) ?? null }]
            : [];
        });
      const patch: Partial<ProjectInputs> = {};
      const bwiAgg = domainWeightedMean(tagged(comm.data, 'bwi_kwh_t'), weights);
      if (bwiAgg.mean) patch.bwi = bwiAgg.mean;
      const sg = avg(comm.data, 'sg_t_m3');     if (sg) patch.ore_sg = sg;
      // Grind target P80: the ECONOMIC optimum from the shared engine (revenue of
      // recovered gold vs plant grinding energy) — the same number Granulométrie
      // stars in "P80 Optimisation" — not the raw lab-measured PSD mean, which
      // reflects how fine the lab happened to grind, not what the plant should do.
      const auFreeAgg = domainWeightedMean(tagged(lib.data, 'au_free_pct'), weights);
      const hasGrindTestwork = (psd.data?.length ?? 0) > 0 || bwiAgg.mean != null;
      if (hasGrindTestwork) {
        patch.p80_grind = -1; // sentinel — resolved against f80_crush in the updater below
      } else {
        const p80Fallback = avg(knel.data, 'p80_feed_um');
        if (p80Fallback) patch.p80_grind = p80Fallback;
      }
      const grg = avg(knel.data, 'grg_recovery_pct'); if (grg) patch.grg_pct = grg;
      const fr = avg(flot.data, 'au_recovery_pct');   if (fr) patch.flot_rec = fr;
      const l24 = avg(leach.data, 'leach_rec_24h_pct'); if (l24) patch.leach_rec_24h = l24;
      const l48 = avg(leach.data, 'leach_rec_48h_pct'); if (l48) patch.leach_rec_48h = l48;
      const cn = avg(leach.data, 'nacn_consumption_kg_t'); if (cn) patch.cyanide_cons = cn;
      const cao = avg(leach.data, 'cao_consumption_kg_t'); if (cao) patch.lime_cons = cao;
      if (Object.keys(patch).length > 0) {
        setInputs(prev => {
          const next = { ...prev, ...patch };
          // Resolve the optimal grind against the draft's own crushing product
          // (f80_crush) so the imported P80 and the comminution cascade agree.
          if (patch.p80_grind === -1) {
            const engine = runP80Engine({
              bwi: bwiAgg.mean ?? prev.bwi,
              f80_um: prev.f80_crush,
              auFreePct: auFreeAgg.mean,
              recoveryCeilingPct: effectiveRecoveryPct,
              goldGradeGt: project.gold_grade_g_t,
              goldPriceUsdOz: project.gold_price_usd,
            });
            next.p80_grind = engine.optimal.p80;
          }
          return next;
        });
        setLimsLoaded(true);
      }
      // Ore-character signals used by the guided assistant's recommendation engine.
      setMetExtra({
        sulfide: avg(chem.data, 's_sulfide_pct') ?? 0,
        cOrg: avg(chem.data, 'c_organic_pct') ?? 0,
        auFree: avg(min.data, 'au_free_pct') ?? 0,
      });
    } catch { /* silent — LIMS optional */ }
  }, [project.id, project.gold_grade_g_t, project.gold_price_usd, effectiveRecoveryPct]);

  const loadDraft = useCallback(async () => {
    const { data } = await supabase
      .from('dc_draft')
      .select('content')
      .eq('project_id', project.id)
      .maybeSingle();
    if (data?.content) {
      const c = data.content as {
        inputs?: ProjectInputs;
        equip?: Record<string, boolean>;
        userEdits?: Record<string, { comment: string; reference: string }>;
        flowOrder?: string[];
      };
      if (c.inputs) setInputs({ ...defaultInputs(project, assumptions.hoursPerYear), ...c.inputs });
      // Normalise l'equip sauvegardé sur la base des défauts : une clé ABSENTE
      // prend sa valeur par défaut explicite (ex. flotation:false) au lieu de
      // rester `undefined`. Sans cela, l'affichage (`!== false`) montrait un
      // équipement absent comme ACTIF/coché, alors que la détection de route du
      // tableau de bord (`=== true`) le traite comme inactif → l'utilisateur
      // « voyait » gravité+flottation actifs mais la route restait « CIL direct ».
      // Un choix EXPLICITE de l'utilisateur (true/false sauvegardé) prime toujours.
      if (c.equip) setActiveEquip({ ...DEFAULT_ACTIVE, ...c.equip });
      if (c.userEdits) setUserEdits(c.userEdits);
      if (c.flowOrder) setFlowOrder(c.flowOrder);
    }
  }, [project, assumptions.hoursPerYear]);

  const loadSnapshots = useCallback(async () => {
    const { data } = await supabase
      .from('dc_snapshots')
      .select('id, label, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setSnapshots((data ?? []) as unknown as { id: string; label: string; created_at: string }[]);
  }, [project.id]);

  useEffect(() => {
    (async () => { await loadDraft(); await loadLimsData(); })();
    loadSnapshots();
  }, [loadDraft, loadLimsData, loadSnapshots]);

  const saveDraft = useCallback(async (
    inp: ProjectInputs,
    eq: Record<string, boolean>,
    edits: Record<string, { comment: string; reference: string }>,
    order: string[],
  ) => {
    setSaving(true);
    await supabase.from('dc_draft').upsert({
      project_id: project.id,
      content: { inputs: inp, equip: eq, userEdits: edits, flowOrder: order },
      updated_at: new Date().toISOString(),
    } as never, { onConflict: 'project_id' });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [project.id]);

  function updateInput(k: keyof ProjectInputs, v: number) {
    setInputs(prev => {
      const next = { ...prev, [k]: v };
      saveDraft(next, activeEquip, userEdits, flowOrder);
      return next;
    });
  }

  function toggleEquip(id: string) {
    setActiveEquip(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveDraft(inputs, next, userEdits, flowOrder);
      return next;
    });
  }

  function updateUserEdit(rowId: string, col: 'comment' | 'reference', val: string) {
    setUserEdits(prev => {
      const next = { ...prev, [rowId]: { ...prev[rowId], comment: prev[rowId]?.comment ?? '', reference: prev[rowId]?.reference ?? '', [col]: val } };
      saveDraft(inputs, activeEquip, next, flowOrder);
      return next;
    });
  }

  // ── Guided assistant: ore-character signals feeding the recommendation engine ──
  const signals: MetSignals = useMemo(() => {
    // Réfractarité = FAIBLE récupération FINALE (48 h), pas une cinétique lente à
    // 24 h. Base 48 h, cohérente avec la recommandation de route métallurgique.
    const refractory = metExtra.sulfide > 3 || metExtra.cOrg > 0.5 || inputs.leach_rec_48h < 80;
    return {
      tph: inputs.tph, bwi: inputs.bwi, f80RomMm: inputs.f80_rom_mm,
      grg: inputs.grg_pct, flotRec: inputs.flot_rec, leachRec: inputs.leach_rec_48h,
      sulfide: metExtra.sulfide, cOrg: metExtra.cOrg, auFree: metExtra.auFree,
      refractory, pregRobbing: metExtra.cOrg > 0.5, hard: inputs.bwi >= 16, highTonnage: inputs.tph >= 800,
    };
  }, [inputs, metExtra]);

  // Pre-fill the wizard with recommendations the first time it is opened (never clobbers
  // choices the user has already made this session).
  useEffect(() => {
    if (viewMode === 'assistant' && Object.keys(wizardChoices).length === 0) {
      setWizardChoices(computeWizardDefaults(signals));
    }
  }, [viewMode, signals, wizardChoices]);

  function toggleWizardOption(step: WizardStep, key: string) {
    setWizardChoices(prev => {
      const cur = prev[step.id] ?? [];
      if (step.multi) {
        const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
        return { ...prev, [step.id]: next };
      }
      return { ...prev, [step.id]: [key] };   // single-select
    });
  }

  function resetWizardToRecommended() {
    setWizardChoices(computeWizardDefaults(signals));
    setWizardStep(0);
  }

  // Commit the wizard: rebuild active equipment + process-ordered flow, show the table.
  function applyWizard() {
    const { order, activeIds } = buildFlowFromChoices(wizardChoices);
    const nextActive: Record<string, boolean> = { general: true };
    for (const sec of SECTIONS) if (sec.id !== 'general') nextActive[sec.id] = activeIds.has(sec.id);
    setActiveEquip(nextActive);
    setFlowOrder(order);
    saveDraft(inputs, nextActive, userEdits, order);
    setViewMode('table');
  }

  // ── Active equipment ordered along the process flow (user choice, else process rank) ──
  const flowSteps = useMemo(() => {
    const active = SECTIONS.filter(s => s.id !== 'general' && activeEquip[s.id] !== false);
    const ranked = [...active].sort((a, b) => processRank(a.code) - processRank(b.code));
    if (flowOrder.length === 0) return ranked;
    const byId = new Map(active.map(s => [s.id, s]));
    const chosen = flowOrder.map(id => byId.get(id)).filter((s): s is EquipSection => !!s);
    const chosenIds = new Set(chosen.map(s => s.id));
    return [...chosen, ...ranked.filter(s => !chosenIds.has(s.id))];
  }, [activeEquip, flowOrder]);

  // ── Flow context: propagate feed F80 + tonnage down the chosen sequence ──
  const flowContext = useMemo(() => {
    const ctx = new Map<string, FlowContext>();
    let stream = inputs.f80_rom_mm * 1000;   // ROM feed size (µm)
    let tph = inputs.tph;                     // mainstream solids tonnage
    let afterFlot = false;                    // becomes true once past a flotation stage
    for (const s of flowSteps) {
      ctx.set(s.id, { feedF80: stream, feedTph: tph, afterFlotation: afterFlot });
      stream = productF80(s.id, stream, inputs);
      // Downstream of flotation the stream is the concentrate (much smaller tonnage).
      if (s.id === 'flotation') {
        tph = inputs.tph * inputs.flot_mass_pull / 100;
        afterFlot = true;
      }
    }
    return ctx;
  }, [flowSteps, inputs]);

  // Base projet partagée avec le Tableau de bord — un seul chiffre de production.
  const designBasis = useMemo<DesignBasis>(
    () => ({ globalRecoveryPct: effectiveRecoveryPct, routeLabel: recommendedRouteLabel }),
    [effectiveRecoveryPct, recommendedRouteLabel],
  );

  // ── Computed rows per section (flow-aware: feed size follows the chosen sequence) ──
  const computedSections = useMemo(() => {
    return SECTIONS
      .filter(s => activeEquip[s.id] !== false || s.id === 'general')
      .map(s => {
        const base = s.rows(inputs, phase, flowContext.get(s.id), designBasis);
        // Ensure no equipment sheet is sparse: top up thinner units with the common
        // operating-basis rows (plant throughput, availability, annual tonnage, design flow).
        const computed = s.id === 'general' || base.length >= 8
          ? base
          : [...base, ...commonOps(inputs)];
        return { ...s, computed };
      });
  }, [inputs, activeEquip, phase, flowContext, designBasis]);

  const totalRows = computedSections.reduce((a, s) => a + s.computed.length, 0);

  // Table rows follow the chosen process flow: general first, then flowSteps order.
  const orderedComputedSections = useMemo(() => {
    const byId = new Map(computedSections.map(s => [s.id, s]));
    const out: typeof computedSections = [];
    const gen = byId.get('general');
    if (gen) out.push(gen);
    for (const s of flowSteps) { const cs = byId.get(s.id); if (cs) out.push(cs); }
    // Append anything computed but not in flowSteps (safety).
    for (const cs of computedSections) { if (cs.id !== 'general' && !flowSteps.some(f => f.id === cs.id)) out.push(cs); }
    return out;
  }, [computedSections, flowSteps]);

  // Preview of the sequence currently chosen in the assistant (process-ordered labels).
  const wizardPreview = useMemo(() => {
    const { order } = buildFlowFromChoices(wizardChoices);
    const byId = new Map(SECTIONS.map(s => [s.id, s]));
    return order.map(id => byId.get(id)).filter((s): s is EquipSection => !!s);
  }, [wizardChoices]);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  async function createSnapshot() {
    if (!snapshotLabel.trim()) return;
    const hash = btoa(JSON.stringify({ inputs, activeEquip })).slice(0, 32);
    await supabase.from('dc_snapshots').insert({
      project_id: project.id,
      label: snapshotLabel.trim(),
      content: { inputs, equip: activeEquip, userEdits },
      content_hash: hash,
    } as never);
    setSnapshotLabel('');
    setShowSnapshot(false);
    loadSnapshots();
  }

  async function restoreSnapshot(id: string) {
    const { data } = await supabase
      .from('dc_snapshots').select('content').eq('id', id).eq('project_id', project.id).maybeSingle();
    if (data?.content) {
      const c = data.content as {
        inputs?: ProjectInputs;
        equip?: Record<string, boolean>;
        userEdits?: Record<string, { comment: string; reference: string }>;
        flowOrder?: string[];
      };
      // Merge saved draft over defaults so inputs added after the draft was saved
      // (e.g. the template sizing parameters) fall back to sensible defaults.
      if (c.inputs) setInputs({ ...defaultInputs(project, assumptions.hoursPerYear), ...c.inputs });
      // Normalise l'equip sauvegardé sur la base des défauts : une clé ABSENTE
      // prend sa valeur par défaut explicite (ex. flotation:false) au lieu de
      // rester `undefined`. Sans cela, l'affichage (`!== false`) montrait un
      // équipement absent comme ACTIF/coché, alors que la détection de route du
      // tableau de bord (`=== true`) le traite comme inactif → l'utilisateur
      // « voyait » gravité+flottation actifs mais la route restait « CIL direct ».
      // Un choix EXPLICITE de l'utilisateur (true/false sauvegardé) prime toujours.
      if (c.equip) setActiveEquip({ ...DEFAULT_ACTIVE, ...c.equip });
      if (c.userEdits) setUserEdits(c.userEdits);
      setFlowOrder(c.flowOrder ?? []);
      setShowHistory(false);
    }
  }

  // ── Groups for sidebar ─────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const seen: Record<string, EquipSection[]> = {};
    for (const s of SECTIONS) {
      if (!seen[s.group]) seen[s.group] = [];
      seen[s.group].push(s);
    }
    return Object.entries(seen).map(([gid, secs]) => ({
      gid,
      ...GROUP_META[gid],
      sections: secs,
    }));
  }, []);

  const INPUT_FIELDS: { key: keyof ProjectInputs; label: string; unit: string; step: string; source: string; group: string }[] = [
    // ── Débit & minerai ─────────────────────────────────────────────────────
    { key: 'tph',           label: 'Débit nominal',          unit: 't/h',    step: '1',    source: 'Projet',       group: 'Débit & minerai' },
    { key: 'availability',  label: 'Disponibilité usine',    unit: '%',      step: '0.1',  source: 'Projet',       group: 'Débit & minerai' },
    { key: 'gold_grade',    label: 'Teneur or alimentation', unit: 'g/t',    step: '0.01', source: 'Modèle blocs', group: 'Débit & minerai' },
    { key: 'ore_sg',        label: 'Densité minerai (SG)',   unit: 't/m³',   step: '0.01', source: 'LIMS',         group: 'Débit & minerai' },
    // ── Indices de broyabilité ──────────────────────────────────────────────
    { key: 'bwi',           label: 'Bond Work Index (BWi)',  unit: 'kWh/t',  step: '0.1',  source: 'LIMS',   group: 'Indices de broyabilité' },
    { key: 'brwi',          label: 'Bond Rod Work Index (RWi)', unit: 'kWh/t', step: '0.1', source: 'LIMS',   group: 'Indices de broyabilité' },
    { key: 'cwi',           label: 'Bond Crushing WI (CWi)', unit: 'kWh/t',  step: '0.1',  source: 'LIMS',   group: 'Indices de broyabilité' },
    { key: 'scse',          label: 'SMC SCSE (SAG)',         unit: 'kWh/t',  step: '0.1',  source: 'LIMS',   group: 'Indices de broyabilité' },
    // ── Comminution — granulométrie par équipement (F80 alim. → P80 produit) ─
    // Chaîne procédé : ROM → primaire → secondaire → tertiaire → HPGR → SAG →
    // ball mill → regrind. Chaque F80 d'un étage ≈ P80 produit de l'étage amont.
    { key: 'f80_rom_mm',       label: 'ROM · F80 (alim. primaire)',      unit: 'mm', step: '10',  source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_primary_mm',   label: 'Concasseur primaire · P80 produit', unit: 'mm', step: '5',  source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_secondary_mm', label: 'Concasseur secondaire · P80 produit', unit: 'mm', step: '1', source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_tertiary_mm',  label: 'Concasseur tertiaire · P80 produit', unit: 'mm', step: '0.5', source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    { key: 'f80_hpgr_mm',      label: 'HPGR · F80 alimentation',         unit: 'mm', step: '1',   source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_hpgr_mm',      label: 'HPGR · P80 produit',              unit: 'mm', step: '0.5', source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    { key: 'f80_sag_mm',       label: 'Broyeur SAG · F80 alimentation',  unit: 'mm', step: '5',   source: 'Broyage',    group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_sag_mm',       label: 'Broyeur SAG · P80 produit',       unit: 'mm', step: '0.1', source: 'Broyage',    group: 'Comminution — granulométrie par équipement' },
    { key: 'f80_ball_um',      label: 'Ball mill · F80 alimentation',    unit: 'µm', step: '50',  source: 'Broyage',    group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_grind',        label: 'Ball mill · P80 produit (cible)', unit: 'µm', step: '1',   source: 'LIMS',       group: 'Comminution — granulométrie par équipement' },
    { key: 'f80_regrind_um',   label: 'Regrind · F80 alimentation',      unit: 'µm', step: '5',   source: 'Broyage',    group: 'Comminution — granulométrie par équipement' },
    { key: 'p80_regrind_um',   label: 'Regrind · P80 produit',           unit: 'µm', step: '1',   source: 'Broyage',    group: 'Comminution — granulométrie par équipement' },
    { key: 'f80_crush',        label: 'F80 alim. broyage (après concassage)', unit: 'µm', step: '100', source: 'Concassage', group: 'Comminution — granulométrie par équipement' },
    // ── Concassage & broyage — exploitation ─────────────────────────────────
    { key: 'avail_crush',        label: 'Disponibilité concassage',    unit: '%',  step: '1',    source: 'Projet',    group: 'Concassage & broyage — exploitation' },
    { key: 'sf_crush',           label: 'Facteur design concassage',   unit: '%',  step: '1',    source: 'Projet',    group: 'Concassage & broyage — exploitation' },
    { key: 'sf_grind',           label: 'Facteur design broyage',      unit: '%',  step: '1',    source: 'Projet',    group: 'Concassage & broyage — exploitation' },
    { key: 'eta_mech',           label: 'Rendement méca. concasseur',  unit: '%',  step: '1',    source: 'Pratique',  group: 'Concassage & broyage — exploitation' },
    { key: 'eta_motor',          label: 'Rendement moteur broyeur',    unit: '%',  step: '1',    source: 'Pratique',  group: 'Concassage & broyage — exploitation' },
    { key: 'cl_ball',            label: 'Charge circulante ball mill', unit: '%',  step: '10',   source: 'Pratique',  group: 'Concassage & broyage — exploitation' },
    { key: 'cyclone_pct_solids', label: 'Cyclone feed % solides',      unit: '%',  step: '1',    source: 'Pratique',  group: 'Concassage & broyage — exploitation' },
    { key: 'ball_cons',          label: 'Consommation boulets acier',  unit: 'kg/t', step: '0.05', source: 'LIMS',    group: 'Concassage & broyage — exploitation' },
    // ── Gravité & Lixiviation (CIL) ─────────────────────────────────────────
    { key: 'grg_pct',       label: 'GRG (%)',                unit: '%',      step: '0.1',  source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'leach_rec_24h', label: 'Récupération CIL 24h',   unit: '%',      step: '0.1',  source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'leach_rec_48h', label: 'Récupération CIL 48h',   unit: '%',      step: '0.1',  source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'leach_k',       label: 'Constante cinétique leach (k)', unit: '1/h', step: '0.01', source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'slurry_density',label: 'Densité pulpe CIL',      unit: '% sol',  step: '0.5',  source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'cyanide_cons',  label: 'Consommation NaCN',      unit: 'kg/t',   step: '0.01', source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'lime_cons',     label: 'Consommation chaux',     unit: 'kg/t',   step: '0.1',  source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'dissolved_o2',  label: 'Oxygène dissous',        unit: 'mg/L',   step: '0.5',  source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    { key: 'carbon_conc',   label: 'Charbon actif (CIL)',    unit: 'g/L',    step: '1',    source: 'LIMS', group: 'Gravité & Lixiviation (CIL)' },
    // ── Flottation ──────────────────────────────────────────────────────────
    { key: 'flot_rec',      label: 'Récupération flottation', unit: '%',     step: '0.1',  source: 'LIMS', group: 'Flottation' },
    { key: 'flot_mass_pull',label: 'Mass pull flottation',   unit: '%',      step: '0.1',  source: 'LIMS', group: 'Flottation' },
    // ── Élution · Électrolyse · Épaississement ──────────────────────────────
    { key: 'elution_temp',  label: 'Température élution',     unit: '°C',     step: '1',    source: 'LIMS',     group: 'Élution · Électro. · Épaississement' },
    { key: 'carbon_loading',label: 'Charge Au charbon (loaded)', unit: 'g/t', step: '100', source: 'LIMS',     group: 'Élution · Électro. · Épaississement' },
    { key: 'ew_current_density', label: 'Densité courant EW', unit: 'A/m²',  step: '10',   source: 'Pratique', group: 'Élution · Électro. · Épaississement' },
    { key: 'thickener_area_factor', label: 'Aire unit. épaiss.', unit: 'm²/(t/j)', step: '0.001', source: 'LIMS', group: 'Élution · Électro. · Épaississement' },
  ];

  // Paramètres liés à un équipement précis : masqués tant qu'AUCUN des équipements
  // listés n'est actif dans la sélection. Les champs absents de cette carte
  // (débit, minerai, indices, lixiviation générale…) restent toujours visibles.
  const FIELD_EQUIP: Partial<Record<keyof ProjectInputs, string[]>> = {
    f80_rom_mm: ['jaw', 'gyratory'],
    p80_primary_mm: ['jaw', 'gyratory'],
    p80_secondary_mm: ['cone', 'pebble_crusher'],
    p80_tertiary_mm: ['cone_tertiary'],
    f80_hpgr_mm: ['hpgr'],
    p80_hpgr_mm: ['hpgr'],
    f80_sag_mm: ['sag', 'ag'],
    p80_sag_mm: ['sag', 'ag'],
    f80_ball_um: ['ball'],
    f80_regrind_um: ['vertimill', 'isamill', 'towermill'],
    p80_regrind_um: ['vertimill', 'isamill', 'towermill'],
    cl_ball: ['ball'],
    cyclone_pct_solids: ['hydrocyclone'],
    flot_rec: ['flotation', 'flash_flot', 'column_flot'],
    flot_mass_pull: ['flotation', 'flash_flot', 'column_flot'],
  };
  const fieldVisible = (key: keyof ProjectInputs): boolean => {
    const gate = FIELD_EQUIP[key];
    return !gate || gate.some(id => activeEquip[id] !== false);
  };

  function renderAssistant() {
    const step = WIZARD_STEPS[wizardStep];
    const sel = wizardChoices[step.id] ?? [];
    const isLast = wizardStep === WIZARD_STEPS.length - 1;
    const chosenSet = buildFlowFromChoices(wizardChoices).activeIds;
    return (
      <div className="px-5 pb-12 pt-3 max-w-5xl mx-auto">
        {/* Intro banner */}
        <div className="flex items-start gap-3 mb-4 p-3 rounded-lg border border-teal-400/30 bg-teal-400/5">
          <Sparkles size={18} className="text-teal-300 shrink-0 mt-0.5" />
          <div className="text-[12px] mf-txt3">
            <span className="font-semibold text-teal-200">Assistant guidé</span> — construisez le circuit étape par étape.
            Les recommandations sont calculées à partir de vos données projet et LIMS (dureté, GRG, sulfures, or libre,
            récupération). En fin de parcours, le tableau des critères se reconstruit automatiquement selon vos choix.
            <button onClick={resetWizardToRecommended} className="ml-2 underline text-teal-300 hover:text-teal-200">Réinitialiser aux recommandations</button>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 flex-wrap mb-4">
          {WIZARD_STEPS.map((st, i) => {
            const done = (wizardChoices[st.id]?.length ?? 0) > 0;
            const active = i === wizardStep;
            return (
              <button key={st.id} onClick={() => setWizardStep(i)}
                className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border transition-colors
                  ${active ? 'border-teal-400 bg-teal-400/15 text-teal-200'
                    : done ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300/80'
                    : 'border-mf-border mf-txt4 hover:mf-txt3'}`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${active ? 'bg-teal-400 text-mf-bg' : done ? 'bg-emerald-400/20' : 'bg-white/10'}`}>
                  {done && !active ? <Check size={9}/> : i + 1}
                </span>
                {st.stage}
              </button>
            );
          })}
        </div>

        {/* Current step card */}
        <div className="border mf-border rounded-xl p-4 bg-mf-panel/40 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-teal-400/15 border border-teal-400/30 flex items-center justify-center text-teal-300">{step.icon}</div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-400/80">Étape {wizardStep + 1}/{WIZARD_STEPS.length} · {step.stage}</div>
              <div className="text-base font-bold mf-txt">{step.title}</div>
            </div>
            {step.optional && <span className="ml-2 text-[9px] mf-txt4 border mf-border rounded px-1.5 py-0.5">optionnel</span>}
            <span className="ml-auto text-[10px] mf-txt4">{step.multi ? 'Choix multiples' : 'Choix unique'}</span>
          </div>
          <p className="text-[12px] mf-txt3 mb-3">{step.intro(signals)}</p>

          <div className="space-y-2">
            {step.options.map(o => {
              const chosen = sel.includes(o.key);
              const rec = o.recommend?.(signals, chosenSet) ?? false;
              return (
                <button key={o.key} onClick={() => toggleWizardOption(step, o.key)}
                  className={`w-full text-left flex items-start gap-3 p-2.5 rounded-lg border transition-colors
                    ${chosen ? 'border-teal-400/60 bg-teal-400/10' : 'border-mf-border bg-mf-panel/30 hover:border-mf-txt4'}`}>
                  <div className={`mt-0.5 shrink-0 ${chosen ? 'text-teal-300' : 'mf-txt4'}`}>
                    {chosen ? <CheckCircle2 size={16}/> : <Circle size={16}/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold mf-txt">{o.label}</span>
                      {rec && <span className="text-[9px] font-semibold text-emerald-300 bg-emerald-400/10 border border-emerald-400/30 rounded-full px-1.5 py-0.5">Recommandé</span>}
                    </div>
                    <div className="text-[11px] mf-txt4">{o.hint}</div>
                    {rec && o.why && <div className="text-[10px] text-emerald-300/70 mt-0.5">→ {o.why(signals)}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live preview of the chosen circuit */}
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider mf-txt4 mb-1.5">Aperçu du circuit ({wizardPreview.length} équipements)</div>
          <div className="flex items-center gap-1 flex-wrap">
            {wizardPreview.length === 0 ? <span className="text-[11px] mf-txt4">Aucun équipement sélectionné.</span>
              : wizardPreview.map((s, i) => (
              <span key={s.id} className="flex items-center gap-1">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border mf-border bg-mf-panel/50 mf-txt3">{s.label}</span>
                {i < wizardPreview.length - 1 && <ArrowRight size={10} className="mf-txt4"/>}
              </span>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => setWizardStep(s => Math.max(0, s - 1))} disabled={wizardStep === 0}
            className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border mf-border mf-txt3 hover:mf-txt disabled:opacity-30 disabled:cursor-not-allowed">
            <ArrowLeft size={13}/> Précédent
          </button>
          {!isLast ? (
            <button onClick={() => setWizardStep(s => Math.min(WIZARD_STEPS.length - 1, s + 1))}
              className="ml-auto flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-500/90 hover:bg-teal-400 text-white">
              Suivant <ArrowRight size={13}/>
            </button>
          ) : (
            <button onClick={applyWizard}
              className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white">
              <Check size={14}/> Générer les critères de conception
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<Settings size={20}/>}
        title="Critères de Conception"
        breadcrumb={['Projet', 'Ingénierie', 'Critères de Conception']}
        actions={
          <div className="flex gap-2 items-center">
            {limsLoaded && (
              <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-400/10 border border-teal-400/20 px-2 py-0.5 rounded-full">
                <CheckCircle2 size={11}/> LIMS auto-chargé
              </span>
            )}
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={13}/> Sauvegardé</span>}
            {saving && <span className="text-xs mf-txt4">Sauvegarde…</span>}
            <button onClick={() => setShowInputs(true)} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Info size={13}/> Paramètres
            </button>
            <button onClick={() => setShowSnapshot(true)} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Camera size={13}/> Snapshot
            </button>
            <button onClick={() => setShowHistory(true)} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Lock size={13}/> Historique
            </button>
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <div className="w-60 shrink-0 border-r mf-border overflow-y-auto p-3 space-y-1">
          <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">Équipements Actifs</div>
          {groups.map(grp => (
            <div key={grp.gid}>
              <button
                onClick={() => setCollapsed(c => ({ ...c, [grp.gid]: !c[grp.gid] }))}
                className="flex items-center gap-1.5 w-full text-[11px] font-semibold mf-txt3 hover:mf-txt py-1 transition-colors"
              >
                {collapsed[grp.gid] ? <ChevronRight size={11}/> : <ChevronDown size={11}/>}
                {grp.icon}
                <span>{grp.label}</span>
                <span className="ml-auto text-[9px] text-emerald-400/70">
                  {grp.sections.filter(s => activeEquip[s.id] !== false).length}/{grp.sections.length}
                </span>
              </button>
              {!collapsed[grp.gid] && (
                <div className="ml-3 space-y-0.5 mb-1">
                  {grp.sections.map(sec => (
                    <label key={sec.id} className="flex items-center gap-2 cursor-pointer group py-0.5">
                      <input
                        type="checkbox"
                        checked={activeEquip[sec.id] !== false}
                        onChange={() => sec.id !== 'general' && toggleEquip(sec.id)}
                        disabled={sec.id === 'general'}
                        className="accent-teal-400 w-3.5 h-3.5"
                      />
                      <span className={`text-[11px] transition-colors ${activeEquip[sec.id] !== false ? 'mf-txt' : 'mf-txt4'}`}>
                        {sec.label}
                      </span>
                      <span className="text-[9px] mf-txt4 ml-auto">{sec.code}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Summary */}
          <div className="mt-3 pt-3 border-t mf-border">
            <div className="text-[10px] mf-txt3 uppercase tracking-wider mb-1">Résumé</div>
            <div className="text-[11px] mf-txt4">Phase: <span className="mf-txt">{project.phase}</span></div>
            <div className="text-[11px] mf-txt4">Précision: <span className="text-amber-400">{phaseSuffix(phase)}</span></div>
            <div className="text-[11px] mf-txt4 mt-0.5">{totalRows} paramètres calculés</div>
          </div>
        </div>

        {/* ── Main panel ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <div className="p-3 pb-1 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold mf-txt">Critères de Conception — {project.name}</span>
            <span className="text-[11px] text-amber-400 border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 rounded-full">{phaseSuffix(phase)} · {project.phase}</span>
            {/* View toggle */}
            <div className="ml-auto flex rounded-lg overflow-hidden border mf-border">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${viewMode === 'table' ? 'bg-teal-400/20 text-teal-300' : 'mf-txt4 hover:mf-txt3'}`}
              >Tableau</button>
              <button
                onClick={() => setViewMode('assistant')}
                className={`px-3 py-1 text-[11px] font-medium transition-colors flex items-center gap-1 ${viewMode === 'assistant' ? 'bg-teal-400/20 text-teal-300' : 'mf-txt4 hover:mf-txt3'}`}
              ><Sparkles size={11}/> Assistant guidé</button>
            </div>
          </div>

          {viewMode === 'assistant' ? renderAssistant() : (
          <div className="overflow-x-auto px-3 pb-6">
            <table className="tbl text-xs w-full min-w-[900px]">
              <thead>
                <tr className="sticky top-0 z-10 bg-[var(--mf-bg,#0f1117)]">
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-16">CODE</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-72">PARAMÈTRE</th>
                  <th className="text-right px-2 py-2 mf-txt3 font-semibold w-28">VALEUR</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-20">UNITÉ</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-60">FORMULE / BASIS</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-24">SOURCE</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-48 border-l border-amber-400/20 bg-amber-400/5">COMMENTAIRE</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-40 bg-amber-400/5">RÉFÉRENCE</th>
                </tr>
              </thead>
              <tbody>
                {orderedComputedSections.map(sec => (
                  <>
                    {/* Section header row */}
                    <tr key={`hdr-${sec.id}`} className="bg-teal-400/10 border-y border-teal-400/20">
                      <td colSpan={8} className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {sec.icon}
                          <span className="text-xs font-semibold text-teal-300">{sec.code} — {sec.label}</span>
                          <span className="text-[10px] mf-txt4 ml-2">{sec.computed.length} paramètres</span>
                        </div>
                      </td>
                    </tr>
                    {/* Parameter rows */}
                    {sec.computed.map((row, i) => (
                      <ParameterRow
                        key={row.id + i}
                        row={row}
                        userEdit={userEdits[row.id]}
                        onEditChange={updateUserEdit}
                      />
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </div>

      {/* ── Inputs Modal ──────────────────────────────────────────────────────── */}
      {showInputs && (
        <Modal title="Paramètres d'Entrée — Sources de Données" onClose={() => setShowInputs(false)}>
          <div className="p-4 space-y-1 min-w-[520px] max-h-[80vh] overflow-y-auto">
            <div className="text-xs mf-txt4 mb-3">
              Les valeurs marquées <span className="text-teal-400">LIMS</span> sont auto-chargées depuis le module LIMS.
              Les autres peuvent être ajustées manuellement.
            </div>
            {(() => {
              // Groupes dans l'ordre de première apparition (ordre procédé).
              const groups: string[] = [];
              for (const f of INPUT_FIELDS) if (!groups.includes(f.group)) groups.push(f.group);
              return groups.map(g => {
                // Seuls les champs dont l'équipement est actif (ou non lié à un
                // équipement) sont affichés ; un groupe vidé disparaît.
                const fields = INPUT_FIELDS.filter(f => f.group === g && fieldVisible(f.key));
                if (fields.length === 0) return null;
                const isComminution = g.startsWith('Comminution');
                return (
                  <div key={g} className="mb-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-teal-300/90 border-b border-mf-border pb-1 mb-2">{g}</div>
                    {isComminution && (
                      <div className="text-[10px] mf-txt4 mb-2">
                        Chaîne procédé : ROM → primaire → secondaire → tertiaire → HPGR → SAG → ball mill → regrind.
                        Le F80 d'un étage ≈ le P80 produit de l'étage amont — ajustez selon votre circuit réel.
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {fields.map(f => (
                        <div key={f.key} className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] mf-txt3">{f.label}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                              f.source === 'LIMS' ? 'bg-teal-400/10 text-teal-400 border-teal-400/20' :
                              f.source === 'Projet' || f.source === 'Modèle blocs' ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' :
                              'bg-white/5 text-white/40 border-white/10'
                            }`}>{f.source}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step={f.step}
                              value={inputs[f.key]}
                              onChange={e => updateInput(f.key, parseFloat(e.target.value) || 0)}
                              className="input-field flex-1 text-xs py-0.5"
                            />
                            <span className="text-[10px] mf-txt4 w-12 shrink-0">{f.unit}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </Modal>
      )}

      {/* ── Snapshot Modal ────────────────────────────────────────────────────── */}
      {showSnapshot && (
        <Modal title="Créer un Snapshot" onClose={() => setShowSnapshot(false)}>
          <div className="p-4 space-y-3 min-w-[360px]">
            <div className="text-xs mf-txt3">Enregistrez l'état actuel comme référence figée (Rev A, B, C…)</div>
            <input
              className="input-field w-full"
              placeholder="Ex: Rev A — PFS 2025-07"
              value={snapshotLabel}
              onChange={e => setSnapshotLabel(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSnapshot(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={createSnapshot} disabled={!snapshotLabel.trim()} className="btn btn-teal">
                <Camera size={13}/> Créer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── History Modal ─────────────────────────────────────────────────────── */}
      {showHistory && (
        <Modal title="Historique des Snapshots" onClose={() => setShowHistory(false)}>
          <div className="p-4 min-w-[400px] space-y-2">
            {snapshots.length === 0 && (
              <div className="text-center mf-txt3 py-8 text-sm">Aucun snapshot enregistré</div>
            )}
            {snapshots.map(s => (
              <div key={s.id} className="flex items-center gap-3 card-sm py-2">
                <Lock size={13} className="mf-txt3 shrink-0"/>
                <div className="flex-1">
                  <div className="text-xs font-semibold mf-txt">{s.label}</div>
                  <div className="text-[10px] mf-txt4">{new Date(s.created_at).toLocaleString('fr-CA')}</div>
                </div>
                <button onClick={() => restoreSnapshot(s.id)} className="btn btn-sm btn-secondary text-xs">
                  Restaurer
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Parameter row sub-component ─────────────────────────────────────────────

interface ParameterRowProps {
  row: CriteriaRow;
  userEdit?: { comment: string; reference: string };
  onEditChange: (rowId: string, col: 'comment' | 'reference', val: string) => void;
}

function ParameterRow({ row, userEdit, onEditChange }: ParameterRowProps) {
  const [editingComment, setEditingComment] = useState(false);
  const [editingRef, setEditingRef] = useState(false);

  const comment = userEdit?.comment ?? '';
  const reference = userEdit?.reference ?? '';

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03] group">
      <td className="px-2 py-1 w-16">
        <span className="text-[10px] mf-txt4">{row.id.slice(0, 6)}</span>
      </td>
      <td className="px-2 py-1 w-72">
        <span className="mf-txt text-xs">{row.parameter}</span>
      </td>
      <td className="px-2 py-1 w-28 text-right">
        <span className={`font-mono text-xs font-semibold ${row.isCalc ? 'text-teal-300' : 'text-amber-300'}`}>
          {row.value}
        </span>
      </td>
      <td className="px-2 py-1 w-20">
        <span className="text-[11px] mf-txt4">{row.unit}</span>
      </td>
      <td className="px-2 py-1 w-60">
        <span className="text-[10px] text-blue-400/70 font-mono leading-tight">{row.formula}</span>
      </td>
      <td className="px-2 py-1 w-24">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
          row.source === 'LIMS' ? 'bg-teal-400/10 text-teal-400' :
          row.source === 'Calcul' ? 'bg-blue-400/10 text-blue-400' :
          row.source === 'Projet' || row.source === 'Gisement' ? 'bg-purple-400/10 text-purple-400' :
          row.source === 'Pratique' ? 'bg-amber-400/10 text-amber-400' :
          row.source === 'Réglement' ? 'bg-red-400/10 text-red-400' :
          'bg-white/5 text-white/40'
        }`}>{row.source}</span>
      </td>
      {/* Comment — user fills */}
      <td className="px-1 py-0.5 w-48 border-l border-amber-400/10">
        {editingComment ? (
          <input
            autoFocus
            className="input-field w-full text-xs py-0.5 bg-amber-400/5"
            value={comment}
            onChange={e => onEditChange(row.id, 'comment', e.target.value)}
            onBlur={() => setEditingComment(false)}
          />
        ) : (
          <div
            className="text-xs mf-txt px-1 py-0.5 min-h-[20px] cursor-pointer rounded hover:bg-amber-400/10 italic text-white/40"
            onClick={() => setEditingComment(true)}
          >
            {comment || <span className="text-[10px] text-white/20">cliquer pour saisir…</span>}
          </div>
        )}
      </td>
      {/* Reference — user fills */}
      <td className="px-1 py-0.5 w-40">
        {editingRef ? (
          <input
            autoFocus
            className="input-field w-full text-xs py-0.5 bg-amber-400/5"
            value={reference}
            onChange={e => onEditChange(row.id, 'reference', e.target.value)}
            onBlur={() => setEditingRef(false)}
          />
        ) : (
          <div
            className="text-xs mf-txt px-1 py-0.5 min-h-[20px] cursor-pointer rounded hover:bg-amber-400/10 italic text-white/40"
            onClick={() => setEditingRef(true)}
          >
            {reference || <span className="text-[10px] text-white/20">référence…</span>}
          </div>
        )}
      </td>
    </tr>
  );
}
