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

export type GateType = 'input' | 'not' | 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor' | 'const' | 'out';

export interface CNode {
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

/** Build the gate graph for one segment's minimized terms (SOP or POS). */
export function buildCircuit(terms: Term[], form: 'sop' | 'pos', varNames: string[]): Circuit {
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
        break;
      case 'xnor':
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
