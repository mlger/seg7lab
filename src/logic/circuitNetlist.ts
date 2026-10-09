/**
 * Pure logic-circuit netlist construction + evaluation.
 *
 * Given the minimized terms of one segment (SOP or POS form) and the variable
 * names, builds the gate graph the circuit visualizer draws: input rails, NOT
 * gates for complemented literals, one AND/OR gate per term, the combining
 * root gate, the output driver, and the wire list with pin indices — plus the
 * deterministic column layout (x/y/w/h for every node).
 *
 * Also evaluates every node's live value for a given input code (the signal
 * simulation the canvas glows with).
 *
 * Pure: no React, no DOM, no store, no I/O. Logic-layer DAG position: below
 * types/simulator only (leaf), consumed by the logic-circuit component.
 */
import type { Literal, Term } from '@/types/simulator';
import { factorCover } from './factoring';
import { layoutLayered } from './circuitLayout';

export type GateType = 'input' | 'not' | 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor' | 'const' | 'out';

export interface CNode {
  id: string;
  type: GateType;
  label: string;
  varName?: string;
  constValue?: 0 | 1;
  operandIds: string[];
  /** Index of the Boolean term this node implements (term gates only).
   *  Set at build time so downstream code never parses ids to recover it. */
  termIndex?: number;
  /** Multi-level networks: the logic LAYER this gate sits in, 1-based.
   *  Layer 0 is the input rails / NOT rails. Drives the canvas layer bands. */
  layer?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Circuit gate style: 'basic' emits AND/OR; 'universal' emits the De Morgan
 *  dual network — SOP with NAND gates only (NAND-NAND), POS with NOR gates
 *  only (NOR-NOR). The pairing is fixed because it is the only one that is
 *  valid: NOR-NAND / NAND-NOR are not gate-universal realisations.
 *  'factored' emits a MULTI-LEVEL network: shared sub-expressions are computed
 *  once as labelled tap nodes feeding several gates (see ./factoring). */
export type GateStyle = 'basic' | 'universal' | 'factored';

/** Term/root gate types for a (form, style) pair — single source of truth.
 *  'factored' uses plain AND/OR internally; its multi-level structure comes
 *  from the factored netlist builder, not from the gate type. */
export function gateTypesFor(form: 'sop' | 'pos', style: GateStyle): { termGate: GateType; rootGate: GateType } {
  if (style === 'factored') return { termGate: 'and', rootGate: 'or' };
  if (style === 'universal') {
    // SOP: NAND terms (¬p) + NAND root = ∨p. POS: NOR terms (¬s) + NOR root = ∧s.
    return form === 'sop'
      ? { termGate: 'nand', rootGate: 'nand' }
      : { termGate: 'nor', rootGate: 'nor' };
  }
  return form === 'sop' ? { termGate: 'and', rootGate: 'or' } : { termGate: 'or', rootGate: 'and' };
}

export interface CWire {
  id: string;
  fromId: string;
  toId: string;
  pin: number;
}

export interface Circuit {
  nodes: CNode[];
  wires: CWire[];
  byId: Map<string, CNode>;
  width: number;
  height: number;
}

/** Build the gate graph for one segment's terms (SOP or POS form).
 *  style: 'basic' (AND/OR) or De Morgan universal-gate forms 'nand'/'nor'. */
export function buildCircuit(
  terms: Term[],
  form: 'sop' | 'pos',
  varNames: string[],
  style: GateStyle = 'basic',
): Circuit {
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
  const { termGate, rootGate } = gateTypesFor(form, style);

  let yCursor = 52;
  const termNodes: CNode[] = [];
  terms.forEach((t, ti) => {
    const pins = literalNodes[ti];
    if (style === 'basic' && pins.length <= 1) {
      // Basic style: a single-literal term reuses the rail directly; an empty
      // term is a constant — 1 for a product (SOP), 0 for a sum (POS).
      termNodes.push(pins[0] ?? add({
        id: `const-${ti}`, type: 'const',
        label: form === 'sop' ? '1' : '0',
        constValue: (form === 'sop' ? 1 : 0) as 0 | 1, operandIds: [],
        x: 300, y: yCursor, w: 48, h: 36,
      }));
    } else if (style === 'universal' && pins.length === 0) {
      // Universal networks invert at the term level: an empty product (1) must
      // leave the term gate as 0, and an empty sum (0) as 1 — NAND(1)/NOR(0)
      // do exactly that, matching the complement the combining gate needs.
      const isSop = form === 'sop';
      const c = add({
        id: `const-${ti}`, type: 'const',
        label: isSop ? '1' : '0',
        constValue: (isSop ? 1 : 0) as 0 | 1, operandIds: [],
        x: 300, y: yCursor, w: 48, h: 36,
      });
      termNodes.push(add({
        id: `term-${ti}`, type: termGate, label: termGate.toUpperCase(), termIndex: ti,
        operandIds: [c.id], x: 316, y: yCursor, w: 76, h: 48,
      }));
      yCursor += 88;
    } else {
      // Multi-literal term — or, in universal mode, a single-literal term that
      // still needs its gate (NAND/NOR of one literal = the complemented term,
      // which is exactly what the combining gate expects on its pins).
      const h = Math.max(48, pins.length * 26 + 18);
      termNodes.push(add({
        id: `term-${ti}`, type: termGate, label: termGate.toUpperCase(), termIndex: ti,
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
      constValue: (form === 'sop' ? 0 : 1) as 0 | 1, operandIds: [], x: 560, y: 120, w: 48, h: 36,
    });
  } else if (distinct.length === 1 && style === 'basic') {
    root = distinct[0];
  } else if (distinct.length === 1) {
    // Universal networks: the single term gate emits the COMPLEMENTED term,
    // so re-invert it with a 1-input gate — the classic "use the universal
    // gate as an inverter" move (NAND(X) = NOR(X) = X').
    root = add({
      id: 'root', type: rootGate, label: rootGate.toUpperCase(),
      operandIds: [distinct[0].id], x: 560, y: distinct[0].y + distinct[0].h / 2 - 24, w: 76, h: 48,
    });
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
/* Multi-level (factored) builder                                      */
/* ------------------------------------------------------------------ */

/** Lays out a multi-level netlist of near-arbitrary depth.
 *  Contrast with buildCircuit, which is fixed at exactly two levels. */
function finishLayered(nodes: CNode[], byId: Map<string, CNode>): Circuit {
  const { width, height } = layoutLayered(nodes);
  const wires: CWire[] = [];
  for (const n of nodes) {
    n.operandIds.forEach((fromId, pin) => {
      wires.push({ id: `${fromId}->${n.id}:${pin}`, fromId, toId: n.id, pin });
    });
  }
  return { nodes, wires, byId, width, height };
}

/**
 * Build a MULTI-LEVEL circuit for one segment's cover.
 *
 * A multi-level network is the same gates arranged in LAYERS: the shared
 * sub-expressions produced by the factorer are ordinary gate networks whose
 * output wire simply feeds several gates in a later layer. There is no
 * special "shared" node — the driver of each sub-expression IS a real gate
 * (or a bare rail), and the router fans its output out to every consumer.
 *
 * Layout is computed by ./circuitLayout, since the stage count is variable.
 *
 * @param form 'sop' (AND terms + OR) or 'pos' (OR terms + AND), factored by
 *   De Morgan duality so both forms get the same treatment.
 */
export function buildFactoredCircuit(
  terms: Term[],
  varNames: string[],
  form: 'sop' | 'pos' = 'sop',
): Circuit {
  const factored = factorCover(terms, form);
  const nodes: CNode[] = [];
  const byId = new Map<string, CNode>();
  const add = (n: CNode) => {
    nodes.push(n);
    byId.set(n.id, n);
    return n;
  };

  /* term/root gate types follow the form: SOP = AND·OR, POS = OR·AND.
     The IDENTITIES differ too: an empty product is 1 and an empty OR is 0
     (SOP), while an empty sum is 0 and an empty AND is 1 (POS). A POS cover
     that is empty means "always 1", which is exactly the DP segment's case. */
  const { termGate, rootGate } = gateTypesFor(form, 'basic');
  const termIdentity: 0 | 1 = form === 'sop' ? 1 : 0;
  const rootIdentity: 0 | 1 = form === 'sop' ? 0 : 1;

  /* primary input rails + NOT rails (shared by every layer) */
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
      // A name with no rail: an intermediate reference that failed to resolve,
      // or a constant. Fall back to a constant so the graph stays valid.
      return add({
        id: `const-${l.name}${l.complemented ? "'" : ''}`, type: 'const',
        label: l.name === '1' ? '1' : '0',
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
   * Emit the gate network for a term list and return its DRIVER node.
   *
   * `signals` maps an already-built sub-expression id to the gate that drives
   * it, so a later layer consumes that gate's output directly — this is what
   * makes the network multi-level rather than special-cased.
   *
   * Note a single-literal term needs no gate, so the driver can be a bare
   * rail, which is exactly how a real schematic wires a signal through.
   */
  const buildLevel = (levelTerms: Term[], idPrefix: string, signals: Map<string, CNode>): CNode => {
    const termNodes: CNode[] = [];

    levelTerms.forEach((t, ti) => {
      // A literal may name a primary input OR an earlier sub-expression.
      const pins = t.literals.map((l) => signals.get(l.name) ?? literalNode(l));
      if (pins.length === 0) {
        // Empty term: the identity of the term gate (1 for a product, 0 for a sum).
        termNodes.push(add({
          id: `${idPrefix}c-${ti}`, type: 'const',
          label: String(termIdentity), constValue: termIdentity,
          operandIds: [], x: 0, y: 0, w: 48, h: 36,
        }));
      } else if (pins.length === 1) {
        termNodes.push(pins[0]); // single literal needs no gate
      } else {
        termNodes.push(add({
          id: `${idPrefix}t-${ti}`, type: termGate, label: termGate.toUpperCase(), termIndex: ti,
          operandIds: pins.map((p) => p.id), x: 0, y: 0, w: 76,
          h: Math.max(48, pins.length * 26 + 18),
        }));
      }
    });

    const distinct = termNodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);
    if (distinct.length === 0) {
      // An empty term list is the identity of the COMBINING gate.
      return add({
        id: `${idPrefix}identity`, type: 'const',
        label: String(rootIdentity), constValue: rootIdentity,
        operandIds: [], x: 0, y: 0, w: 48, h: 36,
      });
    }
    if (distinct.length === 1) return distinct[0];
    return add({
      id: `${idPrefix}combine`, type: rootGate, label: rootGate.toUpperCase(),
      operandIds: distinct.map((n) => n.id), x: 0, y: 0, w: 76,
      h: Math.max(48, distinct.length * 26 + 18),
    });
  };

  /* Sub-expressions in the factorer's dependency order. Each maps its id to the
     GATE that drives it, so later layers consume that gate's output directly. */
  const signalDriver = new Map<string, CNode>();
  for (const sig of factored.intermediates) {
    signalDriver.set(sig.id, buildLevel(sig.terms, `${sig.id}-`, signalDriver));
  }

  /* Top layer: the output expression, consuming sub-expression drivers. */
  const outTerms: Term[] = factored.output;
  const topNodes: CNode[] = [];
  outTerms.forEach((t, ti) => {
    const pins = t.literals.map((l) => signalDriver.get(l.name) ?? literalNode(l));
    if (pins.length === 0) {
      topNodes.push(add({
        id: `topc-${ti}`, type: 'const',
        label: String(termIdentity), constValue: termIdentity,
        operandIds: [], x: 0, y: 0, w: 48, h: 36,
      }));
    } else if (pins.length === 1) {
      topNodes.push(pins[0]);
    } else {
      topNodes.push(add({
        id: `top-t-${ti}`, type: termGate, label: termGate.toUpperCase(), termIndex: ti,
        operandIds: pins.map((p) => p.id), x: 0, y: 0, w: 76,
        h: Math.max(48, pins.length * 26 + 18),
      }));
    }
  });

  const distinctTop = topNodes.filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i);
  let root: CNode;
  if (distinctTop.length === 0) {
    // Empty output expression: constant identity of the combining gate.
    root = add({
      id: 'const-root', type: 'const',
      label: String(rootIdentity), constValue: rootIdentity,
      operandIds: [], x: 0, y: 0, w: 48, h: 36,
    });
  } else if (distinctTop.length === 1) {
    root = distinctTop[0];
  } else {
    root = add({
      id: 'root', type: rootGate, label: rootGate.toUpperCase(),
      operandIds: distinctTop.map((n) => n.id), x: 0, y: 0, w: 76,
      h: Math.max(48, distinctTop.length * 26 + 18),
    });
  }

  add({
    id: 'out', type: 'out', label: 'OUT', operandIds: [root.id],
    x: 0, y: 0, w: 120, h: 68,
  });

  return finishLayered(nodes, byId);
}

/**
 * Longest-path depth of every node: inputs/constants are level 0, every other
 * node is 1 + max(level of its operands). Used by the circuit tab's level
 * trace (propagation step-through). Circuits are DAGs by construction.
 */
export function computeLevels(circuit: Circuit): Map<string, number> {
  const levels = new Map<string, number>();
  const visit = (n: CNode): number => {
    const cached = levels.get(n.id);
    if (cached !== undefined) return cached;
    let v = 0;
    for (const id of n.operandIds) v = Math.max(v, visit(circuit.byId.get(id)!));
    const lv = n.operandIds.length === 0 ? 0 : v + 1;
    levels.set(n.id, lv);
    return lv;
  };
  for (const n of circuit.nodes) visit(n);
  return levels;
}

/**
 * Evaluate every node of the circuit for the given input code (minterm index).
 * Returns node id → logic value. Memoized per node id inside the call, so DAG
 * sharing (shared NOT rails / single-term roots) costs nothing extra.
 */
export function evaluateCircuit(
  circuit: Circuit,
  currentInput: number,
  inputBits: number,
  varNames: string[],
): Map<string, 0 | 1> {
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
        v = n.operandIds.reduce<number>((acc, id) => acc ^ evalNode(circuit.byId.get(id)!), 0) as 0 | 1;
        break;
      case 'nand':
        v = n.operandIds.every((id) => evalNode(circuit.byId.get(id)!) === 1) ? 0 : 1;
        break;
      case 'nor':
        v = n.operandIds.some((id) => evalNode(circuit.byId.get(id)!) === 1) ? 0 : 1;
        break;      case 'xnor':
        v = (n.operandIds.reduce<number>((acc, id) => acc ^ evalNode(circuit.byId.get(id)!), 0) as 0 | 1) === 1 ? 0 : 1;
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
}

/**
 * Viewport transform: maps between client pixels and the SVG viewBox
 * coordinate space (uniform scale + letterbox centering, matching
 * preserveAspectRatio="xMidYMid meet"). Every place that converts screen
 * positions to graph positions — fit, zoom anchoring, wheel zoom, pointer
 * dragging, band wayfinding — MUST go through this one helper so the five
 * former copies of the math cannot drift apart.
 */
export interface ViewportTransform {
  /** viewBox-units per CSS pixel before zoom (the meet scale). */
  vbScale: number;
  /** 1 / vbScale — CSS pixels per viewBox unit (the `k` used for pan). */
  k: number;
  /** Letterbox offsets in CSS pixels (centering bars on each axis). */
  offX: number;
  offY: number;
  /** Client point → viewBox point (before pan/zoom are applied). */
  toViewBox: (clientX: number, clientY: number) => { x: number; y: number };
}

export function getViewportTransform(
  el: SVGSVGElement,
  circuit: { width: number; height: number },
): ViewportTransform | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return null;
  const vbScale = Math.min(circuit.width / rect.width, circuit.height / rect.height);
  const offX = (rect.width - circuit.width / vbScale) / 2;
  const offY = (rect.height - circuit.height / vbScale) / 2;
  return {
    vbScale,
    k: 1 / vbScale,
    offX,
    offY,
    toViewBox: (clientX: number, clientY: number) => ({
      x: (clientX - rect.left - offX) * vbScale,
      y: (clientY - rect.top - offY) * vbScale,
    }),
  };
}
