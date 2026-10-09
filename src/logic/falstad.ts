/**
 * Falstad / CircuitJS1 exporter — writes the classic `$` text netlist that
 * falstad.com/circuit opens via File → Open File… or "Import From Text".
 *
 * Two export shapes share one layout engine:
 *   - buildFalstadNetlist: one self-contained circuit per segment (probe out).
 *   - buildFalstadDisplayNetlist: ONE file — every segment decoder stacked as
 *     a band, all bands fed by ONE shared input bus, and a real SevenSegElm
 *     (type 157, 8 pins incl. DP) driven by the segment circuits, so toggling
 *     the shared switches in CircuitJS1 lights the actual digit.
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
 * THE COMBINED DISPLAY EXPORT — layout contract (also hazard-analyzed)
 * ---------------------------------------------------------------------------
 *   SHARED INPUT BUS: each variable k gets ONE `L` switch on a diagonal
 *   staircase at the top (x = 48+16·k, y = 32+64·k — the 64px y-steps sit in a
 *   different residue class mod 64 than the band pin rows (112+64·m), so an L
 *   post can never land on a band's input wire). Each L drives a vertical RAIL
 *   at its own x that runs down PAST every band, EMITTED AS CONSECUTIVE
 *   SEGMENTS between the pin rows; a band's input pins for variable k are
 *   placed exactly ON that rail (staircase x), so each pin is an
 *   endpoint-to-endpoint join of the rail segments — one net per variable, and
 *   the no-dangling / no-foreign-endpoint checks see it as such. The rails
 *   live in the free zone x ∈ [48,112], left of the first gate column
 *   (x ≥ 128), so they cross only perpendicular runs.
 *
 *   DISPLAY: one SevenSegElm at the top right — `157 XD YD XD+64 YD 0 7 1 0`
 *   (8 pins incl. DP). Pin geometry as PROBED from the live falstad.com app
 *   (the app's own dump is `<ssd x="… 464 …" …/>` = x2 x+64, and the pins
 *   come out at the 32px scale regardless of x2): a,b,c,d on the WEST edge
 *   at (XD, YD+32·i); e,f,g,dp on the EAST edge at (XD+192, YD+32·k); the
 *   body spans (XD, YD-32)…(XD+160, YD+96). West pins are fed from a LEFT fan
 *   band (one rise slot per segment, ordered a→d), east pins from a RIGHT fan
 *   band (ordered e→dp). Each segment's net leaves its band's root driver, drops
 *   into the band's deepest corridor lane (the "deepest lane privilege": every
 *   other vertical in the band ends above it, so the long run to the fan
 *   crosses nothing), rises in its fan slot, and stubs horizontally into the
 *   pin. Fan slot order matches pin y order, which keeps every fan-rise ×
 *   pin-stub interaction a perpendicular non-connection. Constant segments
 *   get a dedicated HIGH/LOW `L` stubbed straight into their pin.
 *
 * ---------------------------------------------------------------------------
 * FORMAT FACTS (verified against pfalstad/circuitjs1 source + the shipped
 * https://www.falstad.com/circuit/circuitjs110/circuits/xor.txt, and the 157
 * display geometry re-verified empirically against the live app 2026-10-09)
 * ---------------------------------------------------------------------------
 *  - Header: one line, `$ <flags> <maxTimeStep> <iterCount> <currentBar>
 *    <voltageRange> [<powerBar>] [<minTimeStep>]`; the last two are optional
 *    (the loader wraps them in try/catch), so the portable 5-field form is used.
 *  - Component: `<type> <x> <y> <x2> <y2> <flags> [params…]`.
 *  - Logic gates are NUMERIC types: AND=150 NAND=151 OR=152 NOR=153 XOR=154
 *    XNOR=431, params `inputCount lastOutputVoltage [highVoltage]`.
 *  - SevenSegElm is type 157, params `baseSegmentCount extraSegment
 *    diodeDirection` (7 / 0|1|2 DP|colon / 0 = plain logic inputs).
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
import { mintermToTerm, maxtermToTerm } from './expressions';
import type { Term } from '@/types/simulator';

/**
 * The terms one segment's circuit is built from. Mirrors the on-screen
 * LogicCircuitCard: minimized covers for 'sop'/'pos', the unminimized
 * minterm/maxterm lists for the canonical 'csop'/'cpos'.
 */
function termsForSegment(
  engine: SegmentEngineMap[SegmentName],
  form: 'sop' | 'pos',
  canonical: boolean,
  inputBits: InputWidth,
  varNames: string[],
): Term[] {
  if (!canonical) return form === 'sop' ? engine.activeSopTerms : engine.activePosTerms;
  return form === 'sop'
    ? engine.ones.map((m) => mintermToTerm(m, inputBits, varNames))
    : engine.zeros.map((m) => maxtermToTerm(m, inputBits, varNames));
}

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
  /** Canonical (unminimized) netlists, like the on-screen csop/cpos forms. */
  canonical?: boolean;
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

/** Result of the combined (single-file, display) export. */
export interface FalstadDisplayResult extends FalstadExportResult {
  /** The 157 display element's origin and all eight pin posts. */
  display: {
    x: number;
    y: number;
    pins: Partial<Record<SegmentName, { x: number; y: number }>>;
  };
  /** How each display pin is driven. */
  driving: Partial<Record<SegmentName, 'circuit' | 'high' | 'low'>>;
}

/**
 * Constant-segment detection from the minimized engine: a segment is constant
 * when its SOP cover is the empty term (constant 1), its POS cover is the empty
 * term (constant 0), or both covers are empty (all don't-care — treated as 0,
 * matching what the minimized circuit shows). Returns the constant value, or
 * null when the segment actually depends on the inputs.
 */
function segmentConstValue(engine: { activeSopTerms: { literals: unknown[] }[]; activePosTerms: { literals: unknown[] }[] }): 0 | 1 | null {
  if (engine.activeSopTerms.some((t) => t.literals.length === 0)) return 1;
  if (engine.activePosTerms.some((t) => t.literals.length === 0)) return 0;
  if (engine.activeSopTerms.length === 0 && engine.activePosTerms.length === 0) return 0;
  return null;
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

/** Options that switch emitCircuit into combined-display mode. */
interface EmitOptions {
  /** Input pins sit on the shared staircase rails (x = originX+16·(k+1)) and
   *  the per-band `L` switches for VARIABLES are not emitted — the shared bus
   *  at the top drives them. `const` nodes still get their fixed `L`s. */
  sharedInputs?: boolean;
  /** The `M` output probe is not emitted and its wire is not routed; the net
   *  leaves the root driver's output post instead (returned as displayNet). */
  skipOutProbe?: boolean;
}

/** What emitCircuit produced, for the callers' global layout. */
interface EmitResult {
  /** Vertical extent the caller must reserve for this band. */
  height: number;
  /** Rightmost x this band occupies (incl. its output-gap drop slot). */
  rightEdge: number;
  /** Display-net source and drop geometry (skipOutProbe mode). */
  displayNet: { srcX: number; srcY: number; dropX: number; laneY: number } | null;
  /** Staircase input pins placed in this band (sharedInputs mode). */
  inputPins: { varName: string; x: number; y: number }[];
}

/** Staircase rail x for variable k (the free zone left of the gate columns). */
function staircaseX(originX: number, varIdx: number): number {
  return originX + FALSTAD_GRID * (varIdx + 1);
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
    // Canonical forms are NEVER const-shortcut: their unminimized netlists
    // (including the don't-care quirk of canonical POS) must match the
    // on-screen circuit exactly — buildCircuit([]) yields a const-root node.
    if (!options.canonical && segmentConstValue(engine) !== null && options.skipConstant !== false) continue;
    const terms = termsForSegment(engine, options.form, options.canonical === true, inputBits, varNames);
    const circuit: Circuit = options.style === 'factored'
      ? buildFactoredCircuit(terms, varNames, options.form)
      : buildCircuit(terms, options.form, varNames, options.style);
    measured.push({ seg, circuit });
  }

  let maxWires = 0;
  for (const { circuit } of measured) maxWires = Math.max(maxWires, circuit.wires.length);
  const bandPitch = 384 + maxWires * FALSTAD_GRID * 2;

  for (const { seg, circuit } of measured) {
    const before = { gates: sink.gates, wires: sink.wires };
    const { height } = emitCircuit(sink, circuit, cursorX, cursorY, bandPitch, {});
    perSegment[seg] = { gates: sink.gates - before.gates, wires: sink.wires - before.wires };
    cursorY += Math.max(height, bandPitch) + 160;
  }

  return {
    text: sink.text(),
    perSegment,
    connectionPoints: sink.connectionPoints,
    wirePoints: sink.wirePoints,
    segments: sink.segments,
  };
}

/**
 * Emit one segment's circuit starting at (originX, originY); returns the
 * band's extent plus (in combined mode) the display-net plumbing.
 */
function emitCircuit(
  sink: Sink,
  circuit: Circuit,
  originX: number,
  originY: number,
  /** Vertical room reserved before the next segment's band may start. */
  reservedBand: number,
  options: EmitOptions,
  /** Variable names, for the shared-input staircase. */
  varNames: string[] = [],
): EmitResult {
  /* ---- 0. combined mode: the out probe leaves, the display net replaces it */
  const layoutNodes = options.skipOutProbe
    ? circuit.nodes.filter((n) => n.type !== 'out')
    : circuit.nodes;
  const outNode = circuit.nodes.find((n) => n.type === 'out');
  const rootId = outNode?.operandIds[0];

  /* ---- 1. columns: one per distinct x in the builder's layout ---------- */
  const colKeys = [...new Set(layoutNodes.map((n) => Math.round(n.x)))].sort((a, b) => a - b);
  const cols: CNode[][] = colKeys.map((k) =>
    layoutNodes
      .filter((n) => Math.round(n.x) === k)
      .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id)),
  );

  /* ---- 2. which wires leave / enter each column ------------------------ */
  const colOf = new Map<string, number>();
  cols.forEach((col, ci) => col.forEach((n) => colOf.set(n.id, ci)));

  // Variables actually referenced by this band's logic (a minimized form may
  // drop a variable; its input node exists but drives nothing, so the shared
  // rail must not extend to its pin — the pin would dangle).
  const referenced = new Set<string>();
  for (const n of layoutNodes) {
    for (const opId of n.operandIds) referenced.add(opId);
  }
  if (rootId !== undefined) referenced.add(rootId); // display-net source

  const leaving = cols.map(() => 0);
  const entering = cols.map(() => 0);
  for (const n of layoutNodes) {
    const ci = colOf.get(n.id)!;
    for (const opId of n.operandIds) {
      const sj = colOf.get(opId);
      if (sj === undefined) continue;
      leaving[sj]++;
      entering[ci]++;
    }
  }

  // Combined mode: the display net needs ONE drop slot in the root driver's
  // gap (the root→out wire is no longer counted, so this reclaims its room).
  // When the root sits in the LAST column the drop happens in the fresh output
  // gap instead (no slot reservation needed there).
  const rootCol = rootId !== undefined ? colOf.get(rootId) : undefined;
  const displayDropSlot = options.skipOutProbe && rootCol !== undefined && rootCol < cols.length - 1
    ? leaving[rootCol]++
    : -1;

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
  const inputPins: { varName: string; x: number; y: number }[] = [];
  let bottom = originY;
  cols.forEach((col, ci) => {
    let cursor = originY;
    for (const n of col) {
      const span = spanOf(n);
      const y = cursor + span;
      const isGate = !!FALSTAD_GATE_TYPE[n.type];
      const isInput = n.type === 'input' || n.type === 'const';
      const isProbe = n.type === 'out';

      // Shared-input mode: VARIABLE nodes sit on the shared staircase rail
      // (same x in every band, so the rail's pass-through is the connection).
      // Const nodes keep the column position — they are per-band fixed L's.
      const onRail = options.sharedInputs && n.type === 'input' && n.varName !== undefined
        ? staircaseX(originX, Math.max(0, varNames.indexOf(n.varName)))
        : colX[ci];
      const nodeX = onRail;

      // Input pins at the body's left edge; the output at its right edge.
      const pins: { x: number; y: number }[] = [];
      if (isGate) {
        for (const off of gatePinOffsets(Math.max(2, n.operandIds.length))) {
          pins.push({ x: colX[ci], y: y + off });
        }
      } else if (n.type === 'not' || isProbe) {
        pins.push({ x: nodeX, y });
      }
      const outX = isInput ? nodeX : colX[ci] + (n.type === 'not' || isGate ? BODY_W : 0);

      const p: Placed = {
        node: n, col: ci, x: nodeX, y, span,
        outX, outY: y, pins,
      };
      placed.push(p);
      byId.set(n.id, p);
      if (options.sharedInputs && n.type === 'input' && n.varName !== undefined
        && referenced.has(n.id)) {
        inputPins.push({ varName: n.varName, x: nodeX, y });
      }
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

  // The display net gets the DEEPEST lane: every other vertical in the band
  // ends above it, so its long horizontal run to the display fan crosses
  // nothing (the "deepest lane privilege").
  const displayNet = options.skipOutProbe && rootId !== undefined && rootCol !== undefined
    ? (() => {
        const root = byId.get(rootId);
        if (!root) return null;
        const dropX = rootCol < cols.length - 1 && dropXAt[rootCol]
          ? dropXAt[rootCol](displayDropSlot)
          : colX[cols.length - 1] + BODY_W + FALSTAD_GRID;
        return {
          srcX: root.outX,
          srcY: root.outY,
          dropX,
          laneY: corridorBase + routed.length * FALSTAD_GRID,
        };
      })()
    : null;

  /* ---- 6. emit elements, recording their posts ------------------------ */
  for (const p of placed) {
    const n = p.node;
    if (n.type === 'input' || n.type === 'const') {
      // Shared-input mode does not emit per-band L's for VARIABLES — the shared
      // bus drives them. Const nodes still get their fixed L.
      if (options.sharedInputs && n.type === 'input') continue;
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

  const lanes = routed.length + (displayNet ? 1 : 0);
  const corridorHeight = lanes > 0 ? (lanes - 1) * FALSTAD_GRID + 96 : 0;
  // Reserve the larger of what was actually used and the band pitch handed in,
  // so the NEXT segment's corridor can never reach up into this one's.
  const height = Math.max((corridorBase - originY) + corridorHeight, reservedBand);
  const rightEdge = displayNet
    ? Math.max(colX[cols.length - 1] + BODY_W, displayNet.dropX + FALSTAD_GRID)
    : colX[cols.length - 1] + BODY_W + 64;
  return { height, rightEdge, displayNet, inputPins };
}

/** Filename stem used by the export menu. */
export function falstadFilename(projectName: string, options: FalstadExportOptions): string {
  const seg = options.segments && options.segments.length === 1 ? `-${options.segments[0]}` : '';
  return `${projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}-falstad${seg}-${options.form}`;
}

/* ------------------------------------------------------------------ */
/* The combined display export                                          */
/* ------------------------------------------------------------------ */

/** x of the shared input L for variable k (diagonal staircase, top left). */
const railTopY = (varIdx: number): number => 32 + 64 * varIdx;

/**
 * Build ONE classic `$` netlist containing every segment decoder, a shared
 * input bus, and a real SevenSegElm (157, 8 pins incl. DP) — so the file
 * opened at falstad.com/circuit is the whole app: flip the shared switches,
 * watch the digit.
 *
 * Layout contract (hazard-analyzed in the file header):
 *   - bands stacked as in buildFalstadNetlist, all starting at the same x so
 *     the shared staircase rails line up;
 *   - each band's display net leaves the root driver, drops into the band's
 *     deepest corridor lane, and runs right to the display fan;
 *   - WEST pins (a-d) rise in the left fan (slot order = pin order), EAST pins
 *     (e,f,g,dp) in the right fan past the display;
 *   - constant segments are driven by dedicated HIGH/LOW `L`s at the pin;
 *   - every variable gets ONE `L` whose vertical rail passes exactly through
 *     each band's input pin for that variable (one net per variable).
 */
export function buildFalstadDisplayNetlist(
  engines: SegmentEngineMap,
  inputBits: InputWidth,
  varNames: string[],
  options: FalstadExportOptions,
): FalstadDisplayResult {
  const segments = options.segments && options.segments.length > 0
    ? options.segments
    : [...SEGMENT_NAMES];
  const sink = new Sink();
  const perSegment: FalstadDisplayResult['perSegment'] = {};
  const driving: FalstadDisplayResult['driving'] = {};

  const cursorX = 32;          // fixed: the staircase rails depend on it
  let cursorY = 96;

  // ---- 1. circuits per segment; constants recorded, circuits skipped -------
  interface Planned { seg: SegmentName; circuit: Circuit | null; constValue: 0 | 1 | null }
  const planned: Planned[] = [];
  for (const seg of segments) {
    const engine = engines[seg];
    // Canonical mode: never const-shortcut (matches the on-screen canonical
    // netlists, don't-care quirks included — see buildFalstadNetlist).
    const constValue = options.canonical ? null : segmentConstValue(engine);
    if (constValue !== null) {
      planned.push({ seg, circuit: null, constValue });
      continue;
    }
    const terms = termsForSegment(engine, options.form, options.canonical === true, inputBits, varNames);
    const circuit: Circuit = options.style === 'factored'
      ? buildFactoredCircuit(terms, varNames, options.form)
      : buildCircuit(terms, options.form, varNames, options.style);
    planned.push({ seg, circuit, constValue: null });
  }

  let maxWires = 0;
  for (const p of planned) if (p.circuit) maxWires = Math.max(maxWires, p.circuit.wires.length);
  const bandPitch = 384 + maxWires * FALSTAD_GRID * 2;

  // ---- 2. emit the bands (circuit mode: shared inputs, no probe) ----------
  const bands: { seg: SegmentName; res: EmitResult }[] = [];
  for (const { seg, circuit } of planned) {
    if (!circuit) continue;
    const before = { gates: sink.gates, wires: sink.wires };
    const res = emitCircuit(sink, circuit, cursorX, cursorY, bandPitch, {
      sharedInputs: true,
      skipOutProbe: true,
    }, varNames);
    bands.push({ seg, res });
    perSegment[seg] = { gates: sink.gates - before.gates, wires: sink.wires - before.wires };
    driving[seg] = 'circuit';
    cursorY += Math.max(res.height, bandPitch) + 160;
  }

  // ---- 3. the shared input bus (one L + one rail per variable) ------------
  const pinsByVar = new Map<string, { x: number; y: number }[]>();
  for (const b of bands) {
    for (const pin of b.res.inputPins) {
      const list = pinsByVar.get(pin.varName) ?? [];
      list.push({ x: pin.x, y: pin.y });
      pinsByVar.set(pin.varName, list);
    }
  }
  for (const [k, v] of varNames.entries()) {
    const pins = (pinsByVar.get(v) ?? []).sort((a, b) => a.y - b.y);
    if (pins.length === 0) continue; // minimized out of every band — unused
    const x = staircaseX(cursorX, k);
    const yL = railTopY(k);
    // Position 0 (LOW): the user flips the switches in the simulator.
    sink.line(`L ${x} ${yL} ${x - 32} ${yL} 0 0 false 5 0`);
    sink.post(x, yL);
    // The rail is emitted as CONSECUTIVE SEGMENTS between the pin rows (the
    // L post → first pin → … → deepest pin), so every band's pin for this
    // variable is an endpoint-to-endpoint join: one net per variable, and the
    // geometry checks see every join as a shared endpoint, never a dangle.
    let prevY = yL;
    for (const pin of pins) {
      sink.wire(x, prevY, x, pin.y);
      prevY = pin.y;
    }
  }

  // ---- 4. the display + fan geometry --------------------------------------
  // Pin layout probed from the live app (see file header): west pins at
  // (XD, YD+32·i), east pins at (XD+192, YD+32·k); body (XD,YD-32)…(XD+160,YD+96).
  const rightEdge = bands.reduce((m, b) => Math.max(m, b.res.rightEdge), 0);
  const westFan = (i: number) => rightEdge + FALSTAD_GRID * (i + 1);        // a-d
  const XD = westFan(3) + 2 * FALSTAD_GRID;                                  // display left edge
  const YD = 32;
  const eastFan = (k: number) => XD + 192 + 32 + FALSTAD_GRID * k;           // e,f,g,dp

  const westPins = ['A', 'B', 'C', 'D'] as SegmentName[];
  const eastPins = ['E', 'F', 'G', 'DP'] as SegmentName[];
  const pins: FalstadDisplayResult['display']['pins'] = {};
  westPins.forEach((seg, i) => { pins[seg] = { x: XD, y: YD + 32 * i }; });
  eastPins.forEach((seg, k) => { pins[seg] = { x: XD + 192, y: YD + 32 * k }; });

  // ---- 5. per segment: route the display net / drive constant pins --------
  for (const { seg, circuit, constValue } of planned) {
    const pin = pins[seg]!;
    if (!circuit || constValue !== null) {
      // Constant segment: a dedicated fixed L stubbed straight into the pin.
      // West pins take it from the left, east pins from the right — the same
      // side their fan would use, so no other net is ever on that stub's line.
      const high = constValue === 1 ? 1 : 0;
      const lX = westPins.includes(seg) ? pin.x - 16 : pin.x + 16;
      sink.line(`L ${lX} ${pin.y} ${lX - 32} ${pin.y} 0 ${high} false 5 0`);
      sink.post(lX, pin.y);
      sink.wire(lX, pin.y, pin.x, pin.y);
      driving[seg] = high ? 'high' : 'low';
      perSegment[seg] = { gates: 0, wires: (perSegment[seg]?.wires ?? 0) + 1 };
      continue;
    }
    const band = bands.find((b) => b.seg === seg)!;
    const net = band.res.displayNet;
    if (!net) continue;
    const isWest = westPins.includes(seg);
    const riseX = isWest
      ? westFan(westPins.indexOf(seg))
      : eastFan(eastPins.indexOf(seg));
    // Root driver → drop → deepest lane → run under everything → rise → pin.
    sink.wire(net.srcX, net.srcY, net.dropX, net.srcY);
    sink.wire(net.dropX, net.srcY, net.dropX, net.laneY);
    sink.wire(net.dropX, net.laneY, riseX, net.laneY);
    sink.wire(riseX, net.laneY, riseX, pin.y);
    sink.wire(riseX, pin.y, pin.x, pin.y);
    perSegment[seg] = {
      gates: perSegment[seg]?.gates ?? 0,
      wires: (perSegment[seg]?.wires ?? 0) + 5,
    };
  }

  // ---- 6. the display element itself --------------------------------------
  // 157 x y x2 y2 flags baseSegmentCount extraSegment(DP) diodeDirection(0)
  // x2 = x+64 is the app's own canonical dump form (drag-snapped placement).
  sink.line(`157 ${XD} ${YD} ${XD + 64} ${YD} 0 7 1 0`);
  for (const seg of [...westPins, ...eastPins]) {
    const pin = pins[seg]!;
    sink.post(pin.x, pin.y);
  }

  return {
    text: sink.text(),
    perSegment,
    connectionPoints: sink.connectionPoints,
    wirePoints: sink.wirePoints,
    segments: sink.segments,
    display: { x: XD, y: YD, pins },
    driving,
  };
}

/** Filename stem for the combined display export. */
export function falstadDisplayFilename(projectName: string, options: FalstadExportOptions): string {
  return `${projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}-falstad-display-${options.form}`;
}
