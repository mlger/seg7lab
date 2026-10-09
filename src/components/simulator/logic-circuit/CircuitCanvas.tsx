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
 *
 * Performance: wires and nodes are individual `memo` components compared on
 * primitive props, so the input auto-sweep only re-renders the handful of
 * elements whose logic value actually changed instead of the whole graph.
 */
'use client';

import { memo, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { SegmentName } from '@/types/simulator';
import type { Circuit, CNode } from '@/logic/circuitNetlist';
import { fanOutCounts, orthogonalWirePath, wireStart } from '@/logic/wireRouting';
import { gateSymbol } from './gateVisuals';

export interface NodeAccent {
  color: string;
  /** Human tooltip, e.g. "K-map group B'C · 4 cells · essential". */
  title: string;
}

/** Junction dot: a shared net branching to several destinations. */
export interface JunctionPoint {
  x: number;
  y: number;
  /** Number of wires leaving this tap point (> 1 by construction). */
  count: number;
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
  /**
   * Multi-level layer separators: one entry per logic layer, in order.
   * Rendered as vertical guides with LAYER n labels so the layering reads as
   * distinct stages rather than one flat sheet of gates.
   */
  layerLines?: { x: number; label: string }[] | null;
  /** Decoder mode: decoder-aware accessible name for the canvas. */
  decoderMode?: boolean;
  /** Jump the viewport to a band (shared by chips, stepper, labels, keys). */
  onBandJump?: (seg: SegmentName) => void;
  /** Fullscreen variant. */
  expanded?: boolean;
  /**
   * Explicit canvas height in px, chosen so the box aspect matches the viewBox
   * aspect. When set, the viewBox fills the box exactly and zoom 100% means
   * "fills the panel" — no letterbox bars from preserveAspectRatio="meet".
   * Omitted / 0 falls back to the responsive CSS height.
   */
  canvasHeight?: number;
  /** Background/pan start (only fires for the svg/circuit-bg target). */
  onCanvasPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  /** Gate/input drag start for a node at its effective position p. */
  onNodePointerDown: (e: React.PointerEvent<SVGGElement>, node: CNode, p: { x: number; y: number }) => void;
  /** Keyboard activation of a node (Enter/Space — same as a click). */
  onNodeActivate: (node: CNode) => void;
  /** Canvas-level keyboard: arrows pan, +/- zoom, 0 fit. */
  onCanvasKeyDown: (e: React.KeyboardEvent<SVGSVGElement>) => void;
}

/* ------------------------------------------------------------------ */
/* Wires — one memo component per wire, compared on painted primitives */
/* ------------------------------------------------------------------ */

interface WireProps {
  d: string;
  stroke: string;
  strokeWidth: number;
  dash?: string;
  opacity: number;
  animated: boolean;
  title: string;
}

const Wire = memo(function Wire({ d, stroke, strokeWidth, dash, opacity, animated, title }: WireProps) {
  return (
    <path
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={dash}
      strokeLinejoin="miter"
      strokeLinecap="butt"
      opacity={opacity}
      className={animated ? 'wire-active' : undefined}
    >
      <title>{title}</title>
    </path>
  );
});

/* ------------------------------------------------------------------ */
/* Nodes — one memo component, dispatching on the node kind            */
/* ------------------------------------------------------------------ */

interface NodeViewProps {
  node: CNode;
  x: number;
  y: number;
  v: 0 | 1;
  isSel: boolean;
  opacity: number;
  accentColor?: string;
  accentTitle?: string;
  activeSegment: SegmentName;
  onPointerDown: (e: React.PointerEvent<SVGGElement>, node: CNode, p: { x: number; y: number }) => void;
  onActivate: (node: CNode) => void;
}

/** Shared keyboard activation handler body for every node kind. */
function keyActivate(e: React.KeyboardEvent<SVGGElement>, node: CNode, onActivate: (n: CNode) => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    onActivate(node);
  }
}

const NodeView = memo(function NodeView({
  node: n, x, y, v, isSel, opacity, accentColor, accentTitle, activeSegment,
  onPointerDown, onActivate,
}: NodeViewProps) {
  const active = v === 1;

  /**
   * Textbook-schematic palette (matches the reference diagram): monoline
   * outlines, a pale blue gate body, and one accent colour for "this signal
   * is currently logic 1". Unlit signals stay neutral grey so the schematic
   * reads like a printed figure rather than a dashboard.
   */
  const wire = active ? '#0f766e' : 'rgba(120,120,128,0.55)';
  const INK = 'rgba(30,30,36,0.85)';

  if (n.type === 'input') {
    // Plain labelled terminal with a wire stub — no box, exactly like the
    // reference's "A B C" inputs. The stub extends to the node's right edge so
    // the router's tap point lands where the rail visually ends.
    const textY = n.h / 2 + 5;
    return (
      <g
        transform={`translate(${x},${y})`}
        className="circuit-node cursor-pointer"
        tabIndex={0}
        role="switch"
        aria-checked={active}
        aria-label={`Input ${n.varName}, currently ${v}. Press Enter to toggle.`}
        opacity={opacity}
        onPointerDown={(e) => onPointerDown(e, n, { x, y })}
        onKeyDown={(e) => keyActivate(e, n, onActivate)}
      >
        <rect className="focus-ring" x={-2} y={-4} width={n.w + 4} height={n.h + 8} rx={8} fill="none" stroke="#f59e0b" strokeWidth={2.5} opacity={0} pointerEvents="none" />
        {/* hit area: keeps the label comfortably clickable / draggable */}
        <rect width={n.w} height={n.h} rx={6} fill="transparent" stroke="none" />
        <text
          x={0} y={textY} textAnchor="start"
          className="font-mono text-[15px] font-semibold"
          fill={active ? '#0f766e' : INK}
        >
          {n.varName}
        </text>
        {/* the logic-level readout sits right of the label */}
        <text
          x={n.w - 12} y={textY} textAnchor="end"
          className={cn('font-mono text-[13px] font-bold', active ? 'fill-teal-700 dark:fill-teal-400' : 'fill-muted-foreground')}
        >
          {v}
        </text>
        {/* wire stub out to the right edge */}
        <line
          x1={n.w - 8} y1={n.h / 2} x2={n.w} y2={n.h / 2}
          stroke={wire} strokeWidth={active ? 2.6 : 1.7}
        />
        {isSel && (
          <rect x={-2} y={-4} width={n.w + 4} height={n.h + 8} rx={8} fill="none" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="5 3" />
        )}
        <title>{`Input ${n.varName} = ${v}. Click or press Enter to toggle.`}</title>
      </g>
    );
  }

  if (n.type === 'out') {
    const segLabel = n.label === 'OUT' ? activeSegment : n.label;
    // Output terminal: a labelled stub, like the reference's "Output (Q)",
    // with the driven segment name and its live level.
    const textY = n.h / 2 + 5;
    return (
      <g
        transform={`translate(${x},${y})`}
        className="circuit-node"
        tabIndex={0}
        role="img"
        aria-label={`Segment ${segLabel} output driver, currently ${v}`}
        opacity={opacity}
        onKeyDown={(e) => keyActivate(e, n, onActivate)}
      >
        <rect className="focus-ring" x={-2} y={-4} width={n.w + 4} height={n.h + 8} rx={8} fill="none" stroke="#f59e0b" strokeWidth={2.5} opacity={0} pointerEvents="none" />
        {/* incoming wire stub from the left edge */}
        <line x1={0} y1={n.h / 2} x2={10} y2={n.h / 2} stroke={wire} strokeWidth={active ? 2.6 : 1.7} />
        {/* the output terminal circle on the wire, as drawn in a schematic */}
        <circle
          cx={10} cy={n.h / 2} r={5}
          fill="none" stroke={active ? '#0f766e' : 'rgba(120,120,128,0.7)'} strokeWidth={1.8}
        />
        <text
          x={22} y={textY - 7} textAnchor="start"
          className="font-mono text-[13px] font-semibold" fill={INK}
        >
          {segLabel}
        </text>
        <text
          x={22} y={textY + 10} textAnchor="start"
          className={cn('font-mono text-[12px] font-bold', active ? 'fill-teal-700 dark:fill-teal-400' : 'fill-muted-foreground')}
        >
          = {v}
        </text>
        {isSel && (
          <rect x={-2} y={-4} width={n.w + 4} height={n.h + 8} rx={8} fill="none" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="5 3" />
        )}
        <title>{`Segment ${segLabel} output = ${v}`}</title>
      </g>
    );
  }

  if (n.type === 'const') {
    return (
      <g transform={`translate(${x},${y})`} opacity={opacity}>
        <rect width={n.w} height={n.h} rx={6} fill="rgba(173,196,222,0.20)" stroke="rgba(30,30,36,0.85)" strokeWidth={1.6} />
        <text x={n.w / 2} y={n.h / 2 + 5} textAnchor="middle" className="fill-foreground font-mono text-[13px] font-semibold">
          {n.label}
        </text>
        <title>{`Constant ${n.label}`}</title>
      </g>
    );
  }

  // logic gates
  return (
    <g
      transform={`translate(${x},${y})`}
      className="circuit-node cursor-grab active:cursor-grabbing"
      tabIndex={0}
      role="button"
      aria-pressed={isSel}
      aria-label={`${n.type.toUpperCase()} gate, output ${v}. Press Enter to inspect.`}
      opacity={opacity}
      onPointerDown={(e) => onPointerDown(e, n, { x, y })}
      onKeyDown={(e) => keyActivate(e, n, onActivate)}
    >
      <rect className="focus-ring" x={-6} y={-6} width={n.w + 20} height={n.h + 14} rx={9} fill="none" stroke="#f59e0b" strokeWidth={2.5} opacity={0} pointerEvents="none" />
      {gateSymbol(n.type, 0, 0, n.w, n.h, active)}
      {/* input pin stubs, as drawn on a printed schematic */}
      {n.operandIds.map((_, i) => {
        const py = ((i + 1) * n.h) / (n.operandIds.length + 1);
        return (
          <g key={i}>
            <line
              x1={-10} y1={py} x2={0} y2={py}
              stroke={active ? '#0f766e' : 'rgba(120,120,128,0.55)'} strokeWidth={1.7}
            />
            <circle cx={0} cy={py} r={2.2} fill={active ? '#0f766e' : 'rgba(120,120,128,0.8)'} />
          </g>
        );
      })}
      {/* output stub + terminal dot (the inversion bubble belongs to the symbol) */}
      {(() => {
        const hasBubble = ['nand', 'nor', 'xnor', 'not'].includes(n.type);
        const startX = n.w + (hasBubble ? 6 : 0);
        return (
          <>
            <line
              x1={startX} y1={n.h / 2} x2={n.w + 14} y2={n.h / 2}
              stroke={active ? '#0f766e' : 'rgba(120,120,128,0.55)'} strokeWidth={1.7}
            />
            <circle
              cx={n.w + 14} cy={n.h / 2} r={3}
              fill={active ? '#0f766e' : 'rgba(120,120,128,0.8)'}
            />
          </>
        );
      })()}
      <text
        x={n.w / 2 - 6} y={n.h / 2 + 4} textAnchor="middle"
        className={cn('font-mono text-[10px] font-semibold pointer-events-none', active ? 'fill-teal-700 dark:fill-teal-400' : 'fill-muted-foreground')}
      >
        {n.type.toUpperCase()}
      </text>
      {accentColor && (
        <rect
          x={-3} y={-3} width={n.w + 16} height={n.h + 6} rx={8}
          fill="none" stroke={accentColor} strokeWidth={2} pointerEvents="none"
        />
      )}
      {isSel && (
        <rect x={-6} y={-6} width={n.w + 18} height={n.h + 12} rx={8} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" />
      )}
      <title>
        {accentTitle
          ? `${n.type.toUpperCase()} gate — ${accentTitle}. Click or press Enter to inspect, drag to move.`
          : `${n.type.toUpperCase()} gate — click or press Enter to inspect, drag to move`}
      </title>
    </g>
  );
});

export function CircuitCanvas({
  svgRef, circuit, values, pos, selected, activeSegment, form, zoom, pan,
  cone, levels, revealLevel, nodeAccents, bandLines, layerLines, decoderMode, onBandJump, expanded,
  canvasHeight,
  onCanvasPointerDown, onPointerMove, onPointerUp,
  onNodePointerDown, onNodeActivate, onCanvasKeyDown,
}: CircuitCanvasProps) {
  const traceOn = revealLevel != null && !!levels;

  /** Shared taps: one source feeding 2+ wires gets a junction dot. */
  const fanOut = fanOutCounts(circuit.wires);

  /** Deterministic corridor lane per wire, grouped by target. */
  const lanes = new Map<string, number>();
  {
    const perTarget = new Map<string, number>();
    for (const w of circuit.wires) {
      const next = perTarget.get(w.toId) ?? 0;
      lanes.set(w.id, next);
      perTarget.set(w.toId, next + 1);
    }
  }

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
        className={cn('block w-full touch-none', expanded ? 'h-full' : !canvasHeight && 'h-[clamp(280px,48vh,520px)]')}
        style={!expanded && canvasHeight ? { height: `${canvasHeight}px` } : undefined}
        role="group"
        aria-label={decoderMode
          ? `Full decoder — all eight segment circuits, ${form.toUpperCase()} form. Arrow keys pan, plus and minus zoom, 0 fits the view, Page Up and Page Down jump between segment bands.`
          : `Logic circuit for segment ${activeSegment}, ${form.toUpperCase()} form. Arrow keys pan, plus and minus zoom, 0 fits the view.`}
        tabIndex={0}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onCanvasKeyDown}
      >
        <rect className="circuit-bg" x={0} y={0} width={circuit.width} height={circuit.height} fill="transparent" />
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* multi-level LAYER guides — one vertical rule per logic layer */}
          {layerLines?.map((L, i) => (
            <g key={`layer-${i}`}>
              {i > 0 && (
                <line
                  x1={L.x} y1={-4} x2={L.x} y2={circuit.height}
                  stroke="rgba(128,128,128,0.28)" strokeWidth={1} strokeDasharray="4 6"
                />
              )}
              <text
                x={L.x + 6} y={16}
                className="fill-muted-foreground font-mono text-[10px] font-bold tracking-widest"
              >
                {L.label}
              </text>
            </g>
          ))}

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

          {/* wires — orthogonal (Manhattan) routing, no curves */}
          {circuit.wires.map((w) => {
            const from = circuit.byId.get(w.fromId)!;
            const to = circuit.byId.get(w.toId)!;
            const fp = pos(from);
            const tp = pos(to);
            const d = orthogonalWirePath(
              { x: fp.x, y: fp.y, w: from.w, h: from.h },
              { x: tp.x, y: tp.y, h: to.h, operandCount: to.operandIds.length },
              w.pin,
              lanes.get(w.id) ?? 0,
            );
            const v = values.get(w.fromId) ?? 0;
            const inCone = cone?.wireIds.has(w.id) ?? false;
            const dimmed =
              (traceOn && (levels!.get(w.fromId) ?? 0) > revealLevel!) ||
              (cone != null && !inCone);
            return (
              <Wire
                key={w.id}
                d={d}
                stroke={inCone ? '#f59e0b' : v === 1 ? '#0f766e' : 'rgba(120,120,128,0.55)'}
                strokeWidth={inCone ? 3 : v === 1 ? 2.4 : 1.7}
                dash={v === 1 ? '7 4' : undefined}
                opacity={dimmed ? 0.15 : cone != null && !inCone ? 0.35 : 1}
                animated={v === 1 && !dimmed}
                title={`${from.varName ?? from.label} (${v}) → ${to.varName ?? to.label} input ${w.pin + 1}`}
              />
            );
          })}

          {/* junction dots — one filled node where a shared net branches */}
          {circuit.wires.map((w) => {
            if ((fanOut.get(w.fromId) ?? 0) < 2) return null;
            const from = circuit.byId.get(w.fromId)!;
            const fp = pos(from);
            const s = wireStart({ x: fp.x, y: fp.y, w: from.w, h: from.h });
            const inCone = cone?.wireIds.has(w.id) ?? false;
            const dimmed =
              (traceOn && (levels!.get(w.fromId) ?? 0) > revealLevel!) ||
              (cone != null && !inCone);
            const v = values.get(w.fromId) ?? 0;
            // One dot per source: only the first wire of that source draws it.
            if (circuit.wires.find((x) => x.fromId === w.fromId)?.id !== w.id) return null;
            return (
              <circle
                key={`j-${w.fromId}`}
                cx={s.x}
                cy={s.y}
                r={inCone ? 3.4 : 2.8}
                fill={inCone ? '#f59e0b' : v === 1 ? '#0f766e' : 'rgba(120,120,128,0.85)'}
                opacity={dimmed ? 0.2 : 1}
              >
                <title>{`Shared net — ${from.varName ?? from.label} (${v}) feeds ${fanOut.get(w.fromId)} gates`}</title>
              </circle>
            );
          })}

          {/* nodes */}
          {circuit.nodes.map((n) => {
            const p = pos(n);
            const accent = nodeAccents?.get(n.id);
            return (
              <NodeView
                key={n.id}
                node={n}
                x={p.x}
                y={p.y}
                v={values.get(n.id) ?? 0}
                isSel={selected === n.id}
                opacity={nodeOpacity(n)}
                accentColor={accent?.color}
                accentTitle={accent?.title}
                activeSegment={activeSegment}
                onPointerDown={onNodePointerDown}
                onActivate={onNodeActivate}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
