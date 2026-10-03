/**
 * The interactive SVG canvas of the logic circuit: wires (with live signal
 * styling) and all node kinds (input rails, NOT/AND/OR/... gates, constants,
 * the segment output driver). Purely presentational — view state (zoom/pan/
 * overrides/selection/drag) and pointer logic live in the parent card, which
 * passes stable callbacks down.
 *
 * Presentation layers, all optional (null/undefined = off):
 *  - cone: amber fan-in/fan-out highlight of the selected node, everything
 *    else dimmed;
 *  - levels + revealLevel: level trace — nodes/wires beyond the revealed
 *    logic depth fade out (propagation step-through);
 *  - nodeAccents: per-node accent ring (K-map cover group colors on term
 *    gates) + tooltip;
 *  - bandLines: dashed per-segment band separators + labels, each a focusable
 *    click target that jumps the viewport to its band (decoder mode);
 *  - expanded: fullscreen variant (svg fills the viewport).
 */
'use client';

import type { RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { SegmentName } from '@/types/simulator';
import type { Circuit, CNode } from '@/logic/circuitNetlist';
import { gateSymbol } from './gateVisuals';

export interface NodeAccent {
  color: string;
  /** Human tooltip, e.g. "K-map group B'C · 4 cells · essential". */
  title: string;
}

export interface BandLine {
  y: number;
  label: string;
  /** Segment the band belongs to — the jump target when clicked. */
  seg: SegmentName;
}

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
  /** Selected node's logic cone (fan-in + fan-out) to highlight. */
  cone?: { nodeIds: Set<string>; wireIds: Set<string> } | null;
  /** Node level map (propagation depth) — enables the level trace. */
  levels?: Map<string, number> | null;
  /** Revealed depth when tracing (null = trace off). */
  revealLevel?: number | null;
  /** Per-node accent rings (term gates ↔ K-map groups). */
  nodeAccents?: Map<string, NodeAccent> | null;
  /** Decoder-mode band separators. */
  bandLines?: BandLine[] | null;
  /** Decoder mode: decoder-aware accessible name for the canvas. */
  decoderMode?: boolean;
  /** Jump the viewport to a band (shared by chips, stepper, labels, keys). */
  onBandJump?: (seg: SegmentName) => void;
  /** Fullscreen variant. */
  expanded?: boolean;
  /** Background/pan start (only fires for the svg/circuit-bg target). */
  onCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerLeave: (e: React.PointerEvent<SVGSVGElement>) => void;
  /** Gate/input drag start for a node at its effective position p. */
  onNodePointerDown: (e: React.PointerEvent<SVGGElement>, node: CNode, p: { x: number; y: number }) => void;
  /** Keyboard activation of a node (Enter/Space — same as a click). */
  onNodeActivate: (node: CNode) => void;
  /** Canvas-level keyboard: arrows pan, +/- zoom, 0 fit. */
  onCanvasKeyDown: (e: React.KeyboardEvent<SVGSVGElement>) => void;
}

export function CircuitCanvas({
  svgRef, circuit, values, pos, selected, activeSegment, form, zoom, pan,
  cone, levels, revealLevel, nodeAccents, bandLines, decoderMode, onBandJump, expanded,
  onCanvasPointerDown, onPointerMove, onPointerUp, onPointerLeave,
  onNodePointerDown, onNodeActivate, onCanvasKeyDown,
}: CircuitCanvasProps) {
  const traceOn = revealLevel != null && !!levels;
  /** Node opacity under the active presentation layers. */
  const nodeOpacity = (n: CNode): number => {
    if (traceOn && (levels!.get(n.id) ?? 0) > revealLevel!) return 0.18;
    if (cone && !cone.nodeIds.has(n.id)) return 0.4;
    return 1;
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border bg-[radial-gradient(circle,rgba(128,128,128,0.18)_1px,transparent_1px)] [background-size:22px_22px]',
        expanded && 'h-full',
      )}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${circuit.width} ${circuit.height}`}
        className={cn('block w-full touch-none', expanded ? 'h-full' : 'h-[400px]')}
        role="img"
        aria-label={decoderMode
          ? `Full decoder — all eight segment circuits, ${form.toUpperCase()} form. Arrow keys pan, plus and minus zoom, 0 fits the view, Page Up and Page Down jump between segment bands.`
          : `Logic circuit for segment ${activeSegment}, ${form.toUpperCase()} form. Arrow keys pan, plus and minus zoom, 0 fits the view.`}
        tabIndex={0}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onKeyDown={onCanvasKeyDown}
      >
        <rect className="circuit-bg" x={0} y={0} width={circuit.width} height={circuit.height} fill="transparent" />
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* decoder band separators — clickable jump targets */}
          {bandLines?.map((b) => (
            <g
              key={b.label}
              className="group cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={`Jump to ${b.label.toLowerCase()} band`}
              onClick={(e) => { e.stopPropagation(); onBandJump?.(b.seg); }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onBandJump?.(b.seg);
                }
              }}
            >
              <rect
                x={8} y={b.y - 34} width={circuit.width - 16} height={32} rx={6}
                fill="rgba(0,0,0,0)" className="group-hover:fill-amber-500/10"
              />
              <line
                x1={8} y1={b.y - 14} x2={circuit.width - 8} y2={b.y - 14}
                stroke="rgba(128,128,128,0.35)" strokeWidth={1} strokeDasharray="6 5"
                className="group-hover:stroke-amber-500/70"
              />
              <text
                x={12} y={b.y - 20}
                className="fill-muted-foreground font-mono text-[11px] font-bold tracking-widest group-hover:fill-amber-500"
              >
                {b.label}
              </text>
              <title>{`Jump to ${b.label.toLowerCase()} — fits that band in the viewport`}</title>
            </g>
          ))}

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
            const inCone = cone?.wireIds.has(w.id) ?? false;
            const dimmed =
              (traceOn && (levels!.get(w.fromId) ?? 0) > revealLevel!) ||
              (cone != null && !inCone);
            const stroke = inCone ? '#f59e0b' : v === 1 ? '#10b981' : 'rgba(128,128,128,0.45)';
            return (
              <path
                key={w.id}
                d={`M ${sx},${sy} C ${mx},${sy} ${mx},${ey} ${ex},${ey}`}
                fill="none"
                stroke={stroke}
                strokeWidth={inCone ? 3 : v === 1 ? 2.6 : 1.6}
                strokeDasharray={v === 1 ? '7 4' : undefined}
                opacity={dimmed ? 0.15 : cone != null && !inCone ? 0.35 : 1}
                className={v === 1 && !dimmed ? 'wire-active' : undefined}
                data-value={v}
              >
                <title>
                  {`${from.varName ?? from.label} (${v}) → ${to.varName ?? to.label} input ${w.pin + 1}`}
                </title>
              </path>
            );
          })}

          {/* nodes */}
          {circuit.nodes.map((n) => {
            const p = pos(n);
            const v = values.get(n.id) ?? 0;
            const active = v === 1;
            const isSel = selected === n.id;
            const opacity = nodeOpacity(n);
            const accent = nodeAccents?.get(n.id);
            if (n.type === 'input') {
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="circuit-node cursor-pointer"
                  tabIndex={0}
                  role="switch"
                  aria-checked={active}
                  aria-label={`Input ${n.varName}, currently ${v}. Press Enter to toggle.`}
                  opacity={opacity}
                  onPointerDown={(e) => onNodePointerDown(e, n, p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onNodeActivate(n);
                    }
                  }}
                >
                  <rect className="focus-ring" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={10} fill="none" stroke="#f59e0b" strokeWidth={2.5} opacity={0} pointerEvents="none" />
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
                  <title>{`Input ${n.varName} = ${v}. Drag to move; click or press Enter to toggle.`}</title>
                </g>
              );
            }
            if (n.type === 'out') {
              const segLabel = n.label === 'OUT' ? activeSegment : n.label;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="circuit-node"
                  tabIndex={0}
                  role="img"
                  aria-label={`Segment ${segLabel} output driver, currently ${v}`}
                  opacity={opacity}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onNodeActivate(n);
                    }
                  }}
                >
                  <rect className="focus-ring" x={-4} y={-4} width={n.w + 8} height={n.h + 8} rx={12} fill="none" stroke="#f59e0b" strokeWidth={2.5} opacity={0} pointerEvents="none" />
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
                    {segLabel}
                  </text>
                  <circle
                    cx={n.w / 2} cy={54} r={7}
                    fill={active ? '#10b981' : 'rgba(128,128,128,0.3)'}
                    stroke={active ? '#10b981' : 'rgba(128,128,128,0.5)'}
                  />
                  <text x={n.w / 2} y={57.5} textAnchor="middle" className="fill-background font-mono text-[8px] font-bold">
                    {v}
                  </text>
                  <title>{`Segment ${segLabel} output = ${v}`}</title>
                </g>
              );
            }
            if (n.type === 'const') {
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} opacity={opacity}>
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
                className="circuit-node cursor-grab active:cursor-grabbing"
                tabIndex={0}
                role="button"
                aria-pressed={isSel}
                aria-label={`${n.type.toUpperCase()} gate, output ${v}. Press Enter to inspect.`}
                opacity={opacity}
                onPointerDown={(e) => onNodePointerDown(e, n, p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onNodeActivate(n);
                  }
                }}
              >
                <rect className="focus-ring" x={-6} y={-6} width={n.w + 20} height={n.h + 14} rx={9} fill="none" stroke="#f59e0b" strokeWidth={2.5} opacity={0} pointerEvents="none" />
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
                {accent && (
                  <rect
                    x={-3} y={-3} width={n.w + 16} height={n.h + 6} rx={8}
                    fill="none" stroke={accent.color} strokeWidth={2} pointerEvents="none"
                  />
                )}
                {isSel && (
                  <rect x={-6} y={-6} width={n.w + 18} height={n.h + 12} rx={8} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" />
                )}
                <title>
                  {accent
                    ? `${n.type.toUpperCase()} gate — ${accent.title}. Click or press Enter to inspect, drag to move.`
                    : `${n.type.toUpperCase()} gate — click or press Enter to inspect, drag to move`}
                </title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
