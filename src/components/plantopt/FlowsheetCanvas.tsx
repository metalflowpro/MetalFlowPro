import { AREA_TYPE_COLORS, AREA_DEFAULT_COLOR, heatColor } from '../../lib/plantopt/config';
import type { PlantModel, SimResult } from '../../lib/plantopt/types';

/** Valeur centrale d'une loi de capacité (mode/mean/value/max), pour l'étiquette. */
function centralValue(params: Record<string, number | number[]>): number {
  const v = params.mode ?? params.mean ?? params.value ?? params.max ?? 0;
  return typeof v === 'number' ? v : 0;
}

interface Props {
  model: PlantModel;
  result: SimResult | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const BOX_W = 150;
const BOX_H = 66;
const GAP = 44;
const PAD = 20;

/**
 * Diagramme de la chaîne de traitement, aires dans l'ordre procédé. Après un run,
 * chaque aire est teintée par sa probabilité d'être le goulot (vert → rouge), ce
 * qui met le goulot en évidence d'un coup d'œil. Cliquer une aire la sélectionne
 * pour édition dans le panneau latéral.
 */
export function FlowsheetCanvas({ model, result, selectedId, onSelect }: Props) {
  const areas = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);
  const width = PAD * 2 + areas.length * BOX_W + Math.max(0, areas.length - 1) * GAP;
  const height = PAD * 2 + BOX_H;
  const xOf = (i: number) => PAD + i * (BOX_W + GAP);
  const cy = PAD + BOX_H / 2;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${Math.max(width, 320)} ${height}`} className="w-full" style={{ minWidth: Math.min(width, 900) }}>
        <defs>
          <marker id="po-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
          </marker>
        </defs>

        {/* Flux (arêtes) — un tampon éventuel est signalé par un petit losange. */}
        {areas.map((a, i) => {
          if (i === areas.length - 1) return null;
          const x1 = xOf(i) + BOX_W;
          const x2 = xOf(i + 1);
          const buffer = (model.buffers ?? []).find(b => b.upstreamAreaId === a.id && b.downstreamAreaId === areas[i + 1].id);
          const mx = (x1 + x2) / 2;
          return (
            <g key={`edge-${a.id}`}>
              <line x1={x1} y1={cy} x2={x2 - 2} y2={cy} stroke="#64748b" strokeWidth={2} markerEnd="url(#po-arrow)" />
              {buffer && (
                <g>
                  <rect x={mx - 9} y={cy - 22} width={18} height={14} rx={2} fill="#1e293b" stroke="#f59e0b" strokeWidth={1.2} />
                  <text x={mx} y={cy - 12} textAnchor="middle" fontSize={8} fill="#f59e0b">
                    {Math.round(buffer.capacityTonnes / 1000)}k
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Aires */}
        {areas.map((a, i) => {
          const prob = result ? (result.bottleneckProbability[a.id] ?? 0) : 0;
          const hasResult = result !== null;
          const typeColor = (a.type && AREA_TYPE_COLORS[a.type]) || AREA_DEFAULT_COLOR;
          const fill = hasResult ? heatColor(prob) : typeColor;
          const selected = a.id === selectedId;
          const cap = centralValue(a.capacityDist.params);
          return (
            <g key={a.id} onClick={() => onSelect(a.id)} style={{ cursor: 'pointer' }}>
              <rect
                x={xOf(i)} y={PAD} width={BOX_W} height={BOX_H} rx={8}
                fill={fill} fillOpacity={hasResult ? 0.25 + 0.6 * prob : 1}
                stroke={selected ? '#34d399' : '#475569'} strokeWidth={selected ? 2.5 : 1}
              />
              <text x={xOf(i) + BOX_W / 2} y={PAD + 26} textAnchor="middle" fontSize={13} fontWeight={600} fill="#e2e8f0">
                {a.name.length > 18 ? a.name.slice(0, 17) + '…' : a.name}
              </text>
              <text x={xOf(i) + BOX_W / 2} y={PAD + 44} textAnchor="middle" fontSize={10} fill="#cbd5e1">
                {Math.round(cap).toLocaleString('fr-FR')} t/h{hasResult ? ` · ${(100 * prob).toFixed(0)}%` : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
