import { useRef } from 'react';
import { AREA_TYPE_COLORS, AREA_DEFAULT_COLOR, heatColor } from '../../lib/plantopt/config';
import { findBuffer } from '../../lib/plantopt/modelOps';
import type { PlantModel, SimResult } from '../../lib/plantopt/types';

/** Valeur centrale d'une loi de capacité (mode/mean/value/max), pour l'étiquette. */
function centralValue(params: Record<string, number | number[]>): number {
  const v = params.mode ?? params.mean ?? params.value ?? params.max ?? 0;
  return typeof v === 'number' ? v : 0;
}

const VB_W = 1200;
const VB_H = 560;
const BOX_W = 140;
const BOX_H = 62;

interface Props {
  model: PlantModel;
  result: SimResult | null;
  selectedId: string | null;
  connectMode: boolean;
  connectSource: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (sourceId: string, targetId: string) => void;
}

/**
 * Éditeur de flowsheet (PFD) : aires positionnables au glisser-déposer, flux
 * fléchés avec rendement massique et tampons, coloration par probabilité de
 * goulot après un run. Mode connexion : cliquer l'aire source puis la cible.
 */
export function FlowsheetCanvas({ model, result, selectedId, connectMode, connectSource, onSelect, onMove, onConnect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  /** Convertit des coordonnées écran en coordonnées viewBox. */
  function toSvg(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * VB_W,
      y: ((clientY - rect.top) / rect.height) * VB_H,
    };
  }

  const posOf = (id: string) => {
    const a = model.areas.find(x => x.id === id);
    return { x: a?.x ?? 60, y: a?.y ?? 120 };
  };

  function onPointerDownArea(e: React.PointerEvent, id: string) {
    if (connectMode) return;
    e.stopPropagation();
    const { x, y } = toSvg(e.clientX, e.clientY);
    const p = posOf(id);
    drag.current = { id, dx: x - p.x, dy: y - p.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const { x, y } = toSvg(e.clientX, e.clientY);
    const nx = Math.max(6, Math.min(VB_W - BOX_W - 6, x - d.dx));
    const ny = Math.max(6, Math.min(VB_H - BOX_H - 6, y - d.dy));
    d.moved = true;
    onMove(d.id, nx, ny);
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    svgRef.current?.releasePointerCapture(e.pointerId);
    if (d && !d.moved) onSelect(d.id);
    drag.current = null;
  }

  function onClickArea(id: string) {
    if (connectMode) {
      if (connectSource && connectSource !== id) onConnect(connectSource, id);
      else onSelect(id); // premier clic = source (géré par le parent via onSelect en mode connexion)
    }
  }

  const hasResult = result !== null;

  return (
    <div className="overflow-x-auto rounded-lg border border-mf-border bg-mf-panel/40">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full"
        style={{ minWidth: 700, height: 460, cursor: connectMode ? 'crosshair' : 'default' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          <marker id="po-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
          </marker>
        </defs>

        {/* Flux */}
        {model.streams.map(s => {
          const src = model.areas.find(a => a.id === s.sourceAreaId);
          const tgt = model.areas.find(a => a.id === s.targetAreaId);
          if (!src || !tgt) return null;
          const x1 = (src.x ?? 60) + BOX_W / 2;
          const y1 = (src.y ?? 120) + BOX_H / 2;
          const x2 = (tgt.x ?? 60) + BOX_W / 2;
          const y2 = (tgt.y ?? 120) + BOX_H / 2;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const buffer = findBuffer(model, s.sourceAreaId, s.targetAreaId);
          const yieldPct = Math.round((s.massYield ?? 1) * 100);
          return (
            <g key={s.id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#64748b" strokeWidth={2} markerEnd="url(#po-arrow)" />
              <g>
                <rect x={mx - 18} y={my - 9} width={36} height={16} rx={3}
                  fill="#0f172a" stroke={buffer ? '#f59e0b' : '#334155'} strokeWidth={buffer ? 1.3 : 1} />
                <text x={mx} y={my + 3} textAnchor="middle" fontSize={9} fill={buffer ? '#f59e0b' : '#94a3b8'}>
                  {buffer ? `${Math.round(buffer.capacityTonnes / 1000)}k` : `${yieldPct}%`}
                </text>
              </g>
            </g>
          );
        })}

        {/* Aires */}
        {model.areas.map(a => {
          const prob = hasResult ? (result!.bottleneckProbability[a.id] ?? 0) : 0;
          const typeColor = (a.type && AREA_TYPE_COLORS[a.type]) || AREA_DEFAULT_COLOR;
          const fill = hasResult ? heatColor(prob) : typeColor;
          const selected = a.id === selectedId;
          const isSource = a.id === connectSource;
          const cap = centralValue(a.capacityDist.params);
          const x = a.x ?? 60;
          const y = a.y ?? 120;
          return (
            <g key={a.id}
              onPointerDown={e => onPointerDownArea(e, a.id)}
              onClick={() => onClickArea(a.id)}
              style={{ cursor: connectMode ? 'crosshair' : 'grab' }}>
              <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={8}
                fill={fill} fillOpacity={hasResult ? 0.25 + 0.6 * prob : 1}
                stroke={isSource ? '#38bdf8' : selected ? '#34d399' : '#475569'} strokeWidth={isSource || selected ? 2.5 : 1} />
              <text x={x + BOX_W / 2} y={y + 24} textAnchor="middle" fontSize={12} fontWeight={600} fill="#e2e8f0">
                {a.name.length > 17 ? a.name.slice(0, 16) + '…' : a.name}
              </text>
              <text x={x + BOX_W / 2} y={y + 42} textAnchor="middle" fontSize={9} fill="#cbd5e1">
                {Math.round(cap).toLocaleString('fr-FR')} t/h{hasResult ? ` · goulot ${(100 * prob).toFixed(0)}%` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
