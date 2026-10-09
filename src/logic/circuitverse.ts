/**
 * CircuitVerse project exporter: converts the simulator's per-segment Boolean
 * logic (minimized SOP cover or canonical minterm SOP) into a `.cv` project
 * file — the plain-JSON format consumed by circuitverse.org/simulator
 * (File → Import). Pure logic, no DOM side effects.
 *
 * Layout (v2 — "Combinational Analysis" style):
 * Replicates the geometry of circuitverse.org's own Combinational Analysis
 * generator (frontend/src/simulator/src/combinationalAnalysis.js), so the
 * exported circuit looks hand-organized instead of like a wire nest:
 *  - Inputs sit in one top row (direction DOWN, 40px pitch); per-variable
 *    NOT gates hang 20px right of each input, forming dual vertical rails
 *    (direct + inverted) that descend the left edge in lockstep.
 *  - Rails advance through a "rail cursor": each gate-input tap drops the
 *    rail to the pin's row and runs ONE horizontal into the pin, so taps
 *    stack end-to-end and never overlap (CA's logixNodes pattern). Rail
 *    junction bends carry up to 3 connections — exactly what CV's own
 *    generator produces.
 *  - One AND column: one AndGate per multi-literal product term, stacked in
 *    term order with CA's c*10+30 pitch; single-literal terms use a junction
 *    "substitute" node at the column; constant segments use a ConstantVal.
 *  - One OR column with CA's symmetric staircase fan (a shared vertical
 *    channel per fanout pair j / n-1-j). Segments with more than 8 terms
 *    combine through a balanced tree of <=8-input OrGates whose levels
 *    cascade right in 90px columns.
 *  - A reserved 220px band in the middle hosts the SevenSegDisplay: OR
 *    groups of top-pin segments (G F A B) sit above it, bottom-pin groups
 *    (E D C DP) below, and constant / single-term groups pin to the very
 *    bottom (their feeds then cross nothing but empty corridors). Every
 *    display feed gets a dedicated vertical channel and a staggered lane
 *    that enters its pin vertically.
 * Geometric invariants (enforced by scripts/verify-circuitverse.ts): every
 * wire renders orthogonal, zero overlapping collinear wire pairs, zero
 * coincident nodes, zero wires crossing component bodies, zero overlapping
 * component boxes, all coordinates on the 10px grid.
 *
 * Format notes (verified against the CircuitVerse simulator sources):
 *  - Top level must carry EXACTLY the 7 keys `name, timePeriod, clockEnabled,
 *    projectId, focussedCircuit, orderedTabs, scopes` IN THAT ORDER (the
 *    importer compares `JSON.stringify(Object.keys(data))` against that list).
 *  - Wires are not serialized as objects: a wire is a MUTUAL pair of node
 *    indices inside `allNodes[i].connections`; bends are type-2 nodes with
 *    absolute coordinates, listed in `scope.nodes`.
 *  - Component pin nodes store x/y RELATIVE to their component's origin and
 *    MUST match the constructor offsets below, or the imported canvas renders
 *    pins at the wrong spots. For direction-DOWN components (Input, NotGate)
 *    the stored offsets stay RAW (e.g. Input output1 = (10,0)); the loader
 *    applies node.js `rotate(offset, parent.direction)` at render time, so
 *    DOWN pins render below their parent — mirroring what CV's own CA
 *    generator saves after a direction change.
 *  - The key is spelled `constructorParamaters` (upstream misspelling) and
 *    ConstantVal states must be JSON STRINGS ("0"/"1") — the constructor does
 *    `state.length`.
 */
import {
  SEGMENT_NAMES,
  type InputWidth,
  type Literal,
  type SegmentName,
  type Term,
} from '@/types/simulator';
import { inputVarNames } from '@/logic/binary';
import { implicantToSopTerm } from './expressions';
import type { SegmentEngineMap } from './engine';

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export type CircuitverseLogicSource = 'minimized' | 'direct';

export interface CircuitverseExportOptions {
  /** Project name written into the file. */
  title: string;
  /**
   * 'minimized' = engines[seg].activeSopTerms (Quine-McCluskey cover);
   * 'direct'    = canonical minterm SOP built from engines[seg].ones.
   */
  logicSource: CircuitverseLogicSource;
  /** Custom variable names (MSB first) for input labels; defaults to A B C (D) (E). */
  varNames?: string[];
}

export interface CircuitverseSegmentStat {
  segment: SegmentName;
  andGates: number;
  orGates: number;
  /** null = segment driven by gates (not a constant). */
  constant: 0 | 1 | null;
}

export interface CircuitverseStats {
  inputs: number;
  inverters: number;
  andGates: number;
  orGates: number;
  constants: number;
  /** Total node-pair connections (undirected wire edges). */
  wires: number;
  /** Type-2 bend nodes. */
  intermediates: number;
  /** Longest gate path from an input to a display pin. */
  maxDepth: number;
  segments: CircuitverseSegmentStat[];
}

export interface CircuitverseBuildResult {
  /** Pretty-printed (2-space) .cv project JSON. */
  json: string;
  stats: CircuitverseStats;
}

export function buildCircuitverseProject(
  inputBits: InputWidth,
  engines: SegmentEngineMap,
  options: CircuitverseExportOptions,
): CircuitverseBuildResult {
  if (inputBits !== 4 && inputBits !== 5) {
    throw new Error(`E-240: unsupported input width ${inputBits} (CircuitVerse export supports 4 or 5)`);
  }
  for (const seg of SEGMENT_NAMES) {
    const engine = engines[seg];
    if (!engine || !Array.isArray(engine.activeSopTerms) || !Array.isArray(engine.ones)) {
      throw new Error(`E-241: engine map is missing segment '${seg}'`);
    }
  }

  const builder = new CircuitverseBuilder(inputBits, options);
  return builder.build(engines);
}

/* ------------------------------------------------------------------ */
/* CircuitVerse JSON shapes (internal)                                 */
/* ------------------------------------------------------------------ */

interface CvNode {
  /** Pin offset relative to the parent origin (types 0/1) or absolute canvas coordinate (type 2). */
  x: number;
  y: number;
  /** 0 = component input pin, 1 = component output pin, 2 = wire bend. */
  type: 0 | 1 | 2;
  bitWidth: number;
  label: string;
  connections: number[];
}

interface CvCustomData {
  nodes: Record<string, number | number[]>;
  values?: { state: number };
  constructorParamaters: unknown[];
}

interface CvComponent {
  x: number;
  y: number;
  objectType: string;
  label: string;
  direction: 'RIGHT' | 'DOWN';
  labelDirection: 'LEFT' | 'UP';
  propagationDelay: number;
  customData: CvCustomData;
  subcircuitMetadata?: {
    showInSubcircuit: boolean;
    showLabelInSubcircuit: boolean;
    labelDirection: 'LEFT';
    x: number;
    y: number;
  };
}

/* ------------------------------------------------------------------ */
/* Pin offsets — mirror of the CircuitVerse constructors               */
/* ------------------------------------------------------------------ */

/**
 * AndGate input-pin y offsets in CREATION order (modules/AndGate.js):
 * odd n  → -10..-10m (ascending magnitude), 0, +10..+10m   (m = (n-1)/2)
 * even n → -10..-10m (ascending magnitude), +10..+10m      (m = n/2)
 */
export function andGateInputOffsets(n: number): number[] {
  const ys: number[] = [];
  if (n % 2 === 1) {
    const m = (n - 1) / 2;
    for (let k = 1; k <= m; k++) ys.push(-10 * k);
    ys.push(0);
    for (let k = 1; k <= m; k++) ys.push(10 * k);
  } else {
    const m = n / 2;
    for (let k = 1; k <= m; k++) ys.push(-10 * k);
    for (let k = 1; k <= m; k++) ys.push(10 * k);
  }
  return ys;
}

/**
 * OrGate input-pin y offsets in CREATION order (modules/OrGate.js):
 * odd n  → -10m..-10 (descending magnitude), 0, +10..+10m  (m = floor(n/2))
 * even n → -10m..-10 (descending magnitude), +10..+10m     (m = n/2)
 */
export function orGateInputOffsets(n: number): number[] {
  const ys: number[] = [];
  if (n % 2 === 1) {
    const m = Math.floor(n / 2);
    for (let k = m; k >= 1; k--) ys.push(-10 * k);
    ys.push(0);
    for (let k = 1; k <= m; k++) ys.push(10 * k);
  } else {
    const m = n / 2;
    for (let k = m; k >= 1; k--) ys.push(-10 * k);
    for (let k = 1; k <= m; k++) ys.push(10 * k);
  }
  return ys;
}

/** SevenSegDisplay pin offsets (modules/SevenSegDisplay.js) — creation order g,f,a,b,e,d,c,dot. */
const SEVENSEG_PINS: { key: SegmentName; x: number; y: number }[] = [
  { key: 'G', x: -20, y: -50 },
  { key: 'F', x: -10, y: -50 },
  { key: 'A', x: 10, y: -50 },
  { key: 'B', x: 20, y: -50 },
  { key: 'E', x: -20, y: 50 },
  { key: 'D', x: -10, y: 50 },
  { key: 'C', x: 10, y: 50 },
  { key: 'DP', x: 20, y: 50 },
];

/* ------------------------------------------------------------------ */
/* Layout constants (Combinational-Analysis geometry)                   */
/* ------------------------------------------------------------------ */

/** Segments whose display pins sit on the TOP edge of the display. */
const TOP_SEGMENTS: SegmentName[] = ['G', 'F', 'A', 'B'];
/** Segments whose display pins sit on the BOTTOM edge. */
const BOTTOM_SEGMENTS: SegmentName[] = ['E', 'D', 'C', 'DP'];

const START_X = 200;        // first input x (CA: startPosX)
const START_Y = 200;        // input row y (CA: startPosY)
const INPUT_PITCH = 40;     // input column pitch (CA)
const INVERT_DX = 20;       // NOT gate x offset right of its input (CA)
const RAIL_HEAD_DY = 20;    // direct-rail head bend below the input row (CA)
const NOT_DY = 40;          // NOT center below the input row (CA)
const AND_GAP = 80;         // andX = last rail + gap (CA: inputCount*40 + 40 + 40)
const OR_MARGIN = 60;       // corridor between the AND column and the OR column, past the widest staircase
const TREE_LEVEL_DX = 90;   // OR-tree level column pitch (clears a <=8-input staircase)
const DISPLAY_BAND = 220;   // reserved vertical band hosting the display + lanes
const FIRST_TERM_DY = 140;  // first term slot below START_Y
const TERM_GAP = 30;        // base gap in the per-term advance (CA: c*10 + 30)
const MIN_OR_GAP = 30;      // minimum clearance below an OR body before the next group
const LANE_PITCH = 10;      // display-feed lane/channel stagger
const TOP_LANE_DY = 60;     // first lane above the display pins (pins at ±50)
const BOT_LANE_DY = 60;     // first lane below the display pins
const FEED_CH_TOP = 20;     // top-feed channel base offset past feedBaseX
const FEED_CH_BOT = 60;     // bottom-feed channel base offset past feedBaseX
const DISPLAY_DX = 160;     // dispX past feedBaseX

/* ------------------------------------------------------------------ */
/* Ids (crypto-free, mirrors CircuitVerse utils.generateId)            */
/* ------------------------------------------------------------------ */

const ID_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomId(length = 20): string {
  let id = '';
  for (let i = 0; i < length; i++) id += ID_CHARSET[Math.floor(Math.random() * ID_CHARSET.length)];
  return id;
}

/** Truthy 10-digit scope id. */
function randomScopeId(): number {
  return 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
}

/* ------------------------------------------------------------------ */
/* Term helpers                                                        */
/* ------------------------------------------------------------------ */

/** Remove exact duplicate literals (A·A ≡ A) while keeping complementary pairs. */
function dedupeLiterals(literals: Literal[]): Literal[] {
  const seen = new Set<string>();
  const out: Literal[] = [];
  for (const lit of literals) {
    const key = `${lit.complemented ? '~' : ''}${lit.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(lit);
    }
  }
  return out;
}

/** Balanced split of m items into chunks of at most 8 (OR-tree fan-in limit). */
function chunkSizes(m: number): number[] {
  const chunks = Math.ceil(m / 8);
  const base = Math.floor(m / chunks);
  const rem = m % chunks;
  return Array.from({ length: chunks }, (_, i) => base + (i < rem ? 1 : 0));
}

/** Number of OrGate tree levels needed to combine m term nets (0 = no OR). */
function treeLevels(m: number): number {
  if (m <= 1) return 0;
  if (m <= 8) return 1;
  return 1 + treeLevels(chunkSizes(m).length);
}

/** Round up to the next 10px grid line. */
function snapUp10(v: number): number {
  return Math.ceil(v / 10) * 10;
}

/** A driven signal: the driving node index plus its logic depth from the inputs. */
interface Net {
  node: number;
  depth: number;
}

/** A placed signal that can feed an OR input: absolute source position + net. */
interface TermNode {
  x: number;
  y: number;
  net: Net;
}

/** One segment's final signal and where it comes from (feeds the display). */
interface Feed {
  seg: SegmentName;
  x: number;
  y: number;
  net: Net;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

class CircuitverseBuilder {
  private readonly inputBits: InputWidth;
  private readonly varNames: string[];
  private readonly options: CircuitverseExportOptions;

  private readonly allNodes: CvNode[] = [];
  private readonly intermediates: number[] = [];

  private readonly modules: Record<string, CvComponent[]> = {
    Input: [],
    NotGate: [],
    AndGate: [],
    OrGate: [],
    ConstantVal: [],
    SevenSegDisplay: [],
  };

  private readonly scopeId = randomScopeId();

  /** AND column x (set by build()). */
  private andX = 0;
  /** First OR column x (set by build()). */
  private orX = 0;
  /** Layout cursor: y of the next free term slot. */
  private curY = 0;
  /** Rail cursors — "varIndex:0|1" → lowest reached node and its rendered y. */
  private readonly railCursor = new Map<string, { node: number; y: number }>();

  constructor(inputBits: InputWidth, options: CircuitverseExportOptions) {
    this.inputBits = inputBits;
    this.varNames = options.varNames?.length === inputBits
      ? options.varNames
      : inputVarNames(inputBits);
    this.options = options;
  }

  /* ---------------- node / wire primitives ---------------- */

  private newPin(offX: number, offY: number, type: 0 | 1): number {
    const idx = this.allNodes.length;
    this.allNodes.push({ x: offX, y: offY, type, bitWidth: 1, label: '', connections: [] });
    return idx;
  }

  /** Type-2 wire bend at absolute canvas coordinates. */
  private bend(x: number, y: number): number {
    const idx = this.allNodes.length;
    this.allNodes.push({ x, y, type: 2, bitWidth: 1, label: '', connections: [] });
    this.intermediates.push(idx);
    return idx;
  }

  /** Direct mutual connection between two nodes (caller guarantees alignment). */
  private link(a: number, b: number): void {
    this.allNodes[a].connections.push(b);
    this.allNodes[b].connections.push(a);
  }

  /* ---------------- component factories ---------------- */

  private addInput(x: number, y: number, label: string, layoutIndex: number): number {
    const out = this.newPin(10, 0, 1);
    this.modules.Input.push({
      x,
      y,
      objectType: 'Input',
      label,
      direction: 'DOWN',
      labelDirection: 'UP',
      propagationDelay: 0,
      customData: {
        nodes: { output1: out },
        values: { state: 0 },
        constructorParamaters: ['DOWN', 1, { x: 0, y: (layoutIndex + 1) * 20, id: randomId() }],
      },
    });
    return out;
  }

  private addInverter(x: number, y: number): { input: number; output: number } {
    const input = this.newPin(-10, 0, 0);
    const output = this.newPin(20, 0, 1);
    this.modules.NotGate.push({
      x,
      y,
      objectType: 'NotGate',
      label: '',
      direction: 'DOWN',
      labelDirection: 'LEFT',
      propagationDelay: 10,
      customData: {
        constructorParamaters: ['DOWN', 1],
        nodes: { output1: output, inp1: input },
      },
    });
    return { input, output };
  }

  private addAnd(x: number, y: number, inputSize: number): { inputs: number[]; output: number } {
    const inputs = andGateInputOffsets(inputSize).map((offY) => this.newPin(-10, offY, 0));
    const output = this.newPin(20, 0, 1);
    this.modules.AndGate.push({
      x,
      y,
      objectType: 'AndGate',
      label: '',
      direction: 'RIGHT',
      labelDirection: 'LEFT',
      propagationDelay: 10,
      customData: {
        constructorParamaters: ['RIGHT', inputSize, 1],
        nodes: { inp: inputs, output1: output },
      },
    });
    return { inputs, output };
  }

  private addOr(x: number, y: number, inputSize: number, label: string): { inputs: number[]; output: number } {
    const inputs = orGateInputOffsets(inputSize).map((offY) => this.newPin(-10, offY, 0));
    const output = this.newPin(20, 0, 1);
    this.modules.OrGate.push({
      x,
      y,
      objectType: 'OrGate',
      label,
      direction: 'RIGHT',
      labelDirection: 'LEFT',
      propagationDelay: 10,
      customData: {
        constructorParamaters: ['RIGHT', inputSize, 1],
        nodes: { inp: inputs, output1: output },
      },
    });
    return { inputs, output };
  }

  private addConstant(x: number, y: number, state: '0' | '1'): number {
    const out = this.newPin(10, 0, 1);
    this.modules.ConstantVal.push({
      x,
      y,
      objectType: 'ConstantVal',
      label: '',
      direction: 'RIGHT',
      labelDirection: 'LEFT',
      propagationDelay: 0,
      customData: {
        nodes: { output1: out },
        // State MUST be a JSON string — the CV constructor reads state.length.
        constructorParamaters: ['RIGHT', 1, state],
      },
    });
    return out;
  }

  private addSevenSeg(x: number, y: number): Record<SegmentName, number> {
    const pins = {} as Record<SegmentName, number>;
    const nodeKeys: Record<string, number> = {};
    for (const pin of SEVENSEG_PINS) {
      const idx = this.newPin(pin.x, pin.y, 0);
      pins[pin.key] = idx;
      nodeKeys[pin.key === 'DP' ? 'dot' : pin.key.toLowerCase()] = idx;
    }
    this.modules.SevenSegDisplay.push({
      x,
      y,
      objectType: 'SevenSegDisplay',
      label: '',
      direction: 'RIGHT',
      labelDirection: 'LEFT',
      propagationDelay: 10,
      customData: {
        constructorParamaters: ['Red'],
        nodes: nodeKeys,
      },
      subcircuitMetadata: {
        showInSubcircuit: false,
        showLabelInSubcircuit: true,
        labelDirection: 'LEFT',
        x: 0,
        y: 0,
      },
    });
    return pins;
  }

  /* ---------------- rail machinery ---------------- */

  /** Absolute x of a variable's rail (direct = below the input, inverted = below the NOT). */
  private railX(vi: number, inverted: boolean): number {
    return START_X + vi * INPUT_PITCH + (inverted ? INVERT_DX : 0);
  }

  /**
   * Tap a rail at the given pin row (CA's logixNodes advance): drop the rail
   * cursor to pinY with one vertical segment, then one horizontal into the
   * pin. The tap node becomes the new cursor and may later carry a third
   * connection when the next tap descends from it (rail junction).
   */
  private tap(vi: number, inverted: boolean, pinY: number, pinIdx: number): void {
    const key = `${vi}:${inverted ? 1 : 0}`;
    const cur = this.railCursor.get(key);
    if (!cur) throw new Error(`E-245: tap on uninitialized rail for variable '${this.varNames[vi]}'`);
    if (cur.y > pinY) {
      throw new Error(`E-244: rail for '${this.varNames[vi]}'${inverted ? "'" : ''} would ascend (y ${cur.y} → ${pinY})`);
    }
    let node = cur.node;
    if (cur.y !== pinY) {
      const b = this.bend(this.railX(vi, inverted), pinY);
      this.link(node, b);
      node = b;
    }
    this.link(node, pinIdx);
    this.railCursor.set(key, { node, y: pinY });
  }

  /* ---------------- term / OR placement ---------------- */

  /**
   * Place one segment's product terms in the AND column, CA style:
   * multi-literal terms become AndGates fed in variable order; single-literal
   * terms become junction "substitute" nodes. Returns the term signal nodes.
   */
  private placeTerms(seg: SegmentName, terms: Literal[][]): TermNode[] {
    const out: TermNode[] = [];
    for (const lits of terms) {
      const c = lits.length;
      if (c === 1) {
        const lit = lits[0];
        const vi = this.varNames.indexOf(lit.name);
        const sub = this.bend(this.andX, this.curY);
        this.tap(vi, lit.complemented, this.curY, sub);
        out.push({ x: this.andX, y: this.curY, net: { node: sub, depth: lit.complemented ? 1 : 0 } });
        this.curY += 10 + TERM_GAP;
      } else {
        if (c > 5) {
          throw new Error(`E-243: segment ${seg} has a term with ${c} literals — AndGate input size would exceed 5`);
        }
        const gate = this.addAnd(this.andX, this.curY, c);
        const offs = andGateInputOffsets(c);
        let depth = 0;
        lits.forEach((lit, k) => {
          const vi = this.varNames.indexOf(lit.name);
          this.tap(vi, lit.complemented, this.curY + offs[k], gate.inputs[k]);
          depth = Math.max(depth, lit.complemented ? 1 : 0);
        });
        out.push({ x: this.andX + 20, y: this.curY, net: { node: gate.output, depth: depth + 1 } });
        this.curY += c * 10 + TERM_GAP;
      }
    }
    return out;
  }

  /**
   * One OrGate combining its sources through CA's symmetric staircase fan:
   * the middle source (odd count) runs straight into the middle pin; pair
   * j / n-1-j share a vertical channel between the source column and the
   * gate. The gate is centered between the two middle sources (grid-snapped)
   * and the layout cursor is pushed past its body (min-gap rule).
   */
  private orGateAt(colX: number, sourceColX: number, sources: TermNode[], label: string): TermNode {
    const cnt = sources.length; // 2..8
    const mid = Math.floor(cnt / 2);
    let orY = (sources[mid].y + sources[Math.floor((cnt - 1) / 2)].y) / 2;
    if (orY % 10 === 5) orY += 5; // CA grid snap
    const gate = this.addOr(colX, orY, cnt, label);
    const offs = orGateInputOffsets(cnt);
    if (cnt % 2 === 1) {
      this.link(sources[mid].net.node, gate.inputs[mid]);
    }
    for (let j = 0; j < mid; j++) {
      const chX = sourceColX + 30 + (mid - j) * 10;
      for (const idx of [j, cnt - 1 - j]) {
        const pinY = orY + offs[idx];
        const src = sources[idx];
        if (src.y === pinY) {
          this.link(src.net.node, gate.inputs[idx]);
        } else {
          const b1 = this.bend(chX, src.y);
          this.link(src.net.node, b1);
          const b2 = this.bend(chX, pinY);
          this.link(b1, b2);
          this.link(b2, gate.inputs[idx]);
        }
      }
    }
    const halfH = 10 * Math.ceil(cnt / 2) + 12;
    this.curY = Math.max(this.curY, snapUp10(orY + halfH + MIN_OR_GAP));
    const depth = sources.reduce((m, s) => Math.max(m, s.net.depth), 0) + 1;
    return { x: colX + 20, y: orY, net: { node: gate.output, depth } };
  }

  /**
   * Combine >= 2 term nets into one segment net. <= 8 sources → one OrGate
   * (labeled with the segment name); more → a balanced tree of <= 8-input
   * OrGates whose levels cascade right, the root keeping the segment label.
   */
  private reduceOr(
    sources: TermNode[],
    sourceColX: number,
    level: number,
    segLabel: string,
    counter: { n: number },
    root: boolean,
  ): TermNode {
    if (sources.length === 1) return sources[0]; // defensive; balanced chunks never produce this
    if (sources.length <= 8) {
      const label = root ? segLabel : `${segLabel}${++counter.n}`;
      return this.orGateAt(this.orX + level * TREE_LEVEL_DX, sourceColX, sources, label);
    }
    const sizes = chunkSizes(sources.length);
    const parts: TermNode[] = [];
    let offset = 0;
    for (const size of sizes) {
      parts.push(this.reduceOr(sources.slice(offset, offset + size), sourceColX, level, segLabel, counter, false));
      offset += size;
    }
    return this.reduceOr(parts, this.orX + level * TREE_LEVEL_DX, level + 1, segLabel, counter, root);
  }

  /* ---------------- display feed ---------------- */

  /**
   * Route one segment feed into its display pin: horizontal out to a
   * dedicated vertical channel, a staggered lane outside the pin row, and a
   * final vertical drop into the pin — provably free of overlaps by
   * construction (distinct channels, distinct lanes, pins entered vertically).
   */
  private routeFeed(f: Feed, chX: number, laneY: number, pinX: number, pinIdx: number): void {
    const b1 = this.bend(chX, f.y);
    this.link(f.net.node, b1);
    const b2 = this.bend(chX, laneY);
    this.link(b1, b2);
    const b3 = this.bend(pinX, laneY);
    this.link(b2, b3);
    this.link(b3, pinIdx);
  }

  /* ---------------- synthesis ---------------- */

  build(engines: SegmentEngineMap): CircuitverseBuildResult {
    // ---- 1. Terms per segment + constant detection ------------------
    const constantOf = {} as Record<SegmentName, 0 | 1 | null>;
    const literalSets = {} as Record<SegmentName, Literal[][]>;
    for (const seg of SEGMENT_NAMES) {
      const engine = engines[seg];
      const terms: Term[] = this.options.logicSource === 'direct'
        ? engine.ones.map((m) => implicantToSopTerm({ bits: m, mask: (1 << this.inputBits) - 1 }, this.inputBits, this.varNames))
        : engine.activeSopTerms;
      constantOf[seg] = terms.length === 0 ? 0 : terms.some((t) => t.literals.length === 0) ? 1 : null;
      literalSets[seg] = constantOf[seg] === null
        ? terms.map((t) => {
            const lits = dedupeLiterals(t.literals);
            // CA feeds AND pins in variable order — sort literals to match.
            return lits.slice().sort((a, b) => this.varNames.indexOf(a.name) - this.varNames.indexOf(b.name));
          })
        : [];
      for (const lits of literalSets[seg]) {
        for (const lit of lits) {
          if (!this.varNames.includes(lit.name)) {
            throw new Error(`E-242: segment ${seg} references unknown variable '${lit.name}' (expected one of ${this.varNames.join(', ')})`);
          }
        }
      }
    }

    // ---- 2. Shared inverters for complemented variables -------------
    const invertedVars = new Set<string>();
    for (const seg of SEGMENT_NAMES) {
      for (const lits of literalSets[seg]) {
        for (const lit of lits) {
          if (lit.complemented) invertedVars.add(lit.name);
        }
      }
    }

    // ---- 3. Layout metrics ------------------------------------------
    const n = this.varNames.length;
    this.andX = START_X + n * INPUT_PITCH + AND_GAP;
    let stairWidth = 10; // corridor minimum (widest channel of a 2-source fan)
    let maxLevels = 0;
    for (const seg of SEGMENT_NAMES) {
      const m = literalSets[seg].length;
      if (m >= 2) {
        stairWidth = Math.max(stairWidth, 30 + Math.floor(Math.min(m, 8) / 2) * 10);
        maxLevels = Math.max(maxLevels, treeLevels(m));
      }
    }
    this.orX = this.andX + stairWidth + OR_MARGIN;
    const rootRightX = this.orX + Math.max(0, maxLevels - 1) * TREE_LEVEL_DX + 20;
    const feedBaseX = rootRightX + 10;
    const dispX = feedBaseX + DISPLAY_DX;

    // ---- 4. Group order: top-pin OR groups, bottom-pin OR groups,
    //         then constant / single-term groups pinned to the bottom --
    const isOrGroup = (seg: SegmentName): boolean => literalSets[seg].length >= 2;
    const topOr = TOP_SEGMENTS.filter(isOrGroup);
    const botOr = BOTTOM_SEGMENTS.filter(isOrGroup);
    const tail = SEGMENT_NAMES.filter((s) => !isOrGroup(s));
    const order: SegmentName[] = [...topOr, ...botOr, ...tail];
    const bandAfter = topOr.length; // reserved display band goes before this index

    // ---- 5. Inputs + dual rails -------------------------------------
    this.varNames.forEach((name, i) => {
      const ix = START_X + i * INPUT_PITCH;
      const pin = this.addInput(ix, START_Y, name, i);
      if (invertedVars.has(name)) {
        const v1 = this.bend(ix, START_Y + RAIL_HEAD_DY);
        this.link(pin, v1);
        const v2 = this.bend(ix + INVERT_DX, START_Y + RAIL_HEAD_DY);
        this.link(v1, v2);
        const inv = this.addInverter(ix + INVERT_DX, START_Y + NOT_DY);
        this.link(v2, inv.input);
        this.railCursor.set(`${i}:0`, { node: v1, y: START_Y + RAIL_HEAD_DY });
        this.railCursor.set(`${i}:1`, { node: inv.output, y: START_Y + NOT_DY + 20 });
      } else {
        this.railCursor.set(`${i}:0`, { node: pin, y: START_Y + 10 });
      }
    });

    // ---- 6. Per-segment groups --------------------------------------
    this.curY = START_Y + FIRST_TERM_DY;
    let bandCenterY = 0;
    const feeds: Feed[] = [];
    const segStats: CircuitverseSegmentStat[] = [];

    for (let gi = 0; gi < order.length; gi++) {
      if (gi === bandAfter) {
        bandCenterY = this.curY + DISPLAY_BAND / 2;
        this.curY += DISPLAY_BAND;
      }
      const seg = order[gi];
      if (constantOf[seg] !== null) {
        const pin = this.addConstant(this.andX, this.curY, constantOf[seg] === 1 ? '1' : '0');
        feeds.push({ seg, x: this.andX + 10, y: this.curY, net: { node: pin, depth: 0 } });
        this.curY += TERM_GAP;
        segStats.push({ segment: seg, andGates: 0, orGates: 0, constant: constantOf[seg] });
        continue;
      }
      const termNodes = this.placeTerms(seg, literalSets[seg]);
      const andCount = literalSets[seg].filter((lits) => lits.length >= 2).length;
      if (termNodes.length === 1) {
        const only = termNodes[0];
        feeds.push({ seg, x: only.x, y: only.y, net: only.net });
        segStats.push({ segment: seg, andGates: andCount, orGates: 0, constant: null });
        continue;
      }
      const segLabel = seg === 'DP' ? 'dp' : seg.toLowerCase();
      const orBefore = this.modules.OrGate.length;
      const rootNet = this.reduceOr(termNodes, this.andX, 0, segLabel, { n: 0 }, true);
      feeds.push({ seg, x: rootNet.x, y: rootNet.y, net: rootNet.net });
      segStats.push({ segment: seg, andGates: andCount, orGates: this.modules.OrGate.length - orBefore, constant: null });
    }

    // ---- 7. Display + per-segment feeds ------------------------------
    // (No rail cleanup pass: unlike CV's generator, which drops every rail
    // to the canvas bottom — dead stubs — our rails end exactly at their
    // last tap. Tapped rails only exist, so there is nothing to tidy up.)
    const dispY = bandCenterY;
    const displayPins = this.addSevenSeg(dispX, dispY);
    const pinOf = (seg: SegmentName) => SEVENSEG_PINS.find((p) => p.key === seg)!;
    const topFeeds = feeds
      .filter((f) => TOP_SEGMENTS.includes(f.seg))
      .sort((a, b) => pinOf(a.seg).x - pinOf(b.seg).x);
    const botFeeds = feeds
      .filter((f) => BOTTOM_SEGMENTS.includes(f.seg))
      .sort((a, b) => pinOf(a.seg).x - pinOf(b.seg).x);
    topFeeds.forEach((f, t) => {
      this.routeFeed(
        f,
        feedBaseX + FEED_CH_TOP + t * LANE_PITCH,
        dispY - TOP_LANE_DY - t * LANE_PITCH,
        dispX + pinOf(f.seg).x,
        displayPins[f.seg],
      );
    });
    botFeeds.forEach((f, t) => {
      this.routeFeed(
        f,
        feedBaseX + FEED_CH_BOT + t * LANE_PITCH,
        dispY + BOT_LANE_DY + t * LANE_PITCH,
        dispX + pinOf(f.seg).x,
        displayPins[f.seg],
      );
    });

    // ---- 9. Stats + project assembly ---------------------------------
    let maxDepth = 0;
    for (const f of feeds) maxDepth = Math.max(maxDepth, f.net.depth);
    segStats.sort((a, b) => SEGMENT_NAMES.indexOf(a.segment) - SEGMENT_NAMES.indexOf(b.segment));

    const wires = this.allNodes.reduce((sum, nd) => sum + nd.connections.length, 0) / 2;
    const stats: CircuitverseStats = {
      inputs: this.modules.Input.length,
      inverters: this.modules.NotGate.length,
      andGates: this.modules.AndGate.length,
      orGates: this.modules.OrGate.length,
      constants: this.modules.ConstantVal.length,
      wires,
      intermediates: this.intermediates.length,
      maxDepth,
      segments: segStats,
    };

    // Scope key set: 7 required keys + one array per component type present.
    const scope: Record<string, unknown> = {
      layout: { width: 100, height: 100, title_x: 50, title_y: 13, titleEnabled: true },
      verilogMetadata: {
        isVerilogCircuit: false,
        isMainCircuit: false,
        code: '// Write Some Verilog Code Here!',
        subCircuitScopeIds: [],
      },
      allNodes: this.allNodes,
      id: this.scopeId,
      name: 'Main',
    };
    for (const [key, arr] of Object.entries(this.modules)) {
      if (arr.length > 0) scope[key] = arr;
    }
    scope.restrictedCircuitElementsUsed = [];
    scope.nodes = [...this.intermediates];

    const project = {
      name: this.options.title,
      timePeriod: 500,
      clockEnabled: true,
      projectId: randomId(),
      focussedCircuit: this.scopeId,
      orderedTabs: [String(this.scopeId)],
      scopes: [scope],
    };

    return { json: JSON.stringify(project, null, 2), stats };
  }
}
