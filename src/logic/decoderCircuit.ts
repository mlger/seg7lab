/**
 * Whole-decoder circuit composer: ONE combined netlist showing all eight
 * segments' gate networks as stacked bands with shared input rails and shared
 * NOT gates — the "Full decoder" view of the Circuit tab.
 *
 * Node types, geometry conventions and wire model are identical to
 * buildCircuit()'s single-segment output, so the same canvas, evaluator
 * (evaluateCircuit), inspector and fit/zoom/pan machinery render it unchanged.
 * Shared rails reuse the single view's ids (in-D / not-D), so drag overrides
 * and the click-to-toggle input behavior carry over.
 *
 * Pure: no React, no DOM, no store, no I/O.
 */
import { SEGMENT_NAMES, type Literal, type SegmentName, type Term } from '@/types/simulator';
import { gateTypesFor, type GateStyle, type Circuit, type CNode, type CWire } from './circuitNetlist';

export interface DecoderBand {
  seg: SegmentName;
  /** Top edge of the band (graph units). */
  y: number;
  height: number;
  /** Gate count owned by this segment (term gates + combining root). */
  gates: number;
}

export interface DecoderCircuit {
  circuit: Circuit;
  /** node id → segment that owns the node (band gates/out; shared rails omitted). */
  nodeOwner: Map<string, SegmentName>;
  /** Bands in draw order (SEGMENT_NAMES order). */
  bands: DecoderBand[];
  /** Gate count per segment (term + root gates). */
  perSegmentGates: Record<SegmentName, number>;
}

/** Canonical literal-set key, used to match a term to its K-map cover group. */
export function termGroupKey(t: Term): string {
  return t.literals.map((l: Literal) => `${l.name}${l.complemented ? '*' : ''}`).sort().join('');
}

/**
 * Compose the eight segments' netlists into one circuit.
 *
 * @param termsBySegment minimized OR canonical terms per segment (the caller
 *   decides the form — the builder is agnostic)
 * @param form 'sop' → term gates are AND, root is OR; 'pos' → mirrored
 * @param varNames input variable names, MSB first
 * @param style 'basic' (default) or 'universal' De Morgan dual form
 */
export function buildDecoderCircuit(
  termsBySegment: Record<SegmentName, Term[]>,
  form: 'sop' | 'pos',
  varNames: string[],
  style: GateStyle = 'basic',
): DecoderCircuit {
  const nodes: CNode[] = [];
  const byId = new Map<string, CNode>();
  const add = (n: CNode) => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };

  /* shared input rails + shared NOT gates (same ids/geometry as single view) */
  const inputNodes = new Map<string, CNode>();
  varNames.forEach((v, i) => {
    inputNodes.set(
      v,
      add({ id: `in-${v}`, type: 'input', label: v, varName: v, operandIds: [], x: 56, y: 48 + i * 76, w: 64, h: 44 }),
    );
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

  const { termGate: termGateType, rootGate: rootGateType } = gateTypesFor(form, style);
  const nodeOwner = new Map<string, SegmentName>();
  const bands: DecoderBand[] = [];
  const perSegmentGates = {} as Record<SegmentName, number>;

  let bandY = 44;
  for (const seg of SEGMENT_NAMES) {
    const terms = termsBySegment[seg];
    const bandTop = bandY;
    let gateCount = 0;

    /* term gates for this segment */
    const literalNodes = terms.map((t) => t.literals.map(literalNode));
    let cursor = bandTop + 8;
    const termNodes: CNode[] = [];
    terms.forEach((t, ti) => {
      const pins = literalNodes[ti];
      if (style === 'basic' && pins.length === 1) {
        termNodes.push(pins[0]); // bare rail — shared node, no gate
      } else if (pins.length === 0) {
        // Empty term: constant 1 for a product, 0 for a sum. In basic style the
        // constant IS the term; in universal style it rides through the term
        // gate, whose inversion delivers the complement the root gate expects.
        const isSop = form === 'sop';
        const c = add({
          id: `c-${seg}-${ti}`, type: 'const', label: isSop ? '1' : '0',
          constValue: (isSop ? 1 : 0) as 0 | 1, operandIds: [],
          x: 300, y: cursor, w: 48, h: 36,
        });
        nodeOwner.set(c.id, seg);
        if (style === 'basic') {
          termNodes.push(c);
        } else {
          const g = add({
            id: `t-${seg}-${ti}`, type: termGateType, label: termGateType.toUpperCase(),
            termIndex: ti, operandIds: [c.id], x: 316, y: cursor, w: 76, h: 48,
          });
          nodeOwner.set(g.id, seg);
          termNodes.push(g);
          gateCount += 1;
          cursor += 76;
        }
      } else {
        const h = Math.max(48, pins.length * 26 + 18);
        const g = add({
          id: `t-${seg}-${ti}`, type: termGateType, label: termGateType.toUpperCase(),
          termIndex: ti, operandIds: pins.map((p) => p.id), x: 316, y: cursor, w: 76, h,
        });
        nodeOwner.set(g.id, seg);
        termNodes.push(g);
        gateCount += 1;
        cursor += h + 28;
      }
    });
    const hasTermGates = termNodes.some((n) => n.type === termGateType);
    const stackBottom = hasTermGates ? cursor - 28 : bandTop + 48;

    /* combining root */
    const distinct = termNodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);
    let root: CNode;
    if (terms.length === 0) {
      root = add({
        id: `c-${seg}`, type: 'const', label: form === 'sop' ? '0' : '1',
        constValue: (form === 'sop' ? 0 : 1) as 0 | 1, operandIds: [], x: 560, y: bandTop + 26, w: 48, h: 36,
      });
      nodeOwner.set(root.id, seg);
    } else if (distinct.length === 1 && style === 'basic') {
      root = distinct[0]; // single term drives the output directly
    } else if (distinct.length === 1) {
      // Universal: re-invert the single complemented term with a 1-input gate
      // (NAND(X) = NOR(X) = X').
      root = add({
        id: `r-${seg}`, type: rootGateType, label: rootGateType.toUpperCase(),
        operandIds: [distinct[0].id], x: 560, y: bandTop + 26, w: 76, h: 48,
      });
      nodeOwner.set(root.id, seg);
      gateCount += 1;
    } else {
      const h = Math.max(48, distinct.length * 26 + 18);
      const mid = bandTop + 8 + (stackBottom - bandTop - 8) / 2;
      root = add({
        id: `r-${seg}`, type: rootGateType, label: rootGateType.toUpperCase(),
        operandIds: distinct.map((n) => n.id), x: 560, y: Math.max(bandTop + 8, mid - h / 2), w: 76, h,
      });
      nodeOwner.set(root.id, seg);
      gateCount += 1;
    }

    /* output driver, labeled with the owning segment */
    const bandH = Math.max(stackBottom + 16 - bandTop, root.h + 24, 88);
    const out = add({
      id: `o-${seg}`, type: 'out', label: seg, operandIds: [root.id],
      x: 730, y: bandTop + bandH / 2 - 34, w: 120, h: 68,
    });
    nodeOwner.set(out.id, seg);

    perSegmentGates[seg] = gateCount;
    bands.push({ seg, y: bandTop, height: bandH, gates: gateCount });
    bandY = bandTop + bandH + 36;
  }

  const wires: CWire[] = [];
  for (const n of nodes) {
    n.operandIds.forEach((fromId, pin) => {
      wires.push({ id: `${fromId}->${n.id}:${pin}`, fromId, toId: n.id, pin });
    });
  }

  const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + 40;
  const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + 40;
  return {
    circuit: { nodes, wires, byId, width: Math.max(920, maxX), height: Math.max(360, maxY) },
    nodeOwner,
    bands,
    perSegmentGates,
  };
}
