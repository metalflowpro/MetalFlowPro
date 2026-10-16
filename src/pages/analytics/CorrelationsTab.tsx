import { useState } from 'react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { ScatterChart } from '../../components/ui/Chart';
import { Info, GitBranch,
} from 'lucide-react';

import { LimsData } from './model';

// ─── Tab: Corrélations ───────────────────────────────────────────────────────

interface ParamDef {
  key: string;
  label: string;
  unit: string;
  group: string;
  fn: (id: string, maps: DataMaps) => number | null | undefined;
}

interface DataMaps {
  chem: Map<string, LimsData['chem'][0]>;
  min: Map<string, LimsData['mineralogy'][0]>;
  leach: Map<string, LimsData['leaching'][0]>;
  comm: Map<string, LimsData['comminution'][0]>;
  flot: Map<string, LimsData['flotation'][0]>;
  knel: Map<string, LimsData['knelson'][0]>;
}

const PARAM_DEFS: ParamDef[] = [
  // Chimie
  { key: 'au_g_t',         label: 'Au tête',          unit: 'g/t',    group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.au_g_t },
  { key: 's_total',        label: 'S total',           unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.s_total_pct },
  { key: 's_sulfide',      label: 'S sulfure',         unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.s_sulfide_pct },
  { key: 'c_organic',      label: 'Corg',              unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.c_organic_pct },
  { key: 'fe_pct',         label: 'Fe',                unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.fe_pct },
  { key: 'as_ppm',         label: 'As',                unit: 'ppm',    group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.as_ppm },
  // Minéralogie
  { key: 'pyrite',         label: 'Pyrite',            unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.pyrite_pct },
  { key: 'pyrrhotite',     label: 'Pyrrhotite',        unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.pyrrhotite_pct },
  { key: 'au_free',        label: 'Au libre',          unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.au_free_pct },
  { key: 'carbonates',     label: 'Carbonates',        unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.carbonates_pct },
  { key: 'fe_oxides',      label: 'Oxydes Fe',         unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.fe_oxides_pct },
  // Comminution
  { key: 'bwi',            label: 'Bond Wi',           unit: 'kWh/t',  group: 'Comminution',   fn: (id, m) => m.comm.get(id)?.bwi_kwh_t },
  { key: 'sg',             label: 'Densité SG',        unit: 't/m³',   group: 'Comminution',   fn: (id, m) => m.comm.get(id)?.sg_t_m3 },
  // Gravimétrie
  { key: 'grg',            label: 'GRG Knelson',       unit: '%',      group: 'Gravimétrie',   fn: (id, m) => m.knel.get(id)?.grg_recovery_pct },
  // Flottation
  { key: 'flot_au_rec',    label: 'Récup. flot. Au',   unit: '%',      group: 'Flottation',    fn: (id, m) => m.flot.get(id)?.au_recovery_pct },
  { key: 'flot_s_rec',     label: 'Récup. flot. S',    unit: '%',      group: 'Flottation',    fn: (id, m) => m.flot.get(id)?.s_recovery_pct },
  // Lixiviation
  { key: 'leach_rec_24h',  label: 'Récup. lixiv. 24h', unit: '%',      group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.leach_rec_24h_pct },
  { key: 'leach_rec_48h',  label: 'Récup. lixiv. 48h', unit: '%',      group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.leach_rec_48h_pct },
  { key: 'leach_rec_2h',   label: 'Récup. lixiv. 2h',  unit: '%',      group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.leach_rec_2h_pct },
  { key: 'nacn_cons',      label: 'Cons. NaCN',        unit: 'kg/t',   group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.nacn_consumption_kg_t },
  { key: 'cao_cons',       label: 'Cons. CaO',         unit: 'kg/t',   group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.cao_consumption_kg_t },
  { key: 'au_tail',        label: 'Au résidu',         unit: 'g/t',    group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.au_feed_g_t },
];

interface SuggestedPair { xKey: string; yKey: string; label: string; color: string; interpretation: string }

const SUGGESTED_PAIRS: SuggestedPair[] = [
  { xKey: 'au_free',       yKey: 'leach_rec_24h', label: 'Au libre → Récup. 24h',   color: '#f59e0b', interpretation: 'Une corrélation positive confirme que la libération de l\'or contrôle directement la récupération par lixiviation. Attendu r > 0.6 pour un minerai oxydé.' },
  { xKey: 'pyrite',        yKey: 'leach_rec_24h', label: 'Pyrite → Récup. 24h',     color: '#9d78f0', interpretation: 'Une corrélation négative indique un minéral réfractaire. La pyrite encapsule l\'or et limite l\'accès du cyanure. r < −0.4 est préoccupant.' },
  { xKey: 'au_g_t',        yKey: 'leach_rec_24h', label: 'Teneur Au → Récup. 24h',  color: '#fbbf24', interpretation: 'Vérifie si la teneur impacte la cinétique. Une corrélation positive peut indiquer de l\'or libre associé aux zones riches.' },
  { xKey: 'bwi',           yKey: 'pyrite',        label: 'BWi → Pyrite',            color: '#38bdf8', interpretation: 'Dans certains gisements, la teneur en pyrite corrèle avec la dureté. Utile pour la modélisation géométallurgique.' },
  { xKey: 's_sulfide',     yKey: 'flot_s_rec',    label: 'S sulf. → Récup. S flot.', color: '#f88a44', interpretation: 'Validation de l\'efficacité de la flottation. Une corrélation positive forte (r > 0.7) confirme que le circuit sépare bien les sulfures.' },
  { xKey: 'nacn_cons',     yKey: 'leach_rec_24h', label: 'NaCN → Récup. 24h',       color: '#10b981', interpretation: 'Une corrélation négative révèle que la consommation élevée de NaCN est liée aux minéraux consommateurs et nuit à la récupération.' },
  { xKey: 'c_organic',     yKey: 'leach_rec_24h', label: 'Corg → Récup. 24h',       color: '#ef4444', interpretation: 'Le carbone organique (prég-robbing) absorbe l\'or dissous et réduit la récupération. Corrélation négative typique.' },
  { xKey: 'grg',           yKey: 'au_free',       label: 'GRG → Au libre',          color: '#2ecc8a', interpretation: 'L\'or récupérable par gravimétrie corrèle avec l\'Au libre. Valide la représentativité des tests Knelson.' },
];

function pearsonStats(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { r: 0, r2: 0, slope: 0, intercept: 0, pValue: null };
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const denX = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const denY = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const slope = denX !== 0 ? num / denX : 0;
  const intercept = yMean - slope * xMean;
  const r = denX !== 0 && denY !== 0 ? num / Math.sqrt(denX * denY) : 0;
  const r2 = r * r;
  // t-statistic and approximate p-value (two-tailed)
  let pValue: number | null = null;
  if (n > 2 && Math.abs(r) < 1) {
    const t = r * Math.sqrt((n - 2) / (1 - r2));
    const df = n - 2;
    // Approximation: p-value via Student t distribution (simplified)
    const x = df / (df + t * t);
    // Regularized incomplete beta approximation
    const p = x < 1 ? Math.min(1, 2 * betaInc(df / 2, 0.5, x)) : 1;
    pValue = Math.round(p * 10000) / 10000;
  }
  return { r, r2, slope, intercept, pValue };
}

function betaInc(a: number, b: number, x: number): number {
  // Simple continued fraction approximation for regularized incomplete beta
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  // Lentz's continued fraction
  let f = 1, c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; f = d;
  for (let m = 1; m <= 100; m++) {
    const m2 = 2 * m;
    let delta = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + delta * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + delta / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; f *= d * c;
    delta = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + delta * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + delta / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; const delta2 = d * c; f *= delta2;
    if (Math.abs(delta2 - 1) < 1e-10) break;
  }
  return front * f;
}

function logGamma(x: number): number {
  // Lanczos approximation coefficients (g=7). Canonical scientific constants;
  // trailing digits exceed f64 precision by design and round to the nearest double.
  // eslint-disable-next-line no-loss-of-precision
  const p = [0.99999999999999709182, 57.156235665862923517, -59.597960355475491248, 14.136097974741747174, -0.49191381609762019978, 3.3994649984811888699e-5, 4.6523628927048575665e-8, -9.8374475304879564677e-8, 1.5808870322491248884e-7];
  let r = p[0]; for (let i = 1; i < p.length; i++) r += p[i] / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(r) - Math.log(x);
}

export function CorrelationsTab({ data }: { data: LimsData }) {
  const [xKey, setXKey] = useState('au_free');
  const [yKey, setYKey] = useState('leach_rec_24h');
  const [computed, setComputed] = useState(false);
  const [activePair, setActivePair] = useState<string | null>('au_free|leach_rec_24h');

  const maps: DataMaps = {
    chem:  new Map(data.chem.map(r => [r.sample_id, r])),
    min:   new Map(data.mineralogy.map(r => [r.sample_id, r])),
    leach: new Map(data.leaching.map(r => [r.sample_id, r])),
    comm:  new Map(data.comminution.map(r => [r.sample_id, r])),
    flot:  new Map(data.flotation.map(r => [r.sample_id, r])),
    knel:  new Map(data.knelson.map(r => [r.sample_id, r])),
  };

  const allIds = [...new Set([
    ...data.chem.map(r => r.sample_id),
    ...data.mineralogy.map(r => r.sample_id),
    ...data.leaching.map(r => r.sample_id),
    ...data.comminution.map(r => r.sample_id),
    ...data.flotation.map(r => r.sample_id),
    ...data.knelson.map(r => r.sample_id),
  ])];

  const xDef = PARAM_DEFS.find(p => p.key === xKey)!;
  const yDef = PARAM_DEFS.find(p => p.key === yKey)!;

  const { xs, ys } = (() => {
    const xs: number[] = [], ys: number[] = [];
    for (const id of allIds) {
      const x = xDef.fn(id, maps), y = yDef.fn(id, maps);
      if (x != null && y != null && !isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
        xs.push(x); ys.push(y);
      }
    }
    return { xs, ys };
  })();

  const stats = pearsonStats(xs, ys);

  const activeSuggested = SUGGESTED_PAIRS.find(p => p.xKey === xKey && p.yKey === yKey);
  const activeColor = activeSuggested?.color ?? '#f59e0b';

  function selectPair(s: SuggestedPair) {
    setXKey(s.xKey); setYKey(s.yKey);
    setActivePair(`${s.xKey}|${s.yKey}`);
    setComputed(true);
  }

  function handleCalculer() {
    setComputed(true);
    setActivePair(`${xKey}|${yKey}`);
  }

  const rAbs = Math.abs(stats.r);
  const intensity = rAbs >= 0.7 ? 'Forte' : rAbs >= 0.4 ? 'Modérée' : 'Faible';
  const intensityColor = rAbs >= 0.7 ? '#10b981' : rAbs >= 0.4 ? '#f59e0b' : '#6b7280';
  const rColor = stats.r >= 0.4 ? '#10b981' : stats.r <= -0.4 ? '#ef4444' : '#f59e0b';

  // gradient bar fill position (r from -1 to +1, fill to mark)
  const rBarPct = ((stats.r + 1) / 2) * 100;

  // Groups for select options
  const groups = [...new Set(PARAM_DEFS.map(p => p.group))];

  const interpretation = activeSuggested?.interpretation ?? (
    computed
      ? rAbs >= 0.7
        ? `Corrélation ${stats.r > 0 ? 'positive' : 'négative'} forte entre ${xDef.label} et ${yDef.label}. Cette relation est statistiquement significative et doit être intégrée à la modélisation géométallurgique.`
        : rAbs >= 0.4
          ? `Corrélation ${stats.r > 0 ? 'positive' : 'négative'} modérée. La relation existe mais d'autres facteurs influencent également ${yDef.label}. Compléter avec d'autres variables.`
          : `Corrélation faible entre ${xDef.label} et ${yDef.label}. Ces deux variables n'ont pas de relation linéaire directe dans cet ensemble de données.`
      : 'Sélectionnez des paramètres et cliquez Calculer pour générer l\'interprétation.'
  );


  return (
    <div className="space-y-4">
      {/* Suggested pairs chips */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4 mb-3">Paires suggérées</div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PAIRS.map(s => {
            const isActive = activePair === `${s.xKey}|${s.yKey}`;
            return (
              <button key={`${s.xKey}|${s.yKey}`} onClick={() => selectPair(s)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200 ${isActive ? 'text-white border-transparent' : 'text-mf-txt3 border-mf-border bg-mf-hover hover:border-mf-txt4 hover:text-mf-txt'}`}
                style={isActive ? { backgroundColor: s.color, borderColor: s.color } : {}}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selectors row */}
      <div className="flex items-end gap-3">
        {/* X */}
        <div className="flex-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-mf-txt4 mb-1.5">Paramètre X (abscisse)</label>
          <select value={xKey} onChange={e => { setXKey(e.target.value); setActivePair(null); setComputed(false); }}
            className="w-full bg-mf-card border border-mf-border rounded-lg px-3 py-2 text-xs text-mf-txt focus:outline-none focus:border-amber-500/50">
            {groups.map(g => (
              <optgroup key={g} label={`── ${g}`}>
                {PARAM_DEFS.filter(p => p.group === g).map(p => (
                  <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {/* Y */}
        <div className="flex-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-mf-txt4 mb-1.5">Paramètre Y (ordonnée)</label>
          <select value={yKey} onChange={e => { setYKey(e.target.value); setActivePair(null); setComputed(false); }}
            className="w-full bg-mf-card border border-mf-border rounded-lg px-3 py-2 text-xs text-mf-txt focus:outline-none focus:border-amber-500/50">
            {groups.map(g => (
              <optgroup key={g} label={`── ${g}`}>
                {PARAM_DEFS.filter(p => p.group === g).map(p => (
                  <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button onClick={handleCalculer}
          className="px-5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors">
          Calculer
        </button>
      </div>

      {/* Main panel */}
      {!computed ? (
        <div className="rounded-xl border border-dashed border-mf-border bg-mf-card p-10 flex flex-col items-center gap-3 text-center">
          <GitBranch size={28} className="text-mf-txt4" />
          <p className="text-sm text-mf-txt">Sélectionnez une paire de paramètres</p>
          <p className="text-xs text-mf-txt4 max-w-sm">Choisissez X et Y dans les listes ou cliquez sur une paire suggérée, puis appuyez sur <strong className="text-mf-txt">Calculer</strong>.</p>
        </div>
      ) : xs.length < 2 ? (
        <div className="rounded-xl border border-mf-border bg-mf-card p-8 flex flex-col items-center gap-3 text-center">
          <Info size={24} className="text-mf-txt4" />
          <p className="text-sm text-mf-txt">Données insuffisantes</p>
          <p className="text-xs text-mf-txt4">Aucune paire complète trouvée pour <strong>{xDef.label}</strong> ↔ <strong>{yDef.label}</strong>. Importez des données dans le module LIMS.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_280px] gap-4">
          {/* Scatter plot */}
          <div className="rounded-xl border border-mf-border bg-mf-card p-5">
            <div className="text-xs font-semibold text-mf-txt mb-0.5">Nuage de points &amp; régression</div>
            <div className="text-[10px] text-mf-txt4 mb-3">{xDef.label} ({xDef.unit}) vs {yDef.label} ({yDef.unit}) — n={xs.length} paires</div>
            <ScatterChart
              points={xs.map((x, i) => ({ x, y: ys[i] }))}
              xLabel={`${xDef.label} (${xDef.unit})`} yLabel={`${yDef.label} (${yDef.unit})`}
              color={activeColor} height={280}
              xFormat={v => formatDecimalGrouped(v, 2)} yFormat={v => formatDecimalGrouped(v, 2)}
              trend={{ slope: stats.slope, intercept: stats.intercept, color: activeColor }}
            />
          </div>

          {/* Stats panel */}
          <div className="rounded-xl border border-mf-border bg-mf-card p-4 flex flex-col gap-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4">Statistiques</div>

            {/* Pearson r */}
            <div>
              <div className="text-[10px] text-mf-txt4 mb-1">Coefficient de Pearson r</div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-3xl font-mono font-bold" style={{ color: rColor }}>{formatDecimalGrouped(stats.r, 3)}</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                  style={{ color: intensityColor, borderColor: `${intensityColor}40`, backgroundColor: `${intensityColor}15` }}>
                  {intensity}
                </span>
              </div>
              {/* Gradient bar */}
              <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'linear-gradient(to right, #ef4444, #6b7280, #10b981)' }}>
                <div className="absolute top-0 w-2 h-2.5 rounded-sm bg-white shadow" style={{ left: `calc(${rBarPct}% - 4px)` }} />
              </div>
              <div className="flex justify-between text-[9px] text-mf-txt4 mt-1">
                <span>−1</span><span>0</span><span>+1</span>
              </div>
            </div>

            {/* Stats grid */}
            <div className="space-y-2.5">
              {[
                { label: 'R²', val: formatDecimalGrouped(stats.r2, 4), note: `${formatDecimalGrouped((stats.r2 * 100), 1)}% variance expliquée` },
                { label: 'n paires', val: xs.length.toString(), note: '' },
                { label: 'p-value', val: stats.pValue != null ? (stats.pValue < 0.0001 ? '< 0.0001' : formatDecimalGrouped(stats.pValue, 4)) : 'N/A', note: stats.pValue != null ? (stats.pValue < 0.05 ? 'Significatif (α=0.05)' : 'Non significatif') : '' },
                { label: 'Équation', val: `y = ${formatDecimalGrouped(stats.slope, 3)}x ${stats.intercept >= 0 ? '+' : '−'} ${formatDecimalGrouped(Math.abs(stats.intercept), 3)}`, note: '' },
              ].map(s => (
                <div key={s.label} className="rounded-lg bg-mf-hover/40 border border-mf-border/50 px-3 py-2">
                  <div className="text-[9px] text-mf-txt4 uppercase tracking-wider">{s.label}</div>
                  <div className="text-xs font-mono font-semibold text-mf-txt mt-0.5">{s.val}</div>
                  {s.note && <div className="text-[9px] text-mf-txt4 mt-0.5">{s.note}</div>}
                </div>
              ))}
            </div>

            {/* Interpretation */}
            <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 p-3 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-blue-400 mb-1.5">Interprétation métallurgique</div>
              <p className="text-[10px] text-mf-txt3 leading-relaxed">{interpretation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
