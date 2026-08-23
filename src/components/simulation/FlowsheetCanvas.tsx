import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { Plus, ZoomIn, ZoomOut, Maximize2, LayoutGrid, X } from 'lucide-react';
import { getAllUnits, getUnit } from '../../lib/simulation/unitRegistry';
import { UnitCategory } from '../../lib/simulation/types';
import { CIRCUIT_TEMPLATES } from '../../lib/simulation/templates';
import { STREAM_LEGEND } from '../../lib/simulation/streamStyle';

const DEFAULT_EDGE_COLOR = '#64748b';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RFNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { label: string; unit_type: string; color?: string };
}

export interface RFEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
  style?: React.CSSProperties;
}

export interface RFConnection {
  source: string | null;
  target: string | null;
}

export interface NodeChange {
  type: 'position' | 'remove' | 'select' | 'dimensions' | string;
  id: string;
  position?: { x: number; y: number };
}

export interface EdgeChange {
  type: 'remove' | 'select' | string;
  id: string;
}

export interface ConnectionInput {
  id?: string;
  source: string | null;
  target: string | null;
  label?: string;
  type?: string;
  style?: React.CSSProperties;
}

export function useNodesState(initial: RFNode[]): [RFNode[], React.Dispatch<React.SetStateAction<RFNode[]>>, (changes: NodeChange[]) => void] {
  const [nodes, setNodes] = useState<RFNode[]>(initial);
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Handle position changes from drag
    if (!Array.isArray(changes)) return;
    setNodes(prev => {
      const next = [...prev];
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const idx = next.findIndex(n => n.id === change.id);
          if (idx >= 0) next[idx] = { ...next[idx], position: change.position };
        }
        if (change.type === 'remove') {
          const idx = next.findIndex(n => n.id === change.id);
          if (idx >= 0) next.splice(idx, 1);
        }
      }
      return next;
    });
  }, []);
  return [nodes, setNodes, onNodesChange];
}

export function useEdgesState(initial: RFEdge[]): [RFEdge[], React.Dispatch<React.SetStateAction<RFEdge[]>>, (changes: EdgeChange[]) => void] {
  const [edges, setEdges] = useState<RFEdge[]>(initial);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!Array.isArray(changes)) return;
    setEdges(prev => {
      const next = [...prev];
      for (const change of changes) {
        if (change.type === 'remove') {
          const idx = next.findIndex(e => e.id === change.id);
          if (idx >= 0) next.splice(idx, 1);
        }
      }
      return next;
    });
  }, []);
  return [edges, setEdges, onEdgesChange];
}

export function addEdge(connection: ConnectionInput, edges: RFEdge[]): RFEdge[] {
  return [...edges, {
    id: connection.id ?? `e-${connection.source}-${connection.target}`,
    source: connection.source ?? '',
    target: connection.target ?? '',
    label: connection.label,
    type: connection.type,
    style: connection.style,
  }];
}

// ─── Category colors ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<UnitCategory, string> = {
  'Comminution': '#f59e0b',
  'Flottation': '#0ea5e9',
  'Lixiviation': '#06b6d4',
  'ADR': '#8b5cf6',
  'Électrométallurgie': '#ef4444',
  'Séparation S/L': '#10b981',
  'Effluents': '#f97316',
  'Utilitaires': '#64748b',
};

// ─── Unit palette ─────────────────────────────────────────────────────────────

function UnitPalette({ onAdd }: { onAdd: (unitType: string) => void }) {
  const allUnits = getAllUnits();
  const categories = Array.from(new Set(allUnits.map(u => u.category))) as UnitCategory[];

  return (
    <div className="w-48 bg-slate-900 border-r border-slate-700 overflow-y-auto flex-shrink-0">
      <div className="p-2 border-b border-slate-700">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Unités disponibles</div>
      </div>
      {categories.map(cat => (
        <div key={cat}>
          <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: CATEGORY_COLORS[cat] }}>
            {cat}
          </div>
          {allUnits.filter(u => u.category === cat).map(unit => (
            <button
              key={unit.unitType}
              onClick={() => onAdd(unit.unitType)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-800 transition-colors group"
            >
              <span style={{ fontSize: 14 }}>{unit.icon}</span>
              <span className="text-xs text-slate-300 group-hover:text-white truncate flex-1">{unit.displayName}</span>
              <Plus size={10} className="text-slate-600 group-hover:text-blue-400 flex-shrink-0" />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

const NODE_W = 130;
const NODE_H = 56;

interface CanvasProps {
  nodes: RFNode[];
  edges: RFEdge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: RFConnection) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onAddNode: (unitType: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onLoadTemplate?: (templateId: string) => void;
  nodeResults: Record<string, { recovery?: number }>;
}

export default function FlowsheetCanvas({
  nodes, edges, onNodesChange, onConnect,
  onNodeSelect, onAddNode, onDeleteNode, onLoadTemplate, nodeResults,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const [dragging, setDragging] = useState<{ nodeId: string; ox: number; oy: number } | null>(null);
  const [panning, setPanning] = useState<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const [connecting, setConnecting] = useState<{ sourceId: string } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Sélecteur de modèles : ouvert d'office sur toile vierge, réouvrable à tout
  // moment via le bouton « Modèles » (les 9 modèles étaient auparavant tassés
  // dans une bulle étroite et non défilable — difficiles à lire).
  const [showTemplates, setShowTemplates] = useState(false);
  const [templatesDismissed, setTemplatesDismissed] = useState(false);
  const templatesVisible = !!onLoadTemplate && (showTemplates || (nodes.length === 0 && !templatesDismissed));

  // Cadre tout le flowsheet dans le panneau (aucun zoom manuel requis) : calcule
  // la boîte englobante des nœuds et ajuste échelle + décalage pour tout montrer.
  const fitToView = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    if (nodes.length === 0) { setScale(1); setPan({ x: 20, y: 20 }); return; }
    const pad = 48;
    const minX = Math.min(...nodes.map(n => n.position.x));
    const minY = Math.min(...nodes.map(n => n.position.y));
    const maxX = Math.max(...nodes.map(n => n.position.x + NODE_W));
    const maxY = Math.max(...nodes.map(n => n.position.y + NODE_H));
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    // Ne jamais agrandir au-delà de 1,4× (un petit circuit ne doit pas être géant).
    const s = Math.max(0.2, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h, 1.4));
    setScale(s);
    setPan({ x: (rect.width - w * s) / 2 - minX * s, y: (rect.height - h * s) / 2 - minY * s });
  }, [nodes]);

  // Auto-cadrage quand l'ENSEMBLE des nœuds change (chargement de template, ajout,
  // suppression) — pas sur un simple déplacement (l'id-signature ne change pas).
  const idSignature = nodes.map(n => n.id).join('|');
  useEffect(() => {
    const raf = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(raf);
    // fitToView est recréé à chaque changement de `nodes` ; on ne relance QUE sur
    // un changement d'ensemble d'ids pour ne pas recadrer pendant un glissement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSignature]);

  // Convert screen coords to canvas coords
  function toCanvas(sx: number, sy: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (sx - rect.left - pan.x) / scale, y: (sy - rect.top - pan.y) / scale };
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.target === svgRef.current || (e.target as SVGElement).tagName === 'rect' && !(e.target as SVGElement).dataset.node) {
      // Pan
      setPanning({ ox: e.clientX, oy: e.clientY, px: pan.x, py: pan.y });
      setSelectedId(null);
      onNodeSelect(null);
    }
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const cv = toCanvas(e.clientX, e.clientY);
    setMousePos(cv);

    if (dragging) {
      const newX = cv.x - dragging.ox;
      const newY = cv.y - dragging.oy;
      onNodesChange([{ type: 'position', id: dragging.nodeId, position: { x: newX, y: newY } }]);
    }
    if (panning) {
      setPan({ x: panning.px + (e.clientX - panning.ox), y: panning.py + (e.clientY - panning.oy) });
    }
  }

  function handleMouseUp() {
    setDragging(null);
    setPanning(null);
  }

  function handleNodeMouseDown(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    if (connecting) {
      if (connecting.sourceId !== nodeId) {
        onConnect({ source: connecting.sourceId, target: nodeId });
      }
      setConnecting(null);
      return;
    }
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const cv = toCanvas(e.clientX, e.clientY);
    setDragging({ nodeId, ox: cv.x - node.position.x, oy: cv.y - node.position.y });
    setSelectedId(nodeId);
    onNodeSelect(nodeId);
  }

  function startConnect(e: React.MouseEvent, nodeId: string) {
    e.stopPropagation();
    setConnecting({ sourceId: nodeId });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      onDeleteNode(selectedId);
      setSelectedId(null);
      onNodeSelect(null);
    }
    if (e.key === 'Escape') setConnecting(null);
  }

  // Edge path: center-right of source to center-left of target
  // Le flowsheet se lit HAUT → BAS (agencement en cascade par profondeur de flux).
  // On sort donc par le BAS de la source et on entre par le HAUT de la cible, avec
  // une bézier verticale (courbe douce en S) — les arêtes suivent le sens du
  // procédé au lieu de traverser le schéma horizontalement.
  function edgePath(srcId: string, tgtId: string) {
    const src = nodes.find(n => n.id === srcId);
    const tgt = nodes.find(n => n.id === tgtId);
    if (!src || !tgt) return '';
    const x1 = src.position.x + NODE_W / 2;
    const x2 = tgt.position.x + NODE_W / 2;
    if (tgt.position.y >= src.position.y) {
      // Cible plus bas (cas normal) : bas de la source → haut de la cible.
      const y1 = src.position.y + NODE_H;
      const y2 = tgt.position.y;
      const my = (y1 + y2) / 2;
      return `M ${x1},${y1} C ${x1},${my} ${x2},${my} ${x2},${y2}`;
    }
    // Retour vers le haut (recyclage) : sort par le côté droit et remonte, pour ne
    // pas se confondre avec le flux descendant.
    const xr1 = src.position.x + NODE_W;
    const yr1 = src.position.y + NODE_H / 2;
    const xr2 = tgt.position.x + NODE_W;
    const yr2 = tgt.position.y + NODE_H / 2;
    const bend = Math.max(xr1, xr2) + 60;
    return `M ${xr1},${yr1} C ${bend},${yr1} ${bend},${yr2} ${xr2},${yr2}`;
  }

  return (
    <div className="flex h-full flex-1 min-w-0">
      <UnitPalette onAdd={onAddNode} />
      <div className="flex-1 relative overflow-hidden bg-slate-950 focus:outline-none" tabIndex={0} onKeyDown={handleKeyDown}>
        {/* Toolbar */}
        <div className="absolute top-3 right-3 z-10 flex gap-1">
          {onLoadTemplate && (
            <button
              onClick={() => { setShowTemplates(true); setTemplatesDismissed(false); }}
              className="px-2.5 py-1.5 rounded bg-blue-600/90 border border-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-600 mr-1"
              title="Charger un modèle de circuit"
            >
              <LayoutGrid size={14} /> Modèles
            </button>
          )}
          <button onClick={() => setScale(s => Math.min(2, s + 0.15))} className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setScale(s => Math.max(0.3, s - 0.15))} className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700">
            <ZoomOut size={14} />
          </button>
          <button onClick={fitToView} title="Ajuster tout le flowsheet au panneau" className="p-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700">
            <Maximize2 size={14} />
          </button>
        </div>

        {connecting && (
          <div className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded bg-blue-900/80 border border-blue-500/50 text-xs text-blue-300">
            Cliquez sur un nœud cible pour connecter · Échap pour annuler
          </div>
        )}

        {/* Légende des types de courant (couleurs des arêtes). */}
        {nodes.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-slate-900/85 border border-slate-700 px-3 py-2 backdrop-blur-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Légende — courants</div>
            <div className="flex flex-col gap-1">
              {STREAM_LEGEND.map(s => (
                <div key={s.type} className="flex items-center gap-2">
                  <svg width="22" height="8" aria-hidden>
                    <line x1="1" y1="4" x2="21" y2="4" stroke={s.color} strokeWidth="2.5" />
                  </svg>
                  <span className="text-[11px] text-slate-300">{s.legend}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Astuce toile vierge (quand le sélecteur de modèles est masqué) */}
        {nodes.length === 0 && !templatesVisible && (
          <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
            <div className="text-center max-w-md">
              <div className="text-4xl mb-2 text-slate-600">⚗</div>
              <div className="text-sm text-slate-500">
                Cliquez une unité à gauche pour l'ajouter, ou <span className="text-blue-300 font-semibold">Modèles</span> (en haut à droite) pour charger un circuit type.
              </div>
            </div>
          </div>
        )}

        {/* Sélecteur de modèles de circuit — large, lisible et défilable */}
        {templatesVisible && (
          <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-slate-950/70 backdrop-blur-sm">
            <div className="w-full max-w-3xl max-h-[82%] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-slate-700 shrink-0">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Modèles de circuit</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Chargez un circuit type — entièrement éditable ensuite (unités, paramètres, connexions).</div>
                </div>
                <button
                  onClick={() => { setShowTemplates(false); setTemplatesDismissed(true); }}
                  className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                  title="Fermer"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CIRCUIT_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (nodes.length > 0 && !window.confirm(`Charger « ${t.name} » ? Le flowsheet actuel sera remplacé.`)) return;
                      onLoadTemplate!(t.id);
                      setShowTemplates(false);
                      setTemplatesDismissed(true);
                    }}
                    className="text-left p-3 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-blue-500 hover:bg-slate-800 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-sm font-semibold text-slate-100 group-hover:text-blue-300">{t.name}</div>
                      <span className="shrink-0 text-[10px] font-mono text-slate-300 bg-slate-950/80 border border-slate-700 rounded px-1.5 py-0.5">{t.units.length} unités</span>
                    </div>
                    <div className="text-[11px] text-slate-400 leading-snug">{t.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing select-none"
          style={{ cursor: connecting ? 'crosshair' : undefined }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Dot grid */}
          <defs>
            <pattern id="grid" width={20 * scale} height={20 * scale} patternUnits="userSpaceOnUse" x={pan.x % (20 * scale)} y={pan.y % (20 * scale)}>
              <circle cx={2} cy={2} r={1} fill="#334155" />
            </pattern>
            {/* La pointe de flèche suit la couleur du trait (context-stroke) → chaque
                courant garde sa couleur de type (pulpe/solide/solution/eau/gaz). */}
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="context-stroke" stroke="context-stroke" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
            {/* Edges */}
            {edges.map(e => {
              const stroke = e.style?.stroke ?? DEFAULT_EDGE_COLOR;
              return (
              <g key={e.id}>
                <path
                  d={edgePath(e.source, e.target)}
                  stroke={stroke} strokeWidth={2 / scale} fill="none"
                  markerEnd="url(#arrow)"
                />
                {e.label && (() => {
                  const src = nodes.find(n => n.id === e.source);
                  const tgt = nodes.find(n => n.id === e.target);
                  if (!src || !tgt) return null;
                  // Milieu du tracé vertical (bas source ↔ haut cible).
                  const mx = (src.position.x + tgt.position.x) / 2 + NODE_W / 2;
                  const my = (src.position.y + NODE_H + tgt.position.y) / 2;
                  return <text x={mx} y={my} fontSize={10 / scale} fill="#94a3b8" textAnchor="middle">{e.label}</text>;
                })()}
              </g>
            );})}

            {/* Connecting preview line */}
            {connecting && (() => {
              const src = nodes.find(n => n.id === connecting.sourceId);
              if (!src) return null;
              const x1 = src.position.x + NODE_W;
              const y1 = src.position.y + NODE_H / 2;
              return (
                <line x1={x1} y1={y1} x2={mousePos.x} y2={mousePos.y}
                  stroke="#3b82f6" strokeWidth={2 / scale} strokeDasharray={`${6 / scale},${4 / scale}`} />
              );
            })()}

            {/* Nodes */}
            {nodes.map(node => {
              const unit = getUnit(node.data.unit_type);
              const color = unit?.color ?? '#64748b';
              const isSelected = selectedId === node.id;
              const result = nodeResults[node.id];
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.position.x},${node.position.y})`}
                  onMouseDown={e => handleNodeMouseDown(e, node.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Shadow */}
                  <rect x={2 / scale} y={2 / scale} width={NODE_W} height={NODE_H} rx={8} ry={8} fill="black" opacity={0.3} />
                  {/* Body */}
                  <rect width={NODE_W} height={NODE_H} rx={8} ry={8} fill="#1e293b"
                    stroke={isSelected ? '#3b82f6' : color} strokeWidth={isSelected ? 2 / scale : 1.5 / scale} />
                  {/* Icon */}
                  <text x={10} y={26} fontSize={16} dominantBaseline="middle">{unit?.icon ?? '⚙'}</text>
                  {/* Label */}
                  <text x={32} y={18} fontSize={10} fill="white" fontWeight={600}
                    style={{ fontFamily: 'system-ui' }}
                    clipPath={`inset(0 0 0 0)`}
                  >{node.data.label.length > 14 ? node.data.label.slice(0, 13) + '…' : node.data.label}</text>
                  <text x={32} y={30} fontSize={8.5} fill={color} style={{ fontFamily: 'system-ui' }}>
                    {unit?.displayName?.slice(0, 16) ?? ''}
                  </text>
                  {/* Recovery badge */}
                  {result?.recovery !== undefined && (
                    <>
                      <line x1={8} y1={40} x2={NODE_W - 8} y2={40} stroke="#334155" strokeWidth={0.8} />
                      <text x={10} y={50} fontSize={8} fill="#94a3b8" style={{ fontFamily: 'monospace' }}>
                        Rec: <tspan fill="#34d399" fontWeight={600}>{formatDecimalGrouped(result.recovery, 1)}%</tspan>
                      </text>
                    </>
                  )}
                  {/* Input port (left) */}
                  <circle cx={0} cy={NODE_H / 2} r={5 / scale} fill={color} stroke="#1e293b" strokeWidth={1.5 / scale} />
                  {/* Output port (right) — click to start connecting */}
                  <circle
                    cx={NODE_W} cy={NODE_H / 2} r={5 / scale}
                    fill={connecting?.sourceId === node.id ? '#3b82f6' : color}
                    stroke="#1e293b" strokeWidth={1.5 / scale}
                    onMouseDown={e => startConnect(e, node.id)}
                    style={{ cursor: 'crosshair' }}
                  />
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
