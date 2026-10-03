/**
 * Logic-gate circuit visualizer, generated from the (minimized OR canonical)
 * Boolean expression of the selected segment — or from all eight segments at
 * once in the full-decoder view.
 *
 * This module is the composition root + view-state owner: view mode
 * (segment / full decoder), zoom/pan/gate-drag overrides/selection (all of
 * which survive tab switches while this card stays mounted), fit-to-content,
 * fullscreen, pointer + keyboard interaction math, the input auto-sweep
 * player, the level trace (propagation step-through), live signal evaluation
 * and the circuit image exports. The SVG canvas, gate inspector and gate
 * reference live in sibling files; the pure netlist builders/evaluators live
 * in @/logic/circuitNetlist and @/logic/decoderCircuit.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircuitBoard, ZoomIn, ZoomOut, Maximize, RotateCcw, MousePointerClick,
  Play, Pause, Layers, ChevronLeft, ChevronRight, Download, Expand, Shrink,
} from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/colors';
import { ExplainBlock } from '../ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SegmentSelector } from '../shared/SegmentSelector';
import { SevenSegmentSvg } from '../SevenSegmentDisplay';
import {
  buildCircuit, evaluateCircuit, computeLevels, type CNode,
} from '@/logic/circuitNetlist';
import { buildDecoderCircuit, termGroupKey } from '@/logic/decoderCircuit';
import { mintermToTerm, maxtermToTerm } from '@/logic/expressions';
import { downloadBlob, sanitizeFilename } from '@/utils/download';
import { buildCircuitSvgBlob, buildCircuitPngBlob } from '@/utils/exporters';
import { toast } from '@/hooks/use-toast';
import {
  SEGMENT_NAMES, type ExpressionForm, type SegmentName,
  type SegmentPatternX, type Term,
} from '@/types/simulator';
import { CircuitCanvas, type NodeAccent } from './CircuitCanvas';
import { GateInspector } from './GateInspector';
import { GateReference } from './GateReference';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 2.5;
const GATE_TYPES = ['and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor'] as const;

const FORM_CHIPS: { form: ExpressionForm; label: string; title: string }[] = [
  { form: 'sop', label: 'SOP', title: 'Simplified SOP (minimized product terms)' },
  { form: 'pos', label: 'POS', title: 'Simplified POS (minimized sum terms)' },
  { form: 'csop', label: 'Σm', title: 'Canonical SOP — one full minterm per 1-row (unminimized)' },
  { form: 'cpos', label: 'ΠM', title: 'Canonical POS — one full maxterm per 0-row (unminimized)' },
];

const SWEEP_SPEEDS = [
  { ms: 500, label: '1×' },
  { ms: 250, label: '2×' },
  { ms: 1000, label: '½×' },
];

export function LogicCircuitCard() {
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const expressionForm = useSimulator((s) => s.expressionForm);
  const setExpressionForm = useSimulator((s) => s.setExpressionForm);
  const currentInput = useSimulator((s) => s.currentInput);
  const inputBits = useSimulator((s) => s.inputBits);
  const toggleBit = useSimulator((s) => s.toggleBit);
  const incrementInput = useSimulator((s) => s.incrementInput);
  const explain = useSimulator((s) => s.explainMode);
  const displaySettings = useSimulator((s) => s.displaySettings);
  const projectName = useSimulator((s) => s.projectName);
  const engines = useEngines();

  const form = expressionForm === 'pos' || expressionForm === 'cpos' ? 'pos' : 'sop';
  const isCanonical = expressionForm === 'csop' || expressionForm === 'cpos';
  const varNames = useSimulator((s) => s.variableNames);

  /* ---------------------------------------------------------------- */
  /* Terms per segment — canonical forms build REAL unminimized        */
  /* netlists (minterm/maxterm terms), so canonical vs minimized is    */
  /* visible in the gate count and layout, not just the label.         */
  /* ---------------------------------------------------------------- */
  const allTerms = useMemo(() => {
    const out = {} as Record<SegmentName, Term[]>;
    for (const seg of SEGMENT_NAMES) {
      const e = engines[seg];
      if (!isCanonical) {
        out[seg] = form === 'sop' ? e.activeSopTerms : e.activePosTerms;
      } else {
        out[seg] = form === 'sop'
          ? e.ones.map((m) => mintermToTerm(m, inputBits, varNames))
          : e.zeros.map((m) => maxtermToTerm(m, inputBits, varNames));
      }
    }
    return out;
  }, [engines, form, isCanonical, inputBits, varNames]);

  /* ---------------------- view state (local) ---------------------- */
  const [mode, setMode] = useState<'segment' | 'decoder'>('segment');
  const [expanded, setExpanded] = useState(false);
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
  const [playing, setPlaying] = useState(false);
  const [sweepIdx, setSweepIdx] = useState(0);
  const [trace, setTrace] = useState(false);
  const [revealLevel, setRevealLevel] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pos = useCallback(
    (n: CNode) => overrides[n.id] ?? { x: n.x, y: n.y },
    [overrides],
  );

  /* --------------------------- circuits --------------------------- */
  const decoder = useMemo(
    () => (mode === 'decoder' ? buildDecoderCircuit(allTerms, form, varNames) : null),
    [mode, allTerms, form, varNames],
  );
  const circuit = useMemo(
    () => (mode === 'decoder'
      ? decoder!.circuit
      : buildCircuit(allTerms[activeSegment], form, varNames)),
    [mode, decoder, allTerms, activeSegment, form, varNames],
  );

  /* live evaluation */
  const values = useMemo(
    () => evaluateCircuit(circuit, currentInput, inputBits, varNames),
    [circuit, currentInput, inputBits, varNames],
  );

  /** Propagation depth per node (inputs = 0) — powers the level trace. */
  const levels = useMemo(() => computeLevels(circuit), [circuit]);
  const maxLevel = useMemo(() => Math.max(0, ...levels.values()), [levels]);

  /**
   * Live logic levels of ALL eight segments for the current input: every
   * segment's minimized circuit ({form}) is evaluated, so the glyph shows
   * exactly what the gate network drives right now. Don't-care cells resolve
   * to the cover's actual choice — the physical truth the circuit delivers.
   */
  const liveOutputs = useMemo(() => {
    const out: SegmentPatternX = {} as SegmentPatternX;
    for (const seg of SEGMENT_NAMES) {
      const segCircuit = buildCircuit(allTerms[seg], form, varNames);
      out[seg] = evaluateCircuit(segCircuit, currentInput, inputBits, varNames).get('out') ?? 0;
    }
    return out;
  }, [allTerms, form, varNames, currentInput, inputBits]);

  /** Logic-level view of the display: user colors/brightness, but polarity
   *  forced to common-cathode — this panel shows gate outputs, not the
   *  physically-driven LED (that is the main display card's job). */
  const liveSettings = useMemo(
    () => ({ ...displaySettings, commonAnode: false as const, reverseLogic: false, showDP: true }),
    [displaySettings],
  );

  /* Selected node's logic cone: transitive fan-in + fan-out. */
  const cone = useMemo(() => {
    if (!selected || !circuit.byId.has(selected)) return null;
    const nodeIds = new Set<string>([selected]);
    const stack = [selected];
    while (stack.length) {
      const n = circuit.byId.get(stack.pop()!)!;
      for (const id of n.operandIds) {
        if (!nodeIds.has(id)) { nodeIds.add(id); stack.push(id); }
      }
    }
    const rev = new Map<string, string[]>();
    for (const n of circuit.nodes) {
      for (const id of n.operandIds) rev.set(id, [...(rev.get(id) ?? []), n.id]);
    }
    stack.push(selected);
    while (stack.length) {
      const id = stack.pop()!;
      for (const d of rev.get(id) ?? []) {
        if (!nodeIds.has(d)) { nodeIds.add(d); stack.push(d); }
      }
    }
    const wireIds = new Set(
      circuit.wires.filter((w) => nodeIds.has(w.fromId) && nodeIds.has(w.toId)).map((w) => w.id),
    );
    return { nodeIds, wireIds };
  }, [selected, circuit]);

  /**
   * K-map cover-group accents: every term gate in the (minimized) circuit
   * gets the color of its group in the K-map tab — the visible link between
   * the two views. Canonical forms have no per-term groups, so no accents.
   */
  const nodeAccents = useMemo(() => {
    const map = new Map<string, NodeAccent>();
    if (isCanonical) return map;
    for (const seg of SEGMENT_NAMES) {
      if (mode === 'segment' && seg !== activeSegment) continue;
      const groups = form === 'sop' ? engines[seg].sopGroups : engines[seg].posGroups;
      allTerms[seg].forEach((t, ti) => {
        const key = termGroupKey(t);
        const g = groups.find((gr) => termGroupKey(gr.term) === key);
        if (!g) return;
        const id = mode === 'segment' ? `term-${ti}` : `t-${seg}-${ti}`;
        map.set(id, {
          color: groupColor(g.colorIndex),
          title: `K-map group ${key.replace(/\*/g, "'")} · ${g.size} cells${g.isEssential ? ' · essential' : ''}`,
        });
      });
    }
    return map;
  }, [engines, form, isCanonical, mode, activeSegment, allTerms]);

  /* ------------------------- fit to content ----------------------- */
  const fitView = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of circuit.nodes) {
      const p = overrides[n.id] ?? { x: n.x, y: n.y };
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.w);
      maxY = Math.max(maxY, p.y + n.h);
    }
    if (!Number.isFinite(minX)) return;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    // viewBox → screen mapping (uniform meet) — must mirror toGraph()
    const vbScale = Math.min(circuit.width / rect.width, circuit.height / rect.height);
    const k = 1 / vbScale;
    const offX = (rect.width - circuit.width / vbScale) / 2;
    const offY = (rect.height - circuit.height / vbScale) / 2;
    const pad = 24;
    const z = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, Math.min((rect.width - 2 * pad) / (bw * k), (rect.height - 2 * pad) / (bh * k))),
    );
    setZoom(z);
    setPan({ x: (pad - offX) / k - minX * z, y: (pad - offY) / k - minY * z });
  }, [circuit, overrides]);

  /** Auto-fit once per (layout × canvas size); never fights the user. */
  const [lastFitKey, setLastFitKey] = useState('');
  const maybeFit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10) return;
    const key = `${mode}|${activeSegment}|${expressionForm}|${inputBits}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key === lastFitKey) return;
    setLastFitKey(key);
    fitView();
  }, [mode, activeSegment, expressionForm, inputBits, lastFitKey, fitView]);

  useEffect(() => { maybeFit(); }, [maybeFit]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => maybeFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [maybeFit]);

  /* non-passive wheel zoom */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  /* fullscreen: Esc to leave + body scroll lock */
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  /* input auto-sweep player */
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => incrementInput(), SWEEP_SPEEDS[sweepIdx].ms);
    return () => clearInterval(t);
  }, [playing, sweepIdx, incrementInput]);

  /* level trace resets on layout change */
  useEffect(() => { setRevealLevel(0); }, [mode, activeSegment, expressionForm, inputBits]);

  /* ---------------------- pointer interactions --------------------- */
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

  /** Background press → start a pan drag (only when the empty canvas was hit). */
  const onCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('circuit-bg')) {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, startClientX: e.clientX, startClientY: e.clientY, origX: pan.x, origY: pan.y });
      setMoved(false);
    }
  };

  /** Node press → start a gate drag (click without moving toggles/inspects). */
  const onNodePointerDown = (e: React.PointerEvent<SVGGElement>, node: CNode, p: { x: number; y: number }) => {
    e.stopPropagation();
    const g = toGraph(e.clientX, e.clientY);
    setDrag({ kind: 'gate', nodeId: node.id, startX: g.x, startY: g.y, startClientX: e.clientX, startClientY: e.clientY, origX: p.x, origY: p.y });
    setMoved(false);
  };

  const activateNode = useCallback((node: CNode) => {
    if (node.id.startsWith('in-')) {
      const idx = varNames.indexOf(node.id.slice(3));
      if (idx >= 0) toggleBit(idx);
    } else {
      setSelected((s) => (s === node.id ? null : node.id));
    }
  }, [varNames, toggleBit]);

  const onPointerUp = () => {
    if (drag && !moved && drag.nodeId) {
      const node = circuit.byId.get(drag.nodeId);
      if (node) activateNode(node);
    }
    setDrag(null);
  };

  /** Canvas-level keyboard: arrows pan, +/- zoom, 0 fit. */
  const onCanvasKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step = 60;
    switch (e.key) {
      case 'ArrowLeft': setPan((p) => ({ ...p, x: p.x + step })); e.preventDefault(); break;
      case 'ArrowRight': setPan((p) => ({ ...p, x: p.x - step })); e.preventDefault(); break;
      case 'ArrowUp': setPan((p) => ({ ...p, y: p.y + step })); e.preventDefault(); break;
      case 'ArrowDown': setPan((p) => ({ ...p, y: p.y - step })); e.preventDefault(); break;
      case '+': case '=': setZoom((z) => Math.min(ZOOM_MAX, z * 1.2)); e.preventDefault(); break;
      case '-': setZoom((z) => Math.max(ZOOM_MIN, z / 1.2)); e.preventDefault(); break;
      case '0': fitView(); e.preventDefault(); break;
    }
  };

  /* --------------------------- derived UI -------------------------- */
  const selectedNode = selected ? (circuit.byId.get(selected) ?? null) : null;
  const ownerSegment = selectedNode && decoder ? decoder.nodeOwner.get(selectedNode.id) : undefined;
  const gateCount = useMemo(
    () => circuit.nodes.filter((n) => (GATE_TYPES as readonly string[]).includes(n.type)).length,
    [circuit],
  );
  const formLabel = isCanonical
    ? (form === 'sop' ? 'CANONICAL Σm' : 'CANONICAL ΠM')
    : form.toUpperCase();
  const outValue = mode === 'segment'
    ? (values.get('out') ?? 0)
    : (values.get(`o-${activeSegment}`) ?? 0);
  const reveal = trace ? Math.min(revealLevel, maxLevel) : null;

  /** K-map accent info for the inspector when a term gate is selected. */
  const inspectorAccent = useMemo(() => {
    if (!selectedNode || !nodeAccents.has(selectedNode.id)) return null;
    const seg = ownerSegment ?? activeSegment;
    const groups = form === 'sop' ? engines[seg].sopGroups : engines[seg].posGroups;
    const terms = allTerms[seg];
    const idx = mode === 'segment'
      ? Number(selectedNode.id.slice('term-'.length))
      : Number(selectedNode.id.slice(selectedNode.id.indexOf('-', 2) + 1));
    const t = terms[idx];
    const g = t ? groups.find((gr) => termGroupKey(gr.term) === termGroupKey(t)) : undefined;
    if (!g) return null;
    return { color: groupColor(g.colorIndex), size: g.size, essential: g.isEssential };
  }, [selectedNode, nodeAccents, ownerSegment, activeSegment, engines, form, allTerms, mode]);

  /* --------------------------- image export ------------------------ */
  const exportCircuit = async (kind: 'svg' | 'png') => {
    const svg = svgRef.current;
    if (!svg) return;
    setExporting(kind);
    try {
      const base = `${sanitizeFilename(projectName)}-circuit-${mode === 'decoder' ? 'decoder' : activeSegment}-${expressionForm}`;
      if (kind === 'svg') {
        downloadBlob(buildCircuitSvgBlob(svg), `${base}.svg`);
        toast({ title: 'Circuit SVG exported', description: `${mode === 'decoder' ? 'Full decoder' : `Segment ${activeSegment}`} · ${formLabel}` });
      } else {
        const bgRaw = getComputedStyle(svg).backgroundColor;
        const background = bgRaw && bgRaw !== 'rgba(0, 0, 0, 0)' ? bgRaw : '#ffffff';
        downloadBlob(await buildCircuitPngBlob(svg, background), `${base}.png`);
        toast({ title: 'Circuit PNG exported', description: `${mode === 'decoder' ? 'Full decoder' : `Segment ${activeSegment}`} · ${formLabel}` });
      }
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : 'Unexpected error', variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  };

  return (
    <Card id="circuit-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <CircuitBoard className="h-4 w-4 text-muted-foreground" aria-hidden />
            LOGIC CIRCUIT
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* view mode */}
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Circuit view mode">
              <Button
                size="sm" variant={mode === 'segment' ? 'secondary' : 'ghost'}
                className="h-6 px-2 text-[11px]"
                onClick={() => { setMode('segment'); setSelected(null); }}
                aria-pressed={mode === 'segment'}
              >
                Segment
              </Button>
              <Button
                size="sm" variant={mode === 'decoder' ? 'secondary' : 'ghost'}
                className="h-6 px-2 text-[11px]"
                onClick={() => { setMode('decoder'); setSelected(null); }}
                aria-pressed={mode === 'decoder'}
              >
                Full decoder
              </Button>
            </div>
            {/* expression form */}
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Expression form">
              {FORM_CHIPS.map((f) => (
                <Button
                  key={f.form}
                  size="sm" variant={expressionForm === f.form ? 'secondary' : 'ghost'}
                  className="h-6 px-2 text-[11px] font-mono"
                  onClick={() => setExpressionForm(f.form)}
                  aria-pressed={expressionForm === f.form}
                  title={f.title}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {formLabel} · {gateCount} gates · depth {maxLevel}
            </Badge>
            {/* level trace */}
            <Button
              size="sm" variant={trace ? 'secondary' : 'outline'}
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => setTrace((t) => !t)}
              aria-pressed={trace}
              title="Level trace — reveal the circuit level by level (propagation order)"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden /> TRACE
            </Button>
            {trace && (
              <div className="flex items-center gap-0.5" role="group" aria-label="Revealed logic level">
                <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => setRevealLevel((l) => Math.max(0, l - 1))} aria-label="Hide one level">
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <span className="min-w-[62px] text-center font-mono text-[10px] text-muted-foreground" aria-live="polite">
                  level {reveal}/{maxLevel}
                </span>
                <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => setRevealLevel((l) => Math.min(maxLevel, l + 1))} aria-label="Reveal one more level">
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            )}
            {/* zoom / fit / reset / expand / export */}
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom((z) => Math.min(ZOOM_MAX, z * 1.2)); }} aria-label="Zoom in">
              <ZoomIn className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom((z) => Math.max(ZOOM_MIN, z / 1.2)); }} aria-label="Zoom out">
              <ZoomOut className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={fitView} aria-label="Fit circuit to view">
              <Maximize className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setOverrides({}); setPan({ x: 0, y: 0 }); setZoom(1); }} aria-label="Reset gate layout">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              size="sm" variant="outline" className="h-7 px-2"
              onClick={() => setExpanded((x) => !x)}
              aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen circuit view'}
              aria-pressed={expanded}
            >
              {expanded ? <Shrink className="h-3.5 w-3.5" aria-hidden /> : <Expand className="h-3.5 w-3.5" aria-hidden />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 px-2" aria-label="Export circuit image" disabled={exporting !== null}>
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportCircuit('svg')}>
                  Circuit SVG{exporting === 'svg' ? '…' : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportCircuit('png')}>
                  Circuit PNG{exporting === 'png' ? '…' : ''}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* decoder stats strip */}
        {mode === 'decoder' && decoder && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-[10px]">
              8 segments · {gateCount} gates · {circuit.wires.length} wires · depth {maxLevel}
            </Badge>
            {decoder.bands.map((b) => (
              <Badge
                key={b.seg}
                variant="outline"
                className={cn(
                  'cursor-pointer font-mono text-[10px] transition-colors hover:bg-muted/60',
                  b.seg === activeSegment && 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                )}
                onClick={() => { setSelected(null); setActiveSegment(b.seg); }}
                title={`Show segment ${b.seg}'s circuit (${b.gates} gates)`}
              >
                {b.seg} {b.gates}g
              </Badge>
            ))}
          </div>
        )}

        {/* segment selector + live output display + sweep player */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[10px] font-medium tracking-widest text-muted-foreground">
              {mode === 'segment' ? 'SEGMENT UNDER EDIT' : 'SEGMENT (BANDS ABOVE ARE CLICKABLE)'}
            </p>
            <SegmentSelector
              activeSegment={activeSegment}
              onSelect={(seg) => { setSelected(null); setActiveSegment(seg); }}
              label="Circuit segment selector"
            />
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
            <SevenSegmentSvg
              outputs={liveOutputs}
              settings={liveSettings}
              interactive
              onSegmentClick={(seg) => { setSelected(null); setActiveSegment(seg); }}
              className="h-24 w-auto"
              clickHint="click to view this segment's circuit"
              title={`Live output — logic levels every segment's ${form.toUpperCase()} circuit drives for input m${currentInput}. Click a segment to view its circuit.`}
            />
            <div className="flex flex-col items-start gap-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-widest text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                LIVE OUTPUT
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                m{currentInput} · {currentInput.toString(2).padStart(inputBits, '0')}
              </span>
              <div className="flex items-center gap-2">
                <Badge
                  className={cn(
                    'font-mono text-[11px]',
                    outValue === 1
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {activeSegment} = {outValue}
                </Badge>
                {/* input auto-sweep */}
                <Button
                  size="sm" variant={playing ? 'secondary' : 'outline'}
                  className="h-6 px-1.5"
                  onClick={() => setPlaying((p) => !p)}
                  aria-pressed={playing}
                  aria-label={playing ? 'Pause input sweep' : 'Play input sweep (cycles all input codes)'}
                  title="Auto-sweep: cycles the input so every circuit, map and row lights up in sequence"
                >
                  {playing ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-6 px-1.5 font-mono text-[10px]"
                  onClick={() => setSweepIdx((i) => (i + 1) % SWEEP_SPEEDS.length)}
                  aria-label={`Sweep speed ${SWEEP_SPEEDS[sweepIdx].label} — click to change`}
                  title="Sweep speed"
                >
                  {SWEEP_SPEEDS[sweepIdx].label}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* SVG canvas (fullscreen overlays the whole viewport) */}
        <div className={cn(expanded && 'fixed inset-3 z-50 rounded-xl border bg-background p-2 shadow-2xl')}>
          <CircuitCanvas
            svgRef={svgRef}
            circuit={circuit}
            values={values}
            pos={pos}
            selected={selected}
            activeSegment={activeSegment}
            form={form}
            zoom={zoom}
            pan={pan}
            cone={cone}
            levels={levels}
            revealLevel={reveal}
            nodeAccents={nodeAccents}
            bandLines={mode === 'decoder' && decoder
              ? decoder.bands.map((b) => ({ y: b.y, label: `SEGMENT ${b.seg}` }))
              : null}
            expanded={expanded}
            onCanvasPointerDown={onCanvasPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setDrag(null)}
            onNodePointerDown={onNodePointerDown}
            onNodeActivate={activateNode}
            onCanvasKeyDown={onCanvasKeyDown}
          />
          {expanded && (
            <div className="absolute right-4 top-4 flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-sm">
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom((z) => Math.min(ZOOM_MAX, z * 1.2)); }} aria-label="Zoom in">
                <ZoomIn className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setZoom((z) => Math.max(ZOOM_MIN, z / 1.2)); }} aria-label="Zoom out">
                <ZoomOut className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={fitView} aria-label="Fit circuit to view">
                <Maximize className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setExpanded(false)} aria-label="Exit fullscreen (Escape)">
                <Shrink className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          )}
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
            <span className="h-0.5 w-6 rounded bg-amber-500" aria-hidden />
            selected gate&apos;s path
          </span>
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
            click inputs to toggle · click gates to inspect · drag to rearrange · wheel to zoom · arrows pan · +/− zoom · 0 fit
          </span>
        </div>

        {/* inspect panel */}
        {selectedNode && (
          <GateInspector
            selectedNode={selectedNode}
            circuit={circuit}
            values={values}
            activeSegment={activeSegment}
            ownerSegment={ownerSegment}
            currentInput={currentInput}
            form={form}
            isCanonical={isCanonical}
            accent={inspectorAccent}
            terms={allTerms[ownerSegment ?? activeSegment]}
          />
        )}

        {/* gate reference */}
        <GateReference />

        {explain && (
          <ExplainBlock title={mode === 'decoder'
            ? 'The complete decoder — all eight segments at once'
            : `How the circuit implements segment ${activeSegment}`}>
            {mode === 'decoder' ? (
              <>
                <p>
                  The full-decoder view builds every segment&apos;s {isCanonical ? 'canonical' : 'minimized'}{' '}
                  {form.toUpperCase()} network at once: the input rails and NOT gates on the left are{' '}
                  <strong>shared</strong> by all eight bands, and each band holds that segment&apos;s{' '}
                  {form === 'sop' ? 'product terms (AND) and its combining OR' : 'sum terms (OR) and its combining AND'}{' '}
                  gate feeding the labeled output driver. The same input feeds all bands, so the green
                  paths you see are exactly the wires driving the glyph on the LIVE OUTPUT panel.
                </p>
                <p>
                  Click an input rail to toggle the code (every band re-evaluates instantly), click a
                  gate to inspect it, or click a band&apos;s segment chip above to open that segment alone.
                  This is the same circuit the CircuitVerse export writes into a{' '}
                  <span className="font-mono">.cv</span> file.
                </p>
              </>
            ) : (
              <>
                <p>
                  The circuit is drawn directly from the {isCanonical
                    ? <>canonical {form.toUpperCase()} expression — one full {form === 'sop' ? 'minterm per 1-row' : 'maxterm per 0-row'}, deliberately unminimized so you can compare it with the minimized form (switch the form chips in the header)</>
                    : <>minimized {form.toUpperCase()} expression with {allTerms[activeSegment].length} term{allTerms[activeSegment].length === 1 ? '' : 's'}</>}: each{' '}
                  {form === 'sop' ? 'product term becomes an AND gate' : 'sum term becomes an OR gate'}, and
                  the {form === 'sop' ? 'OR' : 'AND'} gate combines them
                  {engines[activeSegment].dontCares.length > 0 && !isCanonical && " (don't-cares let the minimizer share gates between terms)"}. NOT
                  gates generate the complemented rails.
                </p>
                <p>
                  With the current input <span className="font-mono">m{currentInput}</span>, the highlighted
                  green paths carry logic 1. The output driver currently reads{' '}
                  <span className="font-mono">{outValue}</span> — segment {activeSegment} is{' '}
                  <span className="font-mono">{outValue}</span> for this input, matching the
                  truth table.
                </p>
              </>
            )}
            <p>
              Input rails are clickable (they toggle the simulator input; they also respond to Enter when
              focused), gates are draggable, and clicking a gate shows its live inputs and output together
              with its <strong>amber path</strong> back to the rails. Term gates carry a colored ring —
              the same color as their group in the K-map tab. The LIVE OUTPUT panel shows all eight segments
              driven simultaneously; its play button auto-sweeps the input, and TRACE reveals the circuit
              level by level (rails → NOT → {form === 'sop' ? 'AND → OR' : 'OR → AND'} → segment).
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
