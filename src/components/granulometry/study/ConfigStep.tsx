import { useState } from 'react';
import { Save } from 'lucide-react';
import type { P80Study, StudyObjective } from '../../../lib/db/p80Study';
import { WebhookConfigPanel } from './WebhookConfigPanel';

interface Props {
  study: P80Study;
  onSave: (patch: Partial<P80Study>) => Promise<void>;
}

const OBJECTIVES: Array<{ id: StudyObjective; label: string }> = [
  { id: 'recovery',   label: 'Maximiser la récupération' },
  { id: 'throughput', label: 'Maximiser le débit' },
  { id: 'cost',       label: 'Minimiser le coût' },
  { id: 'net_value',  label: 'Maximiser la valeur nette / oz par jour' },
];

/** Étape 1 — configuration du projet métallurgique (spec §4, étape 1). */
export function ConfigStep({ study, onSave }: Props) {
  const [name, setName] = useState(study.study_name);
  const [oreType, setOreType] = useState(study.ore_type ?? '');
  const [zone, setZone] = useState(study.deposit_zone ?? '');
  const [route, setRoute] = useState(study.process_route ?? '');
  const [objective, setObjective] = useState<StudyObjective>(study.objective);
  const [targetsRaw, setTargetsRaw] = useState(study.p80_targets_um.join(', '));
  const [saving, setSaving] = useState(false);

  const targets = targetsRaw.split(',').map(t => Number(t.trim())).filter(n => Number.isFinite(n) && n > 0);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        study_name: name.trim() || study.study_name,
        ore_type: oreType.trim() || null,
        deposit_zone: zone.trim() || null,
        process_route: route.trim() || null,
        objective,
        p80_targets_um: targets,
      });
    } finally { setSaving(false); }
  };

  const field = 'input-field text-sm w-full';
  return (
    <div className="space-y-6">
    <div className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-mf-txt4 block mb-1">Nom de l'étude</label>
          <input className={field} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-mf-txt4 block mb-1">Type de minerai</label>
          <input className={field} value={oreType} onChange={e => setOreType(e.target.value)} placeholder="Minerai primaire sulfuré…" />
        </div>
        <div>
          <label className="text-xs text-mf-txt4 block mb-1">Zone / domaine géologique</label>
          <input className={field} value={zone} onChange={e => setZone(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-mf-txt4 block mb-1">Procédé</label>
          <input className={field} value={route} onChange={e => setRoute(e.target.value)} placeholder="Gravimétrie + cyanuration des rejets…" />
        </div>
      </div>
      <div>
        <label className="text-xs text-mf-txt4 block mb-1">Objectif de l'étude</label>
        <select className={field} value={objective} onChange={e => setObjective(e.target.value as StudyObjective)}>
          {OBJECTIVES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-mf-txt4 block mb-1">P80 à comparer (µm, séparés par des virgules)</label>
        <input className={field} value={targetsRaw} onChange={e => setTargetsRaw(e.target.value)} placeholder="150, 106, 75, 53" />
        <div className="text-[10px] text-mf-txt4 mt-1">{targets.length} P80 cibles : {targets.join(' · ') || '—'}</div>
      </div>
      <button onClick={() => void save()} disabled={saving} className="btn btn-primary gap-1.5 text-sm">
        <Save size={14} /> {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
      </button>
    </div>
    <WebhookConfigPanel study={study} />
    </div>
  );
}
