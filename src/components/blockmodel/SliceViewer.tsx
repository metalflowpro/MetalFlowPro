import { useMemo, useState } from 'react';
import { Box, Layers, Grid3x3 } from 'lucide-react';
import { sliceIndices, buildSlice, gradeColor, type SliceAxis, type SliceInputBlock } from '../../lib/blockmodel/slice';
import { formatDecimalGrouped } from '../../lib/format/number';

/**
 * Visualiseur de coupes du modèle de blocs — « 3D légère » (iso/coupes).
 *
 * Rend une coupe 2D interactive du modèle : vue en plan (banc) ou coupe
 * verticale E-O / N-S, colorée par teneur, avec un curseur pour parcourir les
 * coupes et un survol détaillant chaque cellule. Toute la logique de découpe
 * vit dans `lib/blockmodel/slice` (pure, testée) ; ce composant ne fait que
 * disposer et colorer la grille.
 */

interface Props {
  blocks: SliceInputBlock[];
}

const AXES: { id: SliceAxis; label: string; icon: React.ReactNode }[] = [
  { id: 'z', label: 'Plan (banc)',   icon: <Layers size={11} /> },
  { id: 'x', label: 'Section E-O',   icon: <Grid3x3 size={11} /> },
  { id: 'y', label: 'Section N-S',   icon: <Grid3x3 size={11} /> },
];

export function SliceViewer({ blocks }: Props) {
  const [axis, setAxis] = useState<SliceAxis>('z');
  const [pos, setPos] = useState(0); // position dans la liste d'indices
  const [hover, setHover] = useState<{ u: number; v: number } | null>(null);

  const indices = useMemo(() => sliceIndices(blocks, axis), [blocks, axis]);
  const idx = indices[Math.min(pos, indices.length - 1)] ?? 0;
  const slice = useMemo(() => buildSlice(blocks, axis, idx), [blocks, axis, idx]);

  // Échelle de teneur commune (percentile 95 pour ne pas écraser par les outliers).
  const gradeMax = useMemo(() => {
    const gs = blocks.map(b => b.au_g_t).filter(g => Number.isFinite(g)).sort((a, b) => a - b);
    if (gs.length === 0) return 1;
    return gs[Math.floor(gs.length * 0.95)] || gs[gs.length - 1] || 1;
  }, [blocks]);

  if (blocks.length === 0) {
    return <div className="text-center mf-txt3 py-10 text-sm">Importez des blocs pour afficher les coupes.</div>;
  }

  const W = 640, H = 380, PAD = 34;
  const uSpan = slice ? slice.uMax - slice.uMin + 1 : 1;
  const vSpan = slice ? slice.vMax - slice.vMin + 1 : 1;
  const cell = slice ? Math.max(2, Math.min((W - 2 * PAD) / uSpan, (H - 2 * PAD) / vSpan)) : 10;
  const gridW = cell * uSpan, gridH = cell * vSpan;
  const offX = (W - gridW) / 2;
  const offY = (H - gridH) / 2;

  const hoveredCell = slice && hover ? slice.cells.find(c => c.u === hover.u && c.v === hover.v) : null;

  // Which way is "up"? Derive it from the real coordinate (élévation / Nord),
  // not the grid index: a model whose k increases downward would otherwise be
  // drawn upside-down under an "Élévation ↑" label. `vAscends` is true when the
  // coordinate grows with the index (largest index = top); false flips it.
  const vAscends = (() => {
    if (!slice || slice.cells.length < 2) return true;
    const lo = slice.cells.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = slice.cells.reduce((a, b) => (b.v > a.v ? b : a));
    return hi.vCoord >= lo.vCoord;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Box size={13} className="text-sky-400" />
          <span className="text-xs font-semibold mf-txt">Visualiseur de coupes</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 font-semibold">3D légère</span>
        </div>
        <div className="flex gap-1">
          {AXES.map(a => (
            <button key={a.id} onClick={() => { setAxis(a.id); setPos(0); setHover(null); }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                axis === a.id ? 'bg-sky-500/20 text-sky-300' : 'bg-white/[0.04] mf-txt3 hover:mf-txt'}`}>
              {a.icon}{a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Slice slider */}
      <div className="flex items-center gap-3">
        <span className="text-[10px] mf-txt4 w-24 shrink-0">
          {axis === 'z' ? 'Banc k' : axis === 'x' ? 'Colonne i' : 'Rangée j'} = {idx}
        </span>
        <input type="range" min={0} max={Math.max(0, indices.length - 1)} value={Math.min(pos, indices.length - 1)}
          onChange={e => { setPos(parseInt(e.target.value)); setHover(null); }}
          className="flex-1 accent-sky-400" />
        <span className="text-[10px] mf-txt4 w-20 text-right">{indices.length} coupes</span>
      </div>

      <div className="relative rounded-lg border border-mf-border bg-[#070A12] p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Coupe ${axis} à l'indice ${idx}`}>
          {slice?.cells.map((c, ci) => {
            const x = offX + (c.u - slice.uMin) * cell;
            // Position par l'index, orienté vers le haut selon la coordonnée réelle
            // (Nord / élévation) — voir `vAscends`.
            const y = offY + (vAscends ? slice.vMax - c.v : c.v - slice.vMin) * cell;
            const active = hover?.u === c.u && hover?.v === c.v;
            return (
              <rect key={ci} x={x} y={y} width={cell + 0.5} height={cell + 0.5}
                fill={gradeColor(c.grade, 0, gradeMax)}
                stroke={active ? '#E2E8F0' : 'none'} strokeWidth={active ? 1.5 : 0}
                onMouseEnter={() => setHover({ u: c.u, v: c.v })}
                onMouseLeave={() => setHover(null)} />
            );
          })}
          {/* axis labels */}
          {slice && (
            <>
              <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#56657A">{slice.uLabel} →</text>
              <text x={12} y={H / 2} textAnchor="middle" fontSize={10} fill="#56657A" transform={`rotate(-90 12 ${H / 2})`}>{slice.vLabel} →</text>
            </>
          )}
        </svg>

        {/* tooltip */}
        {hoveredCell && (
          <div className="absolute top-2 right-2 rounded-lg bg-mf-panel/95 border border-mf-border px-2.5 py-1.5 text-[10px] shadow-card pointer-events-none space-y-0.5">
            <div className="font-mono text-mf-txt2">E {formatDecimalGrouped(hoveredCell.uCoord, 0)} · N/Z {formatDecimalGrouped(hoveredCell.vCoord, 0)}</div>
            <div className="flex items-center gap-1.5"><span className="mf-txt3">Teneur</span><span className="ml-auto font-mono text-amber-300">{formatDecimalGrouped(hoveredCell.grade, 2)} g/t</span></div>
            <div className="flex items-center gap-1.5"><span className="mf-txt3">Tonnage</span><span className="ml-auto font-mono text-mf-txt">{formatDecimalGrouped(hoveredCell.tonnes, 0)} t</span></div>
            {hoveredCell.rock && <div className="flex items-center gap-1.5"><span className="mf-txt3">Roche</span><span className="ml-auto font-mono text-sky-300">{hoveredCell.rock}</span></div>}
          </div>
        )}
      </div>

      {/* grade legend */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] mf-txt4">0</span>
        <div className="flex-1 h-2.5 rounded-sm overflow-hidden flex">
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} className="flex-1 h-full" style={{ background: gradeColor((i / 39) * gradeMax, 0, gradeMax) }} />
          ))}
        </div>
        <span className="text-[10px] mf-txt4">{formatDecimalGrouped(gradeMax, 1)} g/t (P95)</span>
      </div>
    </div>
  );
}
