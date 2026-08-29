import { updateFeedScenario, patchArea } from '../../lib/plantopt/modelOps';
import { defaultDistribution } from '../../lib/plantopt/config';
import { DistributionEditor } from './DistributionEditor';
import type { PlantModel } from '../../lib/plantopt/types';

interface Props {
  model: PlantModel;
  onModel: (m: PlantModel) => void;
}

/**
 * SCÉNARIO D'ALIMENTATION — corrélation dureté → capacité. Un minerai plus dur
 * abaisse la capacité des aires sensibles (broyage, HPGR…) proportionnellement à
 * l'écart de dureté par rapport à la référence.
 */
export function HardnessPanel({ model, onModel }: Props) {
  const feed = model.feedScenario ?? {};
  const active = !!feed.hardnessDist;
  const areas = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);

  const toggle = () =>
    onModel(updateFeedScenario(model, {
      hardnessDist: active ? undefined : { kind: 'lognormal', params: { mu: Math.log(100), sigma: 0.15 } },
      hardnessRef: active ? feed.hardnessRef : 100,
      hardnessToCapacity: active ? feed.hardnessToCapacity : 0.3,
    }));

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-mf-txt2">
        <input type="checkbox" checked={active} onChange={toggle} />
        Activer la variabilité de dureté du minerai
      </label>
      {active && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-mf-txt4 mb-1">Distribution de dureté (BWi / RQD…)</div>
            <DistributionEditor value={feed.hardnessDist!} onChange={spec => onModel(updateFeedScenario(model, { hardnessDist: spec }))} />
          </div>
          <div className="space-y-3">
            <div>
              <label className="label">Dureté de référence</label>
              <input type="number" className="input-field font-mono" value={feed.hardnessRef ?? 100}
                onChange={e => onModel(updateFeedScenario(model, { hardnessRef: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label">Sensibilité capacité (0–1)</label>
              <input type="number" step={0.05} min={0} max={1} className="input-field font-mono" value={feed.hardnessToCapacity ?? 0.3}
                onChange={e => onModel(updateFeedScenario(model, { hardnessToCapacity: Number(e.target.value) }))} />
              <p className="text-[11px] text-mf-txt4 mt-1">Réduit la capacité des aires sensibles proportionnellement à l'écart de dureté.</p>
            </div>
            <div>
              <div className="text-xs text-mf-txt4 mb-1">Aires sensibles à la dureté :</div>
              <div className="flex flex-wrap gap-2">
                {areas.map(a => (
                  <label key={a.id} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border cursor-pointer ${
                    a.hardnessSensitive ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-mf-border text-mf-txt4'
                  }`}>
                    <input type="checkbox" checked={!!a.hardnessSensitive}
                      onChange={e => onModel(patchArea(model, a.id, { hardnessSensitive: e.target.checked || undefined }))} className="hidden" />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TENEUR → RÉCUPÉRATION MÉTALLURGIQUE. Une teneur d'alimentation différente de la
 * référence module la récupération de chaque aire porteuse (base × (1 + sens·écart)).
 */
export function GradeRecoveryPanel({ model, onModel }: Props) {
  const feed = model.feedScenario ?? {};
  const active = !!feed.gradeDist;
  const areas = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);

  const toggle = () =>
    onModel(updateFeedScenario(model, {
      gradeDist: active ? undefined : { kind: 'normal', params: { mean: 1, sd: 0.1 } },
      gradeRef: active ? feed.gradeRef : 1,
    }));

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-mf-txt2">
        <input type="checkbox" checked={active} onChange={toggle} />
        Activer la variabilité de teneur
      </label>
      {active && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-mf-txt4 mb-1">Distribution de teneur</div>
            <DistributionEditor value={feed.gradeDist ?? defaultDistribution('normal')} onChange={spec => onModel(updateFeedScenario(model, { gradeDist: spec }))} />
          </div>
          <div className="space-y-3">
            <div>
              <label className="label">Teneur de référence</label>
              <input type="number" step={0.01} className="input-field font-mono" value={feed.gradeRef ?? 1}
                onChange={e => onModel(updateFeedScenario(model, { gradeRef: Number(e.target.value) }))} />
              <p className="text-[11px] text-mf-txt4 mt-1">Modifie le facteur de récupération proportionnellement à la teneur.</p>
            </div>
            <div>
              <div className="text-xs text-mf-txt4 mb-1">Récupération par aire — base (0..1) et sensibilité :</div>
              <div className="grid grid-cols-2 gap-2">
                {areas.map(a => (
                  <div key={a.id} className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-mf-txt3 truncate flex-1" title={a.name}>{a.name}</span>
                    <label className="text-mf-txt4">base
                      <input type="number" step={0.01} min={0} max={1} value={a.baseRecovery ?? ''} placeholder="—"
                        onChange={e => onModel(patchArea(model, a.id, { baseRecovery: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="input-field font-mono text-[11px] py-0.5 px-1 w-14 ml-1" />
                    </label>
                    <label className="text-mf-txt4">sens.
                      <input type="number" step={0.01} value={a.gradeSensitivity ?? ''} placeholder="0"
                        onChange={e => onModel(patchArea(model, a.id, { gradeSensitivity: e.target.value === '' ? undefined : Number(e.target.value) }))}
                        className="input-field font-mono text-[11px] py-0.5 px-1 w-14 ml-1" />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
