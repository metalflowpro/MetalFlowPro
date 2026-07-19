import { useEffect, useRef, useState, useMemo } from 'react';
import { formatDecimalGrouped } from '../../lib/format/number';
import type { PitViz } from '../../lib/mine/pitOptimizer.worker';

// ─────────────────────────────────────────────────────────────────────────────
// Pit visualisations — a rotatable isometric 3D view and a nested cross-section.
//
// Canvas + SVG only, no 3D library: the worker already reduced the pit to a
// compact floor surface (one point per mined column) and per-shell floor
// profiles, so these render a few thousand quads at most and stay smooth.
// ─────────────────────────────────────────────────────────────────────────────

/** Depth → colour ramp (shallow teal → deep amber), for the 3D floor. */
function depthColor(t: number): string {
  // t in [0,1], 0 = surface, 1 = deepest.
  const stops = [
    [20, 184, 166],   // teal
    [56, 189, 248],   // sky
    [245, 158, 11],   // amber
    [239, 68, 68],    // red (deepest)
  ];
  const x = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = stops[i], b = stops[i + 1] ?? stops[i];
  const c = a.map((v, n) => Math.round(v + (b[n] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Isometric 3D view of the ultimate pit floor. Drag to rotate, wheel to zoom. */
export function Pit3D({ viz }: { viz: PitViz }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [azimuth, setAzimuth] = useState(0.6);
  const [tilt, setTilt] = useState(0.6);
  const [zoom, setZoom] = useState(1);
  const [colorBy, setColorBy] = useState<'depth' | 'grade'>('depth');
  const drag = useRef<{ x: number; y: number } | null>(null);

  const W = 720, H = 420;

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = W * dpr; cvs.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { surface, iMin, iMax, czMin, czMax, gradeMax } = viz;
    if (!surface.length) return;

    const spanI = Math.max(1, iMax - iMin);
    const jVals = surface.map(s => s.j);
    const jMin = Math.min(...jVals), jMax = Math.max(...jVals);
    const spanJ = Math.max(1, jMax - jMin);
    const spanCz = Math.max(1, czMax - czMin);
    const scale = (Math.min(W, H) / Math.max(spanI, spanJ)) * 0.62 * zoom;
    const cosA = Math.cos(azimuth), sinA = Math.sin(azimuth);
    const vScale = 0.9 * tilt;

    // Project (i, j, cz) to screen with rotation about vertical, then tilt.
    const project = (i: number, j: number, cz: number) => {
      const x = (i - (iMin + iMax) / 2);
      const y = (j - (jMin + jMax) / 2);
      const rx = x * cosA - y * sinA;
      const ry = x * sinA + y * cosA;
      const h = ((cz - czMin) / spanCz) * spanI * vScale; // elevation exaggeration
      return {
        sx: W / 2 + rx * scale,
        sy: H / 2 + (ry * 0.5 - h) * scale,
        depth: ry, // for painter's sort
      };
    };

    // Painter's algorithm: draw far columns first.
    const cells = [...surface].sort((a, b) => {
      const pa = project(a.i, a.j, 0), pb = project(b.i, b.j, 0);
      return pa.depth - pb.depth;
    });

    const half = 0.5;
    for (const c of cells) {
      const t = (czMax - c.floorCz) / spanCz; // 0 surface, 1 deepest
      // Grade is scaled against ~2× the median, not the maximum: one high-grade
      // outlier would otherwise wash every normal block to the same colour.
      const gradeRef = Math.max(1e-6, (viz.diag?.gradeMedian ?? gradeMax / 4) * 2);
      const col = colorBy === 'depth'
        ? depthColor(t)
        : depthColor(1 - Math.min(1, c.grade / gradeRef));
      // Top face quad (four corners of the block column at its floor).
      const p1 = project(c.i - half, c.j - half, c.floorCz);
      const p2 = project(c.i + half, c.j - half, c.floorCz);
      const p3 = project(c.i + half, c.j + half, c.floorCz);
      const p4 = project(c.i - half, c.j + half, c.floorCz);
      ctx.beginPath();
      ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy);
      ctx.lineTo(p3.sx, p3.sy); ctx.lineTo(p4.sx, p4.sy); ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }
  }, [viz, azimuth, tilt, zoom, colorBy]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap text-[10px] mf-txt4">
        <span>Glisser pour pivoter · molette pour zoomer</span>
        <div className="flex items-center gap-1.5">
          <span>Couleur :</span>
          <button onClick={() => setColorBy('depth')} className={`px-2 py-0.5 rounded ${colorBy === 'depth' ? 'bg-amber-400 text-gray-900 font-semibold' : 'bg-white/5 mf-txt3'}`}>profondeur</button>
          <button onClick={() => setColorBy('grade')} className={`px-2 py-0.5 rounded ${colorBy === 'grade' ? 'bg-amber-400 text-gray-900 font-semibold' : 'bg-white/5 mf-txt3'}`}>teneur</button>
        </div>
        <button onClick={() => { setAzimuth(0.6); setTilt(0.6); setZoom(1); }} className="px-2 py-0.5 rounded bg-white/5 mf-txt3">réinitialiser la vue</button>
      </div>
      <div className="rounded-lg overflow-hidden bg-[#0B1017] border border-mf-border" style={{ width: '100%', maxWidth: W }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 'auto', display: 'block', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
          onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerUp={() => { drag.current = null; }}
          onPointerMove={e => {
            if (!drag.current) return;
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            drag.current = { x: e.clientX, y: e.clientY };
            setAzimuth(a => a + dx * 0.01);
            setTilt(t => Math.max(0.15, Math.min(1.4, t + dy * 0.005)));
          }}
          onWheel={e => { setZoom(z => Math.max(0.4, Math.min(3, z - e.deltaY * 0.001))); }}
        />
      </div>
      <div className="flex items-center gap-3 text-[10px] mf-txt4">
        <span>{viz.surface.length.toLocaleString('fr-CA')} colonnes minées</span>
        <span>·</span>
        <span>Profondeur {formatDecimalGrouped((viz.topCz - viz.czMin), 0)} m ({formatDecimalGrouped(viz.czMin, 0)}–{formatDecimalGrouped(viz.topCz, 0)} m RL)</span>
      </div>
    </div>
  );
}

/**
 * Why the pit looks the way it does.
 *
 * A pit that covers the whole model is not automatically a bug — it is the
 * correct answer when every block pays for itself. These figures say which case
 * you are in, instead of leaving a flat shape open to interpretation.
 */
export function PitDiagnostic({ viz }: { viz: PitViz }) {
  const d = viz.diag;
  const orePctModel = d.modelBlocks ? (d.modelOreBlocks / d.modelBlocks) * 100 : 0;
  const pitPctModel = d.modelBlocks ? (d.pitBlocks / d.modelBlocks) * 100 : 0;
  const colPct = d.modelColumns ? (d.pitColumns / d.modelColumns) * 100 : 0;
  const wholeFootprint = colPct > 99;
  const mostlyOre = orePctModel > 80;

  return (
    <div className="mt-3 pt-3 border-t border-mf-border/60 space-y-1.5">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] mf-txt4">
        <span>Modèle : <strong className="mf-txt3">{d.modelBlocks.toLocaleString('fr-CA')}</strong> blocs · <strong className="mf-txt3">{formatDecimalGrouped(orePctModel, 0)} %</strong> au-dessus de la coupure</span>
        <span>Fosse : <strong className="mf-txt3">{d.pitBlocks.toLocaleString('fr-CA')}</strong> blocs (<strong className="mf-txt3">{formatDecimalGrouped(pitPctModel, 0)} %</strong> du modèle)</span>
        <span>Emprise : <strong className="mf-txt3">{formatDecimalGrouped(colPct, 0)} %</strong> des colonnes</span>
        <span>Teneur médiane : <strong className="mf-txt3">{formatDecimalGrouped(d.gradeMedian, 2)} g/t</strong></span>
      </div>
      {wholeFootprint && (
        <div className={`text-[10px] space-y-1 ${mostlyOre ? 'text-amber-400' : 'text-red-400'}`}>
          {mostlyOre ? (
            <>
              <div>
                ⚠ La fosse couvre tout le modèle parce que <strong>{formatDecimalGrouped(orePctModel, 0)} % des blocs paient</strong> à
                ce prix de l'or : il n'y a presque pas de stérile à décaper, donc l'enveloppe optimale <em>est</em> le
                modèle entier. <strong>Le calcul est correct</strong> — c'est le modèle de blocs qui est en cause.
              </div>
              <div className="mf-txt4">
                Cause la plus fréquente : le modèle est <strong className="mf-txt3">découpé sur l'enveloppe
                minéralisée</strong>, sans le stérile encaissant. L'optimisation de fosse arbitre minerai contre
                décapage — sans stérile autour du gisement, il n'y a rien à arbitrer et la réponse est toujours
                « tout miner ». Ré-importez un modèle incluant la roche stérile périphérique (module Block Model)
                pour obtenir une vraie forme de fosse.
              </div>
            </>
          ) : (
            <div>
              ✗ La fosse couvre toute l'emprise alors que seuls {formatDecimalGrouped(orePctModel, 0)} % des blocs paient —
              incohérent. La contrainte de pente ne mord pas : à signaler.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Nested pit-shell cross-section along the model's centre row. */
export function PitSection({ viz }: { viz: PitViz }) {
  const W = 720, H = 300, PAD = 40;
  const iSpan = Math.max(1, viz.iMax - viz.iMin);
  const czTop = viz.topCz, czBot = viz.czMin;
  const czSpan = Math.max(1, czTop - czBot);

  const x = (i: number) => PAD + ((i - viz.iMin) / iSpan) * (W - 2 * PAD);
  const y = (cz: number) => PAD + ((czTop - cz) / czSpan) * (H - 2 * PAD);

  // Colour shells coarse (widest, lightest) → fine (deepest, saturated).
  const shells = useMemo(() => viz.section
    .filter(s => s.floorByI.some(v => v !== null))
    .sort((a, b) => a.revenueFactor - b.revenueFactor), [viz.section]);

  return (
    <div className="space-y-2">
      <div className="text-[10px] mf-txt4">
        Coupe verticale au centre du gisement (rangée j = {viz.centerJ}). Chaque profil est une shell : les basses
        révèlent le cœur, les hautes l'enveloppe finale — la séquence de pushbacks.
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }} className="rounded-lg bg-[#0B1017] border border-mf-border">
        {/* Surface line */}
        <line x1={PAD} y1={y(czTop)} x2={W - PAD} y2={y(czTop)} stroke="#3b4657" strokeWidth={1} strokeDasharray="4 3" />
        <text x={W - PAD} y={y(czTop) - 4} fill="#7F8DA3" fontSize="9" textAnchor="end">surface {formatDecimalGrouped(czTop, 0)} m</text>
        {shells.map((s, idx) => {
          const t = shells.length > 1 ? idx / (shells.length - 1) : 0;
          const col = depthColor(t);
          const isBase = Math.abs(s.revenueFactor - 1) < 1e-9;
          const pts: string[] = [];
          s.floorByI.forEach((cz, c) => { if (cz !== null) pts.push(`${x(viz.iMin + c).toFixed(1)},${y(cz).toFixed(1)}`); });
          if (pts.length < 2) return null;
          return (
            <polyline key={s.revenueFactor} points={pts.join(' ')} fill="none"
              stroke={col} strokeWidth={isBase ? 2.4 : 1} opacity={isBase ? 1 : 0.55}
              strokeLinejoin="round" strokeLinecap="round" />
          );
        })}
        {/* Axis labels */}
        <text x={PAD} y={H - 12} fill="#7F8DA3" fontSize="9">Ouest</text>
        <text x={W - PAD} y={H - 12} fill="#7F8DA3" fontSize="9" textAnchor="end">Est</text>
        <text x={PAD} y={y(czBot) + 14} fill="#7F8DA3" fontSize="9">fond {formatDecimalGrouped(czBot, 0)} m</text>
      </svg>
      <div className="flex items-center gap-2 flex-wrap text-[9px] mf-txt4">
        {shells.map((s, idx) => (
          <span key={s.revenueFactor} className="flex items-center gap-1">
            <span className="w-2.5 h-1 rounded-full inline-block" style={{ backgroundColor: depthColor(shells.length > 1 ? idx / (shells.length - 1) : 0) }} />
            ×{formatDecimalGrouped(s.revenueFactor, 2)}{Math.abs(s.revenueFactor - 1) < 1e-9 ? ' (base)' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
