import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Project, ResourceRunRow } from '../../types';
import { evaluateGates, canExportReport, type ComplianceInput, type GateStatus } from '../../lib/compliance/gates';

/** État du rapport transmis par la page NI 43-101 (ses propres sections). */
export interface ReportComplianceState {
  itemsComplete: number;
  itemsTotal: number;
  allSignedOff: boolean;
  resourceValidated: boolean;
  reserveValidated: boolean;
}

const ICON: Record<GateStatus, typeof ShieldCheck> = { pass: ShieldCheck, warn: ShieldAlert, fail: ShieldX };
const COLOR: Record<GateStatus, string> = {
  pass: 'text-emerald-400',
  warn: 'text-amber-400',
  fail: 'text-red-400',
};
const LABEL: Record<GateStatus, string> = { pass: 'Conforme', warn: 'À vérifier', fail: 'Bloquant' };

/**
 * Panneau de conformité NI 43-101 : évalue les gates (V3 ressource, V5 réserve,
 * V6 économie, V7 rapport) à partir des données réellement disponibles dans le
 * projet. Là où l'app ne peut pas encore prouver un point (réserve formelle non
 * établie), le contrôle apparaît honnêtement en « À vérifier / Bloquant » plutôt
 * qu'en faux « Conforme ».
 */
export function CompliancePanel({ project, report }: { project: Project; report: ReportComplianceState }) {
  const [run, setRun] = useState<ResourceRunRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>('V5');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('resource_estimation_runs')
        .select('*')
        .eq('project_id', project.id)
        .eq('is_effective', true)
        .maybeSingle();
      if (!cancelled) setRun((data as ResourceRunRow) ?? null);
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const gt = run?.summary?.gradeTonnage ?? [];
  const resourceMITonnes = gt.length > 0 ? gt[0].tonnes : 0;

  const input: ComplianceInput = {
    resource: {
      hasEffectiveRun: !!run,
      effectiveDate: run?.effective_date ?? null,
      crossValMeanError: run?.summary?.crossValidation?.meanError ?? null,
      crossValStdev: run?.summary?.compositeStats?.stdev ?? null,
      hasGradeTonnage: gt.length > 0,
      qpAssigned: report.resourceValidated,
    },
    reserve: {
      // Notre estimation exclut structurellement l'Inféré du grade-tonnage M+I.
      inferredBlocksInPlan: 0,
      // Réserve formelle non encore produite par un module dédié → non documentées.
      dilutionApplied: false,
      miningRecoveryApplied: false,
      reserveTonnes: 0,
      resourceMITonnes,
      qpAssigned: report.reserveValidated,
    },
    economics: {
      // Invariant ARCHITECTURAL (pas une donnée du projet) : toutes les pages lisent
      // leurs prix depuis lib/metals + config/constants — il n'existe plus de
      // constante de prix locale à une page depuis le refactor multi-métal.
      pricesFromSingleSource: true,
      // Honnête comme les champs de réserve ci-dessus : l'app ne persiste pas encore
      // la preuve qu'une analyse de sensibilité a été produite/revue pour ce projet
      // (SensitivityTab est calculée à la volée, sans sauvegarde) — donc « à
      // vérifier » plutôt qu'un faux « Conforme ».
      hasSensitivity: false,
    },
    report: {
      itemsComplete: report.itemsComplete,
      itemsTotal: report.itemsTotal,
      allItemsSignedOff: report.allSignedOff,
    },
  };

  const gates = evaluateGates(input);
  const exportOk = canExportReport(gates);

  return (
    <div className="border border-mf-border rounded-lg bg-mf-panel mb-6">
      <div className="px-5 py-4 border-b border-mf-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-mf-txt">Conformité NI 43-101 — points de contrôle</h3>
          <p className="text-xs text-mf-txt4 mt-0.5">
            Règles bloquantes évaluées sur les données du projet. L'export du rapport est
            {exportOk ? ' autorisé' : ' bloqué'} tant qu'un gate est en échec.
          </p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full ${exportOk ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
          {exportOk ? 'Export autorisé' : 'Export bloqué'}
        </span>
      </div>

      <div className="divide-y divide-mf-border">
        {gates.map(g => {
          const Icon = ICON[g.status];
          const open = expanded === g.gateId;
          return (
            <div key={g.gateId}>
              <button
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-mf-bg/40 transition-colors"
                onClick={() => setExpanded(open ? null : g.gateId)}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={16} className={COLOR[g.status]} />
                  <span className="text-sm text-mf-txt2">{g.gateId} — {g.label}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${COLOR[g.status]}`}>{LABEL[g.status]}</span>
                  <ChevronDown size={14} className={`text-mf-txt4 transition-transform ${open ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {open && (
                <div className="px-5 pb-3 space-y-1.5">
                  {g.checks.map(c => {
                    const CIcon = ICON[c.status];
                    return (
                      <div key={c.id} className="flex items-start gap-2 text-xs">
                        <CIcon size={13} className={`${COLOR[c.status]} mt-0.5 shrink-0`} />
                        <span className="text-mf-txt3">
                          {c.label}
                          {c.detail && <span className="text-mf-txt4"> — {c.detail}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
