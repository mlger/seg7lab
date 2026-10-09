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
 * and the circuit image exports. The SVG canvas, gate inspector, gate
 * reference and the shared toolbar chrome (zoom / trace / band-stepper /
 * LIVE OUTPUT panel) live in sibling files; the pure netlist builders/
 * evaluators live in @/logic/circuitNetlist and @/logic/decoderCircuit.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircuitBoard, RotateCcw, MousePointerClick, Download, Expand, Shrink,
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
import {
  buildCircuit, evaluateCircuit, computeLevels, buildFactoredCircuit,
  type Circuit, type CNode, type GateStyle,
} from '@/logic/circuitNetlist';
import { getViewportTransform } from '@/utils/svg-viewport';
import { factorCover } from '@/logic/factoring';
import { buildFactoredDecoderCircuit } from '@/logic/factoredDecoderCircuit';
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
import {
  BandStepButtons, LiveOutputPanel, SWEEP_SPEEDS, TraceControls, ZoomButtons,
} from './controls';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
/** Band jumps fit the band but never zoom in past this — small bands stay readable. */
const BAND_JUMP_MAX_ZOOM = 1.6;
const GATE_TYPES = ['and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor'] as const;

const FORM_CHIPS: { form: ExpressionForm; label: string; title: string }[] = [
  { form: 'sop', label: 'SOP', title: 'Simplified SOP (minimized product terms)' },
  { form: 'pos', label: 'POS', title: 'Simplified POS (minimized sum terms)' },
  { form: 'csop', label: 'Σm', title: 'Canonical SOP — one full minterm per 1-row (unminimized)' },
  { form: 'cpos', label: 'ΠM', title: 'Canonical POS — one full maxterm per 0-row (unminimized)' },
];

/** Implementation style chips: basic AND/OR, or the De Morgan dual network
 *  (SOP → NAND-NAND, POS → NOR-NOR — real 74-series decoders are NAND-based,
 *  and universal-gate conversion is a classic lab exercise). */
const STYLE_CHIPS: { style: GateStyle; label: string; title: string; unavailable: string }[] = [
  {
    style: 'basic',
    label: 'AND/OR',
    unavailable: '',
    title: 'Standard implementation — AND terms combined by OR (SOP), or OR terms combined by AND (POS)',
  },
  {
    style: 'universal',
    label: 'Universal',
    unavailable: 'Universal gates apply to the minimized SOP/POS forms — Σm / ΠM have no shared cover to convert.',
    title: 'De Morgan dual — SOP built from NAND gates only (NAND-NAND), POS from NOR gates only (NOR-NOR)',
  },
  {
    style: 'factored',
    label: 'Layered',
    unavailable: 'Layering applies to the minimized SOP and POS covers — the canonical Σm / ΠM forms are deliberately unminimized, so there is nothing to share.',
    title: 'Layered — arrange the same gates in LAYERS: shared sub-expressions are built once and feed every gate that needs them.',
  },
];

export function LogicCircuitCard() {
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const expressionForm = useSimulator((s) => s.expressionForm);
  const setExpressionForm = useSimulator((s) => s.setExpressionForm);
  // Gate style lives in the store (session state, like expressionForm) so the
  // Falstad export can follow the circuit the user is looking at.
  const styleChoice = useSimulator((s) => s.circuitStyle);
  const setStyleChoice = useSimulator((s) => s.setCircuitStyle);
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

  /**
   * Multi-level factoring works for the minimized SOP and POS covers. Canonical
   * Σm/ΠM are deliberately unminimized — factoring them is meaningless — so the
   * style falls back to basic AND/OR there rather than pretending otherwise.
   */
  const factoredAvailable = !isCanonical;
  const gateStyle: GateStyle =
    styleChoice === 'factored' && !factoredAvailable ? 'basic' : styleChoice;
  const [zoom, setZoom] = useState(1);
  /** Hot-path mirror of zoom so the wheel handler stays subscription-stable. */
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
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
  /** Canvas pixel size (ResizeObserver-fed) — drives the viewport-center indicator. */
  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });
  /** Measured panel width, used to derive an aspect-matched canvas height. */
  const [panelW, setPanelW] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const pos = useCallback(
    (n: CNode) => overrides[n.id] ?? { x: n.x, y: n.y },
    [overrides],
  );

  /* --------------------------- circuits --------------------------- */
  const decoder = useMemo(
    () => (mode === 'decoder'
      ? gateStyle === 'factored'
        ? null // multi-level decoder built separately below
        : buildDecoderCircuit(allTerms, form, varNames, gateStyle)
      : null),
    [mode, allTerms, form, varNames, gateStyle],
  );

  /** Multi-level decoder (all eight segments in one shared factor context). */
  const multiDecoder = useMemo(
    () => (mode === 'decoder' && gateStyle === 'factored'
      ? buildFactoredDecoderCircuit(allTerms, varNames)
      : null),
    [mode, gateStyle, allTerms, varNames],
  );

  /**
   * Band/ownership view of whichever decoder builder is active. Both builders
   * expose `bands` and `nodeOwner`, so the stepper, chips, band labels and the
   * inspector work identically for two-level and multi-level.
   */
  const decoderView = multiDecoder ?? decoder;

  const circuit = useMemo(
    () => (mode === 'decoder'
      ? (multiDecoder ? multiDecoder.circuit : decoder!.circuit)
      : gateStyle === 'factored'
        // Multi-level: variable stage count, so it uses the layered layout.
        // Works for both forms (POS is factored by De Morgan duality).
        ? buildFactoredCircuit(allTerms[activeSegment], varNames, form)
        : buildCircuit(allTerms[activeSegment], form, varNames, gateStyle)),
    [mode, decoder, multiDecoder, allTerms, activeSegment, form, varNames, gateStyle],
  );

  /**
   * Two-level vs multi-level comparison for the badge, in factored mode only.
   *
   * Both sides are measured the SAME way (gate count and canvas layers from the
   * actual built circuits). Previously the badge mixed two different metrics —
   * canvas layers here and the factorer's literal-graph depth there — so the
   * same circuit appeared to be both "depth 4" and "depth 2", which is exactly
   * what read as confusing.
   */
  const tradeoff = useMemo(() => {
    if (gateStyle !== 'factored') return null;
    const GATES = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'];
    const flat = buildCircuit(allTerms[activeSegment], form, varNames, 'basic');
    const flatLevels = computeLevels(flat);
    const flatGates = flat.nodes.filter((n) => GATES.includes(n.type)).length;
    const multiGates = circuit.nodes.filter((n) => GATES.includes(n.type)).length;
    // Derive the multi-level layer count here rather than reading maxLevel, which
    // is computed further down this component.
    const multiLayers = Math.max(1, Math.max(0, ...computeLevels(circuit).values()) + 1);
    return {
      flatGates,
      flatLayers: Math.max(1, Math.max(0, ...flatLevels.values()) + 1),
      multiGates,
      multiLayers,
      // The factorer's own narrower metric, kept for the literal saving claim.
      literals: factorCover(allTerms[activeSegment], form).stats,
    };
  }, [gateStyle, allTerms, activeSegment, form, varNames, circuit]);

  /* live evaluation */
  const values = useMemo(
    () => evaluateCircuit(circuit, currentInput, inputBits, varNames),
    [circuit, currentInput, inputBits, varNames],
  );

  /**
   * Panel height chosen so the canvas BOX aspect equals the viewBox aspect.
   * With preserveAspectRatio="meet" an aspect mismatch letterboxes the drawing
   * into a fraction of the box — which is what made the circuit look small.
   * Matching the aspect makes zoom 100% mean "fills the panel".
   */
  const canvasHeight = useMemo(() => {
    if (panelW < 10) return 0; // not measured yet — canvas falls back to CSS height
    const wanted = (panelW * circuit.height) / circuit.width;
    const viewportCap = typeof window !== 'undefined' ? window.innerHeight * 0.72 : 560;
    return Math.round(Math.max(240, Math.min(wanted, viewportCap)));
  }, [panelW, circuit.width, circuit.height]);

  /** Propagation depth per node (inputs = 0) — powers the level trace. */
  const levels = useMemo(() => computeLevels(circuit), [circuit]);
  const maxLevel = useMemo(() => Math.max(0, ...levels.values()), [levels]);

  /**
  * Per-segment circuits for the LIVE OUTPUT panel, built ONCE per (terms,
  * form, style) — never rebuilt when only the input code changes. (This used
  * to live inside the liveOutputs memo and rebuilt all eight netlists on
  * every sweep tick.)
  */
  const liveCircuits = useMemo(() => {
    const out = {} as Record<SegmentName, Circuit>;
    for (const seg of SEGMENT_NAMES) {
      out[seg] = buildCircuit(allTerms[seg], form, varNames, gateStyle);
    }
    return out;
  }, [allTerms, form, varNames, gateStyle]);

  /**
   * Live logic levels of ALL eight segments for the current input: every
   * segment's minimized circuit ({form}) is evaluated, so the glyph shows
   * exactly what the gate network drives right now. Don't-care cells resolve
   * to the cover's actual choice — the physical truth the circuit delivers.
   */
  const liveOutputs = useMemo(() => {
    const out: SegmentPatternX = {} as SegmentPatternX;
    for (const seg of SEGMENT_NAMES) {
      out[seg] = evaluateCircuit(liveCircuits[seg], currentInput, inputBits, varNames).get('out') ?? 0;
    }
    return out;
  }, [liveCircuits, currentInput, inputBits, varNames]);

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

  /* ------------------------- fit & zoom anchors -------------------- */
  /**
   * Fit an arbitrary graph-space rect into the viewport. `center: false`
   * (fit-to-content behavior) pins the rect's top-left at the padding; the
   * default centers it — right for band jumps and clamped zooms.
   */
  const fitRect = useCallback(
    (minX: number, minY: number, maxX: number, maxY: number, opts?: { maxZoom?: number; center?: boolean }) => {
      const el = svgRef.current;
      const t = el ? getViewportTransform(el, circuit) : null;
      if (!el || !t) return;
      if (!(maxX > minX) || !(maxY > minY)) return;
      const bw = maxX - minX;
      const bh = maxY - minY;
      const k = t.k; // CSS px per viewBox unit — pan/zoom live in viewBox units
      const rect = el.getBoundingClientRect();
      // Proportional breathing room: small circuits don't get lost in a big pad,
      // large ones aren't clipped by a fixed one.
      const pad = Math.max(16, Math.min(40, 0.04 * Math.max(bw * k, bh * k)));
      const z = Math.min(
        opts?.maxZoom ?? ZOOM_MAX,
        Math.max(ZOOM_MIN, Math.min((rect.width - 2 * pad) / (bw * k), (rect.height - 2 * pad) / (bh * k))),
      );
      setZoom(z);
      if (opts?.center === false) {
        setPan({ x: (pad - t.offX) / k - minX * z, y: (pad - t.offY) / k - minY * z });
      } else {
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        setPan({ x: (rect.width / 2 - t.offX) / k - cx * z, y: (rect.height / 2 - t.offY) / k - cy * z });
      }
    },
    [circuit],
  );

  const fitView = useCallback(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of circuit.nodes) {
      const p = overrides[n.id] ?? { x: n.x, y: n.y };
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.w);
      maxY = Math.max(maxY, p.y + n.h);
    }
    if (!Number.isFinite(minX)) return;
    // Centred: content sits in the middle of the panel instead of pinned to
    // the top-left corner with dead space around it.
    fitRect(minX, minY, maxX, maxY, { center: true });
  }, [circuit, overrides, fitRect]);

  /** Zoom to z2 keeping the graph point under (clientX, clientY) fixed. */
  const zoomAt = useCallback((clientX: number, clientY: number, z2: number) => {
    const el = svgRef.current;
    const t = el ? getViewportTransform(el, circuit) : null;
    if (!el || !t) return;
    const z1 = zoomRef.current;
    if (z2 === z1) return;
    const v = t.toViewBox(clientX, clientY);
    setPan((p) => ({ x: v.x - ((v.x - p.x) / z1) * z2, y: v.y - ((v.y - p.y) / z1) * z2 }));
    setZoom(z2);
    zoomRef.current = z2;
  }, [circuit]);

  /** Zoom to an absolute level, anchored at the viewport center. */
  const zoomTo = useCallback((target: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const z2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, z2);
  }, [zoomAt]);

  /** Button/keyboard zoom — anchored at the viewport center. */
  const zoomStep = useCallback((dir: 1 | -1) => {
    zoomTo(zoomRef.current * (dir > 0 ? 1.25 : 1 / 1.25));
  }, [zoomTo]);

  /** Auto-fit once per (layout × canvas size); never fights the user. */
  const [lastFitKey, setLastFitKey] = useState('');
  const maybeFit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10) return;
    // In decoder mode the circuit is invariant to activeSegment — segment
    // switches must NOT refit (the chips jump the viewport themselves).
    const segKey = mode === 'segment' ? activeSegment : '';
    const key = `${mode}|${segKey}|${expressionForm}|${inputBits}|${gateStyle}|${expanded}|${canvasHeight}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key === lastFitKey) return;
    setLastFitKey(key);
    fitView();
  }, [mode, activeSegment, expressionForm, inputBits, gateStyle, expanded, canvasHeight, lastFitKey, fitView]);

  useEffect(() => { maybeFit(); }, [maybeFit]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setCanvasDims((d) => (d.w === w && d.h === h ? d : { w, h }));
      // Panel width drives the aspect-matched canvas height. Guarded so the
      // height change this causes cannot re-trigger an update loop.
      setPanelW((prev) => (prev === w ? prev : w));
      maybeFit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [maybeFit]);

  /* non-passive wheel zoom — anchored at the cursor */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const z1 = zoomRef.current;
      const z2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z1 * factor));
      if (z2 === z1) return;
      const t = getViewportTransform(el, circuit);
      if (!t) return;
      const v = t.toViewBox(e.clientX, e.clientY);
      setPan((p) => ({ x: v.x - ((v.x - p.x) / z1) * z2, y: v.y - ((v.y - p.y) / z1) * z2 }));
      setZoom(z2);
      zoomRef.current = z2;
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [circuit]);

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
  useEffect(() => { setRevealLevel(0); }, [mode, activeSegment, expressionForm, inputBits, gateStyle]);

  /* bring the inspector into view when a gate gets selected (never in fullscreen) */
  useEffect(() => {
    if (!selected || expanded || !inspectorRef.current) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    inspectorRef.current.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }, [selected, expanded]);

  /* ---------------------- decoder band navigation ------------------ */
  /** Jump the viewport to a segment's band: fit its bounds, zoom capped so
   *  small bands stay readable. Shared by chips, stepper, canvas labels and
   *  the keyboard band keys. */
  const jumpToBand = useCallback((seg: SegmentName) => {
    if (!decoderView) return;
    const b = decoderView.bands.find((x) => x.seg === seg);
    if (!b) return;
    fitRect(0, b.y - 26, circuit.width, b.y + b.height + 4, { maxZoom: BAND_JUMP_MAX_ZOOM });
  }, [decoderView, circuit, fitRect]);

  /** Unified segment selection: chip / selector / LIVE OUTPUT / keyboard —
   *  highlights everywhere and, in decoder mode, jumps to the band. */
  const selectSegment = useCallback((seg: SegmentName) => {
    setSelected(null);
    setActiveSegment(seg);
    if (mode === 'decoder') jumpToBand(seg);
  }, [mode, setActiveSegment, jumpToBand]);

  /** Band under the viewport center (wayfinding indicator) — -1 when off-canvas. */
  const centerBandIdx = useMemo(() => {
    if (mode !== 'decoder' || !decoderView || canvasDims.w < 10 || canvasDims.h < 10) return -1;
    const vs = Math.min(circuit.width / canvasDims.w, circuit.height / canvasDims.h);
    const offY = (canvasDims.h - circuit.height / vs) / 2;
    const vy = (canvasDims.h / 2 - offY) * vs;
    const gy = (vy - pan.y) / zoom;
    return decoderView.bands.findIndex((b) => gy >= b.y - 26 && gy < b.y + b.height + 4);
  }, [mode, decoderView, circuit, canvasDims, pan, zoom]);

  /** Step to the previous/next band from the one in view. */
  const stepBand = useCallback((dir: 1 | -1) => {
    if (!decoderView) return;
    const from = centerBandIdx >= 0
      ? centerBandIdx
      : decoderView.bands.findIndex((b) => b.seg === activeSegment);
    const next = Math.min(decoderView.bands.length - 1, Math.max(0, from + dir));
    selectSegment(decoderView.bands[next].seg);
  }, [decoderView, centerBandIdx, activeSegment, selectSegment]);

  /* ---------------------- pointer interactions --------------------- */
  /** Screen → graph coordinates. Stable while the circuit, pan and zoom hold,
   *  which keeps the memoized canvas nodes from re-rendering on value ticks. */
  const toGraph = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    const t = el ? getViewportTransform(el, circuit) : null;
    if (!t) return { x: 0, y: 0 };
    const v = t.toViewBox(clientX, clientY);
    return { x: (v.x - pan.x) / zoom, y: (v.y - pan.y) / zoom };
  }, [circuit, pan.x, pan.y, zoom]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
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
  }, [drag, toGraph]);

  /** Background press → start a pan drag (only when the empty canvas was hit).
   *  Pointer capture keeps the drag alive even if the cursor leaves the SVG. */
  const onCanvasPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).tagName === 'svg' || (e.target as Element).classList.contains('circuit-bg')) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* released already */ }
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, startClientX: e.clientX, startClientY: e.clientY, origX: pan.x, origY: pan.y });
      setMoved(false);
    }
  }, [pan.x, pan.y]);

  /** Node press → start a gate drag (click without moving toggles/inspects).
   *  Pointer capture keeps dragging a gate outside the canvas working. */
  const onNodePointerDown = useCallback((e: React.PointerEvent<SVGGElement>, node: CNode, p: { x: number; y: number }) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* released already */ }
    const g = toGraph(e.clientX, e.clientY);
    setDrag({ kind: 'gate', nodeId: node.id, startX: g.x, startY: g.y, startClientX: e.clientX, startClientY: e.clientY, origX: p.x, origY: p.y });
    setMoved(false);
  }, [toGraph]);

  const activateNode = useCallback((node: CNode) => {
    if (node.id.startsWith('in-')) {
      const idx = varNames.indexOf(node.id.slice(3));
      if (idx >= 0) toggleBit(idx);
    } else {
      setSelected((s) => (s === node.id ? null : node.id));
    }
  }, [varNames, toggleBit]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (drag && !moved && drag.nodeId) {
      const node = circuit.byId.get(drag.nodeId);
      if (node) activateNode(node);
    }
    setDrag(null);
  }, [drag, moved, circuit, activateNode]);

  /** Canvas-level keyboard: arrows pan, +/- zoom, 0 fit; decoder mode also
   *  PageUp/PageDown + Home/End + 1-8 band jumps. */
  const onCanvasKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step = 60;
    switch (e.key) {
      case 'ArrowLeft': setPan((p) => ({ ...p, x: p.x + step })); e.preventDefault(); break;
      case 'ArrowRight': setPan((p) => ({ ...p, x: p.x - step })); e.preventDefault(); break;
      case 'ArrowUp': setPan((p) => ({ ...p, y: p.y + step })); e.preventDefault(); break;
      case 'ArrowDown': setPan((p) => ({ ...p, y: p.y - step })); e.preventDefault(); break;
      case '+': case '=': zoomStep(1); e.preventDefault(); break;
      case '-': zoomStep(-1); e.preventDefault(); break;
      case '0': fitView(); e.preventDefault(); break;
      case 'PageUp': case 'PageDown':
        if (mode === 'decoder') {
          stepBand(e.key === 'PageUp' ? -1 : 1);
          e.preventDefault();
        }
        break;
      case 'Home': case 'End':
        if (mode === 'decoder' && decoderView) {
          selectSegment(decoderView.bands[e.key === 'Home' ? 0 : decoderView.bands.length - 1].seg);
          e.preventDefault();
        }
        break;
      default:
        if (mode === 'decoder' && decoderView && e.key >= '1' && e.key <= '8') {
          selectSegment(decoderView.bands[Number(e.key) - 1].seg);
          e.preventDefault();
        }
    }
  };

  /* --------------------------- derived UI -------------------------- */
  const selectedNode = selected ? (circuit.byId.get(selected) ?? null) : null;
  const ownerSegment = selectedNode && decoderView ? decoderView.nodeOwner.get(selectedNode.id) : undefined;
  const gateCount = useMemo(
    () => circuit.nodes.filter((n) => (GATE_TYPES as readonly string[]).includes(n.type)).length,
    [circuit],
  );
  const formLabel = isCanonical
    ? (form === 'sop' ? 'CANONICAL Σm' : 'CANONICAL ΠM')
    : form.toUpperCase();

  /**
   * Logic-layer guides (multi-level only): one vertical rule per layer, so the
   * network reads as stacked gate layers rather than one flat sheet.
   */
  const layerLines = useMemo(() => {
    if (gateStyle !== 'factored') return null;
    const byLayer = new Map<number, number>();
    for (const n of circuit.nodes) {
      const l = n.layer ?? 0;
      // The leftmost x in a layer is that layer's column.
      if (!byLayer.has(l) || n.x < byLayer.get(l)!) byLayer.set(l, n.x);
    }
    return [...byLayer.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([l, x]) => ({ x, label: l === 0 ? 'INPUTS' : `LAYER ${l}` }));
  }, [gateStyle, circuit]);

  /** Badge suffix naming the implementation style when it isn't basic AND/OR. */
  const styleLabel = gateStyle === 'universal'
    ? (form === 'sop' ? ' · NAND-NAND' : ' · NOR-NOR')
    : gateStyle === 'factored' ? ' · MULTI-LEVEL' : '';
  /**
   * Side-by-side readout on ONE metric so the two columns can be compared: gates
   * and LAYERS, both measured from the actual built circuits. The verdict is
   * stated plainly (saves / costs / identical) because layering usually COSTS a
   * layer for the same gate count, and a badge that implied a win would be
   * misleading.
   */
  const tradeoffNote = !tradeoff
    ? ''
    : tradeoff.flatGates === tradeoff.multiGates && tradeoff.flatLayers === tradeoff.multiLayers
      ? ' — identical to two-level here (nothing in this cover is worth factoring)'
      : ` — two-level: ${tradeoff.flatGates} gates / ${tradeoff.flatLayers} layers · `
        + `layered: ${tradeoff.multiGates} gates / ${tradeoff.multiLayers} layers`
        + (tradeoff.multiGates < tradeoff.flatGates
          ? ' (saves a gate)'
          : tradeoff.multiGates > tradeoff.flatGates
            ? ' (costs a gate)'
            : ' (same gates, one stage deeper)');
  const outValue = mode === 'segment'
    ? (values.get('out') ?? 0)
    : (values.get(`o-${activeSegment}`) ?? 0);
  const reveal = trace ? Math.min(revealLevel, maxLevel) : null;

  /**
   * TRACE layer stepper, dispatched through the single (dir) callback the
   * shared TraceControls component calls — with the same Math.max/Math.min
   * clamps the two inline steppers used before the extraction.
   */
  const stepReveal = useCallback((delta: 1 | -1) => {
    if (delta === -1) setRevealLevel((l) => Math.max(0, l - 1));
    else setRevealLevel((l) => Math.min(maxLevel, l + 1));
  }, [maxLevel]);

  /* stepper bounds (decoder mode) — from the band in view, or the active chip */
  const stepFrom = decoderView && mode === 'decoder'
    ? (centerBandIdx >= 0 ? centerBandIdx : decoderView.bands.findIndex((b) => b.seg === activeSegment))
    : -1;
  const atFirst = stepFrom <= 0;
  const atLast = !decoderView || stepFrom >= decoderView.bands.length - 1;

  /** K-map accent info for the inspector when a term gate is selected. */
  const inspectorAccent = useMemo(() => {
    if (!selectedNode || !nodeAccents.has(selectedNode.id)) return null;
    const seg = ownerSegment ?? activeSegment;
    const groups = form === 'sop' ? engines[seg].sopGroups : engines[seg].posGroups;
    const terms = allTerms[seg];
    // termIndex is authored by the netlist builders — never parse node ids.
    const idx = selectedNode.termIndex;
    if (idx === undefined) return null;
    const t = terms[idx];
    const g = t ? groups.find((gr) => termGroupKey(gr.term) === termGroupKey(t)) : undefined;
    if (!g) return null;
    return { color: groupColor(g.colorIndex), size: g.size, essential: g.isEssential };
  }, [selectedNode, nodeAccents, ownerSegment, activeSegment, engines, form, allTerms]);

  /* --------------------------- image export ------------------------ */
  const exportCircuit = async (kind: 'svg' | 'png') => {
    const svg = svgRef.current;
    if (!svg) return;
    setExporting(kind);
    try {
      const base = `${sanitizeFilename(projectName)}-circuit-${mode === 'decoder' ? 'decoder' : activeSegment}-${expressionForm}${gateStyle === 'basic' ? '' : '-universal'}`;
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
            {/* gate implementation style (De Morgan universal gates) */}
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Gate implementation style">
              {STYLE_CHIPS.map((s) => {
                const disabled = s.style === 'factored' ? !factoredAvailable : isCanonical;
                return (
                  <Button
                    key={s.style}
                    size="sm" variant={styleChoice === s.style ? 'secondary' : 'ghost'}
                    className="h-6 px-2 text-[11px] font-mono"
                    disabled={disabled}
                    onClick={() => { setStyleChoice(s.style); setSelected(null); }}
                    aria-pressed={styleChoice === s.style}
                    title={disabled ? s.unavailable : s.title}
                  >
                    {s.label}
                  </Button>
                );
              })}
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {formLabel}{styleLabel} · {gateCount} gates · {maxLevel + 1} layers{tradeoffNote}
            </Badge>
            <TraceControls
              trace={trace}
              onToggleTrace={() => setTrace((t) => !t)}
              reveal={reveal}
              maxLevel={maxLevel}
              onStepReveal={stepReveal}
            />
            {/* zoom / fit / reset / expand / export */}
            <ZoomButtons
              zoom={zoom}
              onZoomStep={zoomStep}
              onFit={fitView}
              onZoomPreset={zoomTo}
            />
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
        {/* decoder stats strip + band rail (click a chip to jump, double-click to open one) */}
        {mode === 'decoder' && decoderView && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* band stepper — sequential tour of the decoder */}
            <div className="flex items-center gap-0.5" role="group" aria-label="Step between segment bands">
              <BandStepButtons
                atFirst={atFirst}
                atLast={atLast}
                onStep={stepBand}
                withTitles
              />
            </div>
            <Badge variant="secondary" className="font-mono text-[10px]">
              8 segments · {gateCount} gates · {circuit.wires.length} wires · {maxLevel + 1} layers
              {multiDecoder
                ? ` · ${multiDecoder.crossSegmentSignals.length} shared across segments`
                : ''}
            </Badge>            {decoderView.bands.map((b, i) => {
              const inView = i === centerBandIdx;
              return (
                <button
                  key={b.seg}
                  type="button"
                  onClick={() => selectSegment(b.seg)}
                  onDoubleClick={() => { setMode('segment'); setSelected(null); }}
                  title={`Segment ${b.seg} · ${b.gates} gates — click to jump the viewport here, double-click to open this segment alone`}
                  aria-label={`Jump to segment ${b.seg} band, ${b.gates} gates. Double-click to open segment ${b.seg} alone.`}
                  aria-current={inView ? 'location' : undefined}
                  className={cn(
                    'inline-flex h-[23px] items-center gap-1 rounded-full border px-2.5 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    b.seg === activeSegment
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40',
                    inView && 'ring-2 ring-amber-500/60',
                  )}
                >
                  {b.seg} {b.gates}g
                  {inView && <span className="h-1 w-1 rounded-full bg-amber-500" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}

        {/* segment selector + live output display + sweep player */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-[10px] font-medium tracking-widest text-muted-foreground">
              {mode === 'segment'
                ? 'SEGMENT UNDER EDIT'
                : 'SEGMENT (CLICK JUMPS TO THAT BAND · DOUBLE-CLICK A CHIP OPENS IT ALONE)'}
            </p>
            <SegmentSelector
              activeSegment={activeSegment}
              onSelect={selectSegment}
              label="Circuit segment selector"
            />
          </div>
          <LiveOutputPanel
            liveOutputs={liveOutputs}
            liveSettings={liveSettings}
            onSegmentClick={selectSegment}
            form={form}
            mode={mode}
            currentInput={currentInput}
            inputBits={inputBits}
            outValue={outValue}
            activeSegment={activeSegment}
            playing={playing}
            onTogglePlaying={() => setPlaying((p) => !p)}
            sweepIdx={sweepIdx}
            onCycleSweepSpeed={() => setSweepIdx((i) => (i + 1) % SWEEP_SPEEDS.length)}
          />
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
            expanded={expanded}
            canvasHeight={canvasHeight}
            cone={cone}
            levels={levels}
            revealLevel={reveal}
            nodeAccents={nodeAccents}
            bandLines={mode === 'decoder' && decoderView 
              ? decoderView.bands.map((b) => ({ y: b.y, label: `SEGMENT ${b.seg}`, seg: b.seg }))
              : null}
            layerLines={layerLines}
            decoderMode={mode === 'decoder'}
            onBandJump={mode === 'decoder' ? selectSegment : undefined}
            onCanvasPointerDown={onCanvasPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onNodePointerDown={onNodePointerDown}
            onNodeActivate={activateNode}
            onCanvasKeyDown={onCanvasKeyDown}
          />
          {expanded && (
            <div className="absolute right-4 top-4 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-end gap-1 rounded-lg border bg-background/95 p-1 shadow-sm">
              {mode === 'decoder' && decoderView && (
                <>
                  <BandStepButtons
                    atFirst={atFirst}
                    atLast={atLast}
                    onStep={stepBand}
                  >
                    <span className="min-w-[26px] text-center font-mono text-[10px] text-muted-foreground" aria-live="polite">
                      {centerBandIdx >= 0 ? decoderView.bands[centerBandIdx].seg : '—'}
                    </span>
                  </BandStepButtons>
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                </>
              )}
              <ZoomButtons
                zoom={zoom}
                onZoomStep={zoomStep}
                onFit={fitView}
                onZoomPreset={zoomTo}
              />
              <TraceControls
                trace={trace}
                onToggleTrace={() => setTrace((t) => !t)}
                reveal={reveal}
                maxLevel={maxLevel}
                onStepReveal={stepReveal}
              />
              <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setExpanded(false)} aria-label="Exit fullscreen (Escape)">
                <Shrink className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          )}
          {expanded && selectedNode && (
            <div className="absolute bottom-4 left-4 max-h-[50%] w-80 max-w-[calc(100%-2rem)] overflow-y-auto rounded-xl shadow-2xl">
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
            </div>
          )}
        </div>

        {/* legend + hint */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-6 rounded bg-teal-700 dark:bg-teal-500" aria-hidden />
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
          {/* schematic key — reads like the textbook figure */}
          <span className="flex items-center gap-1.5">
            <svg width="26" height="12" aria-hidden className="shrink-0">
              <path d="M 1,6 L 12,6" stroke="currentColor" strokeWidth="1.7" fill="none" />
              <circle cx="15" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M 18,6 L 25,6" stroke="currentColor" strokeWidth="1.7" fill="none" />
            </svg>
            bubble&nbsp;=&nbsp;inverted output
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="26" height="12" aria-hidden className="shrink-0">
              <path d="M 1,6 L 25,6" stroke="currentColor" strokeWidth="1.7" fill="none" />
              <circle cx="13" cy="6" r="3.4" fill="currentColor" />
            </svg>
            dot&nbsp;=&nbsp;wires joined (shared signal)
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="26" height="12" aria-hidden className="shrink-0">
              <path d="M 1,6 L 12,6" stroke="currentColor" strokeWidth="1.7" fill="none" />
              <path d="M 13,1 L 13,11" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M 13,6 L 25,6" stroke="currentColor" strokeWidth="1.7" fill="none" />
            </svg>
            cross&nbsp;=&nbsp;not connected
          </span>
          <span className="flex items-center gap-1.5">
            <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
            click inputs to toggle · click gates to inspect · drag to rearrange · wheel zooms at the cursor · arrows pan · +/− zoom · 0 fit{mode === 'decoder' ? ' · PgUp/PgDn or 1-8 jump bands' : ''}
          </span>
        </div>

        {/* inspect panel */}
        <div ref={inspectorRef}>
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
        </div>

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
                  gate feeding the labeled output driver. The same input feeds all bands, so the teal
                  paths you see are exactly the wires driving the glyph on the LIVE OUTPUT panel.
                </p>
                <p>
                  Click an input rail to toggle the code (every band re-evaluates instantly), click a
                  gate to inspect it, or jump between bands with the ▲▼ stepper,{' '}
                  <span className="font-mono">Page Up/Page Down</span>, the number keys{' '}
                  <span className="font-mono">1-8</span>, a band&apos;s chip or the SEGMENT labels on
                  the canvas — double-click a chip to open that segment alone. This is the same
                  circuit the CircuitVerse export writes into a{' '}
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
                  teal paths carry logic 1. The output driver currently reads{' '}
                  <span className="font-mono">{outValue}</span> — segment {activeSegment} is{' '}
                  <span className="font-mono">{outValue}</span> for this input, matching the
                  truth table.
                </p>
              </>
            )}

            {gateStyle === 'factored' && (
              <p>
                <strong>Layered means the gates are arranged in LAYERS.</strong> Each vertical band
                above (INPUTS, LAYER 1, LAYER 2 …) is one stage of gates, and a signal passes
                through every layer on its way to the output. The factorer looks for a product of
                literals that several terms have in common, builds that sub-expression <em>once</em>{' '}
                as an ordinary gate in an earlier layer, and wires that one gate&apos;s output into
                every place that needs it — no special “shared” box, just a gate with two wires
                leaving it. On this data-set the minimizer has usually already squeezed the cover
                flat, so layering often comes out <em>the same size but one stage deeper</em>; the
                badge above says which case you are looking at, and segment E is the one that saves
                a gate at 4 bits. Treat this view as a lesson in the tradeoff rather than a win.
              </p>
            )}
            <p>
              Input rails are clickable (they toggle the simulator input; they also respond to Enter when
              focused), gates are draggable, and clicking a gate shows its live inputs and output together
              with its <strong>amber path</strong> back to the rails. Term gates carry a colored ring —
              the same color as their group in the K-map tab. The LIVE OUTPUT panel shows all eight segments
              driven simultaneously; its play button auto-sweeps the input, and TRACE reveals the circuit
              level by level (rails → NOT → {form === 'sop' ? 'AND → OR' : 'OR → AND'} → segment). In
              the full-decoder view, the amber-ringed chip marks the band under your viewport.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
