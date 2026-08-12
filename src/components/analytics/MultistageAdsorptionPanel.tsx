// ─────────────────────────────────────────────────────────────────────────────
// Profil d'adsorption multi-cuves CIL / CIP — sous-page « Prédiction IA ».
//
// Câble le moteur pur `simulateMultistageAdsorption` (Nicol & Fleming) : profil
// cuve par cuve de l'or en solution et sur le charbon, pertes solubles en queue,
// chargement du charbon de tête et inventaire d'or immobilisé. Modèle simplifié
// de CADRAGE — à recaler sur les essais de charge/décharge du site.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import { Layers, TrendingDown, Coins, Recycle } from 'lucide-react';
import { simulateMultistageAdsorption, type MultistageAdsorptionInputs } from '../../lib/analytics/adsorptionMultistage';
import { formatDecimalGrouped } from '../../lib/format/number';

const DEFAULTS: MultistageAdsorptionInputs = {
  tankCount: 6, tankVolumeM3: 500, slurryFlowM3H: 250,
  feedGoldSolubleGm3: 2.5, feedGoldSolidGt: 1.0,
  carbonConcentrationGl: 15, carbonTransferKgH: 1500,
  adsorptionRateK: 0.15, mode: 'CIL',
};

interface FieldCfg { key: keyof MultistageAdsorptionInputs; label: string; unit: string; min: number; max: number; step: number; cilOnly?: boolean; }
const FIELDS: FieldCfg[] = [
  { key: 'tankCount',           label: 'Nombre de cuves',        unit: '',      min: 1,   max: 12,   step: 1 },
  { key: 'tankVolumeM3',        label: 'Volume par cuve',        unit: 'm³',    min: 10,  max: 5000, step: 10 },
  { key: 'slurryFlowM3H',       label: 'Débit de pulpe',         unit: 'm³/h',  min: 10,  max: 3000, step: 10 },
  { key: 'feedGoldSolubleGm3',  label: 'Au soluble alimenté',    unit: 'g/m³',  min: 0,   max: 50,   step: 0.1 },
  { key: 'feedGoldSolidGt',     label: 'Au solide alimenté',     unit: 'g/t',   min: 0,   max: 50,   step: 0.1, cilOnly: true },
  { key: 'carbonConcentrationGl', label: 'Charbon en cuve',      unit: 'g/L',   min: 1,   max: 40,   step: 0.5 },
  { key: 'carbonTransferKgH',   label: 'Transfert charbon',      unit: 'kg/h',  min: 10,  max: 10000, step: 10 },
  { key: 'adsorptionRateK',     label: 'Vitesse d\'adsorption k', unit: 'h⁻¹',   min: 0.01, max: 2,   step: 0.01 },
];

export function MultistageAdsorptionPanel() {
  const [inp, setInp] = useState<MultistageAdsorptionInputs>(DEFAULTS);
  const res = useMemo(() => simulateMultistageAdsorption(inp), [inp]);
  const set = (k: keyof MultistageAdsorptionInputs, v: number) => setInp(prev => ({ ...prev, [k]: v }));

  // Échelles du mini-graphe (solution + charbon par cuve).
  const cMax = Math.max(1e-6, ...res.tanks.map(t => t.cSolubleGm3));
  const qMax = Math.max(1e-6, ...res.tanks.map(t => t.qCarbonGt));
  const W = 520, H = 150, PAD = { l: 8, r: 8, t: 12, b: 22 };
  const x = (i: number) => PAD.l + (res.tanks.length <= 1 ? 0.5 : i / (res.tanks.length - 1)) * (W - PAD.l - PAD.r);
  const ySol = (v: number) => PAD.t + (1 - v / cMax) * (H - PAD.t - PAD.b);
  const yCar = (v: number) => PAD.t + (1 - v / qMax) * (H - PAD.t - PAD.b);
  const path = (fy: (v: number) => number, val: (t: typeof res.tanks[number]) => number) =>
    res.tanks.map((t, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${fy(val(t)).toFixed(1)}`).join(' ');

  const KPIS = [
    { label: 'Récup. adsorption', val: `${formatDecimalGrouped(res.overallAdsorptionRecoveryPct, 1)} %`, icon: Layers, color: 'text-emerald-400' },
    { label: 'Charbon de tête', val: `${formatDecimalGrouped(res.loadedCarbonGradeGt, 0)} g/t`, icon: Coins, color: 'text-amber-400' },
    { label: 'Perte soluble queue', val: `${formatDecimalGrouped(res.tailSolubleLossGH, 1)} g/h`, icon: TrendingDown, color: 'text-red-400' },
    { label: 'Inventaire Au charbon', val: `${formatDecimalGrouped(res.totalCarbonInventoryKg, 2)} kg`, icon: Recycle, color: 'text-sky-400' },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-mf-txt">
          <Layers size={15} className="text-teal-400" /> Adsorption multi-cuves ({inp.mode})
        </div>
        <div className="flex rounded-lg overflow-hidden border border-mf-border text-xs">
          {(['CIL', 'CIP'] as const).map(m => (
            <button key={m} onClick={() => setInp(prev => ({ ...prev, mode: m }))}
              className={`px-3 py-1 font-semibold transition-colors ${inp.mode === m ? 'bg-teal-500 text-mf-bg' : 'bg-mf-panel text-mf-txt3 hover:text-mf-txt2'}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-mf-txt4 mb-4">
        Profil cuve par cuve de l'or (solution & charbon) à contre-courant. Modèle simplifié de cadrage — à recaler sur les essais.
      </p>

      {/* Paramètres */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 mb-4">
        {FIELDS.filter(f => !f.cilOnly || inp.mode === 'CIL').map(f => (
          <label key={f.key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-mf-txt4">{f.label}{f.unit && ` (${f.unit})`}</span>
            <input type="number" className="input-field text-xs py-1"
              value={inp[f.key] as number} min={f.min} max={f.max} step={f.step}
              onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) set(f.key, n); }} />
          </label>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {KPIS.map(k => (
          <div key={k.label} className="card-sm py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-mf-txt4 mb-0.5"><k.icon size={11} className={k.color} /> {k.label}</div>
            <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Profil */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4 mb-1">Profil par cuve</div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
            <polyline points={res.tanks.map((t, i) => `${x(i)},${ySol(t.cSolubleGm3)}`).join(' ')} fill="none" stroke="#34D399" strokeWidth={2} />
            <path d={path(yCar, t => t.qCarbonGt)} fill="none" stroke="#FBBF24" strokeWidth={2} strokeDasharray="4 3" />
            {res.tanks.map((t, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={ySol(t.cSolubleGm3)} r={2.5} fill="#34D399" />
                <circle cx={x(i)} cy={yCar(t.qCarbonGt)} r={2.5} fill="#FBBF24" />
                <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#56657A">C{i + 1}</text>
              </g>
            ))}
          </svg>
          <div className="flex gap-4 text-[10px] mt-1">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400 inline-block" /> Au solution (g/m³)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block" style={{ borderTop: '2px dashed' }} /> Au charbon (g/t)</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="tbl text-[11px] w-full">
            <thead><tr><th>Cuve</th><th className="text-right">Au sol. (g/m³)</th><th className="text-right">Au charbon (g/t)</th><th className="text-right">Perte (g/h)</th></tr></thead>
            <tbody>
              {res.tanks.map(t => (
                <tr key={t.tankIndex}>
                  <td>C{t.tankIndex}</td>
                  <td className="text-right font-mono text-emerald-300">{formatDecimalGrouped(t.cSolubleGm3, 3)}</td>
                  <td className="text-right font-mono text-amber-300">{formatDecimalGrouped(t.qCarbonGt, 0)}</td>
                  <td className="text-right font-mono text-mf-txt4">{formatDecimalGrouped(t.solubleLossGH, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
