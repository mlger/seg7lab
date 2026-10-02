/**
 * Logic-gate circuit visualizer, generated from the minimized Boolean
 * expression of the selected segment.
 *
 * Features: live signal simulation (active paths glow), zoom (wheel/buttons),
 * pan (drag background), draggable gates, click-to-inspect gates, clickable
 * input rails that drive the whole simulator, and an interactive gate
 * reference (AND OR NOT NAND NOR XOR XNOR).
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircuitBoard, ZoomIn, ZoomOut, Maximize, RotateCcw, MousePointerClick, Lightbulb,
} from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { ExplainBlock, TermView } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES, type Literal, type Term } from '@/types/simulator';

type GateType = 'input' | 'not' | 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor' | 'const' | 'out';

interface CNode {
  id: string;
  type: GateType;
  label: string;
  varName?: string;
  constValue?: 0 | 1;
  operandIds: string[];
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CWire {
  id: string;
  fromId: string;
  toId: string;
  pin: number;
}

const GATE_INFO: Record<string, { desc: string; expr: string }> = {
  AND: { desc: 'Outputs 1 only when every input is 1.', expr: 'Y = A·B' },
  OR: { desc: 'Outputs 1 when at least one input is 1.', expr: 'Y = A + B' },
  NOT: { desc: 'Inverts its single input.', expr: "Y = A'" },
  NAND: { desc: 'AND followed by inversion — outputs 0 only when every input is 1.', expr: "Y = (A·B)'" },
  NOR: { desc: 'OR followed by inversion — outputs 1 only when every input is 0.', expr: "Y = (A+B)'" },
  XOR: { desc: 'Outputs 1 when an odd number of inputs are 1.', expr: 'Y = A ⊕ B' },
  XNOR: { desc: 'XOR followed by inversion — outputs 1 when inputs are equal.', expr: "Y = (A ⊕ B)'" },
};

/* ------------------------------------------------------------------ */
/* Netlist construction                                                */
/* ------------------------------------------------------------------ */

function buildCircuit(terms: Term[], form: 'sop' | 'pos', varNames: string[]) {
  const nodes: CNode[] = [];
  const byId = new Map<string, CNode>();
  const add = (n: CNode) => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };

  const inputNodes = new Map<string, CNode>();
  varNames.forEach((v, i) => {
    const n = add({
      id: `in-${v}`, type: 'input', label: v, varName: v, operandIds: [],
      x: 56, y: 48 + i * 76, w: 64, h: 44,
    });
    inputNodes.set(v, n);
  });

  const notNodes = new Map<string, CNode>();
  const literalNode = (lit: Literal): CNode => {
    const base = inputNodes.get(lit.name)!;
    if (!lit.complemented) return base;
    let not = notNodes.get(lit.name);
    if (!not) {
      not = add({
        id: `not-${lit.name}`, type: 'not', label: `NOT ${lit.name}`,
        operandIds: [base.id], x: 168, y: base.y + 4, w: 60, h: 36,
      });
      notNodes.set(lit.name, not);
    }
    return not;
  };

  const literalNodes = terms.map((t) => t.literals.map(literalNode));
  const termGate = form === 'sop' ? 'and' : 'or';
  const rootGate = form === 'sop' ? 'or' : 'and';

  let yCursor = 52;
  const termNodes: CNode[] = [];
  terms.forEach((t, ti) => {
    const pins = literalNodes[ti];
    if (pins.length <= 1) {
      termNodes.push(pins[0] ?? add({
        id: `const-${ti}`, type: 'const', label: '1', constValue: 1, operandIds: [],
        x: 300, y: yCursor, w: 48, h: 36,
      }));
    } else {
      const h = Math.max(48, pins.length * 26 + 18);
      termNodes.push(add({
        id: `term-${ti}`, type: termGate, label: `${termGate.toUpperCase()}`,
        operandIds: pins.map((p) => p.id), x: 316, y: yCursor, w: 76, h,
      }));
      yCursor += h + 40;
    }
  });

  const distinct = termNodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);
  let root: CNode;
  if (terms.length === 0) {
    root = add({
      id: 'const-root', type: 'const', label: form === 'sop' ? '0' : '1',
      constValue: form === 'sop' ? 0 : 1, operandIds: [], x: 560, y: 120, w: 48, h: 36,
    });
  } else if (distinct.length === 1) {
    root = distinct[0];
  } else {
    const h = Math.max(48, distinct.length * 26 + 18);
    const rootY = 52 + (yCursor - 92) / 2 - h / 2;
    root = add({
      id: 'root', type: rootGate, label: rootGate.toUpperCase(),
      operandIds: distinct.map((n) => n.id), x: 560, y: Math.max(40, rootY), w: 76, h,
    });
  }

  const out = add({
    id: 'out', type: 'out', label: 'OUT', operandIds: [root.id],
    x: 730, y: root.y + root.h / 2 - 34, w: 120, h: 68,
  });

  const wires: CWire[] = [];
  for (const n of nodes) {
    n.operandIds.forEach((fromId, pin) => {
      wires.push({ id: `${fromId}->${n.id}:${pin}`, fromId, toId: n.id, pin });
    });
  }

  const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + 40;
  const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + 40;
  return { nodes, wires, byId, width: Math.max(920, maxX), height: Math.max(360, maxY) };
}

/* ------------------------------------------------------------------ */
/* Gate symbols                                                        */
/* ------------------------------------------------------------------ */

function gateSymbol(type: GateType, x: number, y: number, w: number, h: number, active: boolean) {
  const stroke = active ? '#10b981' : 'currentColor';
  const fill = active ? 'rgba(16,185,129,0.12)' : 'rgba(128,128,128,0.07)';
  const bubble = (bx: number) => (
    <circle cx={bx} cy={y + h / 2} r={6} fill="none" stroke={stroke} strokeWidth={2} />
  );
  switch (type) {
    case 'and':
    case 'nand': {
      const bodyW = type === 'nand' ? w - 12 : w;
      return (
        <>
          <path
            d={`M ${x},${y} L ${x + bodyW * 0.52},${y} A ${h / 2},${h / 2} 0 0 1 ${x + bodyW * 0.52},${y + h} L ${x},${y + h} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          {type === 'nand' && bubble(x + w - 6)}
        </>
      );
    }
    case 'or':
    case 'nor': {
      const bodyW = type === 'nor' ? w - 12 : w;
      const mx = x + bodyW;
      return (
        <>
          <path
            d={`M ${x},${y} Q ${x + bodyW * 0.55},${y} ${mx},${y + h / 2} Q ${x + bodyW * 0.55},${y + h} ${x},${y + h} Q ${x + bodyW * 0.34},${y + h / 2} ${x},${y} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          {type === 'nor' && bubble(x + w - 6)}
        </>
      );
    }
    case 'xor':
    case 'xnor': {
      const bodyW = type === 'xnor' ? w - 12 : w;
      const mx = x + bodyW;
      return (
        <>
          <path
            d={`M ${x + 8},${y} Q ${x + bodyW * 0.55},${y} ${mx},${y + h / 2} Q ${x + bodyW * 0.55},${y + h} ${x + 8},${y + h} Q ${x + bodyW * 0.34},${y + h / 2} ${x + 8},${y} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          <path
            d={`M ${x},${y} Q ${x + bodyW * 0.34},${y + h / 2} ${x},${y + h}`}
            fill="none" stroke={stroke} strokeWidth={2}
          />
          {type === 'xnor' && bubble(x + w - 6)}
        </>
      );
    }
    case 'not': {
      const tw = w - 16;
      return (
        <>
          <path
            d={`M ${x},${y} L ${x + tw},${y + h / 2} L ${x},${y + h} Z`}
            fill={fill} stroke={stroke} strokeWidth={2}
          />
          {bubble(x + w - 6)}
        </>
      );
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function LogicCircuitCard() {
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const expressionForm = useSimulator((s) => s.expressionForm);
  const currentInput = useSimulator((s) => s.currentInput);
  const inputBits = useSimulator((s) => s.inputBits);
  const toggleBit = useSimulator((s) => s.toggleBit);
  const explain = useSimulator((s) => s.explainMode);
  const engines = useEngines();

  const form = expressionForm === 'pos' || expressionForm === 'cpos' ? 'pos' : 'sop';
  const engine = engines[activeSegment];
  const terms = form === 'sop' ? engine.activeSopTerms : engine.activePosTerms;
  const varNames = useMemo(
    () => (inputBits === 5 ? ['E', 'D', 'C', 'B', 'A'] : ['D', 'C', 'B', 'A']),
    [inputBits],
  );

  const circuit = useMemo(() => buildCircuit(terms, form, varNames), [terms, form, varNames]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{
    kind: 'pan' | 'gate';
    nodeId?: string;
    startX: number;
    startY: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const pos = useCallback(
    (n: CNode) => overrides[n.id] ?? { x: n.x, y: n.y },
    [overrides],
  );

  /* live evaluation */
  const values = useMemo(() => {
    const val = new Map<string, 0 | 1>();
    const bitVals = varNames.map((_, i) => ((currentInput >> (inputBits - 1 - i)) & 1) as 0 | 1);
    const evalNode = (n: CNode): 0 | 1 => {
      const cached = val.get(n.id);
      if (cached !== undefined) return cached;
      let v: 0 | 1 = 0;
      switch (n.type) {
        case 'input':
          v = bitVals[varNames.indexOf(n.varName!)] ?? 0;
          break;
        case 'const':
          v = n.constValue ?? 0;
          break;
        case 'not':
          v = evalNode(circuit.byId.get(n.operandIds[0])!) === 1 ? 0 : 1;
          break;
        case 'and':
          v = n.operandIds.every((id) => evalNode(circuit.byId.get(id)!) === 1) ? 1 : 0;
          break;
        case 'or':
          v = n.operandIds.some((id) => evalNode(circuit.byId.get(id)!) === 1) ? 1 : 0;
          break;
        case 'xor':
          v = n.operandIds.reduce((acc, id) => acc ^ evalNode(circuit.byId.get(id)!), 0) as 0 | 1;
          break;
        case 'nand':
          v = n.operandIds.every((id) => evalNode(circuit.byId.get(id)!) === 1) ? 0 : 1;
          break;
        case 'nor':
          v = n.operandIds.some((id) => evalNode(circuit.byId.get(id)!) === 1) ? 0 : 1;
          break;
        case 'xnor':
          v = (n.operandIds.reduce((acc, id) => acc ^ evalNode(circuit.byId.get(id)!), 0) as 0 | 1) === 1 ? 0 : 1;
          break;
        case 'out':
          v = evalNode(circuit.byId.get(n.operandIds[0])!);
          break;
      }
      val.set(n.id, v);
      return v;
    };
    for (const n of circuit.nodes) evalNode(n);
    return val;
  }, [circuit, currentInput, inputBits, varNames]);

  /* non-passive wheel zoom */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom((z) => Math.min(2.5, Math.max(0.35, z * factor)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  /* pointer interactions */
  const toGraph = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    // uniform viewBox scale + letterbox centering (preserveAspectRatio meet)
    const scale = Math.min(circuit.width / rect.width, circuit.height / rect.height);
    const offX = (rect.width - circuit.width / scale) / 2;
    const offY = (rect.height - circuit.height / scale) / 2;
    const vx = (clientX - rect.left - offX) * scale;
    const vy = (clientY - rect.top - offY) * scale;
    return { x: (vx - pan.x) / zoom, y: (vy - pan.y) / zoom };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const g = toGraph(e.clientX, e.clientY);
    if (Math.abs(g.x - drag.startX) + Math.abs(g.y - drag.startY) > 4) setMoved(true);
    if (drag.kind === 'pan') {
      setPan({ x: drag.origX + (e.clientX - drag.startClientX), y: drag.origY + (e.clientY - drag.startClientY) });
    } else if (drag.nodeId) {
      setOverrides((o) => ({
        ...o,
        [drag.nodeId!]: {
          x: Math.max(4, drag.origX + (g.x - drag.startX)),
          y: Math.max(4, drag.origY + (g.y - drag.startY)),
        },
      }));
    }
  };

  const selectedNode = selected ? circuit.byId.get(selected) : null;
  const gateCount = circuit.nodes.filter((n) => ['and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor'].includes(n.type)).length;
  const varIndex = (name: string) => varNames.indexOf(name);

  return (
    <Card id="circuit-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <CircuitBoard className="h-4 w-4 text-muted-foreground" aria-hidden />
            LOGIC CIRCUIT
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {form.toUpperCase()} · {gateCount} gates
            </Badge>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom((z) => Math.min(2.5, z * 1.2)); }} aria-label="Zoom in">
              <ZoomIn className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom((z) => Math.max(0.35, z / 1.2)); }} aria-label="Zoom out">
              <ZoomOut className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Fit view">
              <Maximize className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setOverrides({}); setPan({ x: 0, y: 0 }); setZoom(1); }} aria-label="Reset gate layout">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* segment selector */}
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Circuit segment selector">
          {SEGMENT_NAMES.map((seg) => (
            <button
              key={seg}
              type="button"
              role="tab"
              aria-selected={seg === activeSegment}
              onClick={() => { setSelected(null); setActiveSegment(seg); }}
              className={cn(
                'h-8 min-w-9 rounded-md border px-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                seg === activeSegment
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40',
              )}
            >
              {seg}
            </button>
          ))}
        </div>

        {/* SVG canvas */}
        <div className="overflow-hidden rounded-lg border bg-[radial-gradient(circle,rgba(128,128,128,0.18)_1px,transparent_1px)] [background-size:22px_22px]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${circuit.width} ${circuit.height}`}
            className="block h-[400px] w-full touch-none"
            role="img"
            aria-label={`Logic circuit for segment ${activeSegment}, ${form.toUpperCase()} form`}
            onWheel={undefined}
            onPointerDown={(e) => {
              if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('circuit-bg')) {
                setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, startClientX: e.clientX, startClientY: e.clientY, origX: pan.x, origY: pan.y });
                setMoved(false);
              }
            }}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
              if (drag && !moved && drag.nodeId) {
                if (drag.nodeId.startsWith('in-')) {
                  const idx = varIndex(drag.nodeId.slice(3));
                  if (idx >= 0) toggleBit(idx);
                } else {
                  const id = drag.nodeId;
                  setSelected((s) => (s === id ? null : id));
                }
              }
              setDrag(null);
            }}
            onPointerLeave={() => setDrag(null)}
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
                const toH = to.type === 'out' ? to.h : to.h;
                const py = tp.y + ((w.pin + 1) * toH) / (to.operandIds.length + 1);
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
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        const g = toGraph(e.clientX, e.clientY);
                        setDrag({ kind: 'gate', nodeId: n.id, startX: g.x, startY: g.y, startClientX: e.clientX, startClientY: e.clientY, origX: p.x, origY: p.y });
                        setMoved(false);
                      }}
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
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const g = toGraph(e.clientX, e.clientY);
                      setDrag({ kind: 'gate', nodeId: n.id, startX: g.x, startY: g.y, startClientX: e.clientX, startClientY: e.clientY, origX: p.x, origY: p.y });
                      setMoved(false);
                    }}
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

        {/* legend + hint */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-6 rounded bg-emerald-500" aria-hidden />
            logic&nbsp;1 (active path)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-6 rounded bg-muted-foreground/40" aria-hidden />
            logic&nbsp;0
          </span>
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
            click inputs to toggle · click gates to inspect · drag to rearrange · wheel to zoom
          </span>
        </div>

        {/* inspect panel */}
        {selectedNode && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
              <span className="font-mono font-semibold">{selectedNode.type.toUpperCase()}</span>
              <span className="text-muted-foreground">
                {selectedNode.type === 'input'
                  ? `input variable ${selectedNode.varName}`
                  : selectedNode.type === 'out'
                    ? `segment output driver`
                    : `${selectedNode.operandIds.length}-input gate`}
              </span>
              <Badge className={cn(
                'font-mono',
                (values.get(selectedNode.id) ?? 0) === 1
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}>
                out = {values.get(selectedNode.id) ?? 0}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {GATE_INFO[selectedNode.type.toUpperCase()]?.desc ??
                (selectedNode.type === 'out'
                  ? `Drives segment ${activeSegment} for every input combination.`
                  : `Current value with input m${currentInput}.`)}
              {GATE_INFO[selectedNode.type.toUpperCase()] && (
                <span className="ml-1 font-mono">{GATE_INFO[selectedNode.type.toUpperCase()].expr}</span>
              )}
            </p>
            {selectedNode.operandIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedNode.operandIds.map((id, i) => {
                  const src = circuit.byId.get(id)!;
                  const sv = values.get(id) ?? 0;
                  return (
                    <span
                      key={id}
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                        sv === 1
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-border bg-muted/40 text-muted-foreground',
                      )}
                    >
                      in{i + 1}: {src.varName ?? src.type} = {sv}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Implemented from the simplified {form.toUpperCase()} expression:{' '}
              {terms.length === 0
                ? form === 'sop' ? 'constant 0' : 'constant 1'
                : terms.map((t, i) => (
                    <span key={i} className="mr-1 inline-flex items-center">
                      {i > 0 && <span className="mr-1 text-muted-foreground">{form === 'sop' ? '+' : '·'}</span>}
                      <TermView literals={t.literals} op={form === 'sop' ? '·' : '+'} />
                    </span>
                  ))}
            </p>
          </div>
        )}

        {/* gate reference */}
        <details className="rounded-lg border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Gate reference (AND · OR · NOT · NAND · NOR · XOR · XNOR)
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'] as GateType[]).map((t) => (
              <div key={t} className="flex flex-col items-center gap-1.5 rounded-md border bg-background/60 p-2">
                <svg viewBox="0 0 80 44" className="h-10 w-full text-foreground" role="img" aria-label={`${t.toUpperCase()} gate symbol`}>
                  {gateSymbol(t, 6, 4, 62, 36, false)}
                </svg>
                <span className="font-mono text-[10px] font-semibold">{t.toUpperCase()}</span>
                <span className="text-center font-mono text-[9px] leading-tight text-muted-foreground">
                  {GATE_INFO[t.toUpperCase()].expr}
                </span>
              </div>
            ))}
          </div>
          <Separator className="my-3" />
          <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
            {(['and', 'or', 'not', 'xor'] as GateType[]).map((t) => (
              <div key={t} className="flex items-center gap-2">
                <span className="w-10 font-mono font-semibold text-foreground/80">{t.toUpperCase()}</span>
                <span>{GATE_INFO[t.toUpperCase()].desc}</span>
              </div>
            ))}
          </div>
        </details>

        {explain && (
          <ExplainBlock title={`How the circuit implements segment ${activeSegment}`}>
            <p>
              The circuit is drawn directly from the minimized {form.toUpperCase()} expression with{' '}
              {terms.length} term{terms.length === 1 ? '' : 's'}: each{' '}
              {form === 'sop' ? 'product term becomes an AND gate' : 'sum term becomes an OR gate'}, and
              the {form === 'sop' ? 'OR' : 'AND'} gate combines them
              {engine.dontCares.length > 0 && " (don't-cares let the minimizer share gates between terms)"}. NOT
              gates generate the complemented rails.
            </p>
            <p>
              With the current input <span className="font-mono">m{currentInput}</span>, the highlighted
              green paths carry logic 1. The output driver currently reads{' '}
              <span className="font-mono">{values.get('out') ?? 0}</span> — segment {activeSegment} is{' '}
              <span className="font-mono">{values.get('out') ?? 0}</span> for this input, matching the
              truth table.
            </p>
            <p>
              Input rails are clickable (they toggle the simulator input), gates are draggable, and
              clicking a gate shows its live inputs and output. The number of levels equals the gate
              depth: rails → NOT → {form === 'sop' ? 'AND' : 'OR'} → {form === 'sop' ? 'OR' : 'AND'} → segment.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
