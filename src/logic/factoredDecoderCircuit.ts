/**
 * Whole-decoder MULTI-LEVEL circuit composer.
 *
 * The two-level decoder (./decoderCircuit) draws each segment's flat SOP as a
 * band. This builder instead factors all eight segments through ONE shared
 * hash-cons table, so:
 *
 *   1. a sub-expression that appears in two different segments is computed
 *      ONCE and feeds both bands — the real cross-segment win, and
 *   2. within a segment, shared cubes become labelled taps as in
 *      buildFactoredCircuit.
 *
 * Layout reuses the same level-based engine (/circuitLayout), since a
 * multi-level network has a variable number of stages.
 *
 * Pure: no React, no DOM, no store, no I/O.
 */
import { SEGMENT_NAMES, type Literal, type SegmentName, type Term } from '@/types/simulator';
import { createFactorContext, factorTermsWith, type FactorContext } from './factoring';
import { layoutLayered } from './circuitLayout';
import type { Circuit, CNode, CWire } from './circuitNetlist';

export interface FactoredDecoderBand {
  seg: SegmentName;
  /** Top edge of the band (graph units), for the canvas band separators. */
  y: number;
  height: number;
  /** Gates owned by this segment (not counting shared signals). */
  gates: number;
}

export interface FactoredDecoder {
  circuit: Circuit;
  nodeOwner: Map<string, SegmentName>;
  bands: FactoredDecoderBand[];
  /** Signals consumed by 2+ different segments — the cross-segment sharing. */
  crossSegmentSignals: string[];
  perSegmentGates: Record<SegmentName, number>;
}

/**
 * Build the multi-level decoder for all eight segments at once.
 *
 * @param termsBySegment minimized SOP terms per segment
 * @param varNames input variable names, MSB first
 */
export function buildFactoredDecoderCircuit(
  termsBySegment: Record<SegmentName, Term[]>,
  varNames: string[],
): FactoredDecoder {
  /* ONE context for all eight segments: identical sub-expressions collapse. */
  const ctx: FactorContext = createFactorContext();
  const forms = SEGMENT_NAMES.map((seg) => ({
    seg,
    form: factorTermsWith(termsBySegment[seg], ctx),
  }));

  const nodes: CNode[] = [];
  const byId = new Map<string, CNode>();
  const nodeOwner = new Map<string, SegmentName>();
  const perSegmentGates = {} as Record<SegmentName, number>;
  const add = (n: CNode) => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };
  /** Tag a node with the segment that owns it (drives bands + ownership tests). */
  const own = (n: CNode, seg: SegmentName): CNode => {
    nodeOwner.set(n.id, seg);
    return n;
  };

  /* primary input rails + NOT rails, shared across the whole decoder */
  const inputNodes = new Map<string, CNode>();
  varNames.forEach((v) => {
    inputNodes.set(v, add({
      id: `in-${v}`, type: 'input', label: v, varName: v, operandIds: [],
      x: 0, y: 0, w: 64, h: 44,
    }));
  });
  const notCache = new Map<string, CNode>();
  const literalNode = (l: Literal): CNode => {
    const base = inputNodes.get(l.name);
    if (!base) {
      // Unresolved name (defensive): keep the graph valid with a constant.
      return add({
        id: `const-${l.name}`, type: 'const', label: l.name === '1' ? '1' : '0',
        constValue: (l.name === '1' ? 1 : 0) as 0 | 1, operandIds: [], x: 0, y: 0, w: 48, h: 36,
      });
    }
    if (!l.complemented) return base;
    let n = notCache.get(l.name);
    if (!n) {
      n = add({
        id: `not-${l.name}`, type: 'not', label: `NOT ${l.name}`,
        operandIds: [base.id], x: 0, y: 0, w: 60, h: 36,
      });
      notCache.set(l.name, n);
    }
    return n;
  };

  /**
   * Emit the AND/OR network for one term list. `scope` prefixes the generated
   * ids so two segments cannot collide; `owner` tags every node it creates.
   */
  const buildLevel = (
    levelTerms: Term[],
    scope: string,
    seg: SegmentName,
    signals: Map<string, CNode>,
  ): { node: CNode; gates: number } => {
    const termNodes: CNode[] = [];
    let gates = 0;

    levelTerms.forEach((t, ti) => {
      // A literal may name a primary input OR an earlier sub-expression.
      const pins = t.literals.map((l) => signals.get(l.name) ?? literalNode(l));
      if (pins.length === 0) {
        termNodes.push(own(add({
          id: `${scope}c-${ti}`, type: 'const', label: '1', constValue: 1,
          operandIds: [], x: 0, y: 0, w: 48, h: 36,
        }), seg));
      } else if (pins.length === 1) {
        termNodes.push(pins[0]);
      } else {
        termNodes.push(own(add({
          id: `${scope}t-${ti}`, type: 'and', label: 'AND', termIndex: ti,
          operandIds: pins.map((p) => p.id), x: 0, y: 0, w: 76,
          h: Math.max(48, pins.length * 26 + 18),
        }), seg));
        gates += 1;
      }
    });

    const distinct = termNodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);
    if (distinct.length === 0) {
      return {
        node: own(add({
          id: `${scope}zero`, type: 'const', label: '0', constValue: 0,
          operandIds: [], x: 0, y: 0, w: 48, h: 36,
        }), seg),
        gates,
      };
    }
    if (distinct.length === 1) return { node: distinct[0], gates };
    return {
      node: own(add({
        id: `${scope}combine`, type: 'or', label: 'OR',
        operandIds: distinct.map((n) => n.id), x: 0, y: 0, w: 76,
        h: Math.max(48, distinct.length * 26 + 18),
      }), seg),
      gates: gates + 1,
    };
  };

  /* Intermediate sub-expressions: emitted once for the whole decoder (already
     deduplicated by the shared context). Each yields the GATE that drives it,
     so later layers consume that gate's output directly — no wrapper node. */
  const signalOwner = new Map<string, SegmentName>();
  for (const { seg, form } of forms) {
    for (const sig of form.intermediates) {
      if (!signalOwner.has(sig.id)) signalOwner.set(sig.id, seg);
    }
  }

  const signalDriver = new Map<string, CNode>();
  for (const sig of ctx.signals) {
    const seg = signalOwner.get(sig.id);
    if (!seg) continue;
    signalDriver.set(sig.id, buildLevel(sig.terms, `${sig.id}-`, seg, signalDriver).node);
  }

  /* Per-segment output networks: the top expression of each segment. */
  for (const { seg, form } of forms) {
    const topNodes: CNode[] = [];
    let gates = 0;
    form.output.forEach((t, ti) => {
      const pins = t.literals.map((l) => signalDriver.get(l.name) ?? literalNode(l));
      if (pins.length === 0) {
        topNodes.push(add({
          id: `top-${seg}c-${ti}`, type: 'const', label: '1', constValue: 1,
          operandIds: [], x: 0, y: 0, w: 48, h: 36,
        }));
      } else if (pins.length === 1) {
        topNodes.push(pins[0]);
      } else {
        const g = add({
          id: `top-${seg}t-${ti}`, type: 'and', label: 'AND', termIndex: ti,
          operandIds: pins.map((p) => p.id), x: 0, y: 0, w: 76,
          h: Math.max(48, pins.length * 26 + 18),
        });
        nodeOwner.set(g.id, seg);
        gates += 1;
        topNodes.push(g);
      }
    });

    const distinctTop = topNodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);
    let root: CNode;
    if (distinctTop.length === 0) {
      root = add({
        id: `top-${seg}-zero`, type: 'const', label: '0', constValue: 0,
        operandIds: [], x: 0, y: 0, w: 48, h: 36,
      });
      nodeOwner.set(root.id, seg);
    } else if (distinctTop.length === 1) {
      root = distinctTop[0];
    } else {
      root = add({
        id: `top-${seg}-or`, type: 'or', label: 'OR',
        operandIds: distinctTop.map((n) => n.id), x: 0, y: 0, w: 76,
        h: Math.max(48, distinctTop.length * 26 + 18),
      });
      nodeOwner.set(root.id, seg);
      gates += 1;
    }

    const out = add({
      id: `o-${seg}`, type: 'out', label: seg, operandIds: [root.id],
      x: 0, y: 0, w: 120, h: 68,
    });
    nodeOwner.set(out.id, seg);
    perSegmentGates[seg] = gates;
  }

  const { width, height } = layoutLayered(nodes);
  const wires: CWire[] = [];
  for (const n of nodes) {
    n.operandIds.forEach((fromId, pin) => {
      wires.push({ id: `${fromId}->${n.id}:${pin}`, fromId, toId: n.id, pin });
    });
  }

  /* Bands: contiguous vertical ranges per segment, derived from the layout so
     the canvas band separators and jump targets keep working. */
  const bands: FactoredDecoderBand[] = [];
  for (const seg of SEGMENT_NAMES) {
    const owned = nodes.filter((n) => nodeOwner.get(n.id) === seg && n.type !== 'input');
    if (owned.length === 0) continue;
    const top = Math.min(...owned.map((n) => n.y));
    const bottom = Math.max(...owned.map((n) => n.y + n.h));
    bands.push({ seg, y: top, height: Math.max(48, bottom - top), gates: perSegmentGates[seg] ?? 0 });
  }

  /* Cross-segment signals: a sub-expression DRIVER feeding nodes owned by 2+
     different segments. Because intermediates now wire straight into their
     consumers, the driver node is the signal — no wrapper to unwrap. */
  const driverOfSignal = new Map<string, string>();   // driver node id -> signal id
  for (const [sig, node] of signalDriver) driverOfSignal.set(node.id, sig);

  const consumersBySignal = new Map<string, Set<SegmentName>>();
  for (const w of wires) {
    const sig = driverOfSignal.get(w.fromId);
    if (!sig) continue;
    const owner = nodeOwner.get(w.toId);
    if (!owner) continue;
    if (!consumersBySignal.has(sig)) consumersBySignal.set(sig, new Set());
    consumersBySignal.get(sig)!.add(owner);
  }
  const crossSegmentSignals = [...consumersBySignal.entries()]
    .filter(([, segs]) => segs.size >= 2)
    .map(([sig]) => sig);

  return {
    circuit: { nodes, wires, byId, width, height },
    nodeOwner,
    bands,
    crossSegmentSignals,
    perSegmentGates,
  };
}
