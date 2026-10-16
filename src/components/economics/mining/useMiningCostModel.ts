// État du module Coûts miniers, partagé par les onglets CAPEX et OPEX de
// l'Économie : chargement des données projet (Mine & Optimisation), du modèle
// persisté (surcharges), calcul, enregistrement et injection dans le modèle
// économique (capex_lines / opex_lines / capital de maintien).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { useProject, type CapexLine, type OpexLine, type ProjectSettings } from '../../../lib/ProjectContext';
import type { Project } from '../../../types';
import {
  applyOverrides,
  computeMiningCost,
  defaultMiningModel,
  effectiveProvenance,
  getPath,
  type MinePhaseSource,
  type MineParamsSource,
  type MiningCostResult,
  type MiningModel,
  type MiningOverrides,
} from '../../../lib/mining/projectInputs';
import {
  MINING_AUTO_NOTE,
  mergedSustaining,
  miningCapexLines,
  miningOpexLines,
  miningSustainingMusdPerYear,
} from '../../../lib/mining/economicLines';
import { loadMineCostModel, saveMineCostModel, type MineCostModelRow } from '../../../lib/data/mineCostStore';
import { logAuditEvent } from '../../../lib/audit/auditLog';
import type { MiningMethod, Provenance } from '../../../lib/mining/types';

export interface MiningCostState {
  loading: boolean;
  error: string | null;
  model: MiningModel | null;
  provenance: Record<string, Provenance>;
  overrides: MiningOverrides;
  result: MiningCostResult | null;
  dirty: boolean;
  saving: boolean;
  applying: boolean;
  row: MineCostModelRow | null;
  hasMineParams: boolean;
  phaseCount: number;
  /** Lignes minières actuellement présentes dans l'Économie. */
  injectedCapex: CapexLine[];
  injectedOpex: OpexLine[];
  setOverride: (path: string, value: unknown) => void;
  resetOverride: (path: string) => void;
  resetAll: () => void;
  setMethod: (m: MiningMethod) => void;
  isOverridden: (path: string) => boolean;
  valueAt: (path: string) => unknown;
  save: () => Promise<void>;
  applyToEconomics: (opts: { includeSustaining: boolean }) => Promise<{ capex: number; opex: number; sustaining: number | null }>;
}

export function useMiningCostModel(project: Project): MiningCostState {
  const {
    settings, saveSettings, assumptions,
    capexLines, opexLines, addCapexLine, deleteCapexLine, addOpexLine, deleteOpexLine,
  } = useProject();

  const [mineParams, setMineParams] = useState<MineParamsSource | null>(null);
  const [phases, setPhases] = useState<MinePhaseSource[]>([]);
  const [row, setRow] = useState<MineCostModelRow | null>(null);
  const [overrides, setOverrides] = useState<MiningOverrides>({});
  const [method, setMethodState] = useState<MiningMethod | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [mp, ph, saved] = await Promise.all([
          supabase.from('mine_params').select('method, stripping_ratio, bench_height_m, reserves_mt, lom_years, ramp_up_y1_pct, ramp_up_y2_pct').eq('project_id', project.id).maybeSingle(),
          supabase.from('mine_phases').select('year_start, year_end, ore_mt, waste_mt').eq('project_id', project.id),
          loadMineCostModel(project.id),
        ]);
        if (cancelled) return;
        setMineParams((mp.data as MineParamsSource | null) ?? null);
        setPhases((ph.data as MinePhaseSource[] | null) ?? []);
        setRow(saved);
        setOverrides(saved?.overrides ?? {});
        setMethodState(saved?.method ?? null);
        setDirty(false);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const base = useMemo(() => defaultMiningModel({
    project: {
      target_tph: project.target_tph,
      availability_pct: project.availability_pct,
      ore_sg: project.ore_sg,
      gold_grade_g_t: project.gold_grade_g_t,
    },
    assumptions,
    settings: settings ? { lom_years: settings.lom_years, contingency_pct: settings.contingency_pct } : null,
    mineParams,
    phases,
  }), [project.target_tph, project.availability_pct, project.ore_sg, project.gold_grade_g_t, assumptions, settings, mineParams, phases]);

  const model = useMemo<MiningModel | null>(() => {
    if (loading) return null;
    const m = applyOverrides(base.model, overrides);
    return method ? { ...m, method } : m;
  }, [base, overrides, method, loading]);

  const provenance = useMemo(() => {
    const p = effectiveProvenance(base.provenance, overrides);
    if (method && method !== base.model.method) p.method = { origin: 'override', source: 'Choisi dans le module Coûts miniers' };
    return p;
  }, [base, overrides, method]);

  const result = useMemo(() => (model ? computeMiningCost(model, phases) : null), [model, phases]);

  const setOverride = useCallback((path: string, value: unknown) => {
    setOverrides(o => ({ ...o, [path]: value }));
    setDirty(true);
  }, []);
  const resetOverride = useCallback((path: string) => {
    setOverrides(o => { const n = { ...o }; delete n[path]; return n; });
    setDirty(true);
  }, []);
  const resetAll = useCallback(() => { setOverrides({}); setMethodState(null); setDirty(true); }, []);
  const setMethod = useCallback((m: MiningMethod) => { setMethodState(m); setDirty(true); }, []);
  const isOverridden = useCallback((path: string) => Object.prototype.hasOwnProperty.call(overrides, path), [overrides]);
  const valueAt = useCallback((path: string) => getPath(model, path), [model]);

  const persist = useCallback(async (patch: Partial<MineCostModelRow>) => {
    if (!model) return null;
    const next: MineCostModelRow = {
      project_id: project.id,
      method: model.method,
      overrides,
      result_summary: row?.result_summary ?? null,
      applied_sustaining_musd_yr: row?.applied_sustaining_musd_yr ?? null,
      ...patch,
    };
    const saved = await saveMineCostModel(next);
    setRow(saved);
    setDirty(false);
    return saved;
  }, [model, overrides, project.id, row]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await persist({});
      void logAuditEvent({
        projectId: project.id, action: 'update', entityType: 'mine_cost_model',
        newValues: { method: model?.method, overrides },
      });
    } finally {
      setSaving(false);
    }
  }, [persist, project.id, model, overrides]);

  const applyToEconomics = useCallback(async ({ includeSustaining }: { includeSustaining: boolean }) => {
    if (!model || !result) throw new Error('Aucun calcul minier disponible.');
    setApplying(true);
    try {
      const contingency = model.method === 'underground' ? model.underground.contingencyPct : model.openPit.contingencyPct;
      const newCapex = miningCapexLines(result, contingency);
      const newOpex = miningOpexLines(result);
      // Remplace les lignes générées précédemment ; les lignes manuelles et celles
      // de la métallurgie (autre marqueur) ne sont pas touchées.
      for (const l of capexLines.filter(l => l.notes === MINING_AUTO_NOTE)) await deleteCapexLine(l.id);
      for (const l of opexLines.filter(l => l.notes === MINING_AUTO_NOTE)) await deleteOpexLine(l.id);
      for (const l of newCapex) await addCapexLine(l);
      for (const l of newOpex) await addOpexLine(l);

      let sustaining: number | null = null;
      let applied = row?.applied_sustaining_musd_yr ?? null;
      if (includeSustaining) {
        const mining = miningSustainingMusdPerYear(result);
        sustaining = mergedSustaining(settings?.sustaining_capex_musd_yr ?? null, applied, mining);
        await saveSettings({ sustaining_capex_musd_yr: sustaining } as Partial<ProjectSettings>);
        applied = mining;
      }

      const summary = {
        method: model.method,
        initialCapexMusd: result.totals.initialCapexUsd / 1e6,
        sustainingMusdPerYear: result.totals.sustainingUsdPerYear / 1e6,
        opexUsdPerOreTonne: result.totals.opexUsdPerOreTonne,
        capexLines: newCapex.length,
        opexLines: newOpex.length,
        appliedAt: new Date().toISOString(),
      };
      await persist({ result_summary: summary, applied_sustaining_musd_yr: applied });
      void logAuditEvent({
        projectId: project.id, action: 'apply_mine_costs', entityType: 'mine_cost_model',
        previousValues: row?.result_summary ? { ...row.result_summary } : null,
        newValues: { ...summary, sustainingProjectMusdYr: sustaining },
        metadata: { overrides: Object.keys(overrides).length },
      });
      return { capex: newCapex.length, opex: newOpex.length, sustaining };
    } finally {
      setApplying(false);
    }
  }, [model, result, capexLines, opexLines, deleteCapexLine, deleteOpexLine, addCapexLine, addOpexLine, row, settings, saveSettings, persist, project.id, overrides]);

  return {
    loading, error, model, provenance, overrides, result, dirty, saving, applying, row,
    hasMineParams: mineParams != null,
    phaseCount: phases.length,
    injectedCapex: capexLines.filter(l => l.notes === MINING_AUTO_NOTE),
    injectedOpex: opexLines.filter(l => l.notes === MINING_AUTO_NOTE),
    setOverride, resetOverride, resetAll, setMethod, isOverridden, valueAt, save, applyToEconomics,
  };
}
