/**
 * Verification suite for the CircuitVerse export engine
 * (src/logic/circuitverse.ts). Run from the project root:
 *
 *     bun scripts/verify-circuitverse.ts
 *
 * Layers, applied to every generated file:
 *  1. Importer-replica validation — a verbatim mirror of circuitverse.org's
 *     ValidateData (file/Open.js): exact ordered top-level key set, required
 *     scope keys, orderedTabs/focussedCircuit consistency.
 *  2. Structural checks — node indices in range, mutual connections, every
 *     pin claimed exactly once, constructor-exact pin offsets, string
 *     ConstantVal states, coordinate grid, scope.nodes vs type-2 nodes, etc.
 *  3. A mini CircuitVerse interpreter: union-find nets over allNodes, gate
 *     propagation to fixpoint, SevenSegDisplay pin readout — simulated for
 *     EVERY input code and compared against a directly-evaluated SOP
 *     reference and against the truth table (non-'X' cells).
 *  4. Seven end-to-end cases over preset/hand-built tables.
 */
import { buildCircuitverseProject } from '@/logic/circuitverse';
import type { CircuitverseBuildResult, CircuitverseStats } from '@/logic/circuitverse';
import { computeEngines } from '@/logic/engine';
import type { SegmentEngineMap } from '@/logic/engine';
import { presetTable } from '@/logic/truthTable';
import { allSegmentsTable } from '@/logic/presets';
import { FONT_GLYPHS } from '@/logic/font';
import { implicantToSopTerm } from '@/logic/expressions';
import { inputVarNames } from '@/utils/binary';
import {
  SEGMENT_NAMES,
  type InputWidth,
  type SegmentName,
  type Term,
  type TruthTable,
} from '@/types/simulator';

/* ------------------------------------------------------------------ */
/* Check harness                                                       */
/* ------------------------------------------------------------------ */

class CaseChecker {
  count = 0;

  check(cond: boolean, msg: string): void {
    this.count++;
    if (!cond) throw new Error(`check failed: ${msg}`);
  }

  equal<T>(actual: T, expected: T, msg: string): void {
    this.count++;
    if (actual !== expected) {
      throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Importer replica (verbatim algorithm from CircuitVerse file/Open.js) */
/* ------------------------------------------------------------------ */

const SCOPE_SCHEMA = ['layout', 'verilogMetadata', 'allNodes', 'id', 'name', 'restrictedCircuitElementsUsed', 'nodes'];
const JSON_SCHEMA = ['name', 'timePeriod', 'clockEnabled', 'projectId', 'focussedCircuit', 'orderedTabs', 'scopes'];
const NON_MODULE_KEYS = new Set(SCOPE_SCHEMA);
const KNOWN_MODULES = new Set(['Input', 'AndGate', 'OrGate', 'NotGate', 'ConstantVal', 'SevenSegDisplay']);

/** Loose shapes of the parsed .cv JSON. */
interface CvNodeJson { x: number; y: number; type: number; bitWidth: number; label: string; connections: number[]; }
interface CvComponentJson {
  x: number; y: number; objectType: string; label: unknown; direction: unknown;
  labelDirection: unknown; propagationDelay: unknown;
  customData: {
    nodes: Record<string, unknown>;
    values?: { state: number };
    constructorParamaters: unknown[];
  };
  subcircuitMetadata?: unknown;
}
interface CvScopeJson extends Record<string, unknown> {
  layout: Record<string, unknown>;
  verilogMetadata: Record<string, unknown>;
  allNodes: CvNodeJson[];
  id: number;
  name: string;
  restrictedCircuitElementsUsed: unknown[];
  nodes: number[];
}
interface CvProjectJson extends Record<string, unknown> {
  name: string;
  timePeriod: number;
  clockEnabled: boolean;
  projectId: string;
  focussedCircuit: number;
  orderedTabs: string[];
  scopes: CvScopeJson[];
}

function validateDataReplica(fileData: string, title: string, c: CaseChecker): CvProjectJson {
  const parsed = JSON.parse(fileData) as CvProjectJson;
  c.check(
    JSON.stringify(Object.keys(parsed)) === JSON.stringify(JSON_SCHEMA),
    'top-level key set/order must exactly match the importer schema',
  );
  for (const scope of parsed.scopes) {
    const keys = Object.keys(scope);
    for (const key of SCOPE_SCHEMA) {
      c.check(keys.includes(key), `scope must contain '${key}'`);
    }
  }
  c.equal(parsed.name, title, 'project name must equal the requested title');
  c.equal(parsed.timePeriod, 500, 'timePeriod');
  c.equal(parsed.clockEnabled, true, 'clockEnabled');
  c.check(/^[A-Za-z0-9]{20}$/.test(parsed.projectId), 'projectId must be 20-char alphanumeric');
  const scope = parsed.scopes[0];
  c.equal(parsed.scopes.length, 1, 'exactly one circuit');
  c.check(typeof scope.id === 'number' && scope.id > 0, 'scope id must be a truthy number');
  c.equal(parsed.focussedCircuit, scope.id, 'focussedCircuit === scope id');
  c.equal(JSON.stringify(parsed.orderedTabs), JSON.stringify([String(scope.id)]), 'orderedTabs === [String(scope id)]');
  c.equal(
    JSON.stringify(scope.layout),
    JSON.stringify({ width: 100, height: 100, title_x: 50, title_y: 13, titleEnabled: true }),
    'scope layout',
  );
  c.equal(
    JSON.stringify(scope.verilogMetadata),
    JSON.stringify({ isVerilogCircuit: false, isMainCircuit: false, code: '// Write Some Verilog Code Here!', subCircuitScopeIds: [] }),
    'scope verilogMetadata',
  );
  c.equal(JSON.stringify(scope.restrictedCircuitElementsUsed), '[]', 'restrictedCircuitElementsUsed empty');
  c.equal(scope.name, 'Main', 'scope name');
  c.check(
    fileData === JSON.stringify(JSON.parse(fileData), null, 2),
    'json must be pretty-printed with 2-space indent',
  );
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Constructor-exact pin offsets (literal transcriptions of the        */
/* CircuitVerse constructor loops — independent of the builder)        */
/* ------------------------------------------------------------------ */

/** modules/AndGate.js input-pin creation loop, verbatim semantics. */
function cvAndInputYs(n: number): number[] {
  const ys: number[] = [];
  if (n % 2 === 1) {
    for (let i = 0; i < n / 2 - 1; i++) ys.push(-10 * (i + 1));
    ys.push(0);
    for (let i = n / 2 + 1; i < n; i++) ys.push(10 * (i + 1 - n / 2 - 1));
  } else {
    for (let i = 0; i < n / 2; i++) ys.push(-10 * (i + 1));
    for (let i = n / 2; i < n; i++) ys.push(10 * (i + 1 - n / 2));
  }
  return ys;
}

/** modules/OrGate.js input-pin creation loop, verbatim semantics. */
function cvOrInputYs(n: number): number[] {
  const ys: number[] = [];
  if (n % 2 === 1) {
    for (let i = Math.floor(n / 2) - 1; i >= 0; i--) ys.push(-10 * (i + 1));
    ys.push(0);
    for (let i = 0; i < Math.floor(n / 2); i++) ys.push(10 * (i + 1));
  } else {
    for (let i = n / 2 - 1; i >= 0; i--) ys.push(-10 * (i + 1));
    for (let i = 0; i < n / 2; i++) ys.push(10 * (i + 1));
  }
  return ys;
}

/** modules/SevenSegDisplay.js pin offsets by key. */
const CV_SEVENSEG_OFFSETS: Record<string, [number, number]> = {
  g: [-20, -50], f: [-10, -50], a: [10, -50], b: [20, -50],
  e: [-20, 50], d: [-10, 50], c: [10, 50], dot: [20, 50],
};

/* ------------------------------------------------------------------ */
/* Structural checks                                                   */
/* ------------------------------------------------------------------ */

function componentsOf(scope: CvScopeJson): { type: string; comp: CvComponentJson }[] {
  const out: { type: string; comp: CvComponentJson }[] = [];
  for (const [key, value] of Object.entries(scope)) {
    if (NON_MODULE_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const comp of value as CvComponentJson[]) out.push({ type: key, comp });
    }
  }
  return out;
}

function structuralChecks(project: CvProjectJson, inputBits: number, c: CaseChecker): CvScopeJson {
  const scope = project.scopes[0];
  const nodes = scope.allNodes;
  const comps = componentsOf(scope);

  // Module keys are all known types.
  for (const key of Object.keys(scope)) {
    if (!NON_MODULE_KEYS.has(key)) c.check(KNOWN_MODULES.has(key), `unknown module array '${key}'`);
  }

  // Connections: in range, mutual, and every type-2 node has exactly 2.
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    c.equal(nd.bitWidth, 1, `node ${i} bitWidth`);
    c.check(Number.isInteger(nd.x) && nd.x % 10 === 0, `node ${i} x must be a multiple of 10`);
    c.check(Number.isInteger(nd.y) && nd.y % 10 === 0, `node ${i} y must be a multiple of 10`);
    c.check([0, 1, 2].includes(nd.type), `node ${i} type`);
    for (const j of nd.connections) {
      c.check(Number.isInteger(j) && j >= 0 && j < nodes.length, `node ${i} connection ${j} in range`);
      c.check(nodes[j].connections.includes(i), `connection ${i}->${j} must be mutual`);
    }
    if (nd.type === 2) c.equal(nd.connections.length, 2, `type-2 node ${i} must have exactly 2 connections`);
  }

  // scope.nodes === sorted indices of all type-2 nodes.
  const type2 = nodes.map((nd, i) => (nd.type === 2 ? i : -1)).filter((i) => i >= 0);
  c.equal(JSON.stringify(scope.nodes), JSON.stringify(type2), 'scope.nodes lists exactly the type-2 indices (sorted)');

  // Every type-0/1 node claimed by exactly one component pin slot.
  const claimed = new Array<number>(nodes.length).fill(0);
  const claim = (idx: unknown, where: string): void => {
    c.check(typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < nodes.length, `${where} references a valid node index`);
    if (typeof idx === 'number') claimed[idx]++;
  };

  const inputLabels: string[] = [];
  const inputIds: string[] = [];
  let sevenSegCount = 0;

  for (const { type, comp } of comps) {
    c.check(comp.objectType === type, `component objectType '${comp.objectType}' matches its array '${type}'`);
    c.equal(typeof comp.label, 'string', `${type} label is a string`);
    c.equal(comp.direction, 'RIGHT', `${type} direction`);
    c.equal(comp.labelDirection, 'LEFT', `${type} labelDirection`);
    c.check(typeof comp.propagationDelay === 'number', `${type} propagationDelay is a number`);
    c.check(comp.x % 10 === 0 && comp.y % 10 === 0, `${type} at (${comp.x},${comp.y}) on the 10-grid`);
    c.check(Array.isArray(comp.customData.constructorParamaters), `${type} constructorParamaters array`);
    const cp = comp.customData.constructorParamaters;
    const nodeKeys = Object.keys(comp.customData.nodes).sort();

    if (type === 'Input') {
      c.equal(JSON.stringify(nodeKeys), JSON.stringify(['output1']), 'Input node keys');
      c.equal(cp[0], 'RIGHT', 'Input direction param');
      c.equal(cp[1], 1, 'Input bitWidth param');
      const layout = cp[2] as { x: number; y: number; id: string };
      c.check(!!layout && typeof layout.id === 'string' && /^[A-Za-z0-9]{20}$/.test(layout.id), 'Input layoutProperties id 20-char alnum');
      inputIds.push(layout.id);
      c.equal(layout.x, 0, 'Input layoutProperties x');
      const out = comp.customData.nodes.output1 as number;
      claim(out, 'Input output1');
      c.equal(nodes[out].x, 10, 'Input output1 pin offset x (bitWidth*10)');
      c.equal(nodes[out].y, 0, 'Input output1 pin offset y');
      c.equal(nodes[out].type, 1, 'Input output1 node type');
      c.equal(comp.propagationDelay, 0, 'Input propagationDelay 0');
      c.equal(comp.customData.values?.state, 0, 'Input values.state');
      inputLabels.push(comp.label as string);
    } else if (type === 'ConstantVal') {
      c.equal(JSON.stringify(nodeKeys), JSON.stringify(['output1']), 'ConstantVal node keys');
      c.equal(cp[0], 'RIGHT', 'ConstantVal direction param');
      c.equal(cp[1], 1, 'ConstantVal bitWidth param');
      c.check(cp[2] === '0' || cp[2] === '1', 'ConstantVal state must be the STRING "0" or "1"');
      const out = comp.customData.nodes.output1 as number;
      claim(out, 'ConstantVal output1');
      c.equal(nodes[out].x, 10, 'ConstantVal output1 pin offset x');
      c.equal(nodes[out].y, 0, 'ConstantVal output1 pin offset y');
      c.equal(nodes[out].type, 1, 'ConstantVal output1 node type');
      c.equal(comp.propagationDelay, 0, 'ConstantVal propagationDelay 0');
    } else if (type === 'NotGate') {
      c.equal(JSON.stringify(nodeKeys), JSON.stringify(['inp1', 'output1']), 'NotGate node keys');
      c.equal(JSON.stringify(cp), JSON.stringify(['RIGHT', 1]), 'NotGate constructorParamaters');
      const inp = comp.customData.nodes.inp1 as number;
      const out = comp.customData.nodes.output1 as number;
      claim(inp, 'NotGate inp1');
      claim(out, 'NotGate output1');
      c.equal(nodes[inp].x, -10, 'NotGate inp1 offset x');
      c.equal(nodes[inp].y, 0, 'NotGate inp1 offset y');
      c.equal(nodes[inp].type, 0, 'NotGate inp1 node type');
      c.equal(nodes[out].x, 20, 'NotGate output1 offset x');
      c.equal(nodes[out].y, 0, 'NotGate output1 offset y');
      c.equal(nodes[out].type, 1, 'NotGate output1 node type');
      c.equal(comp.propagationDelay, 10, 'NotGate propagationDelay 10');
    } else if (type === 'AndGate' || type === 'OrGate') {
      c.equal(JSON.stringify(nodeKeys), JSON.stringify(['inp', 'output1']), `${type} node keys`);
      const inputSize = cp[1] as number;
      c.equal(cp[0], 'RIGHT', `${type} direction param`);
      c.equal(cp[2], 1, `${type} bitWidth param`);
      const inp = comp.customData.nodes.inp as number[];
      c.check(Array.isArray(inp), `${type} inp is an array`);
      c.equal(inp.length, inputSize, `${type} inp length matches inputSize`);
      const ys = type === 'AndGate' ? cvAndInputYs(inputSize) : cvOrInputYs(inputSize);
      inp.forEach((idx, k) => {
        claim(idx, `${type} inp[${k}]`);
        c.equal(nodes[idx].x, -10, `${type} inp[${k}] offset x`);
        c.equal(nodes[idx].y, ys[k], `${type} inp[${k}] offset y (constructor order)`);
        c.equal(nodes[idx].type, 0, `${type} inp[${k}] node type`);
      });
      const out = comp.customData.nodes.output1 as number;
      claim(out, `${type} output1`);
      c.equal(nodes[out].x, 20, `${type} output1 offset x`);
      c.equal(nodes[out].y, 0, `${type} output1 offset y`);
      c.equal(nodes[out].type, 1, `${type} output1 node type`);
      c.equal(comp.propagationDelay, 10, `${type} propagationDelay 10`);
      if (type === 'AndGate') c.check(inputSize >= 2 && inputSize <= 5, `AndGate inputSize ${inputSize} within 2..5`);
      else c.check(inputSize >= 2 && inputSize <= 8, `OrGate inputSize ${inputSize} within 2..8`);
    } else if (type === 'SevenSegDisplay') {
      sevenSegCount++;
      c.equal(JSON.stringify(nodeKeys), JSON.stringify(['a', 'b', 'c', 'd', 'dot', 'e', 'f', 'g']), 'SevenSegDisplay node keys (all 8 pins)');
      c.equal(JSON.stringify(cp), JSON.stringify(['Red']), 'SevenSegDisplay constructorParamaters');
      c.equal(comp.propagationDelay, 10, 'SevenSegDisplay propagationDelay 10');
      c.check(!!comp.subcircuitMetadata, 'SevenSegDisplay has subcircuitMetadata');
      for (const [key, [ex, ey]] of Object.entries(CV_SEVENSEG_OFFSETS)) {
        const idx = comp.customData.nodes[key] as number;
        claim(idx, `SevenSegDisplay ${key}`);
        c.equal(nodes[idx].x, ex, `SevenSegDisplay ${key} offset x`);
        c.equal(nodes[idx].y, ey, `SevenSegDisplay ${key} offset y`);
        c.equal(nodes[idx].type, 0, `SevenSegDisplay ${key} node type`);
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type === 2) {
      c.equal(claimed[i], 0, `type-2 node ${i} must not be claimed by a component`);
    } else {
      c.equal(claimed[i], 1, `pin node ${i} (type ${nodes[i].type}) must be claimed by exactly one component slot`);
    }
  }

  c.equal(sevenSegCount, 1, 'exactly one SevenSegDisplay');
  c.equal(inputLabels.length, inputBits, 'Input count equals input width');
  c.equal(new Set(inputLabels).size, inputLabels.length, 'Input labels unique');
  c.equal(
    JSON.stringify([...inputLabels].sort()),
    JSON.stringify([...inputVarNames(inputBits as InputWidth)].sort()),
    'Input labels are the variable names',
  );
  c.equal(new Set(inputIds).size, inputIds.length, 'Input layoutProperties ids unique');
  return scope;
}

/* ------------------------------------------------------------------ */
/* Mini CircuitVerse interpreter                                       */
/* ------------------------------------------------------------------ */

interface GateJson { inNodes: number[]; outNode: number; kind: 'not' | 'and' | 'or'; }

class MiniSim {
  private readonly parent: number[] = [];
  private readonly inputs: { outNode: number; label: string }[] = [];
  private readonly consts: { outNode: number; state: string }[] = [];
  private readonly gates: GateJson[] = [];
  private readonly display: Record<string, number> | null = null;
  readonly driverErrors: string[] = [];

  constructor(scope: CvScopeJson, private readonly inputBits: number) {
    const nodes = scope.allNodes;
    this.parent = nodes.map((_, i) => i);
    for (let i = 0; i < nodes.length; i++) {
      for (const j of nodes[i].connections) this.union(i, j);
    }

    // One driver (output pin) per net — output-output shorts are import bugs.
    const driversPerNet = new Map<number, number>();
    const noteDriver = (nodeIdx: number, what: string): void => {
      const root = this.find(nodeIdx);
      driversPerNet.set(root, (driversPerNet.get(root) ?? 0) + 1);
      if ((driversPerNet.get(root) ?? 0) > 1) this.driverErrors.push(`${what} shorts another driver on net ${root}`);
    };

    for (const { type, comp } of componentsOf(scope)) {
      const cd = comp.customData;
      if (type === 'Input') {
        this.inputs.push({ outNode: cd.nodes.output1 as number, label: comp.label as string });
        noteDriver(cd.nodes.output1 as number, 'Input');
      } else if (type === 'ConstantVal') {
        this.consts.push({ outNode: cd.nodes.output1 as number, state: cd.constructorParamaters[2] as string });
        noteDriver(cd.nodes.output1 as number, 'ConstantVal');
      } else if (type === 'NotGate') {
        this.gates.push({ inNodes: [cd.nodes.inp1 as number], outNode: cd.nodes.output1 as number, kind: 'not' });
        noteDriver(cd.nodes.output1 as number, 'NotGate');
      } else if (type === 'AndGate') {
        this.gates.push({ inNodes: cd.nodes.inp as number[], outNode: cd.nodes.output1 as number, kind: 'and' });
        noteDriver(cd.nodes.output1 as number, 'AndGate');
      } else if (type === 'OrGate') {
        this.gates.push({ inNodes: cd.nodes.inp as number[], outNode: cd.nodes.output1 as number, kind: 'or' });
        noteDriver(cd.nodes.output1 as number, 'OrGate');
      } else if (type === 'SevenSegDisplay') {
        this.display = cd.nodes as unknown as Record<string, number>;
      }
    }
  }

  private find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  private union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }

  /** Simulate one input code and read the eight display pins. */
  run(code: number): Record<SegmentName, 0 | 1> {
    const value = new Map<number, 0 | 1>();
    const varNames = inputVarNames(this.inputBits as InputWidth);
    for (const inp of this.inputs) {
      const bitPos = this.inputBits - 1 - varNames.indexOf(inp.label);
      value.set(this.find(inp.outNode), ((code >> bitPos) & 1) as 0 | 1);
    }
    for (const cst of this.consts) {
      value.set(this.find(cst.outNode), parseInt(cst.state, 2) as 0 | 1);
    }

    // Combinational propagation to fixpoint (bounded by gate count).
    let progress = true;
    let guard = 0;
    while (progress && guard++ < this.gates.length + 4) {
      progress = false;
      for (const gate of this.gates) {
        const outNet = this.find(gate.outNode);
        if (value.has(outNet)) continue;
        let acc: 0 | 1 | null = null;
        let allDefined = true;
        for (const inNode of gate.inNodes) {
          const v = value.get(this.find(inNode));
          if (v === undefined) { allDefined = false; break; }
          if (gate.kind === 'not') acc = v === 1 ? 0 : 1;
          else if (acc === null) acc = v;
          else if (gate.kind === 'and') acc = acc === 1 && v === 1 ? 1 : 0;
          else acc = acc === 1 || v === 1 ? 1 : 0;
        }
        if (allDefined && acc !== null) {
          value.set(outNet, acc);
          progress = true;
        }
      }
    }

    const pinToSegment: Record<string, SegmentName> = {
      a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', dot: 'DP',
    };
    const out = {} as Record<SegmentName, 0 | 1>;
    for (const [pin, seg] of Object.entries(pinToSegment)) {
      const nodeIdx = this.display?.[pin];
      out[seg] = nodeIdx === undefined ? 0 : (value.get(this.find(nodeIdx)) ?? 0);
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* SOP reference evaluation                                            */
/* ------------------------------------------------------------------ */

function referenceTerms(engines: SegmentEngineMap, seg: SegmentName, logicSource: 'minimized' | 'direct', inputBits: number): Term[] {
  return logicSource === 'direct'
    ? engines[seg].ones.map((m) => implicantToSopTerm({ bits: m, mask: (1 << inputBits) - 1 }, inputBits))
    : engines[seg].activeSopTerms;
}

function evalSop(terms: Term[], code: number, inputBits: number): 0 | 1 {
  const varNames = inputVarNames(inputBits as InputWidth);
  for (const term of terms) {
    if (term.literals.length === 0) return 1;
    let match = true;
    for (const lit of term.literals) {
      const bit = (code >> (inputBits - 1 - varNames.indexOf(lit.name))) & 1;
      if (bit !== (lit.complemented ? 0 : 1)) { match = false; break; }
    }
    if (match) return 1;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Case runner                                                         */
/* ------------------------------------------------------------------ */

interface CaseCtx {
  engines: SegmentEngineMap;
  result: CircuitverseBuildResult;
  stats: CircuitverseStats;
  scope: CvScopeJson;
}

function runCase(
  name: string,
  inputBits: InputWidth,
  table: TruthTable,
  logicSource: 'minimized' | 'direct',
  extra?: (ctx: CaseCtx, c: CaseChecker) => void,
): { pass: boolean; checks: number } {
  const c = new CaseChecker();
  const title = `Verify ${name}`;
  try {
    const engines = computeEngines(table, {}, {});
    const result = buildCircuitverseProject(inputBits, engines, { title, logicSource });
    const project = validateDataReplica(result.json, title, c);
    const scope = structuralChecks(project, inputBits, c);

    // Stats agree with the serialized file.
    const comps = componentsOf(scope);
    const count = (t: string): number => comps.filter((x) => x.type === t).length;
    c.equal(result.stats.inputs, count('Input'), 'stats.inputs vs file');
    c.equal(result.stats.inverters, count('NotGate'), 'stats.inverters vs file');
    c.equal(result.stats.andGates, count('AndGate'), 'stats.andGates vs file');
    c.equal(result.stats.orGates, count('OrGate'), 'stats.orGates vs file');
    c.equal(result.stats.constants, count('ConstantVal'), 'stats.constants vs file');
    c.equal(result.stats.intermediates, scope.allNodes.filter((nd) => nd.type === 2).length, 'stats.intermediates vs file');
    const edgeCount = scope.allNodes.reduce((s, nd) => s + nd.connections.length, 0) / 2;
    c.equal(result.stats.wires, edgeCount, 'stats.wires vs file');
    c.equal(result.stats.segments.length, 8, 'stats has 8 segment entries');
    c.equal(
      JSON.stringify(result.stats.segments.map((s) => s.segment)),
      JSON.stringify([...SEGMENT_NAMES]),
      'segment stats in SEGMENT_NAMES order',
    );

    // Simulate every input code against the SOP reference and the truth table.
    const sim = new MiniSim(scope, inputBits);
    c.equal(sim.driverErrors.length, 0, `every net has at most one driver (${sim.driverErrors.join('; ')})`);
    const refTerms = {} as Record<SegmentName, Term[]>;
    for (const seg of SEGMENT_NAMES) refTerms[seg] = referenceTerms(engines, seg, logicSource, inputBits);
    for (let code = 0; code < (1 << inputBits); code++) {
      const segVals = sim.run(code);
      for (const seg of SEGMENT_NAMES) {
        c.equal(segVals[seg], evalSop(refTerms[seg], code, inputBits), `code ${code} segment ${seg}: circuit vs SOP reference`);
        const cell = table.rows[code].outputs[seg];
        if (cell === 0 || cell === 1) {
          c.equal(segVals[seg], cell, `code ${code} segment ${seg}: circuit vs truth table`);
        }
      }
    }

    extra?.({ engines, result, stats: result.stats, scope }, c);
    console.log(`PASS ${name} — ${c.count} checks`);
    return { pass: true, checks: c.count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FAIL ${name} — aborted after ${c.count} checks: ${msg}`);
    return { pass: false, checks: c.count };
  }
}

/* ------------------------------------------------------------------ */
/* Test cases                                                          */
/* ------------------------------------------------------------------ */

const bcdTable = presetTable(4, 'decimal', 'blank');

/** Segment A ≡ variable B (single literal); DP = A·B·C (3-literal term). */
const handTable: TruthTable = {
  inputBits: 4,
  rows: Array.from({ length: 16 }, (_, m) => {
    const segA = ((m >> 1) & 1) as 0 | 1;
    const segDP = ((m & 1) !== 0 && ((m >> 1) & 1) !== 0 && ((m >> 2) & 1) !== 0 ? 1 : 0) as 0 | 1;
    return {
      input: m,
      outputs: { A: segA, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, DP: segDP },
    };
  }),
};

const dontCareTable = presetTable(4, 'decimal', 'dontcare');
const font5Table = presetTable(5, 'font', 'blank', undefined, { fontStart: 0, tableStartCode: 0, glyphs: FONT_GLYPHS });

interface CaseDef { name: string; run: () => { pass: boolean; checks: number }; }

const cases: CaseDef[] = [
  {
    name: 'a: bcd-4bit-minimized',
    run: () => runCase('a: bcd-4bit-minimized', 4, bcdTable, 'minimized', ({ stats }, c) => {
      c.equal(stats.inputs, 4, 'BCD has 4 inputs');
      c.check(stats.inverters + stats.andGates + stats.orGates >= 25, 'at least 25 gates total');
      for (const seg of ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as SegmentName[]) {
        c.equal(stats.segments.find((s) => s.segment === seg)?.constant, null, `segment ${seg} is gate-driven`);
      }
      c.equal(stats.segments.find((s) => s.segment === 'DP')?.constant, 0, 'DP is constant 0');
    }),
  },
  {
    name: 'b: bcd-4bit-direct',
    run: () => runCase('b: bcd-4bit-direct', 4, bcdTable, 'direct', ({ engines, stats }, c) => {
      const onesTotal = SEGMENT_NAMES.reduce((sum, seg) => sum + engines[seg].ones.length, 0);
      c.equal(stats.andGates, onesTotal, 'direct mode: one AndGate per minterm');
      const minimized = buildCircuitverseProject(4, engines, { title: 'Verify bcd-min-ref', logicSource: 'minimized' });
      c.check(stats.orGates > minimized.stats.orGates, `direct orGates (${stats.orGates}) exceed minimized (${minimized.stats.orGates})`);
      c.check(stats.andGates > minimized.stats.andGates, 'direct uses more AndGates than minimized');
      c.check(stats.maxDepth >= minimized.stats.maxDepth, 'direct depth not shallower than minimized');
    }),
  },
  {
    name: 'c: alloff',
    run: () => runCase('c: alloff', 4, allSegmentsTable(4, false), 'minimized', ({ stats, scope }, c) => {
      c.equal(stats.andGates, 0, 'no AndGates');
      c.equal(stats.orGates, 0, 'no OrGates');
      c.equal(stats.inverters, 0, 'no inverters');
      c.equal(stats.constants, 8, 'eight constants');
      for (const s of stats.segments) c.equal(s.constant, 0, `segment ${s.segment} constant 0`);
      const constStates = (scope.ConstantVal as CvComponentJson[]).map((cv) => cv.customData.constructorParamaters[2]);
      c.equal(JSON.stringify(constStates), JSON.stringify(Array(8).fill('0')), 'all ConstantVal states are "0"');
    }),
  },
  {
    name: 'd: allon',
    run: () => runCase('d: allon', 4, allSegmentsTable(4, true), 'minimized', ({ stats, scope }, c) => {
      c.equal(stats.andGates, 0, 'no AndGates');
      c.equal(stats.orGates, 0, 'no OrGates');
      c.equal(stats.inverters, 0, 'no inverters');
      c.equal(stats.constants, 8, 'eight constants');
      for (const s of stats.segments) c.equal(s.constant, 1, `segment ${s.segment} constant 1`);
      const constStates = (scope.ConstantVal as CvComponentJson[]).map((cv) => cv.customData.constructorParamaters[2]);
      c.equal(JSON.stringify(constStates), JSON.stringify(Array(8).fill('1')), 'all ConstantVal states are "1"');
    }),
  },
  {
    name: 'e: font-5bit-minimized',
    run: () => runCase('e: font-5bit-minimized', 5, font5Table, 'minimized', ({ stats, scope }, c) => {
      c.equal(stats.inputs, 5, '5-bit table has 5 inputs');
      const inputs = scope.Input as CvComponentJson[];
      const eInput = inputs.find((i) => i.label === 'E');
      c.check(!!eInput, 'an Input labeled E exists');
      const eOut = eInput!.customData.nodes.output1 as number;
      c.check(scope.allNodes[eOut].connections.length > 0, 'variable E drives at least one gate input');
      c.check(stats.andGates > 0 && stats.orGates > 0, 'font table synthesizes gates');
    }),
  },
  {
    name: 'f: single-literal-and-3literal',
    run: () => runCase('f: single-literal-and-3literal', 4, handTable, 'minimized', ({ stats }, c) => {
      const segA = stats.segments.find((s) => s.segment === 'A')!;
      const segDP = stats.segments.find((s) => s.segment === 'DP')!;
      c.equal(segA.andGates, 0, 'single-literal segment needs no AndGate');
      c.equal(segA.orGates, 0, 'single-term segment needs no OrGate');
      c.equal(segA.constant, null, 'segment A is wire driven');
      c.equal(segDP.andGates, 1, '3-literal term is one 3-input AndGate');
      c.equal(segDP.orGates, 0, 'single minterm product drives the pin directly');
      c.equal(segDP.constant, null, 'segment DP is gate driven');
      c.equal(stats.andGates, 1, 'exactly one AndGate overall');
      c.equal(stats.orGates, 0, 'no OrGates overall');
      c.equal(stats.inverters, 0, 'no complemented literals, no inverters');
      c.equal(stats.constants, 6, 'six constant-0 segments');
      c.equal(stats.maxDepth, 1, 'deepest path is input -> AND (one gate traversed)');
    }),
  },
  {
    name: 'g: dontcare-minimized',
    run: () => runCase('g: dontcare-minimized', 4, dontCareTable, 'minimized', ({ stats }, c) => {
      const xRows = dontCareTable.rows.filter((r) => SEGMENT_NAMES.some((s) => r.outputs[s] === 'X'));
      c.equal(xRows.length, 6, 'table carries six all-X rows (codes 10-15)');
      c.check(stats.andGates > 0, 'don\'t-care minimization yields gates');
    }),
  },
  {
    name: 'g: dontcare-direct',
    run: () => runCase('g: dontcare-direct', 4, dontCareTable, 'direct', (_ctx, c) => {
      const xRows = dontCareTable.rows.filter((r) => SEGMENT_NAMES.some((s) => r.outputs[s] === 'X'));
      c.equal(xRows.length, 6, 'table carries six all-X rows (codes 10-15)');
    }),
  },
];

let totalChecks = 0;
let failed = 0;
for (const testCase of cases) {
  const outcome = testCase.run();
  totalChecks += outcome.checks;
  if (!outcome.pass) failed++;
}

console.log(`\nTOTAL: ${totalChecks} checks across ${cases.length} cases — ${failed === 0 ? 'ALL PASS' : `${failed} CASE(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
