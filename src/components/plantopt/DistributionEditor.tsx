import { useMemo, useState } from 'react';
import {
  DIST_LABELS, DIST_PARAM_FIELDS, PLANT_OPT_DEFAULT_DIST_PARAMS, PLANT_OPT_MODEL_DEFAULTS,
} from '../../lib/plantopt/config';
import { sampleDistribution, percentile, fitDistribution } from '../../lib/plantopt/distributions';
import type { DistributionKind, DistributionSpec } from '../../lib/plantopt/types';

// Lois proposées dans l'éditeur (l'empirique/catégorielle restent créées par ajustement).
const EDITABLE_KINDS: DistributionKind[] = [
  'pert', 'triangular', 'normal', 'uniform', 'weibull', 'lognormal', 'exponential', 'constant', 'empirical',
];
const FITTABLE_KINDS: DistributionKind[] = ['normal', 'lognormal', 'weibull', 'exponential', 'empirical'];

/** Mini histogramme + CDF d'aperçu d'une loi (SVG, 240×120). */
function DistributionPreview({ spec }: { spec: DistributionSpec }) {
  const data = useMemo(() => {
    const raw = sampleDistribution(spec, PLANT_OPT_MODEL_DEFAULTS.PREVIEW_SAMPLES, 12345)
      .filter(Number.isFinite);
    const sorted = [...raw].sort((a, b) => a - b);
    const xMin = percentile(sorted, 0.01);
    const xMax = percentile(sorted, 0.99);
    const span = xMax - xMin || 1;
    const bins = new Array(30).fill(0);
    for (const v of raw) {
      let b = Math.floor(((v - xMin) / span) * 30);
      if (b < 0) b = 0;
      if (b >= 30) b = 29;
      bins[b] += 1;
    }
    const maxC = Math.max(...bins, 1);
    const cdf: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const t = xMin + (span * i) / 24;
      cdf.push([i / 24, sorted.filter(x => x <= t).length / sorted.length]);
    }
    return { bins, maxC, cdf, xMin, xMax };
  }, [spec]);

  const barW = 240 / data.bins.length;
  return (
    <div className="mt-2">
      <svg viewBox="0 0 240 120" className="w-full h-24 bg-mf-panel rounded-md border border-mf-border">
        {data.bins.map((c, i) => {
          const h = (c / data.maxC) * 96;
          return <rect key={i} x={i * barW + 0.5} y={104 - h} width={Math.max(0.5, barW - 1)} height={h} fill="#f59e0b" fillOpacity={0.7} />;
        })}
        <polyline
          fill="none" stroke="#38bdf8" strokeWidth={1.5}
          points={data.cdf.map(([t, p]) => `${240 * t},${104 - 96 * p}`).join(' ')}
        />
        <line x1={0} y1={104} x2={240} y2={104} stroke="#475569" strokeWidth={1} />
        <text x={4} y={116} fill="#94a3b8" fontSize={9}>{Math.round(data.xMin)}</text>
        <text x={236} y={116} textAnchor="end" fill="#94a3b8" fontSize={9}>{Math.round(data.xMax)}</text>
      </svg>
    </div>
  );
}

interface Props {
  value: DistributionSpec;
  onChange: (spec: DistributionSpec) => void;
  /** Unité affichée à côté des champs (ex. 't/h', 'h'). */
  unit?: string;
}

/**
 * Éditeur générique d'une loi de probabilité : choix de la famille, champs de
 * paramètres pilotés par la config (pas de champs codés en dur), aperçu, et
 * ajustement sur des données collées (avec écart KS).
 */
export function DistributionEditor({ value, onChange, unit }: Props) {
  const [rawData, setRawData] = useState('');
  const [fitKind, setFitKind] = useState<DistributionKind>('normal');
  const [fit, setFit] = useState<{ n: number; mean: number; sd: number; ks: number } | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const fields = DIST_PARAM_FIELDS[value.kind] ?? [];
  const params = value.params as Record<string, number | number[]>;

  const runFit = () => {
    setFitError(null);
    const nums = rawData
      .split(/[\s,;]+/)
      .map(s => Number(s))
      .filter(n => Number.isFinite(n));
    if (nums.length < PLANT_OPT_MODEL_DEFAULTS.FIT_MIN_POINTS) {
      setFitError(`Au moins ${PLANT_OPT_MODEL_DEFAULTS.FIT_MIN_POINTS} valeurs numériques requises`);
      return;
    }
    try {
      const res = fitDistribution(fitKind, nums);
      onChange(res.spec);
      setFit({ n: res.n, mean: res.mean, sd: res.sd, ks: res.ks });
    } catch (e) {
      setFitError(e instanceof Error ? e.message : 'Ajustement impossible');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-mf-txt4 w-14">Loi</span>
        <select
          value={value.kind}
          onChange={e => {
            const kind = e.target.value as DistributionKind;
            onChange({ kind, params: { ...PLANT_OPT_DEFAULT_DIST_PARAMS[kind] } });
            setFit(null);
          }}
          className="input-field text-xs py-1 flex-1"
        >
          {EDITABLE_KINDS.map(k => <option key={k} value={k}>{DIST_LABELS[k]}</option>)}
        </select>
      </div>

      {value.kind === 'empirical' && (
        <div className="text-[11px] text-mf-txt4">
          {Array.isArray(params.samples) ? (params.samples as number[]).length : 0} échantillons empiriques
        </div>
      )}

      {fields.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-mf-txt4 block mb-0.5">{f.label}{unit ? ` (${unit})` : ''}</label>
              <input
                type="number" step={f.step ?? 1}
                value={Number(params[f.key] ?? 0)}
                onChange={e => onChange({ ...value, params: { ...value.params, [f.key]: Number(e.target.value) } })}
                className="input-field font-mono text-xs py-1"
              />
            </div>
          ))}
        </div>
      )}

      <DistributionPreview spec={value} />

      {/* Ajustement sur données */}
      <details className="text-xs">
        <summary className="cursor-pointer text-mf-txt4 hover:text-mf-txt3 select-none">Ajuster sur des données mesurées…</summary>
        <div className="mt-2 space-y-2">
          <textarea
            value={rawData} onChange={e => setRawData(e.target.value)}
            placeholder="Collez des valeurs séparées par des espaces, virgules ou retours (ex. mesures de capacité ou de TTF)"
            rows={3}
            className="input-field text-xs w-full font-mono"
          />
          <div className="flex items-center gap-2">
            <select value={fitKind} onChange={e => setFitKind(e.target.value as DistributionKind)} className="input-field text-xs py-1">
              {FITTABLE_KINDS.map(k => <option key={k} value={k}>{DIST_LABELS[k]}</option>)}
            </select>
            <button onClick={runFit} className="btn btn-sm btn-secondary text-xs">Ajuster</button>
          </div>
          {fitError && <div className="text-[11px] text-red-400">{fitError}</div>}
          {fit && (
            <div className="text-[11px] text-mf-txt3 flex flex-wrap gap-x-3 gap-y-0.5">
              <span>n = {fit.n}</span>
              <span>moy = {fit.mean.toFixed(1)}</span>
              <span>σ = {fit.sd.toFixed(1)}</span>
              <span>
                KS ={' '}
                <span className={fit.ks < 0.1 ? 'text-emerald-400' : fit.ks < 0.2 ? 'text-amber-400' : 'text-red-300'}>
                  {fit.ks.toFixed(3)}
                </span>{' '}
                <span className="text-mf-txt4">(0 = parfait)</span>
              </span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
