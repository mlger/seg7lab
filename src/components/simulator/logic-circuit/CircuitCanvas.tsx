/**
 * The interactive SVG canvas of the logic circuit: wires (with live signal
 * styling) and all node kinds (input rails, NOT/AND/OR/... gates, constants,
 * the segment output driver). Purely presentational — view state (zoom/pan/
 * overrides/selection/drag) and pointer logic live in the parent card, which
 * passes stable callbacks down.
 */
'use client';

import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { SegmentName } from '@/types/simulator';
import type { Circuit, CNode } from '@/logic/circuitNetlist';
import { gateSymbol } from './gateVisuals';

interface CircuitCanvasProps {
  svgRef: RefObject<SVGSVGElement | null>;
  circuit: Circuit;
  values: Map<string, 0 | 1>;
  /** Effective node position (layout or drag override). */
  pos: (n: CNode) => { x: number; y: number };
  selected: string | null;
  activeSegment: SegmentName;
  form: 'sop' | 'pos';
  zoom: number;
  pan: { x: number; y: number };
  /** Background/pan start (only fires for the svg/circuit-bg target). */
  onCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerLeave: (e: React.PointerEvent<SVGSVGElement>) => void;
  /** Gate/input drag start for a node at its effective position p. */
  onNodePointerDown: (e: React.PointerEvent<SVGGElement>, node: CNode, p: { x: number; y: number }) => void;
}

export function CircuitCanvas({
  svgRef, circuit, values, pos, selected, activeSegment, form, zoom, pan,
  onCanvasPointerDown, onPointerMove, onPointerUp, onPointerLeave, onNodePointerDown,
}: CircuitCanvasProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-[radial-gradient(circle,rgba(128,128,128,0.18)_1px,transparent_1px)] [background-size:22px_22px]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${circuit.width} ${circuit.height}`}
        className="block h-[400px] w-full touch-none"
        role="img"
        aria-label={`Logic circuit for segment ${activeSegment}, ${form.toUpperCase()} form`}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        <rect className="circuit-bg" x={0} y={0} width={circuit.width} height={circuit.height} fill="transparent" />
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* wires */}
          {circuit.wires.map((w) => {
            const from = circuit.byId.get(w.fromId)!;
            const to = circuit.byId.get(w.toId)!;
            const fp = pos(from);
            const tp = pos(to);
            const sx = fp.x + from.w;
            const sy = fp.y + from.h / 2;
            const py = tp.y + ((w.pin + 1) * to.h) / (to.operandIds.length + 1);
            const ex = tp.x;
            const ey = py;
            const mx = (sx + ex) / 2;
            const v = values.get(w.fromId) ?? 0;
            return (
              <path
                key={w.id}
                d={`M ${sx},${sy} C ${mx},${sy} ${mx},${ey} ${ex},${ey}`}
                fill="none"
                stroke={v === 1 ? '#10b981' : 'rgba(128,128,128,0.45)'}
                strokeWidth={v === 1 ? 2.6 : 1.6}
                strokeDasharray={v === 1 ? '7 4' : undefined}
                className={v === 1 ? 'wire-active' : undefined}
                data-value={v}
              />
            );
          })}

          {/* nodes */}
          {circuit.nodes.map((n) => {
            const p = pos(n);
            const v = values.get(n.id) ?? 0;
            const active = v === 1;
            const isSel = selected === n.id;
            if (n.type === 'input') {
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="cursor-pointer"
                  onPointerDown={(e) => onNodePointerDown(e, n, p)}
                >
                  <rect
                    width={n.w} height={n.h} rx={8}
                    fill={active ? 'rgba(16,185,129,0.15)' : 'rgba(128,128,128,0.08)'}
                    stroke={active ? '#10b981' : 'rgba(128,128,128,0.5)'}
                    strokeWidth={isSel ? 2.5 : 1.5}
                  />
                  <text x={n.w / 2} y={20} textAnchor="middle" className="fill-foreground font-mono text-[13px] font-bold">
                    {n.varName}
                  </text>
                  <text
                    x={n.w / 2} y={35} textAnchor="middle"
                    className={cn('font-mono text-[12px]', active ? 'fill-emerald-500' : 'fill-muted-foreground')}
                  >
                    {v}
                  </text>
                  <title>{`Input ${n.varName} = ${v}. Drag to move; click to toggle.`}</title>
                </g>
              );
            }
            if (n.type === 'out') {
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <rect
                    width={n.w} height={n.h} rx={10}
                    fill={active ? 'rgba(16,185,129,0.12)' : 'rgba(128,128,128,0.06)'}
                    stroke={active ? '#10b981' : 'rgba(128,128,128,0.5)'}
                    strokeWidth={isSel ? 2.5 : 1.5}
                  />
                  <text x={n.w / 2} y={22} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px] tracking-widest">
                    SEGMENT
                  </text>
                  <text x={n.w / 2} y={40} textAnchor="middle" className="fill-foreground font-mono text-[15px] font-bold">
                    {activeSegment}
                  </text>
                  <circle
                    cx={n.w / 2} cy={54} r={7}
                    fill={active ? '#10b981' : 'rgba(128,128,128,0.3)'}
                    stroke={active ? '#10b981' : 'rgba(128,128,128,0.5)'}
                  />
                  <text x={n.w / 2} y={57.5} textAnchor="middle" className="fill-background font-mono text-[8px] font-bold">
                    {v}
                  </text>
                  <title>{`Segment ${activeSegment} output = ${v}`}</title>
                </g>
              );
            }
            if (n.type === 'const') {
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <rect width={n.w} height={n.h} rx={18} fill="rgba(128,128,128,0.08)" stroke="rgba(128,128,128,0.5)" strokeWidth={1.5} />
                  <text x={n.w / 2} y={n.h / 2 + 5} textAnchor="middle" className="fill-foreground font-mono text-[13px] font-bold">
                    {n.label}
                  </text>
                  <title>{`Constant ${n.label}`}</title>
                </g>
              );
            }
            // logic gates
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => onNodePointerDown(e, n, p)}
              >
                {gateSymbol(n.type, 0, 0, n.w, n.h, active)}
                {n.operandIds.map((_, i) => {
                  const py = ((i + 1) * n.h) / (n.operandIds.length + 1);
                  return <circle key={i} cx={0} cy={py} r={2.5} fill={active ? '#10b981' : 'rgba(128,128,128,0.7)'} />;
                })}
                <circle
                  cx={n.w + (['nand', 'nor', 'xnor', 'not'].includes(n.type) ? 12 : 2)}
                  cy={n.h / 2} r={5}
                  fill={active ? '#10b981' : 'rgba(128,128,128,0.25)'}
                  stroke={active ? '#10b981' : 'rgba(128,128,128,0.5)'}
                />
                <text
                  x={n.w / 2 - 4} y={n.h / 2 + 4} textAnchor="middle"
                  className={cn('font-mono text-[10px] font-bold pointer-events-none', active ? 'fill-emerald-500' : 'fill-muted-foreground')}
                >
                  {n.type.toUpperCase()}
                </text>
                {isSel && (
                  <rect x={-6} y={-6} width={n.w + 18} height={n.h + 12} rx={8} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" />
                )}
                <title>{`${n.type.toUpperCase()} gate — click to inspect, drag to move`}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
