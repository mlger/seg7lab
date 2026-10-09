/**
 * Falstad / CircuitJS1 exporter — writes the classic `$` text netlist that
 * falstad.com/circuit opens via File → Open File… or "Import From Text".
 *
 * ---------------------------------------------------------------------------
 * LAYOUT: single-row gates + a routing corridor
 * ---------------------------------------------------------------------------
 * In CircuitJS1 there is NO junction element and NO node table: two things are
 * connected if and only if their connection points have IDENTICAL integer
 * coordinates. A wire that ends in mid-air is silently disconnected, and a wire
 * that ends on the wrong pin silently shorts two nets. So the layout is chosen
 * to make those two failure modes impossible:
 *
 *   - All gates sit on one horizontal row, one per "column" (level).
 *   - A dedicated routing CORRIDOR runs below every gate.
 *   - A net leaves its gate, drops into the corridor, runs horizontally, rises
 *     in the gap just left of its destination, then stubs into the pin.
 *
 * Every vertical run gets its own x-slot and every corridor run its own y-lane,
 * so two DIFFERENT nets can never lie on the same line (which would short
 * them), and no wire can cross a gate body (the corridor is below all of them,
 * and every drop/rise happens inside a column gap). scripts/verify-logic.ts
 * section 15 asserts both properties.
 *
 * ---------------------------------------------------------------------------
 * FORMAT FACTS (verified against pfalstad/circuitjs1 source + the shipped
 * https://www.falstad.com/circuit/circuitjs110/circuits/xor.txt)
 * ---------------------------------------------------------------------------
 *  - Header: one line, `$ <flags> <maxTimeStep> <iterCount> <currentBar>
 *    <voltageRange> [<powerBar>] [<minTimeStep>]`; the last two are optional
 *    (the loader wraps them in try/catch), so the portable 5-field form is used.
 *  - Component: `<type> <x> <y> <x2> <y2> <flags> [params…]`.
 *  - Logic gates are NUMERIC types: AND=150 NAND=151 OR=152 NOR=153 XOR=154
 *    XNOR=431, params `inputCount lastOutputVoltage [highVoltage]`.
 *  - `L` extends SwitchElm, which parses the position token INVERTED for logic
 *    inputs: the literal "false" yields position 1, and LogicInputElm.doStep()
 *    turns position 1 into the HIGH voltage. Writing the words would silently
 *    invert every input, so integers (0 = low, 1 = high) are written instead.
 *  - `L` (logic input) and `M` (logic output probe) have ONE post, at (x,y);
 *    the second coordinate pair only sets the label direction. Note 'M' is the
 *    OUTPUT probe — the mnemonic reads the other way round from intuition.
 *  - Gate input pins sit at `16 * i0` perpendicular to the body, where
 *    `i0 = -floor(n/2)` advancing per input and skipping 0 when n is even
 *    (GateElm.setPoints). A gate's output is its second point (x2,y2).
 *  - Inverter `I` params are omitted on purpose: the defaults (slewRate .5,
 *    highVoltage 5) are exactly what a logic circuit wants, and the token order
 *    is version-sensitive.
 *  - Coordinates are integers on a 16px grid.
 *
 * Pure: no DOM, no React, no I/O.
 */
import { SEGMENT_NAMES, type InputWidth, type SegmentName } from '@/types/simulator';
import {
  buildCircuit, buildFactoredCircuit, type Circuit, type CNode, type GateStyle,
} from './circuitNetlist';
import type { SegmentEngineMap } from './engine';

/** CircuitJS1 numeric dump types for the logic gates we emit. */
export const FALSTAD_GATE_TYPE: Record<string, number> = {
  and: 150,
  nand: 151,
  or: 152,
  nor: 153,
  xor: 154,
  xnor: 431,
};

/** Grid pitch used by CircuitJS1 (px per snap square). */
export const FALSTAD_GRID = 16;
/** Gate body width in px (a multiple of the grid). */
const BODY_W = 80;
/** Vertical gap between adjacent nodes stacked in the same column. */
const ROW_GAP = 48;

export interface FalstadExportOptions {
  /** Segments to emit, left to right. Empty = all eight. */
  segments?: SegmentName[];
  form: 'sop' | 'pos';
  style: GateStyle;
  /** Skip segments whose output is a constant (nothing to draw). Default true. */
  skipConstant?: boolean;
}

export interface FalstadExportResult {
  /** The complete file contents. */
  text: string;
  /** Elements emitted per segment, for tests and reporting. */
  perSegment: Partial<Record<SegmentName, { gates: number; wires: number }>>;
  /** Every element connection point, keyed "x,y". */
  connectionPoints: Set<string>;
  /** Every wire endpoint, keyed "x,y". */
  wirePoints: Set<string>;
  /** Wire segments as [x1,y1,x2,y2], for the no-crossing assertions. */
  segments: [number, number, number, number][];
}

/**
 * Input-pin offsets for an n-input gate, in the exact order
 * GateElm.setPoints() computes them: `i0 = -floor(n/2)`, advancing per input,
 * skipping 0 when n is even.
 */
export function gatePinOffsets(inputCount: number): number[] {
  const offsets: number[] = [];
  let i0 = -Math.floor(inputCount / 2);
  for (let i = 0; i < inputCount; i++) {
    if (i0 === 0 && inputCount % 2 === 0) i0++;
    offsets.push(FALSTAD_GRID * i0);
    i0++;
  }
  return offsets;
}

/** Half the vertical extent of a gate's pin fan. */
function spanOf(n: CNode): number {
  if (FALSTAD_GATE_TYPE[n.type]) return Math.floor(Math.max(2, n.operandIds.length) / 2) * FALSTAD_GRID;
  return FALSTAD_GRID;
}

interface Placed {
  node: CNode;
  col: number;
  /** Body left edge — where this node's input pins live. */
  x: number;
  /** Body vertical centre. */
  y: number;
  span: number;
  /** Where the signal leaves this node. */
  outX: number;
  outY: number;
  /** Input pin coordinates, in operand order. */
  pins: { x: number; y: number }[];
}

interface RoutedWire {
  from: Placed;
  to: Placed;
  pinIndex: number;
  dropX: number;
  riseX: number;
  corridorY: number;
  dx: number;
  dy: number;
}

class Sink {
  lines: string[] = ['$ 1 5.0E-6 1.5 50 5.0'];
  connectionPoints = new Set<string>();
  wirePoints = new Set<string>();
  segments: [number, number, number, number][] = [];
  gates = 0;
  wires = 0;

  key(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** Register a point an element connects at. */
  post(x: number, y: number): void {
    this.connectionPoints.add(this.key(x, y));
  }

  line(l: string): void {
    this.lines.push(l);
  }

  /** Emit one wire segment, recording its endpoints. */
  wire(x1: number, y1: number, x2: number, y2: number): void {
    if (x1 === x2 && y1 === y2) return; // zero-length: nothing to draw
    this.line(`w ${x1} ${y1} ${x2} ${y2} 0`);
    this.wirePoints.add(this.key(x1, y1));
    this.wirePoints.add(this.key(x2, y2));
    this.segments.push([x1, y1, x2, y2]);
    this.wires++;
  }

  text(): string {
    return this.lines.join('\n') + '\n';
  }
}

/**
 * Build the classic `$` netlist for the requested segment circuits.
 *
 * The circuits come from the SAME builders the on-screen circuit tab uses, so
 * the file matches what the user is looking at: style 'factored' exports the
 * layered network, 'basic' the flat two-level one.
 */
export function buildFalstadNetlist(
  engines: SegmentEngineMap,
  inputBits: InputWidth,
  varNames: string[],
  options: FalstadExportOptions,
): FalstadExportResult {
  const segments = options.segments && options.segments.length > 0
    ? options.segments
    : [...SEGMENT_NAMES];
  const sink = new Sink();
  const perSegment: FalstadExportResult['perSegment'] = {};

  let cursorX = 32;
  // Each segment gets its own VERTICAL BAND of the canvas. A corridor shared
  // between two circuits would short them together, so the bands are spaced by
  // the deepest circuit's corridor rather than guessed.
  let cursorY = 96;

  // Pre-measure so the bands can be spaced by the tallest circuit.
  const measured: { seg: SegmentName; circuit: Circuit }[] = [];
  for (const seg of segments) {
    const engine = engines[seg];
    const terms = options.form === 'sop' ? engine.activeSopTerms : engine.activePosTerms;
    const circuit: Circuit = options.style === 'factored'
      ? buildFactoredCircuit(terms, varNames, options.form)
      : buildCircuit(terms, options.form, varNames, options.style);
    const hasGates = circuit.nodes.some((n) => FALSTAD_GATE_TYPE[n.type]);
    if (!hasGates && options.skipConstant !== false) continue;
    measured.push({ seg, circuit });
  }

  let maxWires = 0;
  for (const { circuit } of measured) maxWires = Math.max(maxWires, circuit.wires.length);
  const bandPitch = 384 + maxWires * FALSTAD_GRID * 2;

  for (const { seg, circuit } of measured) {
    const before = { gates: sink.gates, wires: sink.wires };
    const height = emitCircuit(sink, circuit, cursorX, cursorY, bandPitch);
    perSegment[seg] = { gates: sink.gates - before.gates, wires: sink.wires - before.wires };
    cursorY += Math.max(height, bandPitch) + 160;
    void inputBits;
  }

  return {
    text: sink.text(),
    perSegment,
    connectionPoints: sink.connectionPoints,
    wirePoints: sink.wirePoints,
    segments: sink.segments,
  };
}

/** Emit one segment's circuit starting at (originX, originY); return its height. */
function emitCircuit(
  sink: Sink,
  circuit: Circuit,
  originX: number,
  originY: number,
  /** Vertical room reserved before the next segment's band may start. */
  reservedBand: number,
): number {
  /* ---- 1. columns: one per distinct x in the builder's layout ---------- */
  const colKeys = [...new Set(circuit.nodes.map((n) => Math.round(n.x)))].sort((a, b) => a - b);
  const cols: CNode[][] = colKeys.map((k) =>
    circuit.nodes
      .filter((n) => Math.round(n.x) === k)
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id)),
  );

  /* ---- 2. which wires leave / enter each column ------------------------ */
  const colOf = new Map<string, number>();
  cols.forEach((col, ci) => col.forEach((n) => colOf.set(n.id, ci)));

  const leaving = cols.map(() => 0);
  const entering = cols.map(() => 0);
  for (const n of circuit.nodes) {
    const ci = colOf.get(n.id)!;
    for (const opId of n.operandIds) {
      const sj = colOf.get(opId);
      if (sj === undefined) continue;
      leaving[sj]++;
      entering[ci]++;
    }
  }

  /* ---- 3. adaptive x with DISJOINT drop / rise bands -------------------
   *
   * Each column gap holds two separate x-bands:
   *   [body][ drop band ][ rise band ][body]
   * Drops (nets leaving the left column) live only in the drop band; rises (nets
   * entering the right column) only in the rise band. Splitting them is what
   * guarantees two DIFFERENT nets can never share a vertical x — a drop and a
   * rise on the same x would be read as one conductor and short them together.
   * Slot k of a band sits at bandStart + k*16.
   */
  const colX: number[] = [];
  /** x of drop slot k in the gap after column c. */
  const dropXAt: ((k: number) => number)[] = [];
  /** x of rise slot k in the gap before column c. */
  const riseXAt: ((k: number) => number)[] = [];
  {
    let x = originX;
    for (let c = 0; c < cols.length; c++) {
      colX[c] = x;
      const isLast = c === cols.length - 1;
      if (isLast) break;
      const dropStart = x + BODY_W + FALSTAD_GRID;
      const riseStart = dropStart + Math.max(1, leaving[c]) * FALSTAD_GRID + FALSTAD_GRID;
      dropXAt[c] = (k: number) => dropStart + k * FALSTAD_GRID;
      riseXAt[c + 1] = (k: number) => riseStart + k * FALSTAD_GRID;
      x = riseStart + Math.max(1, entering[c + 1] ?? 0) * FALSTAD_GRID;
    }
  }

  /* ---- 4. place nodes: stack within a column, no vertical overlap ----- */
  const placed: Placed[] = [];
  const byId = new Map<string, Placed>();
  let bottom = originY;
  cols.forEach((col, ci) => {
    let cursor = originY;
    for (const n of col) {
      const span = spanOf(n);
      const y = cursor + span;
      const isGate = !!FALSTAD_GATE_TYPE[n.type];
      const isInput = n.type === 'input' || n.type === 'const';
      const isProbe = n.type === 'out';

      // Input pins at the body's left edge; the output at its right edge.
      const pins: { x: number; y: number }[] = [];
      if (isGate) {
        for (const off of gatePinOffsets(Math.max(2, n.operandIds.length))) {
          pins.push({ x: colX[ci], y: y + off });
        }
      } else if (n.type === 'not' || isProbe) {
        pins.push({ x: colX[ci], y });
      }
      const outX = isInput ? colX[ci] : colX[ci] + (n.type === 'not' || isGate ? BODY_W : 0);

      const p: Placed = {
        node: n, col: ci, x: colX[ci], y, span,
        outX, outY: y, pins,
      };
      placed.push(p);
      byId.set(n.id, p);
      cursor = y + span + ROW_GAP;
      bottom = Math.max(bottom, y + span);
    }
  });

  /* ---- 5. route every wire through the corridor -----------------------
   *
   * Shape of one net: leave the source post, drop straight into its own corridor
   * lane, run horizontally to just before the destination, rise to the pin's row,
   * stub in.
   *
   * Keeping both verticals SHORT and inside column gaps is what stops the long
   * horizontals from being crossed: every horizontal run sits below every gate
   * and below every vertical, in a lane of its own, so no two runs can meet. (An
   * earlier attempt dropped the wire in mid-span, which let long horizontals cut
   * across other nets' verticals — genuinely wrong wiring.)
   */
  const corridorBase = bottom + 96;

  // Slot indices so no two different nets share a vertical run.
  const leaveSlot = new Map<string, number>();
  const enterSlot = new Map<string, number>();
  {
    const seenOut = cols.map(() => 0);
    const seenIn = cols.map(() => 0);
    for (const target of placed) {
      target.node.operandIds.forEach((srcId, pinIndex) => {
        const src = byId.get(srcId);
        if (!src) return;
        const wid = `${srcId}->${target.node.id}:${pinIndex}`;
        enterSlot.set(wid, seenIn[target.col]++);
        leaveSlot.set(wid, seenOut[src.col]++);
      });
    }
  }

  const routed: RoutedWire[] = [];
  for (const target of placed) {
    target.node.operandIds.forEach((srcId, pinIndex) => {
      const src = byId.get(srcId);
      if (!src) return;
      const wid = `${srcId}->${target.node.id}:${pinIndex}`;
      const dst = target.pins[pinIndex] ?? { x: target.x, y: target.y };
      // Drop in the source column's drop band; rise in the destination's rise
      // band. The two bands are disjoint, so unrelated nets can never share a
      // vertical x (which the simulator would read as one conductor).
      const dropFn = dropXAt[src.col];
      const riseFn = riseXAt[target.col];
      if (!dropFn || !riseFn) return;
      const dropX = dropFn(leaveSlot.get(wid) ?? 0);
      const riseX = riseFn(enterSlot.get(wid) ?? 0);
      routed.push({
        from: src, to: target, pinIndex, dropX, riseX,
        corridorY: corridorBase, dx: dst.x, dy: dst.y,
      });
    });
  }

  // One corridor lane per wire keeps different nets off the same horizontal.
  routed.forEach((w, i) => {
    w.corridorY = corridorBase + i * FALSTAD_GRID;
  });

  /* ---- 6. emit elements, recording their posts ------------------------ */
  for (const p of placed) {
    const n = p.node;
    if (n.type === 'input' || n.type === 'const') {
      const high = n.type === 'const' && n.constValue === 1 ? 1 : 0;
      // Single post at (x,y); the second pair only points the label leftward.
      // Position is an INTEGER because the loader inverts true/false here.
      sink.line(`L ${p.x} ${p.y} ${p.x - 32} ${p.y} 0 ${high} false 5 0`);
      sink.post(p.x, p.y);
      continue;
    }
    if (n.type === 'not') {
      // Params omitted: defaults are slewRate .5 / highVoltage 5.
      sink.line(`I ${p.x} ${p.y} ${p.outX} ${p.outY} 0`);
      sink.post(p.x, p.y);
      sink.post(p.outX, p.outY);
      continue;
    }
    if (n.type === 'out') {
      sink.line(`M ${p.x} ${p.y} ${p.x + 64} ${p.y} 0`);
      sink.post(p.x, p.y);
      continue;
    }
    const type = FALSTAD_GATE_TYPE[n.type];
    if (type !== undefined) {
      const count = Math.max(2, n.operandIds.length);
      // inputCount lastOutputVoltage highVoltage
      sink.line(`${type} ${p.x} ${p.y} ${p.outX} ${p.outY} 0 ${count} 0 5`);
      sink.gates++;
      sink.post(p.outX, p.outY);
      for (const pin of p.pins) sink.post(pin.x, pin.y);
      continue;
    }
  }

  /* ---- 7. emit the wires ---------------------------------------------- */
  for (const w of routed) {
    sink.post(w.from.outX, w.from.outY);      // the driver's output post
    sink.wire(w.from.outX, w.from.outY, w.dropX, w.from.outY);
    sink.wire(w.dropX, w.from.outY, w.dropX, w.corridorY);
    sink.wire(w.dropX, w.corridorY, w.riseX, w.corridorY);
    sink.wire(w.riseX, w.corridorY, w.riseX, w.dy);
    sink.wire(w.riseX, w.dy, w.dx, w.dy);
  }

  const corridorHeight = routed.length > 0 ? (routed.length - 1) * FALSTAD_GRID + 96 : 0;
  // Reserve the larger of what was actually used and the band pitch handed in,
  // so the NEXT segment's corridor can never reach up into this one's.
  return Math.max((corridorBase - originY) + corridorHeight, reservedBand);
}

/** Filename stem used by the export menu. */
export function falstadFilename(projectName: string, options: FalstadExportOptions): string {
  const seg = options.segments && options.segments.length === 1 ? `-${options.segments[0]}` : '';
  return `${projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}-falstad${seg}-${options.form}`;
}
