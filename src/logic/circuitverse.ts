/**
 * CircuitVerse project exporter: converts the simulator's per-segment Boolean
 * logic (minimized SOP cover or canonical minterm SOP) into a `.cv` project
 * file — the plain-JSON format consumed by circuitverse.org/simulator
 * (File → Import). Pure logic, no DOM side effects.
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
 *    pins at the wrong spots.
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
import { inputVarNames } from '@/utils/binary';
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
  direction: 'RIGHT';
  labelDirection: 'LEFT';
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
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */

/** Segments whose display pins sit on the TOP edge (clusters above the display). */
const TOP_SEGMENTS: SegmentName[] = ['G', 'F', 'A', 'B'];
/** Segments whose display pins sit on the BOTTOM edge (clusters below). */
const BOTTOM_SEGMENTS: SegmentName[] = ['E', 'D', 'C', 'DP'];

const INPUT_X = 100;        // input column
const INPUT_Y0 = 100;       // first input row (MSB)
const INPUT_DY = 120;       // input row pitch
const INVERTER_X = 220;     // shared inverter column (y-aligned with its input)
const CONSTANT_X = 300;     // per-segment constant column
const AND_X = 400;          // per-segment AND column
const OR_X = 520;           // per-segment OR column
const DISPLAY_X = 620;      // SevenSegDisplay origin
const GATE_SPACING = 60;    // vertical pitch inside a gate cluster
const BAND_GAP = 60;        // vertical gap between segment clusters
const TOP_MARGIN = 100;     // canvas margin above the topmost cluster

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

/** Number of OrGates needed to combine m term nets (balanced ≤8-input tree). */
function orTreeSize(m: number): number {
  if (m <= 1) return 0;
  if (m <= 8) return 1;
  const chunks = chunkSizes(m);
  return chunks.length + orTreeSize(chunks.length);
}

/** A driven signal: the driving node index plus its logic depth from the inputs. */
interface Net {
  node: number;
  depth: number;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

class CircuitverseBuilder {
  private readonly inputBits: InputWidth;
  private readonly varNames: string[];
  private readonly options: CircuitverseExportOptions;

  private readonly allNodes: CvNode[] = [];
  /** Absolute canvas position of every node (parallel to allNodes). */
  private readonly abs: { x: number; y: number }[] = [];
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

  constructor(inputBits: InputWidth, options: CircuitverseExportOptions) {
    this.inputBits = inputBits;
    this.varNames = options.varNames?.length === inputBits
      ? options.varNames
      : inputVarNames(inputBits);
    this.options = options;
  }

  /* ---------------- node / wire primitives ---------------- */

  private newPin(offX: number, offY: number, type: 0 | 1, originX: number, originY: number): number {
    const idx = this.allNodes.length;
    this.allNodes.push({ x: offX, y: offY, type, bitWidth: 1, label: '', connections: [] });
    this.abs.push({ x: originX + offX, y: originY + offY });
    return idx;
  }

  /**
   * Wire a source pin to a sink pin. Same absolute y → direct mutual
   * connection; otherwise route through ONE type-2 bend at (sinkX, sourceY):
   * a horizontal run along the source row, then a vertical drop onto the sink.
   */
  private connect(srcIdx: number, sinkIdx: number): void {
    const src = this.abs[srcIdx];
    const sink = this.abs[sinkIdx];
    if (src.y === sink.y) {
      this.allNodes[srcIdx].connections.push(sinkIdx);
      this.allNodes[sinkIdx].connections.push(srcIdx);
    } else {
      const bendIdx = this.allNodes.length;
      this.allNodes.push({ x: sink.x, y: src.y, type: 2, bitWidth: 1, label: '', connections: [srcIdx, sinkIdx] });
      this.abs.push({ x: sink.x, y: src.y });
      this.intermediates.push(bendIdx);
      this.allNodes[srcIdx].connections.push(bendIdx);
      this.allNodes[sinkIdx].connections.push(bendIdx);
    }
  }

  /* ---------------- component factories ---------------- */

  private addInput(x: number, y: number, label: string, layoutIndex: number): number {
    const out = this.newPin(10, 0, 1, x, y);
    this.modules.Input.push({
      x,
      y,
      objectType: 'Input',
      label,
      direction: 'RIGHT',
      labelDirection: 'LEFT',
      propagationDelay: 0,
      customData: {
        nodes: { output1: out },
        values: { state: 0 },
        constructorParamaters: ['RIGHT', 1, { x: 0, y: (layoutIndex + 1) * 20, id: randomId() }],
      },
    });
    return out;
  }

  private addInverter(x: number, y: number): { input: number; output: number } {
    const input = this.newPin(-10, 0, 0, x, y);
    const output = this.newPin(20, 0, 1, x, y);
    this.modules.NotGate.push({
      x,
      y,
      objectType: 'NotGate',
      label: '',
      direction: 'RIGHT',
      labelDirection: 'LEFT',
      propagationDelay: 10,
      customData: {
        constructorParamaters: ['RIGHT', 1],
        nodes: { output1: output, inp1: input },
      },
    });
    return { input, output };
  }

  private addAnd(x: number, y: number, inputSize: number): { inputs: number[]; output: number } {
    const inputs = andGateInputOffsets(inputSize).map((offY) => this.newPin(-10, offY, 0, x, y));
    const output = this.newPin(20, 0, 1, x, y);
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
    const inputs = orGateInputOffsets(inputSize).map((offY) => this.newPin(-10, offY, 0, x, y));
    const output = this.newPin(20, 0, 1, x, y);
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
    const out = this.newPin(10, 0, 1, x, y);
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
      const idx = this.newPin(pin.x, pin.y, 0, x, y);
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

  /* ---------------- synthesis ---------------- */

  build(engines: SegmentEngineMap): CircuitverseBuildResult {
    // ---- 1. Terms per segment + constant detection ------------------
    const constantOf = {} as Record<SegmentName, 0 | 1 | null>;
    const literalSets = {} as Record<SegmentName, Literal[][]>;
    for (const seg of SEGMENT_NAMES) {
      const engine = engines[seg];
      const terms: Term[] = this.options.logicSource === 'direct'
        ? engine.ones.map((m) => implicantToSopTerm({ bits: m, mask: (1 << this.inputBits) - 1 }, this.inputBits))
        : engine.activeSopTerms;
      constantOf[seg] = terms.length === 0 ? 0 : terms.some((t) => t.literals.length === 0) ? 1 : null;
      literalSets[seg] = constantOf[seg] === null ? terms.map((t) => dedupeLiterals(t.literals)) : [];
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

    // ---- 3. Cluster sizes (needed before layout) --------------------
    const andCount = {} as Record<SegmentName, number>;
    const orCount = {} as Record<SegmentName, number>;
    for (const seg of SEGMENT_NAMES) {
      andCount[seg] = literalSets[seg].filter((lits) => lits.length >= 2).length;
      orCount[seg] = constantOf[seg] !== null ? 0 : orTreeSize(literalSets[seg].length);
    }
    const bandHeight = (seg: SegmentName): number => Math.max(1, andCount[seg], orCount[seg]) * GATE_SPACING;

    // ---- 4. Layout: segment clusters banded around the display ------
    const displayY = TOP_MARGIN + 50 + BAND_GAP
      + TOP_SEGMENTS.reduce((acc, seg) => acc + bandHeight(seg) + BAND_GAP, 0);

    const bands = {} as Record<SegmentName, { top: number; height: number }>;
    let cursor = displayY - 50 - BAND_GAP; // above the top pin row, going up
    for (const seg of TOP_SEGMENTS) {
      const height = bandHeight(seg);
      bands[seg] = { top: cursor - height, height };
      cursor -= height + BAND_GAP;
    }
    cursor = displayY + 50 + BAND_GAP; // below the bottom pin row, going down
    for (const seg of BOTTOM_SEGMENTS) {
      const height = bandHeight(seg);
      bands[seg] = { top: cursor, height };
      cursor += height + BAND_GAP;
    }

    // ---- 5. Inputs + shared inverters -------------------------------
    const inputNode = {} as Record<string, number>;
    this.varNames.forEach((name, i) => {
      inputNode[name] = this.addInput(INPUT_X, INPUT_Y0 + i * INPUT_DY, name, i);
    });
    const inverterOutput = {} as Record<string, number>;
    for (const name of this.varNames) {
      if (invertedVars.has(name)) {
        const y = INPUT_Y0 + this.varNames.indexOf(name) * INPUT_DY;
        const inv = this.addInverter(INVERTER_X, y);
        this.connect(inputNode[name], inv.input); // aligned rows → direct wire
        inverterOutput[name] = inv.output;
      }
    }

    // ---- 6. Display -------------------------------------------------
    const displayPins = this.addSevenSeg(DISPLAY_X, displayY);

    // ---- 7. Per-segment gate clusters --------------------------------
    const literalNet = (lit: Literal): Net => ({
      node: lit.complemented ? inverterOutput[lit.name] : inputNode[lit.name],
      depth: lit.complemented ? 1 : 0,
    });

    const segStats: CircuitverseSegmentStat[] = [];
    let maxDepth = 0;
    let constants = 0;

    for (const seg of SEGMENT_NAMES) {
      const band = bands[seg];
      const centerY = band.top + band.height / 2;
      let segAnds = 0;
      let segOrs = 0;

      let finalNet: Net;
      if (constantOf[seg] !== null) {
        constants++;
        finalNet = { node: this.addConstant(CONSTANT_X, centerY, constantOf[seg] === 1 ? '1' : '0'), depth: 0 };
      } else {
        // One AndGate per multi-literal term (stacked in the cluster); single
        // literals use the variable's net (input output or shared inverter).
        const termNets: Net[] = literalSets[seg].map((lits, j) => {
          if (lits.length === 1) return literalNet(lits[0]);
          if (lits.length > 5) {
            throw new Error(`E-243: segment ${seg} has a term with ${lits.length} literals — AndGate input size would exceed 5`);
          }
          const y = band.top + GATE_SPACING / 2 + j * GATE_SPACING;
          const gate = this.addAnd(AND_X, y, lits.length);
          let depth = 0;
          lits.forEach((lit, k) => {
            const net = literalNet(lit);
            this.connect(net.node, gate.inputs[k]);
            depth = Math.max(depth, net.depth);
          });
          segAnds++;
          return { node: gate.output, depth: depth + 1 };
        });

        if (termNets.length === 1) {
          finalNet = termNets[0];
        } else {
          const orBefore = this.modules.OrGate.length;
          finalNet = this.buildOrTree(seg, termNets, band);
          segOrs = this.modules.OrGate.length - orBefore;
        }
      }

      this.connect(finalNet.node, displayPins[seg]);
      maxDepth = Math.max(maxDepth, finalNet.depth);
      segStats.push({ segment: seg, andGates: segAnds, orGates: segOrs, constant: constantOf[seg] });
    }

    // ---- 8. Stats + project assembly ---------------------------------
    const wires = this.allNodes.reduce((sum, n) => sum + n.connections.length, 0) / 2;
    const stats: CircuitverseStats = {
      inputs: this.modules.Input.length,
      inverters: this.modules.NotGate.length,
      andGates: this.modules.AndGate.length,
      orGates: this.modules.OrGate.length,
      constants,
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

  /**
   * Combine ≥2 term nets into one segment net. m = 2..8 → a single OrGate
   * (labeled with the segment name, like real CircuitVerse decoders); m > 8 →
   * a balanced tree of ≤8-input OrGates whose root is centered in the cluster.
   */
  private buildOrTree(seg: SegmentName, nets: Net[], band: { top: number; height: number }): Net {
    const label = seg === 'DP' ? 'dp' : seg.toLowerCase();
    const centerY = band.top + band.height / 2;
    const slots = band.height / GATE_SPACING;
    const usedYs = new Set<number>();
    let created = 0;

    const makeGate = (group: Net[], root: boolean): Net => {
      let y: number | null = null;
      if (root && !usedYs.has(centerY)) {
        y = centerY;
      } else {
        for (let j = 0; j < slots; j++) {
          const cand = band.top + GATE_SPACING / 2 + j * GATE_SPACING;
          if (!usedYs.has(cand)) { y = cand; break; }
        }
      }
      if (y === null) y = centerY; // pathological fallback — overlap is harmless
      usedYs.add(y);
      const gate = this.addOr(OR_X, y, group.length, root ? label : `${label}${created + 1}`);
      created++;
      let depth = 0;
      group.forEach((net, k) => {
        this.connect(net.node, gate.inputs[k]);
        depth = Math.max(depth, net.depth);
      });
      return { node: gate.output, depth: depth + 1 };
    };

    const reduce = (group: Net[], top: boolean): Net => {
      if (group.length === 1) return group[0];
      if (group.length <= 8) return makeGate(group, top);
      const sizes = chunkSizes(group.length);
      const parts: Net[] = [];
      let offset = 0;
      for (const size of sizes) {
        parts.push(reduce(group.slice(offset, offset + size), false));
        offset += size;
      }
      return reduce(parts, top);
    };

    return reduce(nets, true);
  }
}
