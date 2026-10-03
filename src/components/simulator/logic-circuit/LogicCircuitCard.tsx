/**
 * Logic-gate circuit visualizer, generated from the minimized Boolean
 * expression of the selected segment.
 *
 * This module is the composition root + view-state owner: zoom/pan/gate-drag
 * overrides/selection (all of which survive tab switches while this card stays
 * mounted), pointer math (screen → graph coordinates), and the live signal
 * evaluation. The SVG canvas, gate inspector and gate reference live in
 * sibling files; the pure netlist builder/evaluator lives in
 * @/logic/circuitNetlist.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircuitBoard, ZoomIn, ZoomOut, Maximize, RotateCcw, MousePointerClick } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { cn } from '@/lib/utils';
import { ExplainBlock } from '../ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentSelector } from '../shared/SegmentSelector';
import { SevenSegmentSvg } from '../SevenSegmentDisplay';
import { buildCircuit, evaluateCircuit, type CNode } from '@/logic/circuitNetlist';
import { SEGMENT_NAMES, type SegmentPatternX } from '@/types/simulator';
import { CircuitCanvas } from './CircuitCanvas';
import { GateInspector } from './GateInspector';
import { GateReference } from './GateReference';

export function LogicCircuitCard() {
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const expressionForm = useSimulator((s) => s.expressionForm);
  const currentInput = useSimulator((s) => s.currentInput);
  const inputBits = useSimulator((s) => s.inputBits);
  const toggleBit = useSimulator((s) => s.toggleBit);
  const explain = useSimulator((s) => s.explainMode);
  const displaySettings = useSimulator((s) => s.displaySettings);
  const engines = useEngines();

  const form = expressionForm === 'pos' || expressionForm === 'cpos' ? 'pos' : 'sop';
  const engine = engines[activeSegment];
  const terms = form === 'sop' ? engine.activeSopTerms : engine.activePosTerms;
  const varNames = useSimulator((s) => s.variableNames);

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
  const values = useMemo(
    () => evaluateCircuit(circuit, currentInput, inputBits, varNames),
    [circuit, currentInput, inputBits, varNames],
  );

  /**
   * Live logic levels of ALL eight segments for the current input: every
   * segment's minimized circuit ({form}) is evaluated, so the glyph shows
   * exactly what the gate network drives right now. Don't-care cells resolve
   * to the cover's actual choice — the physical truth the circuit delivers.
   */
  const liveOutputs = useMemo(() => {
    const out: SegmentPatternX = {} as SegmentPatternX;
    for (const seg of SEGMENT_NAMES) {
      const e = engines[seg];
      const segTerms = form === 'sop' ? e.activeSopTerms : e.activePosTerms;
      const segCircuit = buildCircuit(segTerms, form, varNames);
      out[seg] = evaluateCircuit(segCircuit, currentInput, inputBits, varNames).get('out') ?? 0;
    }
    return out;
  }, [engines, form, varNames, currentInput, inputBits]);

  /** Logic-level view of the display: user colors/brightness, but polarity
   *  forced to common-cathode — this panel shows gate outputs, not the
   *  physically-driven LED (that is the main display card's job). */
  const liveSettings = useMemo(
    () => ({ ...displaySettings, commonAnode: false as const, reverseLogic: false, showDP: true }),
    [displaySettings],
  );

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

  const onPointerUp = () => {
    if (drag && !moved && drag.nodeId) {
      if (drag.nodeId.startsWith('in-')) {
        const idx = varNames.indexOf(drag.nodeId.slice(3));
        if (idx >= 0) toggleBit(idx);
      } else {
        const id = drag.nodeId;
        setSelected((s) => (s === id ? null : id));
      }
    }
    setDrag(null);
  };

  const selectedNode = selected ? circuit.byId.get(selected) : null;
  const gateCount = circuit.nodes.filter((n) => ['and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor'].includes(n.type)).length;

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
        {/* segment selector + live output display */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[10px] font-medium tracking-widest text-muted-foreground">
              SEGMENT UNDER EDIT
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
              <Badge
                className={cn(
                  'font-mono text-[11px]',
                  (values.get('out') ?? 0) === 1
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {activeSegment} = {values.get('out') ?? 0}
              </Badge>
            </div>
          </div>
        </div>

        {/* SVG canvas */}
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
          onCanvasPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setDrag(null)}
          onNodePointerDown={onNodePointerDown}
        />

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
          <GateInspector
            selectedNode={selectedNode}
            circuit={circuit}
            values={values}
            activeSegment={activeSegment}
            currentInput={currentInput}
            form={form}
            terms={terms}
          />
        )}

        {/* gate reference */}
        <GateReference />

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
              clicking a gate shows its live inputs and output. The LIVE OUTPUT panel (top right)
              shows all eight segments driven simultaneously for the current input — click any
              segment on it to jump to that segment&apos;s circuit. The number of levels equals the
              gate depth: rails → NOT → {form === 'sop' ? 'AND' : 'OR'} → {form === 'sop' ? 'OR' : 'AND'} → segment.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
