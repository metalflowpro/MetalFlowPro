import { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from '@e965/xlsx';
import { Save, CheckCircle2, FileDown, Lock, ShieldCheck } from 'lucide-react';
import { P80_STUDY_DEFAULTS } from '../../../lib/config/constants';
import {
  listResults, listScenarios, latestRecommendation, saveRecommendation, approveRecommendation,
  addSignature, listSignatures,
  type P80Study, type P80TestResult, type P80PlantScenario, type P80Recommendation, type P80Signature,
} from '../../../lib/db/p80Study';
import { scoreLab } from './studyCompute';
import type { StudyStatus } from '../../../lib/db/p80Study';

interface Props {
  study: P80Study;
  onChanged: () => void;
  onAdvance: (status: StudyStatus) => Promise<void>;
}

/** Niveau de confiance indicatif depuis le nombre de P80 exploitables (spec §7). */
function suggestConfidence(nCandidates: number): 'low' | 'medium' | 'high' {
  const t = P80_STUDY_DEFAULTS.CONFIDENCE_SAMPLE_THRESHOLDS;
  if (nCandidates >= t.high) return 'high';
  if (nCandidates >= t.medium) return 'medium';
  return 'low';
}

/** Étape 6 — recommandation, hypothèses, export, approbation. */
export function ReportStep({ study, onChanged, onAdvance }: Props) {
  const [results, setResults] = useState<P80TestResult[]>([]);
  const [scenarios, setScenarios] = useState<P80PlantScenario[]>([]);
  const [reco, setReco] = useState<P80Recommendation | null>(null);
  const [signatures, setSignatures] = useState<P80Signature[]>([]);
  const [labP80, setLabP80] = useState('');
  const [plantP80, setPlantP80] = useState('');
  const [rangeLow, setRangeLow] = useState('');
  const [rangeHigh, setRangeHigh] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, sc, rc, sig] = await Promise.all([
      listResults(study.id), listScenarios(study.id), latestRecommendation(study.id), listSignatures(study.id),
    ]);
    setResults(r); setScenarios(sc); setReco(rc); setSignatures(sig);
    if (rc) {
      setLabP80(rc.lab_p80_um?.toString() ?? '');
      setPlantP80(rc.plant_p80_um?.toString() ?? '');
      setRangeLow(rc.range_low_um?.toString() ?? '');
      setRangeHigh(rc.range_high_um?.toString() ?? '');
      setRationale(rc.rationale ?? '');
    }
  }, [study.id]);
  useEffect(() => { void load(); }, [load]);

  const lab = useMemo(() => scoreLab(results), [results]);
  const plantOptimum = useMemo(() => {
    if (scenarios.length === 0) return null;
    const key = study.objective === 'recovery' ? 'oz_per_day' : 'net_value_per_day';
    return scenarios.reduce((best, s) =>
      (s[key] ?? -Infinity) > (best[key] ?? -Infinity) ? s : best, scenarios[0]);
  }, [scenarios, study.objective]);

  // Pré-remplissage depuis les optima calculés (l'utilisateur peut ajuster).
  useEffect(() => {
    if (reco) return;
    if (lab.best && labP80 === '') setLabP80(String(Math.round(lab.best.p80Um)));
    if (plantOptimum && plantP80 === '') setPlantP80(String(Math.round(plantOptimum.target_p80)));
  }, [lab.best, plantOptimum, reco, labP80, plantP80]);

  const confidence = suggestConfidence(lab.scored.length);
  const estRecovery = plantOptimum?.recovery_pct ?? lab.best?.recoveryPct ?? null;
  const published = reco?.status === 'published';

  const num = (s: string): number | null => {
    const n = Number(s.trim()); return s.trim() !== '' && Number.isFinite(n) ? n : null;
  };

  const save = async () => {
    setBusy(true);
    try {
      const assumptions = {
        objective: study.objective,
        lab_weights: lab.weights,
        plant_optimum_basis: study.objective === 'recovery' ? 'oz_per_day' : 'net_value_per_day',
        n_p80_candidates: lab.scored.length,
      };
      await saveRecommendation(study.project_id, study.id, {
        lab_p80_um: num(labP80), plant_p80_um: num(plantP80),
        range_low_um: num(rangeLow), range_high_um: num(rangeHigh),
        estimated_recovery_pct: estRecovery, confidence, rationale: rationale.trim() || null,
        assumptions: assumptions as unknown as import('../../../lib/database.types').Json,
        validation_required: ['locked-cycle test', 'campagne usine'],
        status: 'draft',
      });
      await load(); onChanged();
    } finally { setBusy(false); }
  };

  const approve = async (status: 'approved' | 'published') => {
    if (!reco) return;
    const role = status === 'published' ? 'responsible' : 'analyst';
    const meaning = status === 'published' ? 'Publication' : 'Approbation';
    // Contenu signé = image figée de la reco → hash SHA-256 (liaison au dossier).
    const signedContent = JSON.stringify({
      study: study.id, reco: reco.id, lab: reco.lab_p80_um, plant: reco.plant_p80_um,
      range: [reco.range_low_um, reco.range_high_um], recovery: reco.estimated_recovery_pct,
      confidence: reco.confidence, meaning,
    });
    if (!confirm(`Signature électronique — ${meaning}\n\nEn confirmant, vous apposez votre signature électronique (identité de session, horodatée et inaltérable) sur cette recommandation.`)) return;
    setBusy(true);
    try {
      await addSignature(study.project_id, study.id, reco.id, role, meaning, signedContent);
      await approveRecommendation(reco, status);
      await onAdvance(status === 'published' ? 'published' : 'recommendation_approved');
      await load(); onChanged();
    } finally { setBusy(false); }
  };

  const exportXlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      Etude: study.study_name, Minerai: study.ore_type, Zone: study.deposit_zone,
      Procede: study.process_route, Objectif: study.objective, Statut: study.status,
    }]), 'Étude');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.map(r => ({
      P80_cible: r.target_p80, P80_calcule: r.computed_p80, Methode: r.p80_method,
      R_calculee: r.computed_recovery, R_rapportee: r.au_recovery, QC: r.qc_status,
    }))), 'Résultats');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scenarios.map(s => ({
      P80: s.target_p80, Debit_tph: s.throughput_tph, Recup: s.recovery_pct,
      Oz_jour: s.oz_per_day, Valeur_nette_jour: s.net_value_per_day,
    }))), 'Usine');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
      P80_labo: num(labP80), P80_usine: num(plantP80),
      Plage_basse: num(rangeLow), Plage_haute: num(rangeHigh),
      Recup_estimee: estRecovery, Confiance: confidence, Motif: rationale,
    }]), 'Recommandation');
    XLSX.writeFile(wb, `etude_p80_${study.study_name.replace(/\s+/g, '_')}.xlsx`);
  };

  const field = 'input-field text-sm w-28';
  return (
    <div className="space-y-5 max-w-3xl">
      {published && (
        <div className="flex items-center gap-2 text-xs text-mf-txt3 bg-mf-hover/40 border border-mf-border rounded-lg px-3 py-2">
          <Lock size={13} /> Recommandation publiée — verrouillée. Toute correction crée une nouvelle version.
        </div>
      )}

      <div className="rounded-xl border border-mf-border bg-mf-card p-5 space-y-4">
        <div className="text-sm font-semibold text-mf-txt">Recommandation P80</div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-xs text-mf-txt4 block mb-1">P80 laboratoire (µm)</label><input disabled={published} className={field} value={labP80} onChange={e => setLabP80(e.target.value)} /></div>
          <div><label className="text-xs text-mf-txt4 block mb-1">P80 usine (µm)</label><input disabled={published} className={field} value={plantP80} onChange={e => setPlantP80(e.target.value)} /></div>
          <div><label className="text-xs text-mf-txt4 block mb-1">Plage basse (µm)</label><input disabled={published} className={field} value={rangeLow} onChange={e => setRangeLow(e.target.value)} /></div>
          <div><label className="text-xs text-mf-txt4 block mb-1">Plage haute (µm)</label><input disabled={published} className={field} value={rangeHigh} onChange={e => setRangeHigh(e.target.value)} /></div>
        </div>
        <div>
          <label className="text-xs text-mf-txt4 block mb-1">Motif / hypothèses</label>
          <textarea disabled={published} className="input-field text-sm w-full h-20" value={rationale} onChange={e => setRationale(e.target.value)}
            placeholder="Meilleur compromis récupération / débit / énergie ; validation requise : locked-cycle test et campagne usine." />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-mf-txt3">
          <span>Récupération estimée : <strong className="text-amber-400">{estRecovery != null ? `${estRecovery.toFixed(1)} %` : '—'}</strong></span>
          <span>Confiance : <strong className={confidence === 'high' ? 'text-emerald-400' : confidence === 'medium' ? 'text-teal-400' : 'text-amber-400'}>{confidence}</strong></span>
          <span>P80 exploitables : <strong>{lab.scored.length}</strong></span>
        </div>
        <p className="text-[11px] text-mf-txt4">
          Cette recommandation n'est pas une valeur absolue : elle est accompagnée des hypothèses
          (objectif, poids du score, base de l'optimum usine) et suppose une validation par
          locked-cycle test et campagne usine.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {!published && (
          <button onClick={() => void save()} disabled={busy} className="btn btn-primary gap-1.5 text-sm">
            <Save size={14} /> Enregistrer la recommandation
          </button>
        )}
        <button onClick={exportXlsx} className="btn btn-secondary gap-1.5 text-sm">
          <FileDown size={14} /> Export Excel
        </button>
        {reco && reco.status === 'draft' && (
          <button onClick={() => void approve('approved')} disabled={busy} className="btn btn-secondary gap-1.5 text-sm">
            <CheckCircle2 size={14} /> Approuver
          </button>
        )}
        {reco && reco.status === 'approved' && (
          <button onClick={() => void approve('published')} disabled={busy} className="btn btn-secondary gap-1.5 text-sm">
            <ShieldCheck size={14} /> Publier
          </button>
        )}
      </div>

      {reco && (
        <div className="text-xs text-mf-txt4">
          Version enregistrée : statut <strong className="text-mf-txt3">{reco.status}</strong>
          {reco.approved_by && <> · approuvée par {reco.approved_by}</>}
        </div>
      )}

      {signatures.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-mf-border text-xs font-bold text-mf-txt4 uppercase tracking-wider">
            Signatures électroniques (21 CFR Part 11) — inaltérables
          </div>
          <table className="tbl">
            <thead><tr><th>Signataire</th><th>Rôle</th><th>Signification</th><th>Date/heure</th><th>Empreinte (SHA-256)</th></tr></thead>
            <tbody>
              {signatures.map(s => (
                <tr key={s.id}>
                  <td className="text-xs">{s.signer}</td>
                  <td className="text-xs">{s.signer_role === 'responsible' ? 'Responsable' : 'Analyste'}</td>
                  <td className="text-xs">{s.meaning}</td>
                  <td className="text-xs text-mf-txt4">{new Date(s.signed_at).toLocaleString('fr-CA')}</td>
                  <td className="text-[10px] font-mono text-mf-txt4" title={s.content_hash}>{s.content_hash.slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
