import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Box, Crosshair, Layers3, Pause, Play, RotateCcw, Scan, SlidersHorizontal } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';

export interface BlockModelViewerBlock {
  id?: string;
  i: number; j: number; k: number;
  cx: number; cy: number; cz: number;
  au_g_t: number; density: number; volume_m3: number;
  rock_type: string | null; resource_category: string | null;
}

interface Props { blocks: BlockModelViewerBlock[] }
type ColorMode = 'grade' | 'category';
type CameraPreset = 'isometric' | 'top' | 'north';

const CATEGORY_COLORS: Record<string, string> = { Mesuré: '#34D399', Indiqué: '#60A5FA', Inféré: '#A78BFA', Unknown: '#64748B' };

function gradeColor(grade: number, max: number) {
  const t = Math.max(0, Math.min(1, grade / Math.max(max, 0.001)));
  return `rgb(${Math.round(35 + 220 * t)},${Math.round(105 + 90 * (1 - t))},${Math.round(210 - 180 * t)})`;
}

function cameraAngles(preset: CameraPreset): { yaw: number; pitch: number } {
  if (preset === 'top') return { yaw: 0, pitch: 1.48 };
  if (preset === 'north') return { yaw: 0, pitch: 0.08 };
  return { yaw: -0.65, pitch: 0.55 };
}

export function BlockModel3DViewer({ blocks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectedRef = useRef<Array<{ block: BlockModelViewerBlock; x: number; y: number }>>([]);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const [camera, setCamera] = useState(cameraAngles('isometric'));
  const [zoom, setZoom] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>('grade');
  const [minGrade, setMinGrade] = useState(0);
  const [category, setCategory] = useState('all');
  const [autoRotate, setAutoRotate] = useState(false);
  const [selected, setSelected] = useState<BlockModelViewerBlock | null>(null);

  const maxGrade = useMemo(() => Math.max(...blocks.map(block => block.au_g_t), 1), [blocks]);
  const categories = useMemo(() => [...new Set(blocks.map(block => block.resource_category ?? 'Unknown'))].sort(), [blocks]);
  const visibleBlocks = useMemo(() => blocks.filter(block => block.au_g_t >= minGrade && (category === 'all' || (block.resource_category ?? 'Unknown') === category)), [blocks, minGrade, category]);
  const sample = useMemo(() => {
    if (visibleBlocks.length <= 8000) return visibleBlocks;
    const stride = Math.ceil(visibleBlocks.length / 8000);
    return visibleBlocks.filter((_, index) => index % stride === 0);
  }, [visibleBlocks]);
  const summary = useMemo(() => {
    const tonnes = visibleBlocks.reduce((sum, block) => sum + block.density * block.volume_m3, 0);
    const grade = tonnes > 0 ? visibleBlocks.reduce((sum, block) => sum + block.au_g_t * block.density * block.volume_m3, 0) / tonnes : 0;
    return { tonnes, grade, ounces: tonnes * grade / 31.1034768 };
  }, [visibleBlocks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sample.length === 0) return;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#070A12';
      context.fillRect(0, 0, rect.width, rect.height);
      const xs = sample.map(block => block.cx), ys = sample.map(block => block.cy), zs = sample.map(block => block.cz);
      const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs), 1);
      const scale = Math.min(rect.width, rect.height) * 0.78 * zoom / span;
      const cosYaw = Math.cos(camera.yaw), sinYaw = Math.sin(camera.yaw), cosPitch = Math.cos(camera.pitch), sinPitch = Math.sin(camera.pitch);
      const projected = sample.map(block => {
        const x = block.cx - center.x, y = block.cy - center.y, z = block.cz - center.z;
        const rotatedX = x * cosYaw - y * sinYaw;
        const depth = x * sinYaw + y * cosYaw;
        const rotatedY = z * cosPitch - depth * sinPitch;
        const rotatedDepth = z * sinPitch + depth * cosPitch;
        return { block, x: rect.width / 2 + rotatedX * scale, y: rect.height / 2 - rotatedY * scale, depth: rotatedDepth };
      }).sort((a, b) => a.depth - b.depth);
      projectedRef.current = projected;
      const cell = Math.max(2.5, Math.min(15, scale * 0.65));
      for (const point of projected) {
        context.globalAlpha = Math.max(0.35, Math.min(1, 0.7 + point.depth / span * 0.25));
        context.fillStyle = colorMode === 'grade' ? gradeColor(point.block.au_g_t, maxGrade) : (CATEGORY_COLORS[point.block.resource_category ?? 'Unknown'] ?? CATEGORY_COLORS.Unknown);
        context.fillRect(point.x - cell / 2, point.y - cell / 2, cell, cell);
        context.strokeStyle = 'rgba(255,255,255,0.08)';
        context.strokeRect(point.x - cell / 2, point.y - cell / 2, cell, cell);
      }
      context.globalAlpha = 1;
      context.fillStyle = '#64748B';
      context.font = '11px ui-monospace, monospace';
      context.fillText(`${sample.length.toLocaleString()} affichés · ${visibleBlocks.length.toLocaleString()} filtrés`, 14, rect.height - 14);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, colorMode, maxGrade, sample, visibleBlocks.length, zoom]);

  useEffect(() => {
    if (!autoRotate) return;
    const timer = window.setInterval(() => setCamera(current => ({ ...current, yaw: current.yaw + 0.025 })), 40);
    return () => window.clearInterval(timer);
  }, [autoRotate]);

  function reset() { setCamera(cameraAngles('isometric')); setZoom(1); setSelected(null); }
  function pick(event: MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || projectedRef.current.length === 0) return;
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const nearest = projectedRef.current.reduce((best, point) => {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      return !best || distance < best.distance ? { block: point.block, distance } : best;
    }, null as { block: BlockModelViewerBlock; distance: number } | null);
    if (nearest && nearest.distance < 400) setSelected(nearest.block);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {[['Blocs visibles', visibleBlocks.length.toLocaleString(), 'text-sky-300'], ['Tonnage', `${formatDecimalGrouped(summary.tonnes / 1e6, 2)} Mt`, 'text-teal-300'], ['Teneur moyenne', `${formatDecimalGrouped(summary.grade, 2)} g/t`, 'text-amber-300'], ['Or contenu', `${formatDecimalGrouped(summary.ounces / 1000, 1)} koz`, 'text-violet-300']].map(([label, value, tone]) => <div key={label} className="card-sm"><div className="text-[10px] uppercase tracking-wider mf-txt4">{label}</div><div className={`text-lg font-mono font-bold ${tone}`}>{value}</div></div>)}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-mf-border bg-mf-panel/60 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-mf-txt mr-2"><SlidersHorizontal size={13} className="text-sky-400" /> Filtres d’analyse</div>
        <select className="input-field text-xs py-1.5 w-32" value={colorMode} onChange={event => setColorMode(event.target.value as ColorMode)}><option value="grade">Couleur : teneur</option><option value="category">Couleur : classe</option></select>
        <select className="input-field text-xs py-1.5 w-32" value={category} onChange={event => setCategory(event.target.value)}><option value="all">Toutes classes</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select>
        <label className="flex items-center gap-2 text-[11px] mf-txt3">Cut-off <input type="range" min="0" max={Math.ceil(maxGrade * 10) / 10} step="0.1" value={minGrade} onChange={event => setMinGrade(Number(event.target.value))} className="w-28 accent-amber-400" /> <span className="font-mono text-amber-300 w-14">{minGrade.toFixed(1)} g/t</span></label>
        <div className="ml-auto flex gap-1"><button className="btn btn-secondary btn-sm" onClick={() => setCamera(cameraAngles('top'))}><Scan size={12} /> Plan</button><button className="btn btn-secondary btn-sm" onClick={() => setCamera(cameraAngles('north'))}><Layers3 size={12} /> Nord</button><button className="btn btn-secondary btn-sm" onClick={() => setCamera(cameraAngles('isometric'))}><Box size={12} /> Iso</button></div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-mf-border bg-[#070A12] shadow-card">
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-white/10 bg-mf-panel/85 px-2.5 py-1.5 backdrop-blur"><Crosshair size={13} className="text-emerald-400" /><span className="text-[10px] font-semibold text-mf-txt">ORBITAL VIEW</span><span className="text-[10px] mf-txt4">{camera.yaw.toFixed(2)}°</span></div>
        <canvas ref={canvasRef} className="h-[500px] w-full cursor-grab active:cursor-grabbing" onMouseDown={event => { drag.current = { x: event.clientX, y: event.clientY, yaw: camera.yaw, pitch: camera.pitch }; }} onMouseMove={event => { if (!drag.current) return; setCamera({ yaw: drag.current.yaw + (event.clientX - drag.current.x) * 0.008, pitch: Math.max(-1.35, Math.min(1.35, drag.current.pitch + (event.clientY - drag.current.y) * 0.008)) }); }} onMouseUp={() => { drag.current = null; }} onMouseLeave={() => { drag.current = null; }} onWheel={event => { event.preventDefault(); setZoom(current => Math.max(0.35, Math.min(4, current * (event.deltaY > 0 ? 0.9 : 1.1)))); }} onClick={pick} aria-label="Visualisation 3D interactive du modèle de blocs" />
        <div className="absolute bottom-3 right-3 flex gap-1.5"><button className="btn btn-secondary btn-sm bg-mf-panel/90" onClick={() => setAutoRotate(current => !current)}>{autoRotate ? <Pause size={12} /> : <Play size={12} />}{autoRotate ? 'Pause' : 'Auto-rotation'}</button><button className="btn btn-secondary btn-sm bg-mf-panel/90" onClick={reset}><RotateCcw size={12} /> Reset</button></div>
        {selected && <div className="absolute right-3 top-3 w-52 card-sm border-sky-400/30 bg-mf-panel/95 text-xs space-y-1.5"><div className="flex items-center justify-between"><span className="font-semibold text-mf-txt">Bloc sélectionné</span><button onClick={() => setSelected(null)} className="mf-txt4 hover:text-mf-txt">×</button></div><div className="font-mono text-sky-300">{selected.i} / {selected.j} / {selected.k}</div><div className="mf-txt3">Au <span className="float-right text-amber-300">{formatDecimalGrouped(selected.au_g_t, 2)} g/t</span></div><div className="mf-txt3">Centre <span className="float-right text-mf-txt2">{formatDecimalGrouped(selected.cx, 0)} · {formatDecimalGrouped(selected.cy, 0)}</span></div><div className="mf-txt3">Classe <span className="float-right text-teal-300">{selected.resource_category ?? 'Inconnue'}</span></div></div>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[10px] mf-txt4"><span className="font-semibold text-mf-txt3">LÉGENDE</span>{colorMode === 'grade' ? <><span>0</span><div className="h-2 min-w-40 flex-1 rounded-full bg-gradient-to-r from-blue-600 via-emerald-400 to-red-500" /><span>{formatDecimalGrouped(maxGrade, 1)} g/t</span></> : Object.entries(CATEGORY_COLORS).map(([label, color]) => <span key={label} className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>)}<span className="ml-auto">Glisser : orbite · molette : zoom · clic : inspection</span></div>
    </div>
  );
}
