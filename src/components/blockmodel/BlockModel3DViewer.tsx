import { useEffect, useRef, useState } from 'react';
import { Box, RotateCcw } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';

export interface BlockModelViewerBlock {
  i: number; j: number; k: number;
  cx: number; cy: number; cz: number;
  au_g_t: number; density: number; volume_m3: number;
  rock_type: string | null; resource_category: string | null;
}

interface Props { blocks: BlockModelViewerBlock[] }

const CATEGORY_COLORS: Record<string, string> = { Mesuré: '#34D399', Indiqué: '#60A5FA', Inféré: '#A78BFA', Unknown: '#64748B' };

function gradeColor(grade: number, max: number) {
  const t = Math.max(0, Math.min(1, grade / Math.max(max, 0.001)));
  const r = Math.round(35 + 220 * t);
  const g = Math.round(105 + 90 * (1 - t));
  const b = Math.round(210 - 180 * t);
  return `rgb(${r},${g},${b})`;
}

/** Lightweight WebGL-free orbital 3D renderer for large block models. */
export function BlockModel3DViewer({ blocks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [yaw, setYaw] = useState(-0.65);
  const [pitch, setPitch] = useState(0.55);
  const [zoom, setZoom] = useState(1);
  const [colorBy, setColorBy] = useState<'grade' | 'category'>('grade');
  const [selected, setSelected] = useState<BlockModelViewerBlock | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const maxGrade = blocks.reduce((max, b) => Math.max(max, b.au_g_t), 0);
  const sample = blocks.length > 7000
    ? blocks.filter((_, i) => i % Math.ceil(blocks.length / 7000) === 0)
    : blocks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sample.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#070A12';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const xs = sample.map(b => b.cx), ys = sample.map(b => b.cy), zs = sample.map(b => b.cz);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const scale = Math.min(rect.width, rect.height) * 0.78 * zoom / span;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const projected = sample.map(block => {
      const x = block.cx - center.x, y = block.cy - center.y, z = block.cz - center.z;
      const rx = x * cy - y * sy;
      const depth = x * sy + y * cy;
      const ry = z * cp - depth * sp;
      const rz = z * sp + depth * cp;
      return { block, x: rect.width / 2 + rx * scale, y: rect.height / 2 - ry * scale, depth: rz };
    }).sort((a, b) => a.depth - b.depth);

    const cell = Math.max(2, Math.min(16, scale * Math.max(...sample.map(b => Math.min(Math.max(b.volume_m3, 1), 10) ** (1 / 3))) * 0.75));
    for (const p of projected) {
      const fill = colorBy === 'grade' ? gradeColor(p.block.au_g_t, maxGrade) : (CATEGORY_COLORS[p.block.resource_category ?? 'Unknown'] ?? CATEGORY_COLORS.Unknown);
      const shade = Math.max(0.35, Math.min(1, 0.68 + p.depth / span * 0.25));
      ctx.globalAlpha = shade;
      ctx.fillStyle = fill;
      ctx.fillRect(p.x - cell / 2, p.y - cell / 2, cell, cell);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.strokeRect(p.x - cell / 2, p.y - cell / 2, cell, cell);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`${sample.length.toLocaleString()} blocs affichés · rotation par glisser`, 12, rect.height - 12);
  }, [sample, yaw, pitch, zoom, colorBy, maxGrade]);

  function pick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || sample.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const nearest = sample.reduce<{ block: BlockModelViewerBlock; distance: number } | null>((best, block) => {
      const dx = x - rect.width / 2 - (block.cx - (Math.min(...sample.map(b => b.cx)) + Math.max(...sample.map(b => b.cx))) / 2);
      const dy = y - rect.height / 2 + (block.cz - (Math.min(...sample.map(b => b.cz)) + Math.max(...sample.map(b => b.cz))) / 2);
      const distance = dx * dx + dy * dy;
      return !best || distance < best.distance ? { block, distance } : best;
    }, null);
    if (nearest) setSelected(nearest.block);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Box size={14} className="text-sky-400" /><span className="text-xs font-semibold mf-txt">Block Model 3D orbital</span><span className="badge badge-teal">{blocks.length.toLocaleString()} blocs</span></div>
        <div className="flex items-center gap-2">
          <select className="input-field text-xs py-1 w-32" value={colorBy} onChange={e => setColorBy(e.target.value as 'grade' | 'category')}><option value="grade">Couleur teneur</option><option value="category">Catégorie ressource</option></select>
          <button className="btn btn-secondary btn-sm" onClick={() => { setYaw(-0.65); setPitch(0.55); setZoom(1); }}><RotateCcw size={12} /> Réinitialiser</button>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-mf-border bg-[#070A12]">
        <canvas ref={canvasRef} className="w-full h-[480px] cursor-grab active:cursor-grabbing" onMouseDown={e => { drag.current = { x: e.clientX, y: e.clientY, yaw, pitch }; }} onMouseMove={e => { if (!drag.current) return; setYaw(drag.current.yaw + (e.clientX - drag.current.x) * 0.008); setPitch(Math.max(-1.35, Math.min(1.35, drag.current.pitch + (e.clientY - drag.current.y) * 0.008))); }} onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }} onWheel={e => { e.preventDefault(); setZoom(z => Math.max(0.35, Math.min(4, z * (e.deltaY > 0 ? 0.9 : 1.1)))); }} onClick={pick} aria-label="Visualisation 3D du modèle de blocs" />
        {selected && <div className="absolute top-3 right-3 card-sm text-xs space-y-1 pointer-events-none"><div className="font-semibold text-mf-txt">Bloc {selected.i}/{selected.j}/{selected.k}</div><div className="text-mf-txt3">Au <span className="text-amber-300">{formatDecimalGrouped(selected.au_g_t, 2)} g/t</span></div><div className="text-mf-txt3">Centre {formatDecimalGrouped(selected.cx, 0)} · {formatDecimalGrouped(selected.cy, 0)} · {formatDecimalGrouped(selected.cz, 0)}</div><div className="text-mf-txt3">{selected.resource_category ?? 'Catégorie inconnue'}</div></div>}
      </div>
      <div className="flex items-center gap-2 text-[10px] mf-txt4"><span>Faible</span><div className="h-2 flex-1 rounded bg-gradient-to-r from-blue-600 via-emerald-400 to-red-500" /><span>{formatDecimalGrouped(maxGrade, 1)} g/t</span><span className="ml-auto">Molette : zoom · glisser : orbite · clic : bloc</span></div>
    </div>
  );
}

