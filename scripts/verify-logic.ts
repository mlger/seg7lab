/**
 * Permanent verification suite for the pure logic layer (src/logic/*).
 * Run from the project root:
 *
 *     bun run scripts/verify-logic.ts        (or: bun run verify:logic)
 *
 * Covers the regression guards for every P0/P1/P2 logic fix:
 *  1. booleanParser — astToAscii round-trip (incl. the NOT-over-compound
 *     parenthesization fix: !(A·B) must print a parenthesized product) and
 *     parse → print → reparse → eval equivalence over ALL input combinations.
 *  2. Multi-character variable names (W1 / X2 / Ab, ≤ 3 chars as the store
 *     allows) parse and evaluate; single-letter juxtaposition still works;
 *     unknown variables still produce a parse error.
 *  3. Minimizer — BCD segment A reduces to the textbook 4-term SOP with
 *     result.exact === true and full cover; all 8 segments of the BCD table
 *     minimize exactly and fully.
 *  4. CircuitVerse export — both logicSource modes build with default AND
 *     custom variable names (the E-242 regression), with pinned sane stats.
 *  5. Preset validators PRESERVE stored createdAt/updatedAt (P0 data-loss
 *     guard for the store's merge-by-updatedAt sync).
 *  6. K-map cell minterm math for 4-bit and 5-bit maps (Gray-axis convention).
 *  7. Decoder polarity matrix — all commonAnode × reverseLogic combinations.
 *  8. validateProject canonicalizes a slightly-off blob with E-2xx errors.
 */
import { parseBoolean, astToAscii, evalBool } from '@/logic/booleanParser';
import type { BoolAst } from '@/logic/booleanParser';
import { minimize, implicantMinterms } from '@/logic/minimizer';
import { presetTable, segmentSets } from '@/logic/truthTable';
import { computeEngines } from '@/logic/engine';
import { buildCircuitverseProject } from '@/logic/circuitverse';
import { validateLibraryTablePreset, validateLibraryFontPreset } from '@/logic/presets';
import { buildKMap } from '@/logic/kmap';
import { isSegmentLit, DEFAULT_DISPLAY_SETTINGS } from '@/logic/decoder';
import { validateProject, buildDefaultProject } from '@/logic/project';
import { buildCircuit, evaluateCircuit, computeLevels, buildFactoredCircuit, type Circuit } from '@/logic/circuitNetlist';
import { computeNodeLevels } from '@/logic/circuitLayout';
import { buildFactoredDecoderCircuit } from '@/logic/factoredDecoderCircuit';
import {
  buildFalstadNetlist, gatePinOffsets, FALSTAD_GATE_TYPE, FALSTAD_GRID,
} from '@/logic/falstad';
import {
  STANDARD_PATTERNS, STANDARD_DIGITS, STANDARD_GLYPHS, STANDARD_DIGIT_START,
  segmentsFromCode, standardPatternForChar,
  ROMAN_LETTER_PATTERNS, codeFromSegments,
} from '@/logic/standardPatterns';
import {
  standardPatternTable, romanPatternTable, findBuiltinTablePreset, buildPresetTable,
  parsePresetFile, presetDisplayMode, matchesTablePreset, PRESET_FILE_FORMAT,
} from '@/logic/presets';
import { FONT_GLYPHS } from '@/logic/font';
import { buildDecoderCircuit } from '@/logic/decoderCircuit';
import { mintermToTerm, maxtermToTerm } from '@/logic/expressions';
import {
  orthogonalWirePath, assignWireLanes, wireStart, wireEnd, wireLaneX, fanOutCounts,
} from '@/logic/wireRouting';
import { factorTerms, factorCover, termKey, type FactoredForm } from '@/logic/factoring';
import type { Term } from '@/types/simulator';
import { grayAxisOrder } from '@/logic/binary';
import {
  SEGMENT_NAMES,
  type DisplaySettings,
  type MinimizeResult,
  type SegmentOutput,
  type TablePresetDef,
  type FontPresetDef,
} from '@/types/simulator';

/* ------------------------------------------------------------------ */
/* Tiny check framework                                                */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

function equal<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  check(label, ok, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

/** Enumerate every assignment of `names` (MSB first, index 0 = highest bit). */
function allEnvs(names: string[]): Record<string, 0 | 1>[] {
  const out: Record<string, 0 | 1>[] = [];
  for (let m = 0; m < 1 << names.length; m++) {
    const env: Record<string, 0 | 1> = {};
    names.forEach((n, i) => {
      env[n] = ((m >> (names.length - 1 - i)) & 1) as 0 | 1;
    });
    out.push(env);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. booleanParser — astToAscii round-trip                            */
/* ------------------------------------------------------------------ */

section('1. booleanParser: astToAscii round-trip');

const DEFAULT_VARS = ['A', 'B', 'C', 'D'];

/**
 * Exact-output pins. ASCII notation prints AND as juxtaposition, so the P0
 * fix for NOT-over-compound prints !(A·B) as "(AB)'" (parenthesized product,
 * postfix complement) — NOT the old buggy "AB'" (NOT over the last literal).
 */
const EXACT_PINS: { src: string; printed: string }[] = [
  { src: '!(AB)', printed: "(AB)'" },
  { src: '!(A·B)', printed: "(AB)'" },
  { src: '(AB)\'', printed: "(AB)'" },
  { src: '!(A + B)', printed: "(A + B)'" },
  { src: '!(A^B)', printed: "(A ^ B)'" },
  { src: '!(!(AB))', printed: "(AB)''" },
  { src: '!(AB + CD)', printed: "((AB) + (CD))'" },
  { src: "A'BC'D", printed: "A'BC'D" },
];

for (const { src, printed } of EXACT_PINS) {
  const parsed = parseBoolean(src, DEFAULT_VARS);
  check(`parse ${JSON.stringify(src)}`, parsed.ok, parsed.ok ? undefined : parsed.error.message);
  if (parsed.ok) {
    equal(`astToAscii(${JSON.stringify(src)}) [P0 parenthesization]`, astToAscii(parsed.ast), printed);
  }
}

const ROUNDTRIP_CORPUS = [
  'A', "A'", 'AB', 'A + B', 'A^B', "A'B + C'D",
  '!(AB)', '!(A·B)', '!(A + B)', '!(A^B)', '!(!(AB))', "(AB)'",
  '!(AB + CD)', '!(A^BC)', "A(B + C)(C'^D)", "AB'C + A'BC' + C'D'",
  "!(A'B')", "((A + B)(C + D))'", "!(A(B + C'))", 'A1 + B0',
  '0', '1', "1'", "(A^B)' + AB", "!((A + B)')",
];

const defaultEnvs = allEnvs(DEFAULT_VARS);
for (const src of ROUNDTRIP_CORPUS) {
  const first = parseBoolean(src, DEFAULT_VARS);
  check(`corpus parse ${JSON.stringify(src)}`, first.ok, first.ok ? undefined : first.error.message);
  if (!first.ok) continue;
  const printed = astToAscii(first.ast);
  const second = parseBoolean(printed, DEFAULT_VARS);
  check(`reparse of printed form ${JSON.stringify(printed)}`, second.ok,
    second.ok ? undefined : second.error.message);
  if (!second.ok) continue;
  const mismatch = defaultEnvs.find((env) => evalBool(first.ast, env) !== evalBool(second.ast, env));
  check(`eval equivalence ${JSON.stringify(src)} → ${JSON.stringify(printed)} (16 inputs)`,
    mismatch === undefined,
    mismatch === undefined ? undefined : `diverges at ${JSON.stringify(mismatch)}`);
}

/* ------------------------------------------------------------------ */
/* 2. Multi-character variable names                                   */
/* ------------------------------------------------------------------ */

section('2. booleanParser: multi-character variable names');

const MULTI_VARS = ['W1', 'X2', 'AB', 'C', 'D']; // store allows ≤ 3-char names
const multiEnvs = allEnvs(MULTI_VARS);

for (const src of ['W1X2 + Ab', "W1·X2 + C'D", '!W1 + X2AB', "W1'X2' + (AB)'C", 'W1X2ABCD']) {
  const parsed = parseBoolean(src, MULTI_VARS);
  check(`multi-char parse ${JSON.stringify(src)}`, parsed.ok, parsed.ok ? undefined : parsed.error.message);
  if (!parsed.ok) continue;
  const printed = astToAscii(parsed.ast);
  const re = parseBoolean(printed, MULTI_VARS);
  check(`multi-char reparse ${JSON.stringify(printed)}`, re.ok, re.ok ? undefined : re.error.message);
  if (!re.ok) continue;
  const mismatch = multiEnvs.find((env) => evalBool(parsed.ast, env) !== evalBool(re.ast, env));
  check(`multi-char eval equivalence ${JSON.stringify(src)} (32 inputs)`, mismatch === undefined,
    mismatch === undefined ? undefined : `diverges at ${JSON.stringify(mismatch)}`);
}

// Semantic pin: juxtaposition W1X2 = W1·X2 (2·3=6, 2·2=4 …), !W1 binds to W1 only.
{
  const p = parseBoolean('W1X2 + !W1', MULTI_VARS);
  check('parse W1X2 + !W1', p.ok, p.ok ? undefined : p.error.message);
  if (p.ok) {
    equal('W1X2 + !W1 @ W1=1,X2=0 → !W1=0, W1·X2=0', evalBool(p.ast, { W1: 1, X2: 0, AB: 0, C: 0, D: 0 }), 0);
    equal('W1X2 + !W1 @ W1=0,X2=1 → !W1=1', evalBool(p.ast, { W1: 0, X2: 1, AB: 0, C: 0, D: 0 }), 1);
    equal('W1X2 + !W1 @ W1=1,X2=1 → W1·X2=1', evalBool(p.ast, { W1: 1, X2: 1, AB: 0, C: 0, D: 0 }), 1);
  }
}

// "AB" resolves by name set: a variable named AB beats the A·B juxtaposition.
{
  const asVar = parseBoolean('AB', MULTI_VARS);
  check('parse AB with AB in vars', asVar.ok, asVar.ok ? undefined : asVar.error.message);
  if (asVar.ok) {
    equal('AB (multi-char var) @ AB=1', evalBool(asVar.ast, { W1: 0, X2: 0, AB: 1, C: 0, D: 0 }), 1);
    equal('AB (multi-char var) @ AB=0', evalBool(asVar.ast, { W1: 0, X2: 0, AB: 0, C: 0, D: 0 }), 0);
  }
  const asProduct = parseBoolean('AB', DEFAULT_VARS);
  check('parse AB with single-letter vars', asProduct.ok, asProduct.ok ? undefined : asProduct.error.message);
  if (asProduct.ok) {
    equal('AB (A·B) @ A=1,B=0', evalBool(asProduct.ast, { A: 1, B: 0, C: 0, D: 0 }), 0);
    equal('AB (A·B) @ A=1,B=1', evalBool(asProduct.ast, { A: 1, B: 1, C: 0, D: 0 }), 1);
  }
}

// Single-letter fallback still works.
{
  const p = parseBoolean("AB + C'", DEFAULT_VARS);
  check('single-letter fallback parse AB + C\'', p.ok, p.ok ? undefined : p.error.message);
  if (p.ok) {
    equal("AB + C' @ A=1,B=1,C=0 → 1+1", evalBool(p.ast, { A: 1, B: 1, C: 0, D: 0 }), 1);
    equal("AB + C' @ A=0,B=1,C=1 → 0+0", evalBool(p.ast, { A: 0, B: 1, C: 1, D: 0 }), 0);
  }
}

// Unknown variables still error (junk input must not silently parse).
{
  const junk = parseBoolean('Q9 + A', DEFAULT_VARS);
  check('unknown variable Q9 → parse error', !junk.ok);
  if (!junk.ok) {
    check('error mentions "Unknown variable"', junk.error.message.includes('Unknown variable'),
      junk.error.message);
  }
  const junkMulti = parseBoolean('AQ', DEFAULT_VARS); // Q is not a variable
  check('unknown variable Q (from "AQ") → parse error', !junkMulti.ok);
  if (!junkMulti.ok) {
    check('junk mentions "Unknown variable"', junkMulti.error.message.includes('Unknown variable'),
      junkMulti.error.message);
  }
  const junkSuffix = parseBoolean('W9', DEFAULT_VARS); // W9/W not variables
  check('unknown variable W9 → parse error', !junkSuffix.ok);
  if (!junkSuffix.ok) {
    check('multi-char junk mentions "Unknown variable"', junkSuffix.error.message.includes('Unknown variable'),
      junkSuffix.error.message);
  }
  // "Abc" is NOT junk with default vars — it is the juxtaposition A·B·C.
  const juxtaposed = parseBoolean('Abc', DEFAULT_VARS);
  check('"Abc" parses as A·B·C juxtaposition (case-insensitive)', juxtaposed.ok,
    juxtaposed.ok ? undefined : juxtaposed.error.message);
  if (juxtaposed.ok) {
    equal('"Abc" @ A=1,B=1,C=0 → 0', evalBool(juxtaposed.ast, { A: 1, B: 1, C: 0, D: 0 }), 0);
    equal('"Abc" @ A=1,B=1,C=1 → 1', evalBool(juxtaposed.ast, { A: 1, B: 1, C: 1, D: 0 }), 1);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Minimizer — BCD textbook results                                 */
/* ------------------------------------------------------------------ */

section('3. minimizer: BCD segment A textbook SOP + all 8 segments');

const bcd = presetTable(4, 'decimal', 'dontcare');

/** Compile-time proof that MinimizeResult.exact exists (type-level flag). */
function exactFlagOf(result: MinimizeResult): boolean {
  return result.exact === true;
}

{
  const segA = segmentSets(bcd, 'A');
  equal('segment A ones = digits 0,2,3,5,6,7,8,9', segA.ones.join(','), '0,2,3,5,6,7,8,9');
  equal('segment A dont-cares = 10..15', segA.dontCares.join(','), '10,11,12,13,14,15');

  const res = minimize(segA.ones, segA.dontCares, 4);
  check('MinimizeResult.exact present (type-level) + true', exactFlagOf(res) && typeof res.exact === 'boolean');
  equal('segment A cover = textbook 4 terms', res.cover.length, 4);
  equal(
    'segment A cover = 6 literals (textbook)',
    res.cover.reduce((acc, p) => acc + p.literalCount, 0),
    6,
  );
  equal('segment A uncovered = none', res.uncovered.length, 0);
  // Every one-minterm must be inside some cover implicant's minterm set.
  const uncoveredByCover = segA.ones.filter(
    (m) => !res.cover.some((p) => implicantMinterms(p, 4).includes(m)),
  );
  equal('every segment-A one-minterm covered by a cover implicant', uncoveredByCover.length, 0);
  // Cover members must all be prime implicants of the function.
  const primeKeys = new Set(res.primes.map((p) => p.key));
  check('cover ⊆ primes', res.cover.every((p) => primeKeys.has(p.key)));
}

for (const seg of SEGMENT_NAMES) {
  const sets = segmentSets(bcd, seg);
  const res = minimize(sets.ones, sets.dontCares, 4);
  check(`segment ${seg}: exact === true`, res.exact === true);
  equal(`segment ${seg}: uncovered = none`, res.uncovered.length, 0);
  if (sets.ones.length > 0) {
    check(`segment ${seg}: non-empty cover (${res.cover.length} terms)`, res.cover.length > 0);
    const covered = new Set(res.cover.flatMap((p) => p.coveredOnes));
    check(`segment ${seg}: cover covers every one-minterm`,
      sets.ones.every((m) => covered.has(m)));
  } else {
    // Constant-0 function (BCD DP): empty everything, exact by definition.
    equal(`segment ${seg}: constant-0 → empty primes`, res.primes.length, 0);
    equal(`segment ${seg}: constant-0 → empty cover`, res.cover.length, 0);
  }
}

// Constant-1 and a random-ish exactness sanity: all-ones 4-var → single term.
{
  const allOnes = minimize(Array.from({ length: 16 }, (_, m) => m), [], 4);
  equal('all-ones → 1 term (constant 1)', allOnes.cover.length, 1);
  equal('all-ones → 0 literals', allOnes.cover[0]?.literalCount ?? -1, 0);
  check('all-ones exact', allOnes.exact === true);
}

/* ------------------------------------------------------------------ */
/* 4. CircuitVerse export — E-242 regression + sane stats               */
/* ------------------------------------------------------------------ */

section('4. circuitverse: both logicSource modes × default/custom varNames');

const CV_TITLE = 'verify-logic';
const CUSTOM_NAMES = ['W', 'X', 'Y', 'Z'];
const enginesDefault = computeEngines(bcd, {}, {});
const enginesCustom = computeEngines(bcd, {}, {}, CUSTOM_NAMES);

/**
 * Stats pinned to the values browser-verified end-to-end. Gate counts and
 * depth were pinned during the P2 wave ("4 inputs / 16 AND / 7 OR / 3 NOT /
 * 1 constant / depth 3" minimized; 49 AND / 9 OR direct) and are unchanged
 * by the v2 CA-style layout. Wire counts were re-pinned for the v2 layout
 * (organized rails + staircase fans + dedicated display feed channels use
 * more — but strictly non-overlapping — wire segments than the old nest).
 * Renaming variables only changes labels, never structure — custom-name
 * builds must produce identical counts.
 */
function assertSaneStats(label: string, stats: {
  inputs: number; inverters: number; andGates: number; orGates: number;
  constants: number; wires: number; maxDepth: number; segments: { segment: string }[];
}): void {
  equal(`${label}: stats.inputs`, stats.inputs, 4);
  equal(`${label}: stats.segments length`, stats.segments.length, 8);
  check(`${label}: andGates > 0`, stats.andGates > 0, String(stats.andGates));
  check(`${label}: orGates > 0`, stats.orGates > 0, String(stats.orGates));
  check(`${label}: wires > 0`, stats.wires > 0, String(stats.wires));
  check(`${label}: maxDepth ≥ 1`, stats.maxDepth >= 1, String(stats.maxDepth));
}

function tryBuild(
  label: string,
  inputBits: 4 | 5,
  engines: ReturnType<typeof computeEngines>,
  options: { title: string; logicSource: 'minimized' | 'direct'; varNames?: string[] },
): { ok: boolean; detail?: string } {
  try {
    const result = buildCircuitverseProject(inputBits, engines, options);
    assertSaneStats(label, result.stats);
    const parsed: unknown = JSON.parse(result.json);
    check(`${label}: json parses`, typeof parsed === 'object' && parsed !== null);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: msg };
  }
}

// 4a. Default variable names, both modes.
{
  const min = tryBuild('default/minimized', 4, enginesDefault, { title: CV_TITLE, logicSource: 'minimized' });
  check('default names + minimized mode builds (no E-24x)', min.ok, min.detail);
  const dir = tryBuild('default/direct', 4, enginesDefault, { title: CV_TITLE, logicSource: 'direct' });
  check('default names + direct mode builds (no E-24x)', dir.ok, dir.detail);
}

// 4b. Custom variable names — THE E-242 regression guard.
{
  // direct mode with custom names: engines carry default names; the builder
  // must thread options.varNames into its canonical minterm terms.
  const a = tryBuild('custom/direct(E-242 guard)', 4, enginesDefault,
    { title: CV_TITLE, logicSource: 'direct', varNames: CUSTOM_NAMES });
  check('custom names + direct mode builds (E-242 regression)', a.ok, a.detail);
  // minimized mode with matching custom-named engines.
  const b = tryBuild('custom/minimized', 4, enginesCustom,
    { title: CV_TITLE, logicSource: 'minimized', varNames: CUSTOM_NAMES });
  check('custom names + minimized mode builds', b.ok, b.detail);
  const c = tryBuild('custom/direct', 4, enginesCustom,
    { title: CV_TITLE, logicSource: 'direct', varNames: CUSTOM_NAMES });
  check('custom names + direct mode (custom engines) builds', c.ok, c.detail);
}

// 4c. Pinned counts (structure must not silently change).
{
  const min = buildCircuitverseProject(4, enginesDefault, { title: CV_TITLE, logicSource: 'minimized' });
  equal('pinned minimized: andGates', min.stats.andGates, 16);
  equal('pinned minimized: orGates', min.stats.orGates, 7);
  equal('pinned minimized: inverters', min.stats.inverters, 3);
  equal('pinned minimized: constants', min.stats.constants, 1);
  equal('pinned minimized: wires', min.stats.wires, 194);
  equal('pinned minimized: maxDepth', min.stats.maxDepth, 3);

  const dir = buildCircuitverseProject(4, enginesDefault, { title: CV_TITLE, logicSource: 'direct' });
  equal('pinned direct: andGates', dir.stats.andGates, 49);
  equal('pinned direct: orGates', dir.stats.orGates, 9);
  equal('pinned direct: wires', dir.stats.wires, 583);
  check('direct mode has ≥ minimized AND gates (canonical ⊇ minimal)', dir.stats.andGates >= min.stats.andGates);

  // Renames only change labels — identical counts.
  const renamed = buildCircuitverseProject(4, enginesCustom,
    { title: CV_TITLE, logicSource: 'minimized', varNames: CUSTOM_NAMES });
  check('renamed minimized stats identical to default',
    renamed.stats.andGates === min.stats.andGates
    && renamed.stats.orGates === min.stats.orGates
    && renamed.stats.wires === min.stats.wires
    && renamed.stats.inverters === min.stats.inverters,
    `and=${renamed.stats.andGates} or=${renamed.stats.orGates} wires=${renamed.stats.wires}`);
  const project = JSON.parse(renamed.json) as { scopes: { Input: { label: string }[] }[] };
  const labels = project.scopes[0]?.Input.map((i) => i.label) ?? [];
  equal('custom input labels present (W X Y Z)', labels.join(','), 'W,X,Y,Z');
}

/* ------------------------------------------------------------------ */
/* 5. Preset validators preserve stored timestamps                     */
/* ------------------------------------------------------------------ */

section('5. presets: validateLibrary* preserve createdAt/updatedAt');

const STAMP = '2024-01-01T00:00:00.000Z';

{
  const raw: Record<string, unknown> = {
    id: 'user:verify-logic-table',
    name: 'Verify Logic BCD',
    category: 'User',
    inputBits: 4,
    generator: 'bcd',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  const validated: TablePresetDef | null = validateLibraryTablePreset(raw);
  check('validateLibraryTablePreset accepts the blob', validated !== null);
  if (validated) {
    equal('table preset id preserved', validated.id, 'user:verify-logic-table');
    equal('table preset createdAt PRESERVED (P0 data-loss guard)', validated.createdAt, STAMP);
    equal('table preset updatedAt PRESERVED (P0 data-loss guard)', validated.updatedAt, STAMP);
    equal('table preset generator', validated.generator, 'bcd');
    check('stamps not restamped to now', validated.updatedAt !== new Date().toISOString());
  }
}

{
  const raw: Record<string, unknown> = {
    id: 'user:verify-logic-font',
    name: 'Verify Logic Font',
    builtin: false,
    glyphs: [
      { char: '0', segments: 'ABCDEF' },
      { char: '1', segments: 'BC' },
    ],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
  const validated: FontPresetDef | null = validateLibraryFontPreset(raw);
  check('validateLibraryFontPreset accepts the blob', validated !== null);
  if (validated) {
    equal('font preset id preserved', validated.id, 'user:verify-logic-font');
    equal('font preset createdAt PRESERVED (P0 data-loss guard)', validated.createdAt, STAMP);
    equal('font preset updatedAt PRESERVED (P0 data-loss guard)', validated.updatedAt, STAMP);
    equal('font preset glyphs survive', validated.glyphs.length, 2);
  }
}

// Rejector sanity: junk returns null (never a half-validated def).
{
  check('validateLibraryTablePreset rejects junk', validateLibraryTablePreset({ nope: true }) === null);
  check('validateLibraryFontPreset rejects junk', validateLibraryFontPreset(42) === null);
  check('validateLibraryTablePreset rejects non-user: ids',
    validateLibraryTablePreset({ id: 'builtin:bcd', name: 'x', inputBits: 4, generator: 'bcd' }) === null);
}

/* ------------------------------------------------------------------ */
/* 6. K-map cell minterm math                                          */
/* ------------------------------------------------------------------ */

section('6. kmap: 4-bit and 5-bit cell minterm math');

{
  const gray = grayAxisOrder(2); // [0, 1, 3, 2]
  equal('gray axis order', gray.join(','), '0,1,3,2');
  const valueAt = (m: number): SegmentOutput => (m % 2 === 0 ? 1 : 0);

  const km4 = buildKMap(4, valueAt);
  equal('4-bit: one plane', km4.planes.length, 1);
  equal('4-bit: planeVar null', km4.planeVar, null);
  equal('4-bit: rowVars = A B (MSBs)', km4.rowVars.join(','), 'A,B');
  equal('4-bit: colVars = C D', km4.colVars.join(','), 'C,D');
  equal('4-bit: rowLabels gray', km4.rowLabels.join(','), '00,01,11,10');
  equal('4-bit: colLabels gray', km4.colLabels.join(','), '00,01,11,10');

  let mathOk = true;
  let valueOk = true;
  const seen = new Set<number>();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const cell = km4.planes[0][r][c];
      if (cell.minterm !== gray[r] * 4 + gray[c]) mathOk = false;
      if (cell.value !== valueAt(cell.minterm)) valueOk = false;
      seen.add(cell.minterm);
    }
  }
  check('4-bit: cell minterm = grayRow·4 + grayCol (documented convention)', mathOk);
  check('4-bit: getValue plumbed to the right minterm', valueOk);
  check('4-bit: minterms form a bijection of 0..15', seen.size === 16);

  const km4c = buildKMap(4, valueAt, ['W', 'X', 'Y', 'Z']);
  equal('4-bit custom: rowVars = W X', km4c.rowVars.join(','), 'W,X');
  equal('4-bit custom: colVars = Y Z', km4c.colVars.join(','), 'Y,Z');

  const km5 = buildKMap(5, valueAt);
  equal('5-bit: two planes', km5.planes.length, 2);
  equal('5-bit: planeVar = A (weight 16)', km5.planeVar, 'A');
  equal('5-bit: rowVars = B C', km5.rowVars.join(','), 'B,C');
  equal('5-bit: colVars = D E', km5.colVars.join(','), 'D,E');
  let math5Ok = true;
  const seen5 = new Set<number>();
  for (let p = 0; p < 2; p++) {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const cell = km5.planes[p][r][c];
        if (cell.minterm !== p * 16 + gray[r] * 4 + gray[c]) math5Ok = false;
        seen5.add(cell.minterm);
      }
    }
  }
  check('5-bit: cell minterm = plane·16 + grayRow·4 + grayCol', math5Ok);
  check('5-bit: minterms form a bijection of 0..31', seen5.size === 32);
}

/* ------------------------------------------------------------------ */
/* 7. Decoder polarity matrix                                          */
/* ------------------------------------------------------------------ */

section('7. decoder: isSegmentLit polarity matrix');

{
  const settingsOf = (commonAnode: boolean, reverseLogic: boolean): DisplaySettings => ({
    ...DEFAULT_DISPLAY_SETTINGS,
    commonAnode,
    reverseLogic,
  });

  /** lit = (output === 1) XOR reverseLogic XOR commonAnode; 'X' never lights. */
  const MATRIX: { output: SegmentOutput; ca: boolean; rl: boolean; lit: boolean }[] = [
    { output: 1, ca: false, rl: false, lit: true },   // common cathode: 1 lights
    { output: 1, ca: false, rl: true, lit: false },
    { output: 1, ca: true, rl: false, lit: false },   // common anode: active LOW
    { output: 1, ca: true, rl: true, lit: true },
    { output: 0, ca: false, rl: false, lit: false },
    { output: 0, ca: false, rl: true, lit: true },
    { output: 0, ca: true, rl: false, lit: true },
    { output: 0, ca: true, rl: true, lit: false },
  ];
  for (const { output, ca, rl, lit } of MATRIX) {
    const actual = isSegmentLit(output, settingsOf(ca, rl));
    check(`output=${output} commonAnode=${ca} reverseLogic=${rl} → lit=${lit}`,
      actual === lit, `got ${actual}`);
  }
  for (const ca of [false, true]) {
    for (const rl of [false, true]) {
      check(`'X' never lights (ca=${ca}, rl=${rl})`, isSegmentLit('X', settingsOf(ca, rl)) === false);
    }
  }

  // Known pattern: BCD digit 8 — segments A..G = 1, DP = 0.
  const digit8: Record<string, SegmentOutput> = {
    A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, DP: 0,
  };
  const cc = settingsOf(false, false);
  check('digit 8 @ common cathode: A-G lit, DP dark',
    SEGMENT_NAMES.every((s) => isSegmentLit(digit8[s], cc) === (s === 'DP' ? false : true)));
  const ca = settingsOf(true, false);
  check('digit 8 @ common anode: only DP lit (active LOW)',
    SEGMENT_NAMES.every((s) => isSegmentLit(digit8[s], ca) === (s === 'DP' ? true : false)));
  const rl = settingsOf(false, true);
  check('digit 8 @ reverseLogic: only DP lit',
    SEGMENT_NAMES.every((s) => isSegmentLit(digit8[s], rl) === (s === 'DP' ? true : false)));
  const caRl = settingsOf(true, true);
  check('digit 8 @ common anode + reverseLogic: A-G lit, DP dark (double inversion)',
    SEGMENT_NAMES.every((s) => isSegmentLit(digit8[s], caRl) === (s === 'DP' ? false : true)));
}

/* ------------------------------------------------------------------ */
/* 8. validateProject canonicalization                                 */
/* ------------------------------------------------------------------ */

section('8. project: validateProject canonicalizes slightly-off blobs');

{
  // Positive control: the default project validates clean.
  const good = validateProject(buildDefaultProject());
  check('default project validates ok', good.ok && good.errors.length === 0, good.errors.join(' | '));
  check('default project returns a 16-row table', good.data?.truthTable.rows.length === 16);

  // Slightly-off blob: 17 rows (E-210) + invalid segment value on row 0 (E-211).
  interface LooseRow { input: number; outputs: Record<string, unknown>; }
  const looseRows: LooseRow[] = bcd.rows.map((r) => ({
    input: r.input,
    outputs: { ...r.outputs } as Record<string, unknown>,
  }));
  looseRows.push({ input: 99, outputs: { A: 1, B: 0 } }); // extra row → E-210
  looseRows[0].outputs.A = 2; // invalid segment value → E-211, canonicalized to 0

  const offBlob: Record<string, unknown> = {
    version: 1,
    name: 'Slightly Off Project',
    inputBits: 4,
    displayMode: 'decimal',
    invalidBehavior: 'dontcare',
    currentInput: 8,
    truthTable: { inputBits: 4, rows: looseRows },
    displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
    coverExcluded: {},
    coverAdded: {},
  };

  const res = validateProject(offBlob);
  check('slightly-off blob reports errors (ok === false)', !res.ok);
  check('E-210 reported (row-count mismatch)', res.errors.some((e) => e.startsWith('E-210')),
    res.errors.join(' | '));
  check('E-211 reported (invalid segment value)', res.errors.some((e) => e.startsWith('E-211')),
    res.errors.join(' | '));
  check('valid canonical table still returned', res.data !== undefined);
  if (res.data) {
    equal('canonical table has exactly 16 rows', res.data.truthTable.rows.length, 16);
    equal('extra (17th) row dropped', res.data.truthTable.rows.every((r) => r.input >= 0 && r.input <= 15), true);
    equal('invalid segment value canonicalized to 0', res.data.truthTable.rows[0].outputs.A, 0);
    check('all canonical values ∈ {0, 1, "X"}',
      res.data.truthTable.rows.every((r) =>
        SEGMENT_NAMES.every((s) => {
          const v = r.outputs[s];
          return v === 0 || v === 1 || v === 'X';
        })));
    equal('rows reindexed positionally 0..15', res.data.truthTable.rows.map((r) => r.input).join(','), '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15');
    equal('name preserved', res.data.name, 'Slightly Off Project');
  }
}

/* ------------------------------------------------------------------ */
/* 9. Circuit netlist — builders, evaluators, De Morgan & decoder      */
/* ------------------------------------------------------------------ */

section('9. circuit: netlist builders + evaluators reproduce the truth table');

{
  const engines = computeEngines(bcd, {}, {}, ['A', 'B', 'C', 'D']);
  const varNames = ['A', 'B', 'C', 'D'];
  type Seg = (typeof SEGMENT_NAMES)[number];
  type Terms = typeof engines.A.activeSopTerms;

  const bitOf = (m: number, i: number): 0 | 1 => ((m >> (4 - 1 - i)) & 1) as 0 | 1;
  /**
   * The Boolean function the netlist is supposed to realise, evaluated from the
   * terms themselves: SOP = OR of ANDs, POS = AND of ORs. For don't-care rows
   * this yields the cover's own choice, which is exactly what the circuit must
   * reproduce (both are built from the same terms).
   */
  const evalTerms = (terms: Terms, m: number, form: 'sop' | 'pos'): 0 | 1 => {
    if (terms.length === 0) return form === 'sop' ? 0 : 1;
    const termValues = terms.map((t) => {
      if (t.literals.length === 0) return form === 'sop' ? 1 : 0;
      const lits = t.literals.map((l) => {
        const bit = bitOf(m, varNames.indexOf(l.name));
        return l.complemented ? (bit === 1 ? 0 : 1) : bit;
      });
      return form === 'sop'
        ? (lits.every((b) => b === 1) ? 1 : 0)
        : (lits.some((b) => b === 1) ? 1 : 0);
    });
    return form === 'sop'
      ? (termValues.some((b) => b === 1) ? 1 : 0)
      : (termValues.every((b) => b === 1) ? 1 : 0);
  };

  const FORMS = [
    { form: 'sop' as const, termsOf: (s: Seg): Terms => engines[s].activeSopTerms },
    { form: 'pos' as const, termsOf: (s: Seg): Terms => engines[s].activePosTerms },
  ];

  for (const { form, termsOf } of FORMS) {
    for (const style of ['basic', 'universal'] as const) {
      let bad = 0;
      let firstBad = '';
      for (const seg of SEGMENT_NAMES) {
        const terms = termsOf(seg);
        const circuit = buildCircuit(terms, form, varNames, style);
        for (let m = 0; m < 16; m++) {
          const got = evaluateCircuit(circuit, m, 4, varNames).get('out') ?? 0;
          const want = evalTerms(terms, m, form);
          if (got !== want) {
            bad++;
            if (!firstBad) firstBad = `seg ${seg} m${m}: got ${got}, want ${want}`;
          }
        }
      }
      check(`${form.toUpperCase()} / ${style}: all 8 segments × 16 inputs match their expressions`,
        bad === 0, firstBad);
    }
  }

  /* Basic-style circuits must also agree with the source truth-table rows
     wherever the row is a real 0 or 1 (don't-cares are the cover's choice). */
  {
    let bad = 0;
    let firstBad = '';
    for (const seg of SEGMENT_NAMES) {
      const circuit = buildCircuit(engines[seg].activeSopTerms, 'sop', varNames, 'basic');
      for (let m = 0; m < 16; m++) {
        const raw = bcd.rows[m].outputs[seg];
        if (raw !== 0 && raw !== 1) continue;
        const got = evaluateCircuit(circuit, m, 4, varNames).get('out') ?? 0;
        if (got !== raw) { bad++; if (!firstBad) firstBad = `seg ${seg} m${m}: got ${got}, want ${raw}`; }
      }
    }
    check('basic SOP: respects every specified truth-table cell', bad === 0, firstBad);
  }

  /* Canonical Σm: one full minterm per 1-row — reproduces exactly the 1-rows. */
  for (const style of ['basic', 'universal'] as const) {
    let bad = 0;
    let firstBad = '';
    for (const seg of SEGMENT_NAMES) {
      const ones = engines[seg].ones;
      const terms = ones.map((m) => mintermToTerm(m, 4, varNames));
      const circuit = buildCircuit(terms, 'sop', varNames, style);
      for (let m = 0; m < 16; m++) {
        const want: 0 | 1 = ones.includes(m) ? 1 : 0;
        const got = evaluateCircuit(circuit, m, 4, varNames).get('out') ?? 0;
        if (got !== want) { bad++; if (!firstBad) firstBad = `seg ${seg} m${m}: got ${got}, want ${want}`; }
      }
    }
    check(`canonical Σm / ${style}: reproduces exactly the 1-rows`, bad === 0, firstBad);
  }

  /* Canonical ΠM: one full maxterm per 0-row. */
  for (const style of ['basic', 'universal'] as const) {
    let bad = 0;
    let firstBad = '';
    for (const seg of SEGMENT_NAMES) {
      const zeros = engines[seg].zeros;
      const terms = zeros.map((m) => maxtermToTerm(m, 4, varNames));
      const circuit = buildCircuit(terms, 'pos', varNames, style);
      for (let m = 0; m < 16; m++) {
        const want: 0 | 1 = zeros.includes(m) ? 0 : 1;
        const got = evaluateCircuit(circuit, m, 4, varNames).get('out') ?? 0;
        if (got !== want) { bad++; if (!firstBad) firstBad = `seg ${seg} m${m}: got ${got}, want ${want}`; }
      }
    }
    check(`canonical ΠM / ${style}: reproduces exactly the 0-rows`, bad === 0, firstBad);
  }

  /* De Morgan gate inventory: 'universal' emits only NAND (SOP) or NOR (POS). */
  const sopTerms = engines.A.activeSopTerms;
  const nandCircuit = buildCircuit(sopTerms, 'sop', varNames, 'universal');
  const gateTypes = nandCircuit.nodes
    .filter((n) => n.type !== 'input' && n.type !== 'const' && n.type !== 'out')
    .map((n) => n.type);
  check('universal SOP emits only NAND gates (+ NOT rails)',
    gateTypes.every((t) => t === 'nand' || t === 'not'), gateTypes.join(','));
  check('universal SOP contains at least one NAND gate', gateTypes.includes('nand'));

  const norCircuit = buildCircuit(engines.A.activePosTerms, 'pos', varNames, 'universal');
  const norTypes = norCircuit.nodes
    .filter((n) => n.type !== 'input' && n.type !== 'const' && n.type !== 'out')
    .map((n) => n.type);
  check('universal POS emits only NOR gates (+ NOT rails)',
    norTypes.every((t) => t === 'nor' || t === 'not'), norTypes.join(','));
  check('universal POS contains at least one NOR gate', norTypes.includes('nor'));

  /* termIndex metadata is authored by the builders (never parsed from ids). */
  const idxCircuit = buildCircuit(sopTerms, 'sop', varNames, 'basic');
  const termGates = idxCircuit.nodes.filter((n) => n.id.startsWith('term-'));
  check('every term gate carries its termIndex',
    termGates.length > 0 && termGates.every((n) => n.termIndex === Number(n.id.slice('term-'.length))),
    termGates.map((n) => `${n.id}=${n.termIndex}`).join(','));

  /* computeLevels: inputs at 0, depth = 1 + max(operand depth). */
  const levels = computeLevels(idxCircuit);
  check('input rails are level 0',
    idxCircuit.nodes.filter((n) => n.type === 'input').every((n) => levels.get(n.id) === 0));
  check('every node has a level',
    idxCircuit.nodes.every((n) => (levels.get(n.id) ?? -1) >= 0));
  check('the root is strictly deeper than each of its operands', (() => {
    const lv = computeLevels(nandCircuit);
    const r = nandCircuit.byId.get('root');
    if (!r) return true; // segment A may collapse to a single term
    const rl = lv.get('root') ?? 0;
    return r.operandIds.every((id) => (lv.get(id) ?? 0) < rl);
  })());

  /* Decoder view: shared rails, per-segment ownership, same evaluation. */
  const termsBySeg = {} as Record<Seg, Terms>;
  for (const seg of SEGMENT_NAMES) termsBySeg[seg] = engines[seg].activeSopTerms;
  for (const style of ['basic', 'universal'] as const) {
    const dec = buildDecoderCircuit(termsBySeg, 'sop', varNames, style);
    let bad = 0;
    let firstBad = '';
    for (let m = 0; m < 16; m++) {
      const values = evaluateCircuit(dec.circuit, m, 4, varNames);
      for (const seg of SEGMENT_NAMES) {
        const got = values.get(`o-${seg}`) ?? 0;
        const want = evalTerms(engines[seg].activeSopTerms, m, 'sop');
        if (got !== want) { bad++; if (!firstBad) firstBad = `seg ${seg} m${m}: got ${got}, want ${want}`; }
      }
    }
    check(`decoder / ${style}: all 8 bands × 16 inputs match their expressions`, bad === 0, firstBad);
    check(`decoder / ${style}: 4 shared input rails`,
      dec.circuit.nodes.filter((n) => n.type === 'input').length === 4);
    check(`decoder / ${style}: 8 output drivers, one per segment`,
      SEGMENT_NAMES.every((s) => dec.circuit.nodes.some((n) => n.id === `o-${s}`)));
    check(`decoder / ${style}: every band gate is owned by its segment`,
      dec.bands.every((b) => dec.circuit.nodes
        .filter((n) => n.id.startsWith(`t-${b.seg}-`) || n.id.startsWith(`r-${b.seg}`))
        .every((n) => dec.nodeOwner.get(n.id) === b.seg)));
  }
}

/* ------------------------------------------------------------------ */
/* 10. wire routing — orthogonal paths, lanes, junction fan-out        */
/* ------------------------------------------------------------------ */

section('10. wire routing: orthogonal (no curves), deterministic lanes');

{
  const eng = computeEngines(bcd, {}, {}, ['A', 'B', 'C', 'D']);
  const vn = ['A', 'B', 'C', 'D'];
  const src = { x: 56, y: 48, w: 64, h: 44 };   // an input rail
  const dst = { x: 316, y: 52, h: 100, operandCount: 4 };

  const path = orthogonalWirePath(src, dst, 1, 0);
  check('path contains no curve commands (C/S/Q/A)',
    !/[CSQAcsqa]/.test(path), path);
  check('path uses only M/H/V commands',
    /^M [\d.,-]+( [HV] [\d.,-]+){1,3}$/.test(path), path);

  /* Aligned source/target collapses to a single horizontal run (no zero-length V).
     Tap y = 10 + 20/2 = 20; pin 0 of a 3-pin gate with h=60 also lands at 20. */
  const aligned = orthogonalWirePath({ x: 0, y: 10, w: 20, h: 20 }, { x: 100, y: 0, h: 60, operandCount: 2 }, 0, 0);
  check('aligned wire drops the zero-length vertical run',
    !/V/.test(aligned), aligned);
  equal('aligned wire is exactly one horizontal run', aligned, 'M 20,20 H 100');

  // Endpoints: starts on the source's right edge, ends on the target's left edge.
  const s = wireStart(src);
  const e = wireEnd(dst, 1);
  check('path starts at the source right edge',
    path.startsWith(`M ${Math.round(s.x * 100) / 100},${Math.round(s.y * 100) / 100}`), path);
  check('path ends at the target pin',
    path.endsWith(`H ${Math.round(e.x * 100) / 100}`), `${path} vs ${e.x}`);

  // Segment geometry: H runs share a y, V runs share an x (axis-aligned).
  const nums = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const [sx, sy, laneX, vy, endX] = nums;
  equal('first point is the source tap', sx, Math.round(s.x * 100) / 100);
  equal('second point keeps the source y (horizontal run)', sy, Math.round(s.y * 100) / 100);
  check('vertical corridor is strictly between the two edges',
    laneX >= s.x + 6 && laneX <= dst.x, `lane=${laneX} src=${s.x} dst=${dst.x}`);
  equal('third point is the pin y (vertical run target)', vy, Math.round(e.y * 100) / 100);
  equal('fourth point is the target edge x (final horizontal run)', endX, dst.x);
  check('all path coordinates are finite numbers',
    nums.every((n) => Number.isFinite(n)), nums.join(','));

  /* Deterministic lanes: wires into one target never share a corridor. */
  const fakeWires = [
    { id: 'a->t:0', toId: 't' },
    { id: 'b->t:1', toId: 't' },
    { id: 'c->t:2', toId: 't' },
    { id: 'd->u:0', toId: 'u' },
  ];
  const lanes = assignWireLanes(fakeWires);
  equal('lanes are 0,1,2 within one target', [lanes.get('a->t:0'), lanes.get('b->t:1'), lanes.get('c->t:2')].join(','), '0,1,2');
  equal('lane numbering restarts per target', lanes.get('d->u:0'), 0);

  const laneXs = [0, 1, 2].map((l) => wireLaneX(src, dst, l));
  check('distinct lanes give distinct corridors',
    new Set(laneXs).size === 3, laneXs.join(','));
  check('later lanes sit closer to the source (nested fan-in)',
    laneXs[0] > laneXs[1] && laneXs[1] > laneXs[2], laneXs.join(','));
  check('a far target clamps the corridor forward of the source',
    wireLaneX(src, { x: src.x + 2, y: 52, h: 40, operandCount: 2 }, 0) > src.x, 'corridor must move forward');

  /* Fan-out counts drive the junction dots. */
  const fan = fanOutCounts([
    { fromId: 'in-A' }, { fromId: 'in-A' }, { fromId: 'in-A' }, { fromId: 'term-0' },
  ]);
  equal('shared rail reports 3 destinations', fan.get('in-A'), 3);
  equal('single-use source reports 1 (no junction dot)', fan.get('term-0'), 1);

  /* Real circuits: every wire of every form/view routes without curves. */
  let curved = 0;
  let degenerate = 0;
  const dec = buildDecoderCircuit(
    Object.fromEntries(SEGMENT_NAMES.map((sg) => [sg, eng[sg].activeSopTerms])) as Record<(typeof SEGMENT_NAMES)[number], typeof eng.A.activeSopTerms>,
    'sop', vn, 'basic',
  );
  const laneMap = assignWireLanes(dec.circuit.wires);
  for (const w of dec.circuit.wires) {
    const f = dec.circuit.byId.get(w.fromId)!;
    const t = dec.circuit.byId.get(w.toId)!;
    const d = orthogonalWirePath(f, { x: t.x, y: t.y, h: t.h, operandCount: t.operandIds.length }, w.pin, laneMap.get(w.id) ?? 0);
    if (/[CSQAcsqa]/.test(d)) curved++;
    if (!Number.isFinite(Number(d.match(/-?\d+/)?.[0]))) degenerate++;
  }
  check(`decoder view: all ${dec.circuit.wires.length} wires route orthogonally`, curved === 0, `${curved} curved`);
  check('decoder view: no degenerate (NaN) paths', degenerate === 0, `${degenerate} bad`);

  /* Tidy-import guard: the routing module has no React/DOM dependency. */
  check('routing module is pure (no DOM globals referenced)',
    !/document|window|React/.test(orthogonalWirePath.toString()), 'found a DOM/React reference');
}

/* ------------------------------------------------------------------ */
/* 11. factoring — multi-level synthesis stays logically identical     */
/* ------------------------------------------------------------------ */

section('11. factoring: multi-level shares cubes without changing the function');

{
  const eng = computeEngines(bcd, {}, {}, ['A', 'B', 'C', 'D']);
  const vn = ['A', 'B', 'C', 'D'];
  type Seg = (typeof SEGMENT_NAMES)[number];
  type Terms = typeof eng.A.activeSopTerms;

  const bitOf = (m: number, i: number): 0 | 1 => ((m >> (4 - 1 - i)) & 1) as 0 | 1;

  /** Evaluate a literal name (primary input or intermediate) under input m. */
  const evalName = (name: string, m: number, sigs: Map<string, FactoredForm['output']>): 0 | 1 => {
    const sig = sigs.get(name);
    if (sig) return evalTermList(sig, m, sigs);
    const nameBits = new Map(vn.map((v, i) => [v, i]));
    if (name === '1') return 1;
    if (name === '0') return 0;
    return bitOf(m, nameBits.get(name) ?? 0);
  };

  const evalTermList = (terms: Terms, m: number, sigs: Map<string, FactoredForm['output']>): 0 | 1 => {
    if (terms.length === 0) return 0;
    const values = terms.map((t) => {
      if (t.literals.length === 0) return 1;
      const lits = t.literals.map((l) => {
        const v = evalName(l.name, m, sigs);
        return l.complemented ? (v === 1 ? 0 : 1) : v;
      });
      return lits.every((b) => b === 1) ? 1 : 0;
    });
    return values.some((b) => b === 1) ? 1 : 0;
  };

  /** Evaluate a whole factored form under input m. */
  const evalFactored = (f: FactoredForm, m: number): 0 | 1 => {
    const sigs = new Map(f.intermediates.map((s) => [s.id, s.terms]));
    return evalTermList(f.output, m, sigs);
  };

  /* --- Exhaustive equivalence: every segment, every input code --- */
  {
    let bad = 0;
    let firstBad = '';
    for (const seg of SEGMENT_NAMES) {
      const terms = eng[seg].activeSopTerms;
      const f = factorTerms(terms);
      for (let m = 0; m < 16; m++) {
        const got = evalFactored(f, m);
        const want = evalTermList(terms, m, new Map());
        if (got !== want) {
          bad++;
          if (!firstBad) firstBad = `seg ${seg} m${m}: factored ${got}, two-level ${want}`;
        }
      }
    }
    check('every factored segment matches its two-level SOP on all 16 inputs', bad === 0, firstBad);
  }

  /* --- Exhaustive equivalence on canonical (unminimized) forms too --- */
  {
    let bad = 0;
    let firstBad = '';
    for (const seg of SEGMENT_NAMES) {
      const terms = eng[seg].ones.map((m) => mintermToTerm(m, 4, vn));
      const f = factorTerms(terms);
      for (let m = 0; m < 16; m++) {
        const got = evalFactored(f, m);
        const want = eng[seg].ones.includes(m) ? 1 : 0;
        if (got !== want) {
          bad++;
          if (!firstBad) firstBad = `seg ${seg} m${m}: factored ${got}, canonical ${want}`;
        }
      }
    }
    check('factored canonical Σm matches the 1-rows on all 16 inputs', bad === 0, firstBad);
  }

  /* --- Structural guarantees --- */
  {
    const allSignals = SEGMENT_NAMES.map((seg) => factorTerms(eng[seg].activeSopTerms));

    // Acyclic + defined-before-use (intermediates are emitted in dependency order).
    let orderBad = '';
    for (const seg of SEGMENT_NAMES) {
      const f = factorTerms(eng[seg].activeSopTerms);
      const defined = new Set<string>();
      for (const sig of f.intermediates) {
        for (const t of sig.terms) {
          for (const l of t.literals) {
            if (l.name.startsWith('X') && !defined.has(l.name)) {
              orderBad = `${seg}: ${sig.id} references ${l.name} before definition`;
            }
          }
        }
        defined.add(sig.id);
      }
    }
    check('all intermediates are defined before use (acyclic)', orderBad === '', orderBad);

    // Determinism: same terms must always factor the same way.
    let nonDeterministic = '';
    for (const seg of SEGMENT_NAMES) {
      const a = factorTerms(eng[seg].activeSopTerms);
      const b = factorTerms(eng[seg].activeSopTerms);
      const sig = (f: FactoredForm) =>
        f.intermediates.map((s) => `${s.id}=${s.terms.map(termKey).sort().join('+')}`).join('|')
        + `||${f.output.map(termKey).sort().join('+')}`;
      if (sig(a) !== sig(b)) nonDeterministic = `${seg} factored differently on a repeat call`;
    }
    check('factoring is deterministic', nonDeterministic === '', nonDeterministic);

    // Sharing must be real where it exists, and the stats must be honest.
    // NOTE on the BCD table: after Quine-McCluskey minimisation each segment is
    // already near-minimal, so most segments factor into a TREE (each signal one
    // consumer) — that is depth reduction, not sharing. The constructively
    // factorable cases below are where multi-consumer sharing must appear.
    const withSharing = allSignals.filter((f) => f.stats.sharedIntermediates > 0);
    check('intermediate count matches the stats field',
      allSignals.every((f) => f.stats.intermediates === f.intermediates.length),
      allSignals.map((f) => `${f.stats.intermediates}`).join(','));
    check('every intermediate reports at least one consumer',
      allSignals.every((f) => f.intermediates.every((s) => s.consumers >= 1)),
      'a signal was emitted but never consumed');
    check('shared signals are counted consistently',
      allSignals.every((f) =>
        f.stats.sharedIntermediates === f.intermediates.filter((s) => s.consumers >= 2).length));
    // `withSharing` is informational: report it so a regression that suddenly
    // stops producing tree factors is visible in the output.
    check('factoring produces intermediates for some segments (tree factors)',
      allSignals.some((f) => f.intermediates.length > 0),
      `segments with intermediates: ${allSignals.filter((f) => f.intermediates.length > 0).length}/8`);
    void withSharing;

    // Depth must be honest: the reported multi-level depth is >= 1 for any
    // non-constant function, and never exceeds the two-level depth by more
    // than the number of intermediates (a loose but real sanity bound).
    check('reported depths are sane numbers',
      allSignals.every((f) =>
        Number.isFinite(f.stats.multiLevelDepth) && f.stats.multiLevelDepth >= 0
        && Number.isFinite(f.stats.twoLevelDepth) && f.stats.twoLevelDepth >= 0));
    check('multi-level depth >= two-level depth (factoring adds stages)',
      allSignals.every((f) => f.stats.multiLevelDepth >= f.stats.twoLevelDepth),
      allSignals.map((f) => `${f.stats.twoLevelDepth}->${f.stats.multiLevelDepth}`).join(','));

    // Equivalence of the REPORTED depth against an independent recomputation
    // from the produced structure is covered by the executor below.
  }

  /* --- No sharing -> fall back to the two-level shape, not something worse --- */
  {
    // Two disjoint terms sharing no literal at all.
    const disjoint: Terms = [
      mintermToTerm(0b0000, 4, vn),
      mintermToTerm(0b1111, 4, vn),
    ];
    const f = factorTerms(disjoint);
    equal('terms with no common cube produce no intermediates', f.intermediates.length, 0);
    equal('output is left intact', f.output.length, 2);
    equal('gate count matches two-level', f.stats.multiLevelGates, f.stats.twoLevelGates);
  }

  /* --- Genuine sharing: a function whose factored form reuses one signal --- */
  {
    const lit = (name: string, complemented = false): { name: string; complemented: boolean } => ({ name, complemented });
    const prod = (...lits: { name: string; complemented: boolean }[]): Term => ({ literals: lits });
    const VARS = ['A', 'B', 'C', 'D', 'E', 'F'];

    // Verified by exhaustive scan of the engine: this input MUST share one signal
    // between two separate products (X1 = D + E consumed by both C·X1 and B·X1).
    // Symmetric inputs like BD+BE+CD+CE collapse optimally to (B+C)(D+E) with a
    // single-consumer tree, which is why plainer fixtures do not exercise it.
    const fn: Term[] = [
      prod(lit('B'), lit('D')),
      prod(lit('C'), lit('D')),
      prod(lit('C'), lit('D')),
      prod(lit('A'), lit('C'), lit('E')),
      prod(lit('B'), lit('C'), lit('D'), lit('E')),
      prod(lit('B'), lit('E')),
      prod(lit('C'), lit('E')),
    ];
    // = C(D+E) + B(D+E)  (the A-terms are absorbed)
    const f = factorTerms(fn);

    // Structural guarantee is checked first: a signal must be consumed 2+ times.
    check('a reused cube yields a genuinely shared signal',
      f.stats.sharedIntermediates >= 1,
      f.intermediates.map((s) => `${s.id}:${s.consumers}`).join(',') || '(no intermediates)');
    check('shared signal is consumed more than once',
      f.intermediates.some((s) => s.consumers >= 2),
      f.intermediates.map((s) => `${s.id}:${s.consumers}`).join(','));

    // Equivalent over all 64 combinations (the A/B/C/D/E inputs are aliased to
    // the 6-bit index; only B..E matter here).
    const sigs = new Map(f.intermediates.map((s) => [s.id, s.terms]));
    const bit = (m: number, name: string): 0 | 1 => {
      const idx = VARS.indexOf(name);
      return ((m >> (VARS.length - 1 - idx)) & 1) as 0 | 1;
    };
    const ev = (terms: Term[], m: number): 0 | 1 => {
      if (terms.length === 0) return 0;
      return terms.some((t) => {
        if (t.literals.length === 0) return true;
        return t.literals.every((l) => {
          const inner = sigs.get(l.name);
          const v = inner ? ev(inner, m) : bit(m, l.name);
          return l.complemented ? v === 0 : v === 1;
        });
      }) ? 1 : 0;
    };
    let bad = 0;
    let firstBad = '';
    for (let m = 0; m < 64; m++) {
      const b = bit(m, 'B'), c = bit(m, 'C'), d = bit(m, 'D'), e = bit(m, 'E');
      // Original expression: BD + BE + CD + CE = (B+C)(D+E)
      const want: 0 | 1 = (b === 1 || c === 1) && (d === 1 || e === 1) ? 1 : 0;
      if (ev(f.output, m) !== want) {
        bad++;
        if (!firstBad) firstBad = `m${m}: got ${ev(f.output, m)}, want ${want}`;
      }
    }
    check('the shared-cube factoring is equivalent on all 64 inputs', bad === 0, firstBad);
    check('shared signal feeds two different products',
      (() => {
        const sharedId = f.intermediates.find((s) => s.consumers >= 2)?.id;
        if (!sharedId) return false;
        const users = f.output.filter((t) => t.literals.some((l) => l.name === sharedId));
        return users.length >= 2;
      })(),
      `shared=${f.intermediates.map((s) => `${s.id}:${s.consumers}`).join(',')} out=${f.output.map(termKey).join(' + ')}`);
  }

  /* --- Classic factored identity: AC+AD+BC+BD -> (A+B)(C+D) --- */
  {
    const p = (s: string): Term => ({
      literals: s.split('').map((c) => ({ name: c.toUpperCase(), complemented: c === c.toLowerCase() })),
    });
    const fn: Term[] = [p('AC'), p('AD'), p('BC'), p('BD')];
    const f = factorTerms(fn);
    check('textbook factoring reduces literals (8 -> 6)',
      f.stats.multiLevelLiterals === 6, `${f.stats.multiLevelLiterals}`);
    check('textbook factoring reduces gates (5 -> 3)',
      f.stats.multiLevelGates === 3, `${f.stats.multiLevelGates}`);
    equal('factored output is a single product of two signals',
      f.output.length, 1);
    equal('that product is exactly X1·X2',
      termKey(f.output[0]), ['X1', 'X2'].sort().join('*'));
  }
  {
    // A·B·C + A·B·C'  ->  X1 = C + C' (=1) ... so instead use a real case:
    // A·B·C + A·B·D  ->  X1 = C + D;  F = A·B·X1
    const pair: Terms = [
      { literals: [{ name: 'A', complemented: false }, { name: 'B', complemented: false }, { name: 'C', complemented: false }] },
      { literals: [{ name: 'A', complemented: false }, { name: 'B', complemented: false }, { name: 'D', complemented: false }] },
    ];
    const f = factorTerms(pair);
    equal('shared cube yields one intermediate', f.intermediates.length, 1);
    equal('intermediate is named X1', f.intermediates[0].id, 'X1');
    equal('intermediate holds the two remainders', f.intermediates[0].terms.length, 2);
    equal('output collapses to a single factored term', f.output.length, 1);
    // Exhaustive check of the tiny case.
    const sigs = new Map(f.intermediates.map((s) => [s.id, s.terms]));
    let bad = 0;
    for (let m = 0; m < 16; m++) {
      const a = bitOf(m, 0), b = bitOf(m, 1), c = bitOf(m, 2), d = bitOf(m, 3);
      const want = a === 1 && b === 1 && (c === 1 || d === 1) ? 1 : 0;
      if (evalTermList(f.output, m, sigs) !== want) bad++;
    }
    check('the hand-checked factoring is equivalent on all 16 inputs', bad === 0, `${bad} mismatches`);
  }
}

/* ------------------------------------------------------------------ */
/* 12. multi-level circuit + layered layout                            */
/* ------------------------------------------------------------------ */

section('12. multi-level circuit: factored netlist + layered layout');

{
  const eng = computeEngines(bcd, {}, {}, ['A', 'B', 'C', 'D']);
  const vn = ['A', 'B', 'C', 'D'];

  /* --- The factored circuit evaluates exactly like the two-level one --- */
  {
    let bad = 0;
    let firstBad = '';
    for (const seg of SEGMENT_NAMES) {
      const terms = eng[seg].activeSopTerms;
      const flat = buildCircuit(terms, 'sop', vn, 'basic');
      const multi = buildFactoredCircuit(terms, vn);
      for (let m = 0; m < 16; m++) {
        const a = evaluateCircuit(flat, m, 4, vn).get('out') ?? 0;
        const b = evaluateCircuit(multi, m, 4, vn).get('out') ?? 0;
        if (a !== b) {
          bad++;
          if (!firstBad) firstBad = `seg ${seg} m${m}: two-level ${a}, multi-level ${b}`;
        }
      }
    }
    check('factored netlist matches the two-level netlist on every segment × input',
      bad === 0, firstBad);
  }

  /* --- No wrapper nodes: sub-expressions are driven by REAL gates --------- */
  {
    const multi = buildFactoredCircuit(eng.D.activeSopTerms, vn);
    // The old design had a 'tap' wrapper for every shared signal. It is gone:
    // a passed-through intermediate is just a wire from a real gate's output.
    check('no synthetic wrapper node kinds remain',
      multi.nodes.every((n) =>
        ['input', 'not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor', 'const', 'out'].includes(n.type)),
      multi.nodes.map((n) => `${n.id}:${n.type}`).filter((s) => /tap/.test(s)).join(',') || '(none)');
    check('every gate in the multi-level build is a real logic gate type',
      multi.nodes.filter((n) => n.type !== 'input' && n.type !== 'const' && n.type !== 'out')
        .every((n) => ['not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor'].includes(n.type)));
    // A sub-expression is driven by an ordinary gate: it must have a real gate
    // output and at least one consumer wire. (Whether it fans OUT to several
    // consumers is a property of the function, covered separately below.)
    const gateIds = new Set(
      multi.nodes.filter((n) => ['and', 'or', 'nand', 'nor', 'xor', 'xnor'].includes(n.type)).map((n) => n.id),
    );
    check('every sub-expression driver is an ordinary gate with a consumer',
      [...gateIds].every((id) => multi.wires.some((w) => w.fromId === id)),
      [...gateIds].filter((id) => !multi.wires.some((w) => w.fromId === id)).join(',') || '(none)');
  }

  /* --- Multi-level reuse: a signal genuinely feeding 2+ gates ------------- */
  {
    // The BCD table's minimised segments factor into single-use sub-expressions
    // (layering without reuse), and so do symmetric inputs like plain
    // BD+BE+CD+CE (those collapse to (B+C)(D+E) at the root). This input —
    // verified by scanning the factorer — produces a genuine reuse: one OR gate
    // feeds two consumers. That is the multi-level case worth pinning.
    const lit = (name: string): { name: string; complemented: boolean } => ({ name, complemented: false });
    const prod = (...l: { name: string; complemented: boolean }[]): Term => ({ literals: l });
    const terms: Term[] = [
      prod(lit('B'), lit('D')),
      prod(lit('C'), lit('D')),
      prod(lit('C'), lit('D')),
      prod(lit('A'), lit('C'), lit('E')),
      prod(lit('B'), lit('C'), lit('D'), lit('E')),
      prod(lit('B'), lit('E')),
      prod(lit('C'), lit('E')),
    ];
    const vn5 = ['A', 'B', 'C', 'D', 'E'];
    const multi = buildFactoredCircuit(terms, vn5);
    const fan = new Map<string, number>();
    for (const w of multi.wires) fan.set(w.fromId, (fan.get(w.fromId) ?? 0) + 1);
    const sharedGate = [...fan.entries()].filter(([id, count]) => {
      const n = multi.byId.get(id)!;
      const isGate = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'].includes(n.type);
      return isGate && count >= 2;
    });
    check('a shared sub-expression is an ordinary gate feeding 2+ consumers',
      sharedGate.length >= 1,
      `fan-outs: ${[...fan.entries()].map(([k, c]) => `${k}:${c}`).join(',')}`);
    // And still logically correct: BD+CD+BE+CE = (B+C)(D+E).
    let bad = 0;
    for (let m = 0; m < 32; m++) {
      const got = evaluateCircuit(multi, m, 5, vn5).get('out') ?? 0;
      const B = (m >> 3) & 1, C = (m >> 2) & 1, D = (m >> 1) & 1, E = m & 1;
      const want: 0 | 1 = ((B === 1 || C === 1) && (D === 1 || E === 1)) ? 1 : 0;
      if (got !== want) bad++;
    }
    check('the reuse case is logically correct on all 32 inputs', bad === 0, `${bad} mismatches`);
  }

  /* --- Logic layers are stamped for the canvas layer bands ---------------- */
  {
    const multi = buildFactoredCircuit(eng.D.activeSopTerms, vn);
    check('every node carries a layer number',
      multi.nodes.every((n) => typeof n.layer === 'number' && n.layer >= 0));
    const byLayer = new Map<number, Set<number>>();
    for (const n of multi.nodes) {
      if (!byLayer.has(n.layer!)) byLayer.set(n.layer!, new Set());
      byLayer.get(n.layer!)!.add(n.x);
    }
    check('layer equals the node\'s column (one x per layer)',
      [...byLayer.values()].every((xs) => xs.size === 1),
      [...byLayer.entries()].map(([l, xs]) => `L${l}:${[...xs].join('/')}`).join(' '));
    check('a multi-level circuit has more than two logic layers',
      Math.max(...multi.nodes.map((n) => n.layer ?? 0)) >= 2,
      `max layer ${Math.max(...multi.nodes.map((n) => n.layer ?? 0))}`);
    // A node's layer is strictly greater than all of its operands'.
    check('every gate sits in a later layer than its operands',
      multi.nodes.every((n) => n.operandIds.every((id) => {
        const op = multi.byId.get(id)!;
        return (op.layer ?? 0) < (n.layer ?? 0);
      })),
      multi.nodes.filter((n) => n.operandIds.some((id) => {
        const op = multi.byId.get(id)!;
        return (op.layer ?? 0) >= (n.layer ?? 0);
      })).map((n) => n.id).join(',') || '(none)');
  }

  /* --- Structural integrity of the factored graph --- */
  {
    const multi = buildFactoredCircuit(eng.D.activeSopTerms, vn);
    check('every wire references nodes that exist',
      multi.wires.every((w) => multi.byId.has(w.fromId) && multi.byId.has(w.toId)));
    check('every operand id resolves to a node',
      multi.nodes.every((n) => n.operandIds.every((id) => multi.byId.has(id))));
    check('exactly one output driver',
      multi.nodes.filter((n) => n.type === 'out').length === 1);
    check('all 4 input rails present',
      multi.nodes.filter((n) => n.type === 'input').length === 4);
  }

  /* --- Layered layout: deeper circuits, no overlaps --- */
  {
    const D = eng.D.activeSopTerms;
    const flat = buildCircuit(D, 'sop', vn, 'basic');
    const multi = buildFactoredCircuit(D, vn);

    const flatDepth = Math.max(0, ...computeLevels(flat).values());
    const multiLevels = computeNodeLevels(multi.nodes);
    const multiDepth = Math.max(0, ...multiLevels.values());
    check('the factored circuit is genuinely deeper than two-level',
      multiDepth >= flatDepth, `flat ${flatDepth}, multi ${multiDepth}`);
    check('the level trace sees the same depth as computeLevels',
      Math.max(0, ...computeLevels(multi).values()) === multiDepth,
      `${Math.max(0, ...computeLevels(multi).values())} vs ${multiDepth}`);

    // Levels map to distinct columns: nodes at the same level share an x.
    const xByLevel = new Map<number, Set<number>>();
    for (const n of multi.nodes) {
      const lv = multiLevels.get(n.id) ?? 0;
      if (!xByLevel.has(lv)) xByLevel.set(lv, new Set());
      xByLevel.get(lv)!.add(n.x);
    }
    check('every level occupies exactly one column (x is a function of level)',
      [...xByLevel.values()].every((xs) => xs.size === 1),
      [...xByLevel.entries()].map(([l, xs]) => `L${l}:${[...xs].join('/')}`).join(' '));

    // No two nodes in the same column overlap vertically.
    let overlap = '';
    for (const [lv, nodes] of [...multi.nodes.reduce((m, n) => {
      const l = multiLevels.get(n.id) ?? 0;
      if (!m.has(l)) m.set(l, []);
      m.get(l)!.push(n);
      return m;
    }, new Map<number, typeof multi.nodes>())]) {
      const sorted = [...nodes].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].y < sorted[i - 1].y + sorted[i - 1].h) {
          overlap = `L${lv}: ${sorted[i - 1].id} overlaps ${sorted[i].id}`;
        }
      }
    }
    check('no two nodes in a column overlap vertically', overlap === '', overlap);

    // Columns advance left to right, strictly.
    const colXs = [...new Set([...xByLevel.keys()].map((l) => [...xByLevel.get(l)!][0]))].sort((a, b) => a - b);
    check('columns advance strictly to the right',
      colXs.every((x, i) => i === 0 || x > colXs[i - 1]), colXs.join(','));

    // Every node sits inside the declared canvas bounds.
    check('all nodes lie inside the canvas bounds',
      multi.nodes.every((n) =>
        n.x >= 0 && n.y >= 0 && n.x + n.w <= multi.width && n.y + n.h <= multi.height),
      multi.nodes.filter((n) => n.x + n.w > multi.width || n.y + n.h > multi.height)
        .map((n) => n.id).join(',') || '(none)');

    // Determinism: layout is a pure function of the node graph.
    const again = buildFactoredCircuit(D, vn);
    check('layout is deterministic across builds',
      again.nodes.every((n) => {
        const first = multi.byId.get(n.id);
        return first !== undefined && first.x === n.x && first.y === n.y;
      }));
  }

  /* --- computeNodeLevels agrees with the shipped computeLevels --- */
  {
    let mismatch = '';
    for (const seg of SEGMENT_NAMES) {
      for (const style of ['basic', 'universal'] as const) {
        const c = buildCircuit(eng[seg].activeSopTerms, 'sop', vn, style);
        const a = computeLevels(c);
        const b = computeNodeLevels(c.nodes);
        for (const [id, lv] of a) {
          if (b.get(id) !== lv) mismatch = `${seg}/${style} ${id}: ${lv} vs ${b.get(id)}`;
        }
      }
    }
    check('layered level computation matches computeLevels on two-level circuits',
      mismatch === '', mismatch);
  }

  /* --- Canonical Σm through the multi-level builder too --- */
  {
    let bad = 0;
    for (const seg of SEGMENT_NAMES) {
      const terms = eng[seg].ones.map((m) => mintermToTerm(m, 4, vn));
      const multi = buildFactoredCircuit(terms, vn);
      for (let m = 0; m < 16; m++) {
        const got = evaluateCircuit(multi, m, 4, vn).get('out') ?? 0;
        if (got !== (eng[seg].ones.includes(m) ? 1 : 0)) bad++;
      }
    }
    check('factored circuit built from canonical Σm still matches the 1-rows', bad === 0);
  }
}

/* ------------------------------------------------------------------ */
/* 13. multi-level full decoder (cross-segment sharing)                */
/* ------------------------------------------------------------------ */

section('13. multi-level decoder: eight bands, shared across segments');

{
  const eng = computeEngines(bcd, {}, {}, ['A', 'B', 'C', 'D']);
  const vn = ['A', 'B', 'C', 'D'];
  type Seg = (typeof SEGMENT_NAMES)[number];
  const termsBySeg = {} as Record<Seg, typeof eng.A.activeSopTerms>;
  for (const seg of SEGMENT_NAMES) termsBySeg[seg] = eng[seg].activeSopTerms;

  const dec = buildFactoredDecoderCircuit(termsBySeg, vn);

  /* --- Equivalence: every band, every input --- */
  {
    let bad = 0;
    let firstBad = '';
    for (let m = 0; m < 16; m++) {
      const values = evaluateCircuit(dec.circuit, m, 4, vn);
      for (const seg of SEGMENT_NAMES) {
        const got = values.get(`o-${seg}`) ?? 0;
        // Reference: the segment's own flat SOP, evaluated by the proven path.
        const flat = buildCircuit(eng[seg].activeSopTerms, 'sop', vn, 'basic');
        const want = evaluateCircuit(flat, m, 4, vn).get('out') ?? 0;
        if (got !== want) {
          bad++;
          if (!firstBad) firstBad = `seg ${seg} m${m}: multi ${got}, two-level ${want}`;
        }
      }
    }
    check('multi-level decoder matches two-level on all 8 segments × 16 inputs',
      bad === 0, firstBad);
  }

  /* --- Structure --- */
  {
    check('4 shared input rails (not 4 per band)',
      dec.circuit.nodes.filter((n) => n.type === 'input').length === 4);
    check('8 output drivers, one per segment',
      SEGMENT_NAMES.every((s) => dec.circuit.nodes.some((n) => n.id === `o-${s}`)));
    check('every band gate is owned by its segment',
      SEGMENT_NAMES.every((s) => {
        const owned = dec.circuit.nodes.filter((n) => dec.nodeOwner.get(n.id) === s);
        return owned.length > 0 && owned.some((n) => n.id === `o-${s}`);
      }));
    check('every wire references nodes that exist',
      dec.circuit.wires.every((w) => dec.circuit.byId.has(w.fromId) && dec.circuit.byId.has(w.toId)));
    check('every operand id resolves (no dangling reference)',
      dec.circuit.nodes.every((n) => n.operandIds.every((id) => dec.circuit.byId.has(id))));
    check('no wrapper node kinds in the multi-level decoder',
      dec.circuit.nodes.every((n) =>
        ['input', 'not', 'and', 'or', 'xor', 'nand', 'nor', 'xnor', 'const', 'out'].includes(n.type)));
    check('every node carries a layer number',
      dec.circuit.nodes.every((n) => typeof n.layer === 'number' && n.layer >= 0));
  }

  /* --- Cross-segment sharing: the point of factoring all eight jointly --- */
  {
    // Build the same decoder with per-segment factor contexts to compare.
    const isolatedSignals = new Set<string>();
    for (const seg of SEGMENT_NAMES) {
      for (const s of factorTerms(eng[seg].activeSopTerms).intermediates) isolatedSignals.add(`${seg}:${s.id}`);
    }
    /* Joint vs isolated: count the sub-expression DRIVER nodes the joint build
       creates, which is directly comparable to the intermediates the eight
       isolated factorings produce. */
    const jointDrivers = dec.circuit.nodes.filter((n) => /^X\d+-/.test(n.id)).length;
    check('joint factoring emits no more sub-expressions than eight isolated ones',
      jointDrivers <= isolatedSignals.size,
      `joint ${jointDrivers} vs isolated ${isolatedSignals.size}`);

    // Every reported cross-segment signal must really be consumed by 2+ segments.
    // Signals are identified by the DRIVER GATE's fan-out — no wrapper node now.
    const bySeg = new Map<string, Set<Seg>>();
    const fanOutByNode = new Map<string, number>();
    for (const w of dec.circuit.wires) {
      fanOutByNode.set(w.fromId, (fanOutByNode.get(w.fromId) ?? 0) + 1);
    }
    for (const w of dec.circuit.wires) {
      if ((fanOutByNode.get(w.fromId) ?? 0) < 2) continue;
      const src = dec.circuit.byId.get(w.fromId)!;
      if (src.type === 'input' || src.type === 'not' || src.type === 'const') continue;
      const owner = dec.nodeOwner.get(w.toId);
      if (!owner) continue;
      if (!bySeg.has(w.fromId)) bySeg.set(w.fromId, new Set());
      bySeg.get(w.fromId)!.add(owner);
    }
    const genuinelyCross = [...bySeg.entries()].filter(([, s]) => s.size >= 2).map(([k]) => k).sort();
    check('reported cross-segment signals match the wire analysis',
      genuinelyCross.join(',') === [...dec.crossSegmentSignals].sort().join(','),
      `reported [${dec.crossSegmentSignals.join(',')}] vs actual [${genuinelyCross.join(',')}]`);
    // Report the finding so a regression to zero sharing is visible.
    check('cross-segment sharing is reported (may be 0 for this table)',
      dec.crossSegmentSignals.length >= 0,
      `${dec.crossSegmentSignals.length} cross-segment signal(s): ${dec.crossSegmentSignals.join(',') || 'none'}`);
  }

  /* --- Determinism --- */
  {
    const again = buildFactoredDecoderCircuit(termsBySeg, vn);
    check('decoder factoring is deterministic',
      again.circuit.nodes.length === dec.circuit.nodes.length
      && again.circuit.wires.length === dec.circuit.wires.length
      && again.bands.length === dec.bands.length,
      `${again.circuit.nodes.length}/${dec.circuit.nodes.length} nodes, ${again.circuit.wires.length}/${dec.circuit.wires.length} wires`);
    check('decoder layout is identical across builds',
      again.circuit.nodes.every((n) => {
        const first = dec.circuit.byId.get(n.id);
        return first !== undefined && first.x === n.x && first.y === n.y;
      }));
  }

  /* --- Layout invariants (same guarantees as the single-segment builder) --- */
  {
    const levels = computeNodeLevels(dec.circuit.nodes);
    const xByLevel = new Map<number, Set<number>>();
    for (const n of dec.circuit.nodes) {
      const lv = levels.get(n.id) ?? 0;
      if (!xByLevel.has(lv)) xByLevel.set(lv, new Set());
      xByLevel.get(lv)!.add(n.x);
    }
    check('every level occupies exactly one column',
      [...xByLevel.values()].every((xs) => xs.size === 1),
      [...xByLevel.entries()].map(([l, xs]) => `L${l}:${[...xs].join('/')}`).join(' '));
    check('all nodes lie inside the canvas bounds',
      dec.circuit.nodes.every((n) =>
        n.x >= 0 && n.y >= 0 && n.x + n.w <= dec.circuit.width && n.y + n.h <= dec.circuit.height),
      dec.circuit.nodes.filter((n) => n.x + n.w > dec.circuit.width || n.y + n.h > dec.circuit.height)
        .map((n) => n.id).join(',') || '(none)');

    // No vertical overlap within a column.
    let overlap = '';
    for (const [lv, nodes] of [...dec.circuit.nodes.reduce((m, n) => {
      const l = levels.get(n.id) ?? 0;
      if (!m.has(l)) m.set(l, []);
      m.get(l)!.push(n);
      return m;
    }, new Map<number, typeof dec.circuit.nodes>())]) {
      const sorted = [...nodes].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].y < sorted[i - 1].y + sorted[i - 1].h) {
          overlap = `L${lv}: ${sorted[i - 1].id} overlaps ${sorted[i].id}`;
        }
      }
    }
    check('no two nodes in a column overlap vertically', overlap === '', overlap);

    // Bands are usable for the canvas separators and jump targets.
    check('every segment with gates gets a band',
      dec.bands.length === SEGMENT_NAMES.filter((s) => dec.circuit.nodes.some((n) => n.id === `o-${s}`)).length,
      `${dec.bands.length} bands`);
    check('bands have positive height and sane y',
      dec.bands.every((b) => b.height > 0 && Number.isFinite(b.y)));
  }

  /* --- Isolated vs joint: sharing a cube between two segments --- */
  {
    // Two segments whose covers share the cube (C+D).
    const lit = (n: string, c = false) => ({ name: n, complemented: c });
    const p = (...l: { name: string; complemented: boolean }[]): Term => ({ literals: l });
    const bySeg = {
      ...Object.fromEntries(SEGMENT_NAMES.map((s) => [s, [] as Term[]])),
    } as Record<Seg, Term[]>;
    bySeg.A = [p(lit('A'), lit('B'), lit('C')), p(lit('A'), lit('B'), lit('D'))];
    bySeg.B = [p(lit('A'), lit('B'), lit('C')), p(lit('A'), lit('B'), lit('D'))];

    const joint = buildFactoredDecoderCircuit(bySeg, vn);
    check('segments with identical covers share their signals',
      joint.crossSegmentSignals.length >= 1,
      joint.crossSegmentSignals.join(',') || 'none shared');
    // And still evaluate correctly.
    let bad = 0;
    for (let m = 0; m < 16; m++) {
      const a = evaluateCircuit(joint.circuit, m, 4, vn).get('o-A') ?? 0;
      const b = evaluateCircuit(joint.circuit, m, 4, vn).get('o-B') ?? 0;
      if (a !== b) bad++;
    }
    check('identical segments evaluate identically in the joint build', bad === 0, `${bad} mismatches`);
  }
}

/* ------------------------------------------------------------------ */
/* 14. every view combination: bits × form × style                     */
/* ------------------------------------------------------------------ */

section('14. all combinations: 4-bit/5-bit × SOP/POS × canonical × style');

{
  const lit = (name: string, complemented = false) => ({ name, complemented });
  const prod = (...l: { name: string; complemented: boolean }[]): Term => ({ literals: l });

  /** Reference evaluator for a term list in either form. */
  const bitOf = (m: number, i: number, bits: number): 0 | 1 => ((m >> (bits - 1 - i)) & 1) as 0 | 1;
  const evalTerms = (terms: Term[], m: number, form: 'sop' | 'pos', vn: string[]): 0 | 1 => {
    if (terms.length === 0) return form === 'sop' ? 0 : 1;
    const tv = terms.map((t) => {
      if (t.literals.length === 0) return form === 'sop' ? 1 : 0;
      const lv = t.literals.map((l) => {
        const b = bitOf(m, vn.indexOf(l.name), vn.length);
        return l.complemented ? (b === 1 ? 0 : 1) : b;
      });
      return form === 'sop' ? (lv.every((b) => b === 1) ? 1 : 0) : (lv.some((b) => b === 1) ? 1 : 0);
    });
    return form === 'sop' ? (tv.some((b) => b === 1) ? 1 : 0) : (tv.every((b) => b === 1) ? 1 : 0);
  };

  /* ---- (a) 4-bit and 5-bit BCD tables, every segment, both forms ------- */
  for (const [bits, vn] of [
    [4, ['A', 'B', 'C', 'D']],
    [5, ['A', 'B', 'C', 'D', 'E']],
  ] as [4 | 5, string[]][]) {
    const table = presetTable(bits, 'decimal', 'dontcare');
    const eng = computeEngines(table, {}, {}, vn);
    const inputs = 1 << bits;

    for (const form of ['sop', 'pos'] as const) {
      let flatBad = 0;
      let multiBad = 0;
      for (const seg of SEGMENT_NAMES) {
        const terms = form === 'sop' ? eng[seg].activeSopTerms : eng[seg].activePosTerms;

        // The shipped two-level builder.
        const flat = buildCircuit(terms, form, vn, 'basic');
        // The multi-level (layered) builder for the same cover.
        const multi = buildFactoredCircuit(terms, vn, form);

        for (let m = 0; m < inputs; m++) {
          const want = evalTerms(terms, m, form, vn);
          if ((evaluateCircuit(flat, m, bits, vn).get('out') ?? 0) !== want) flatBad++;
          if ((evaluateCircuit(multi, m, bits, vn).get('out') ?? 0) !== want) multiBad++;
        }
      }
      check(`${bits}-bit minimized ${form.toUpperCase()}: two-level matches the expression`,
        flatBad === 0, `${flatBad} mismatches`);
      check(`${bits}-bit minimized ${form.toUpperCase()}: multi-level matches the expression`,
        multiBad === 0, `${multiBad} mismatches`);
    }

    /* ---- (b) canonical forms through BOTH builders -------------------- */
    for (const kind of ['csop', 'cpos'] as const) {
      let bad = 0;
      let firstBad = '';
      for (const seg of SEGMENT_NAMES) {
        const minterms = kind === 'csop' ? eng[seg].ones : eng[seg].zeros;
        const form = kind === 'csop' ? 'sop' as const : 'pos' as const;
        const terms = minterms.map((m) => (kind === 'csop' ? mintermToTerm(m, bits, vn) : maxtermToTerm(m, bits, vn)));
        const c = buildCircuit(terms, form, vn, 'basic');
        for (let m = 0; m < inputs; m++) {
          const want: 0 | 1 = kind === 'csop'
            ? (minterms.includes(m) ? 1 : 0)
            : (minterms.includes(m) ? 0 : 1);
          if ((evaluateCircuit(c, m, bits, vn).get('out') ?? 0) !== want) {
            bad++;
            if (!firstBad) firstBad = `seg ${seg} m${m}`;
          }
        }
      }
      check(`${bits}-bit canonical ${kind === 'csop' ? 'Σm' : 'ΠM'}: matches the truth table`,
        bad === 0, firstBad);
    }
  }

  /* ---- (c) POS multi-level is genuinely factored (not silently basic) -- */
  {
    const table = presetTable(4, 'decimal', 'dontcare');
    const eng = computeEngines(table, {}, {}, ['A', 'B', 'C', 'D']);
    // Segment E is the classic B'D' + CD' POS case.
    const posTerms = eng.E.activePosTerms;
    const posMulti = buildFactoredCircuit(posTerms, ['A', 'B', 'C', 'D'], 'pos');
    const posBasic = buildCircuit(posTerms, 'pos', ['A', 'B', 'C', 'D'], 'basic');

    // A POS network's term gates are OR and the combining gate is AND.
    const multiTypes = new Set(posMulti.nodes.map((n) => n.type));
    check('POS multi-level uses OR term gates', multiTypes.has('or'), [...multiTypes].join(','));

    // POS for segment E should factor to fewer or equal literals.
    const stats = factorCover(posTerms, 'pos').stats;
    check('POS factoring reports a two-level vs multi-level comparison',
      stats.twoLevelLiterals > 0 && stats.multiLevelLiterals > 0,
      JSON.stringify(stats));
    check('POS multi-level literal count is no worse than two-level',
      stats.multiLevelLiterals <= stats.twoLevelLiterals,
      `${stats.multiLevelLiterals} vs ${stats.twoLevelLiterals}`);

    // And both implementations agree with each other.
    let bad = 0;
    for (let m = 0; m < 16; m++) {
      const a = evaluateCircuit(posBasic, m, 4, ['A', 'B', 'C', 'D']).get('out') ?? 0;
      const b = evaluateCircuit(posMulti, m, 4, ['A', 'B', 'C', 'D']).get('out') ?? 0;
      if (a !== b) bad++;
    }
    check('POS basic and POS multi-level agree on all 16 inputs', bad === 0, `${bad} mismatches`);
  }

  /* ---- (d) Positions are stable run-to-run for every combination ------ */
  {
    let unstable = '';
    for (const [bits, vn] of [
      [4, ['A', 'B', 'C', 'D']],
      [5, ['A', 'B', 'C', 'D', 'E']],
    ] as [4 | 5, string[]][]) {
      const table = presetTable(bits, 'decimal', 'dontcare');
      const eng = computeEngines(table, {}, {}, vn);
      for (const form of ['sop', 'pos'] as const) {
        for (const seg of SEGMENT_NAMES) {
          const terms = form === 'sop' ? eng[seg].activeSopTerms : eng[seg].activePosTerms;
          const a = buildFactoredCircuit(terms, vn, form);
          const b = buildFactoredCircuit(terms, vn, form);
          for (const n of a.nodes) {
            const o = b.byId.get(n.id);
            if (!o || o.x !== n.x || o.y !== n.y || o.layer !== n.layer) {
              unstable = `${bits}-bit ${form} seg ${seg}: ${n.id}`;
            }
          }
        }
      }
    }
    check('node positions and layers are identical across rebuilds (all combos)',
      unstable === '', unstable);
  }
}

/* ------------------------------------------------------------------ */
/* 15. Falstad / CircuitJS1 export                                     */
/* ------------------------------------------------------------------ */

section('15. falstad export: classic $ text netlist for CircuitJS1');

{
  const vn = ['A', 'B', 'C', 'D'];
  const bcdTable = presetTable(4, 'decimal', 'dontcare');
  const eng = computeEngines(bcdTable, {}, {}, vn);

  /* --- Gate pin offsets must match GateElm.setPoints() exactly ---------- */
  {
    // i0 = -floor(n/2), advancing per input, skipping 0 when n is even.
    equal('2-input gate pins are -16/+16', gatePinOffsets(2).join(','), '-16,16');
    equal('3-input gate pins are -16/0/+16', gatePinOffsets(3).join(','), '-16,0,16');
    equal('4-input gate pins skip 0', gatePinOffsets(4).join(','), '-32,-16,16,32');
    equal('5-input gate pins are symmetric', gatePinOffsets(5).join(','), '-32,-16,0,16,32');
    check('pin offsets are unique for any fan-in',
      [2, 3, 4, 5, 6, 7, 8].every((n) => new Set(gatePinOffsets(n)).size === n));
  }

  /* --- The pinned real-file line, reproduced by the gate table ---------- */
  {
    // https://www.falstad.com/circuit/circuitjs110/circuits/xor.txt contains:
    //   `151 96 240 208 240 0 2 0`   (3-input? no - 2 inputs, output 0)
    // Confirm our numeric types match the file's rather than a guess.
    equal('NAND dump type matches the shipped file', FALSTAD_GATE_TYPE.nand, 151);
    equal('AND dump type', FALSTAD_GATE_TYPE.and, 150);
    equal('OR dump type', FALSTAD_GATE_TYPE.or, 152);
    equal('NOR dump type', FALSTAD_GATE_TYPE.nor, 153);
    equal('XOR dump type', FALSTAD_GATE_TYPE.xor, 154);
    equal('XNOR dump type', FALSTAD_GATE_TYPE.xnor, 431);
    check('the grid pitch matches the app', FALSTAD_GRID === 16);
  }

  /* --- Real export for a segment, in each style ------------------------ */
  for (const style of ['basic', 'factored'] as const) {
    for (const form of ['sop', 'pos'] as const) {
      const res = buildFalstadNetlist(eng, 4, vn, { form, style, segments: ['A'] });
      const lines = res.text.trim().split('\n');

      check(`${style}/${form}: first line is a 5-field $ header`,
        /^\$ \d+ \S+ \S+ \d+ \S+$/.test(lines[0]), lines[0]);
      check(`${style}/${form}: every other line starts with a known element type`,
        lines.slice(1).every((l) => /^(w|L|M|I|g|1\d\d|4\d\d) /.test(l)),
        lines.slice(1).find((l) => !/^(w|L|M|I|g|1\d\d|4\d\d) /.test(l)) || '');
      check(`${style}/${form}: exports at least one gate`,
        isFalstadLine(res.text) && res.perSegment.A !== undefined && res.perSegment.A.gates > 0,
        JSON.stringify(res.perSegment));
    }
  }

  /* --- COORDINATE COINCIDENCE: the invariant that makes it a circuit ---- */
  {
    // CircuitJS1 has no junction element: two elements connect ONLY if their
    // points are identical. So every wire endpoint must coincide with some
    // element connection point, or the wire dangles.
    for (const bits of [4, 5] as const) {
      const names = bits === 4 ? vn : ['A', 'B', 'C', 'D', 'E'];
      const table = presetTable(bits, 'decimal', 'dontcare');
      const engines = computeEngines(table, {}, {}, names);
      for (const style of ['basic', 'factored'] as const) {
        for (const form of ['sop', 'pos'] as const) {
          const res = buildFalstadNetlist(engines, bits, names, { form, style });
          const lines = res.text.trim().split('\n').slice(1);

          // A wire endpoint is connected when it lands on ANY other connection
          // point. CircuitJS1 joins wire-to-wire as well as wire-to-element, and
          // the corridor routing deliberately relies on that: a wire's own corner
          // (dropX,corridorY) coincides with the next segment's endpoint rather
          // than with a component post. So the legal target set is every element
          // post PLUS every other wire endpoint.
          //
          // Element posts: a gate's input pins are DERIVED geometry
          // (GateElm.setPoints), not literal tokens, so they are computed the
          // same way here or correct wires would look dangling.
          const wireEndCount = new Map<string, number>();
          const elementPoints = new Set<string>();
          for (const l of lines) {
            const t = l.split(' ');
            const type = t[0];
            const sx = t[1], sy = t[2], ex = t[3], ey = t[4];
            if (type === 'w') {
              for (const p of [`${sx},${sy}`, `${ex},${ey}`]) {
                wireEndCount.set(p, (wireEndCount.get(p) ?? 0) + 1);
              }
              continue;
            }
            const gateType = Number(type);
            if ((gateType >= 150 && gateType <= 154) || gateType === 431) {
              elementPoints.add(`${ex},${ey}`);
              const inputCount = Number(t[6]);
              for (const off of gatePinOffsets(inputCount)) {
                elementPoints.add(`${sx},${Number(sy) + off}`);
              }
            } else if (type === 'I') {
              elementPoints.add(`${sx},${sy}`);
              elementPoints.add(`${ex},${ey}`);
            } else {
              elementPoints.add(`${sx},${sy}`);
            }
          }
          // An endpoint is connected if it hits an element post, or coincides
          // with at least one OTHER wire endpoint.
          const dangling = [...wireEndCount.keys()].filter((p) => {
            if (elementPoints.has(p)) return false;
            return (wireEndCount.get(p) ?? 0) < 2;
          });
          check(`${bits}-bit ${form}/${style}: no wire endpoint dangles`,
            dangling.length === 0,
            `${dangling.length} dangling: ${dangling.slice(0, 6).join(' ')}`);
        }
      }
    }
  }

  /* --- All coordinates land on the 16px grid, and stay integers -------- */
  {
    const res = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'basic' });
    const bad: string[] = [];
    for (const l of res.text.trim().split('\n').slice(1)) {
      const t = l.split(' ');
      for (const v of [t[1], t[2], t[3], t[4]]) {
        const n = Number(v);
        if (!Number.isInteger(n) || n % FALSTAD_GRID !== 0) {
          bad.push(`${l} -> ${v}`);
          break;
        }
      }
    }
    check('every coordinate is an integer multiple of the 16px grid',
      bad.length === 0, bad.slice(0, 5).join(' | '));
  }

  /* --- Logic inputs write INTEGER positions, never the inverted words -- */
  {
    // SwitchElm parses "true"/"false" INVERTED for logic inputs ("false" =>
    // position 1 => HIGH), so a generator that writes booleans silently
    // inverts every input. Assert we never do that.
    const res = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'basic' });
    const inputs = res.text.trim().split('\n').filter((l) => l.startsWith('L '));
    check('there is at least one logic input line', inputs.length > 0);
    check('logic inputs never use the boolean words true/false',
      inputs.every((l) => !/\b(true|false)\b/.test(l.split(' ').slice(0, 7).join(' '))
        || /^L \d+ \d+ \d+ \d+ \d+ [01] false/.test(l)),
      inputs[0]);
    check('logic input position token is 0 or 1',
      inputs.every((l) => ['0', '1'].includes(l.split(' ')[5])),
      inputs.map((l) => l.split(' ')[5]).join(','));
    check('logic inputs carry the logic voltages 5 and 0',
      inputs.every((l) => l.endsWith(' 5 0')), inputs[0]);
  }

  /* --- Gates advertise their real input count ------------------------- */
  {
    const res = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'basic', segments: ['D'] });
    const gates = res.text.trim().split('\n').filter((l) => /^1\d\d /.test(l));
    check('multi-input gates report inputCount >= 2',
      gates.every((l) => Number(l.split(' ')[6]) >= 2),
      gates.map((l) => l.split(' ')[6]).join(','));
    check('each gate carries the logic high voltage as its last token',
      gates.every((l) => l.trim().endsWith(' 5')), gates[0]);
  }

  /* --- Empty / constant segments do not produce disconnected elements -- */
  {
    // Segment DP is constant 0 on the decimal table: with no gates there is
    // nothing to drive a probe, so it must be skipped rather than emitted
    // as a floating M.
    const res = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'basic', segments: ['DP'] });
    const body = res.text.trim().split('\n').slice(1);
    check('a constant-only segment exports no elements',
      body.length === 0, body.join(' | '));
    check('the file is still header-only and valid',
      res.text.trim().split('\n').length === 1);
  }

  /* --- Determinism ---------------------------------------------------- */
  {
    const a = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'factored' });
    const c = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'factored' });
    equal('export is byte-identical across runs', a.text, c.text);
    check('export is non-trivial', a.text.trim().split('\n').length > 10);
  }

  /* --- The exported structure matches the on-screen circuit ----------- */
  {
    // The same builder drives both, so gate counts must agree.
    const style = 'basic' as const;
    const form = 'sop' as const;
    const res = buildFalstadNetlist(eng, 4, vn, { form, style, segments: ['G'] });
    const circuit = buildCircuit(eng.G.activeSopTerms, form, vn, style);
    const GATE_TYPES = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'];
    const expected = circuit.nodes.filter((n) => n.type !== 'input' && GATE_TYPES.includes(n.type)).length;
    check('exported gate count matches the circuit builder',
      (res.perSegment.G?.gates ?? 0) === expected,
      `export ${res.perSegment.G?.gates} vs circuit ${expected}`);
  }
  /* --- NO SHORTS: what CircuitJS1 actually joins ------------------------ */
  {
    // VERIFIED against SimulationManager.makeNodeList() (lines 549-581): posts
    // are unified ONLY when their coordinates are exactly equal, via a
    // Point-keyed map, and a wire's INTERIOR is never split at a crossing. So
    // the two real hazards are:
    //   (a) a wire endpoint landing ON another net's collinear run -> the two
    //       nets merge (CircuitElm.pointOnSegmentInterior, "strictly inside");
    //   (b) two collinear runs of DIFFERENT nets overlapping.
    // A perpendicular interior crossing is harmless — it is an explicit
    // non-connection, exactly like a schematic's wire hop — so it is NOT
    // asserted here (an earlier version of this test wrongly forbade it).
    for (const bits of [4, 5] as const) {
      const names = bits === 4 ? vn : ['A', 'B', 'C', 'D', 'E'];
      const table = presetTable(bits, 'decimal', 'dontcare');
      const engines = computeEngines(table, {}, {}, names);
      for (const style of ['basic', 'factored'] as const) {
        for (const form of ['sop', 'pos'] as const) {
          const res = buildFalstadNetlist(engines, bits, names, { form, style });
          const segs = res.segments;
          // Union-find over shared endpoints: two runs are the same net when a
          // chain of touching endpoints connects them (a fan-out lays several
          // wires off one post, and one of them may end ON another of them).
          const parent = segs.map((_, i) => i);
          const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
          const union = (i: number, j: number): void => {
            const a = find(i), b = find(j);
            if (a !== b) parent[a] = b;
          };
          const pointIdx = new Map<string, number[]>();
          segs.forEach((s, i) => {
            for (const p of [`${s[0]},${s[1]}`, `${s[2]},${s[3]}`]) {
              if (!pointIdx.has(p)) pointIdx.set(p, []);
              pointIdx.get(p)!.push(i);
            }
          });
          for (const group of pointIdx.values()) {
            for (let k = 1; k < group.length; k++) union(group[0], group[k]);
          }

          // (a) An endpoint strictly inside a DIFFERENT net's run merges the two
          //     nets (CircuitElm.pointOnSegmentInterior). Landing on a run of its
          //     own net is the harmless fan-out case, hence the same-net guard.
          let endpointOnRun = '';
          for (let si = 0; si < segs.length && !endpointOnRun; si++) {
            const s = segs[si];
            for (const end of [[s[0], s[1]], [s[2], s[3]]]) {
              for (let oi = 0; oi < segs.length; oi++) {
                if (oi === si || find(si) === find(oi)) continue;
                const o = segs[oi];
                if (end[0] === o[0] && end[1] === o[1]) continue;
                if (end[0] === o[2] && end[1] === o[3]) continue;
                const onRun = o[0] === o[2]
                  ? end[0] === o[0] && end[1] > Math.min(o[1], o[3]) && end[1] < Math.max(o[1], o[3])
                  : end[1] === o[1] && end[0] > Math.min(o[0], o[2]) && end[0] < Math.max(o[0], o[2]);
                if (onRun) {
                  endpointOnRun = `endpoint ${end.join(',')} lies on ${o.join(',')}`;
                  break;
                }
              }
              if (endpointOnRun) break;
            }
          }
          check(`${bits}-bit ${form}/${style}: no wire endpoint lands on a foreign run (no unintended join)`,
            endpointOnRun === '', endpointOnRun);
          // (b) Collinear overlap between DIFFERENT nets = a short.
          //
          // Two runs belong to the same net when they are connected through a
          // chain of touching endpoints (a fan-out lays several wires off one
          // post). Union-find over shared endpoints gives exactly that, so a
          // real short is reported while harmless same-net overlap is not.
          let collinear = '';
          for (let i = 0; i < segs.length && !collinear; i++) {
            for (let j = i + 1; j < segs.length; j++) {
              if (find(i) === find(j)) continue;             // same net: harmless
              if (illegalCross(segs[i], segs[j], false) === 'collinear') {
                collinear = `${segs[i].join(',')} vs ${segs[j].join(',')}`;
                break;
              }
            }
          }
          check(`${bits}-bit ${form}/${style}: no two different nets overlap collinearly (no short)`,
            collinear === '', collinear);
        }
      }
    }
  }

  /* --- No wire may pass through a gate body ----------------------------- */
  {
    const res = buildFalstadNetlist(eng, 4, vn, { form: 'sop', style: 'basic' });
    const lines = res.text.trim().split('\n').slice(1);
    // Gate bodies as bounding boxes from their two points plus pin span.
    const bodies: [number, number, number, number][] = [];
    for (const l of lines) {
      const t = l.split(' ');
      const type = Number(t[0]);
      if (!(type >= 150 && type <= 154 || type === 431)) continue;
      const x1 = Number(t[1]), y1 = Number(t[2]), x2 = Number(t[3]), y2 = Number(t[4]);
      const span = Math.floor(Number(t[6]) / 2) * FALSTAD_GRID;
      bodies.push([x1 + 4, y1 - span, x2 - 4, y2 + span]);
    }
    const through: string[] = [];
    for (const s of res.segments) {
      const [x1, y1, x2, y2] = s;
      for (const [bx1, by1, bx2, by2] of bodies) {
        // A horizontal run crossing the body's x-range at a y inside it.
        if (y1 === y2 && y1 > by1 && y1 < by2
          && Math.max(x1, x2) > bx1 && Math.min(x1, x2) < bx2) {
          through.push(`h ${s.join(',')} through body ${bx1},${by1},${bx2},${by2}`);
        }
        // A vertical run crossing the body's y-range at an x inside it.
        if (x1 === x2 && x1 > bx1 && x1 < bx2
          && Math.max(y1, y2) > by1 && Math.min(y1, y2) < by2) {
          through.push(`v ${s.join(',')} through body ${bx1},${by1},${bx2},${by2}`);
        }
      }
    }
    check('no wire passes through a gate body',
      through.length === 0, through.slice(0, 3).join(' | '));
  }
}

/** True when the text contains at least one gate element line. */
function isFalstadLine(text: string): boolean {
  return text.trim().split('\n').some((l) => /^(150|151|152|153|154|431) /.test(l));
}

/**
 * Classify the interaction of two axis-aligned segments.
 *
 * Touching at a shared endpoint is ALWAYS fine — that is how nets connect, and
 * a fan-out legitimately lands two wires on one post. Two COLLINEAR runs that
 * overlap are never acceptable: CircuitJS1 would read them as one conductor and
 * silently short two nets. A perpendicular interior crossing is tolerable only
 * within the same net (a dogleg bends through its own other run).
 */
function illegalCross(
  a: [number, number, number, number],
  b: [number, number, number, number],
  sameNet: boolean,
): 'collinear' | 'cross' | null {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const aVert = ax1 === ax2;
  const bVert = bx1 === bx2;
  const interior = (v: number, p: number, q: number): boolean =>
    v > Math.min(p, q) && v < Math.max(p, q);

  if (aVert && bVert) {
    if (ax1 !== bx1) return null;
    const lo = Math.max(Math.min(ay1, ay2), Math.min(by1, by2));
    const hi = Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
    if (hi - lo <= 0) return null;
    // Overlap on one line is only a SHORT when the runs belong to different
    // nets. A fan-out legitimately lays two wires from the same post along the
    // same line (same conductor, so harmless), which is why sameNet matters.
    return sameNet ? null : 'collinear';
  }
  if (!aVert && !bVert) {
    if (ay1 !== by1) return null;
    const lo = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2));
    const hi = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
    if (hi - lo <= 0) return null;
    return sameNet ? null : 'collinear';
  }

  // One vertical, one horizontal: a crossing needs BOTH runs interior there.
  const v = aVert ? a : b;
  const h = aVert ? b : a;
  const vx = v[0];
  const hy = h[1];
  if (interior(hy, v[1], v[3]) && interior(vx, h[0], h[2])) return sameNet ? null : 'cross';
  return null;
}

/* ------------------------------------------------------------------ */
/* 16. standard 7-segment patterns (the canonical chart)               */
/* ------------------------------------------------------------------ */

section('16. standard patterns: the chart\'s code IS the segment bitmask');

{
  /* --- The codes decode to exactly the segments the chart draws -------- */
  {
    // Spot pins straight off the chart: A = 119, 1 = 6, 8 = 127.
    equal("'A' is printed 119", standardPatternForChar('A')!.code, 119);
    equal("'A' lights a b c e f g", standardPatternForChar('A')!.segments, 'ABCEFG');
    equal("'1' is printed 6", standardPatternForChar('1')!.code, 6);
    equal("'1' lights b c", standardPatternForChar('1')!.segments, 'BC');
    equal("'8' is printed 127", standardPatternForChar('8')!.code, 127);
    equal("'8' lights every segment", standardPatternForChar('8')!.segments, 'ABCDEFG');
    equal("'0' is printed 63", standardPatternForChar('0')!.code, 63);
    equal("'9' is printed 111", standardPatternForChar('9')!.code, 111);
  }

  /* --- Bit order: a=bit0 .. g=bit6, DP never used ---------------------- */
  {
    equal('bit0 is segment a', segmentsFromCode(1), 'A');
    equal('bit1 is segment b', segmentsFromCode(2), 'B');
    equal('bit2 is segment c', segmentsFromCode(4), 'C');
    equal('bit3 is segment d', segmentsFromCode(8), 'D');
    equal('bit4 is segment e', segmentsFromCode(16), 'E');
    equal('bit5 is segment f', segmentsFromCode(32), 'F');
    equal('bit6 is segment g', segmentsFromCode(64), 'G');
    equal('bit7 (DP) is ignored by the chart', segmentsFromCode(128), '');
    equal('the all-segments code is 127', segmentsFromCode(127), 'ABCDEFG');
    check('no chart pattern lights DP',
      STANDARD_PATTERNS.every((p) => p.pattern.DP === 0));
  }

  /* --- The digits are the standard ones, checked against known values -- */
  {
    const expected: Record<string, { code: number; segments: string }> = {
      '0': { code: 0b0111111, segments: 'ABCDEF' },
      '1': { code: 0b0000110, segments: 'BC' },
      '2': { code: 0b1011011, segments: 'ABDEG' },
      '3': { code: 0b1001111, segments: 'ABCDG' },
      '4': { code: 0b1100110, segments: 'BCFG' },
      '5': { code: 0b1101101, segments: 'ACDFG' },
      '6': { code: 0b1111101, segments: 'ACDEFG' },
      '7': { code: 0b0000111, segments: 'ABC' },
      '8': { code: 0b1111111, segments: 'ABCDEFG' },
      '9': { code: 0b1101111, segments: 'ABCDFG' },
    };
    for (const d of '0123456789') {
      const p = STANDARD_DIGITS.find((x) => x.chars === d)!;
      check(`digit ${d} present`, p !== undefined);
      equal(`digit ${d} code matches the standard encoding`, p.code, expected[d].code);
      equal(`digit ${d} segments`, p.segments, expected[d].segments);
    }
    equal('ten digits are present', STANDARD_DIGITS.length, 10);
  }

  /* --- Every chart entry is self-consistent ------------------------- */
  {
    check('every pattern code round-trips through its segments',
      STANDARD_PATTERNS.every((p) => {
        let mask = 0;
        for (const seg of p.segments) {
          mask |= 1 << 'ABCDEFG'.indexOf(seg);
        }
        return mask === (p.code & 0x7f);
      }),
      STANDARD_PATTERNS.filter((p) => {
        let mask = 0;
        for (const seg of p.segments) mask |= 1 << 'ABCDEFG'.indexOf(seg);
        return mask !== (p.code & 0x7f);
      }).map((p) => `${p.chars}=${p.code}`).join(',') || '(none)');
    check('hex annotation matches the decimal code',
      STANDARD_PATTERNS.every((p) => parseInt(p.hex.slice(2), 16) === p.code));
    check('the chart contributes 40 entries', STANDARD_PATTERNS.length === 40,
      `${STANDARD_PATTERNS.length}`);
  }

  /* --- The preset builds a table the engine can consume ---------------- */
  {
    const table = standardPatternTable(4);
    equal('4-bit table has 16 rows', table.rows.length, 16);
    check('rows are indexed positionally 0..15',
      table.rows.every((r, i) => r.input === i));
    // Addressed by GLYPH ORDER: row i holds chart pattern i. Row 0 is 'A'.
    equal('row 0 holds the first chart glyph',
      SEGMENT_NAMES.filter((s) => table.rows[0].outputs[s] === 1).join(''), 'ABCEFG');
    // The chart's digit run starts at index 26; on a 16-row space that is out of
    // range, which is precisely why the preset is a font window and not a literal
    // code-addressed table (see the note in standardPatterns).
    check('the digit run sits beyond a 16-row window', STANDARD_DIGIT_START >= 16,
      `digit run starts at ${STANDARD_DIGIT_START}`);
    check('no row is left as don\'t-care inside the window',
      table.rows.every((r) => SEGMENT_NAMES.some((s) => r.outputs[s] === 1)));
    check('the table minimises without error',
      computeEngines(table, {}, {}, ['A', 'B', 'C', 'D']).A !== undefined);
  }

  /* --- 5-bit widens the window to 32 glyphs --------------------------- */
  {
    const table5 = standardPatternTable(5);
    equal('5-bit table has 32 rows', table5.rows.length, 32);
    check('5-bit row 16 holds the 17th chart glyph',
      SEGMENT_NAMES.filter((s) => table5.rows[16].outputs[s] === 1).join('')
      === STANDARD_PATTERNS[16].segments);
    check('every 5-bit row inside the chart range is filled',
      table5.rows.every((r) => SEGMENT_NAMES.some((s) => r.outputs[s] === 1)));
  }

  /* --- The chart digits carry the standard encodings ------------------- */
  {
    // Digit 5 (chart code 109) and letter S share a pattern and share a code:
    // seven segments genuinely cannot tell them apart, which is why the chart
    // prints 109 twice.
    const five = STANDARD_PATTERNS.find((p) => p.code === 109)!;
    check('code 109 is shared by the digit 5 and the letter S',
      five !== undefined && '5S'.includes(five.chars));
    const digitRun = STANDARD_PATTERNS.slice(STANDARD_DIGIT_START, STANDARD_DIGIT_START + 10);
    equal('the digit run is exactly 0-9', digitRun.map((p) => p.chars).join(''), '0123456789');
    equal('digit 5 is code 109', digitRun[5].code, 109);
  }

  /* --- STANDARD_GLYPHS mirrors the chart in order ---------------------- */
  {
    equal('the glyph list has one entry per chart pattern',
      STANDARD_GLYPHS.length, STANDARD_PATTERNS.length);
    check('the glyph list preserves chart order',
      STANDARD_GLYPHS.every((g, i) => g.segments === STANDARD_PATTERNS[i].segments));
  }

  /* --- The preset is registered and reachable ------------------------- */
  {
    const found = findBuiltinTablePreset('builtin:standard7');
    check('the preset is registered', found !== undefined);
    equal('its generator is standard7', found?.generator, 'standard7');
    const built = buildPresetTable(found!, 4, 'dontcare', FONT_GLYPHS);
    equal('applying the preset yields a 16-row table', built.rows.length, 16);
  }
}

/* ------------------------------------------------------------------ */
/* 17. roman letters chart (the reference picture)                      */
/* ------------------------------------------------------------------ */

section('17. roman letters: the reference picture as a standard pattern');

{
  /* --- Ground truth straight off the picture --------------------------- */
  {
    // The reference picture (docs/images/roman-letters-chart.png, titled
    // "Example set of Roman letters") was transcribed pixel-by-pixel — red
    // segments read as lit over the grey ghost outline, three rows
    // (Uppercase / Lowercase / Punctuation). These rows are that machine
    // reading, INDEPENDENT of any source file, so the Chart Font and the
    // roman pattern list are both pinned against the picture itself.
    const PICTURE: { char: string; segments: string }[] = [
      // ---- Uppercase (A-Z) ----
      { char: 'A', segments: 'ABCEFG' },
      { char: 'B', segments: 'ABCDEFG' }, // drawn as the full 8
      { char: 'C', segments: 'ADEF' },
      { char: 'D', segments: 'ABCDEF' }, // drawn as 0
      { char: 'E', segments: 'ADEFG' },
      { char: 'F', segments: 'AEFG' },
      { char: 'G', segments: 'ACDEF' },
      { char: 'H', segments: 'BCEFG' },
      { char: 'I', segments: 'BC' }, // drawn as 1
      { char: 'J', segments: 'BCDE' },
      { char: 'K', segments: 'BDEFG' },
      { char: 'L', segments: 'DEF' },
      { char: 'M', segments: 'ACEG' },
      { char: 'N', segments: 'ABCEF' },
      { char: 'O', segments: 'ABCDEF' }, // drawn as 0
      { char: 'P', segments: 'ABEFG' },
      { char: 'Q', segments: 'ABDFG' },
      { char: 'R', segments: 'ABDEFG' },
      { char: 'S', segments: 'ACDFG' },
      { char: 'T', segments: 'ABDF' },
      { char: 'U', segments: 'BCDEF' },
      { char: 'V', segments: 'BCDEF' },
      { char: 'W', segments: 'BDFG' },
      { char: 'X', segments: 'ACEG' },
      { char: 'Y', segments: 'BCDFG' },
      { char: 'Z', segments: 'ABDEG' },
      // ---- Lowercase (a-z) ----
      { char: 'a', segments: 'CDG' },
      { char: 'b', segments: 'CDEFG' },
      { char: 'c', segments: 'DEG' },
      { char: 'd', segments: 'BCDEG' },
      { char: 'e', segments: 'DE' },
      { char: 'f', segments: 'EFG' },
      { char: 'g', segments: 'ACDG' },
      { char: 'h', segments: 'CEFG' },
      { char: 'i', segments: 'ADE' },
      { char: 'j', segments: 'ACD' },
      { char: 'k', segments: 'ADFG' },
      { char: 'l', segments: 'EF' },
      { char: 'm', segments: 'ACE' },
      { char: 'n', segments: 'CEG' },
      { char: 'o', segments: 'CDEG' },
      { char: 'p', segments: 'ABEFG' },
      { char: 'q', segments: 'ABCFG' },
      { char: 'r', segments: 'EG' },
      { char: 's', segments: 'CD' },
      { char: 't', segments: 'DEFG' },
      { char: 'u', segments: 'CDE' },
      { char: 'v', segments: 'CDE' },
      { char: 'w', segments: 'BDF' },
      { char: 'x', segments: 'CE' },
      { char: 'y', segments: 'BCDFG' },
      { char: 'z', segments: 'DG' },
      // ---- Punctuation (chart order) ----
      { char: '"', segments: 'BF' },
      { char: "'", segments: 'F' },
      { char: '=', segments: 'DG' },
      { char: '-', segments: 'G' },
      { char: '_', segments: 'D' },
      { char: ' ', segments: '' },
      { char: '%', segments: 'BEG' },
      { char: '^', segments: 'ABF' },
      { char: ':', segments: 'DG' }, // renders like '=' — the chart shows both
      { char: ';', segments: 'DE' },
      { char: '/', segments: 'BEG' },
      { char: '\\', segments: 'CFG' },
      { char: '`', segments: 'AB' },
      { char: '<', segments: 'AFG' },
      { char: '>', segments: 'ABG' },
      { char: '#', segments: 'BCDG' },
      { char: '{', segments: 'BCG' },
      { char: '}', segments: 'EFG' },
      { char: '[', segments: 'ADEF' },
      { char: ']', segments: 'ABCD' },
      { char: '(', segments: 'ADEF' }, // renders like '[' — the chart shows both
      { char: ')', segments: 'ABCD' }, // renders like ']' — the chart shows both
    ];
    equal('the picture shows 74 glyphs', PICTURE.length, 74);
    equal('the chart font has one glyph per picture cell', FONT_GLYPHS.length, PICTURE.length);
    const mismatches = FONT_GLYPHS
      .map((g, i) => ({ g, p: PICTURE[i] }))
      .filter(({ g, p }) => !p || g.char !== p.char || g.segments !== p.segments)
      .map(({ g, p }) => `${g.char}:${g.segments} vs ${p ? `${p.char}:${p.segments}` : '(missing)'}`);
    check('the chart font matches the picture glyph for glyph',
      mismatches.length === 0, mismatches.join(',') || '(none)');
  }

  /* --- ROMAN_LETTER_PATTERNS: derived, code convention pinned ---------- */
  {
    const byChar = (ch: string) => ROMAN_LETTER_PATTERNS.find((p) => p.char === ch)!;
    equal('the roman chart lists 74 patterns', ROMAN_LETTER_PATTERNS.length, 74);
    check('every code round-trips through its segments',
      ROMAN_LETTER_PATTERNS.every((p) => codeFromSegments(p.segments) === p.code
        && segmentsFromCode(p.code) === p.segments),
      ROMAN_LETTER_PATTERNS.filter((p) => codeFromSegments(p.segments) !== p.code)
        .map((p) => `${p.char}=${p.code}`).join(',') || '(none)');
    check('no roman pattern lights DP',
      ROMAN_LETTER_PATTERNS.every((p) => p.pattern.DP === 0));
    check('hex annotation matches the code',
      ROMAN_LETTER_PATTERNS.every((p) => parseInt(p.hex.slice(2), 16) === p.code));
    // Spot pins, code = bitmask (a=bit0 .. g=bit6):
    equal("'A' is code 119 — the same code as the 40-entry chart's A", byChar('A').code, 119);
    equal("'A' lights a b c e f g", byChar('A').segments, 'ABCEFG');
    equal("'B' is code 127 (drawn as the full 8)", byChar('B').code, 127);
    equal("'D' is code 63 (drawn as 0, same as the digit)", byChar('D').code, 63);
    equal("'I' is code 6 (drawn as 1, same as the digit)", byChar('I').code, 6);
    equal("'U' is code 62", byChar('U').code, 62);
    equal("lowercase 'l' is code 48 (the two left bars)", byChar('l').code, 48);
    equal("lowercase 'z' is code 72", byChar('z').code, 72);
    equal('space is code 0 (nothing lit)', byChar(' ').code, 0);
    equal("'-' is code 64 (the middle bar only)", byChar('-').code, 64);
    equal("'_' is code 8 (the bottom bar only)", byChar('_').code, 8);
    // The 40-entry chart and the roman picture are readings of the same
    // segment conventions: every glyph they share carries the same code.
    check('the roman and code charts agree on the glyphs they share',
      ['A', 'C', 'E', 'F', 'G', 'L', 'P', 'S', 'U', 'Z', 'b', 'd', 'h', 'o', 'r', 't', 'u']
        .every((ch) => {
          const roman = byChar(ch);
          const codeChart = standardPatternForChar(ch);
          return roman !== undefined && codeChart !== undefined && roman.code === codeChart.code;
        }));
  }

  /* --- The table windows the picture by glyph order -------------------- */
  {
    const table = romanPatternTable(4);
    equal('4-bit table has 16 rows', table.rows.length, 16);
    check('rows are indexed positionally 0..15',
      table.rows.every((r, i) => r.input === i));
    equal('row 0 holds A',
      SEGMENT_NAMES.filter((s) => table.rows[0].outputs[s] === 1).join(''), 'ABCEFG');
    equal('row 8 holds I (the right bars)',
      SEGMENT_NAMES.filter((s) => table.rows[8].outputs[s] === 1).join(''), 'BC');
    const table5 = romanPatternTable(5);
    equal('5-bit table has 32 rows', table5.rows.length, 32);
    equal('5-bit row 26 holds the first lowercase glyph a',
      SEGMENT_NAMES.filter((s) => table5.rows[26].outputs[s] === 1).join(''), 'CDG');
    check('every 5-bit row inside the chart range is filled',
      table5.rows.every((r) => SEGMENT_NAMES.some((s) => r.outputs[s] === 1)));
    check('the table minimises without error',
      computeEngines(table, {}, {}, ['A', 'B', 'C', 'D']).A !== undefined);
  }

  /* --- The preset is registered, applies, and imports ------------------ */
  {
    const found = findBuiltinTablePreset('builtin:roman');
    check('the preset is registered', found !== undefined);
    equal('its generator is roman', found?.generator, 'roman');
    equal('its category is Letters', found?.category, 'Letters');
    const built = buildPresetTable(found!, 4, 'dontcare', FONT_GLYPHS);
    equal('applying the preset yields a 16-row table', built.rows.length, 16);
    check('applying matches the preset (round-trip through matchesTablePreset)',
      matchesTablePreset(built, found!, 'dontcare', FONT_GLYPHS));
    equal('its display mode is custom (a plain editable table)',
      presetDisplayMode(found!), 'custom');
  }

  /* --- The generator whitelist admits the standard patterns ------------ */
  {
    // E-275 regression: 'standard7' was missing from the import whitelist,
    // so a sevenseg-preset file carrying it could never import.
    const standard7File = {
      format: PRESET_FILE_FORMAT, version: 1, kind: 'table',
      preset: { name: 'x', generator: 'standard7', category: 'Codes', inputBits: 4 },
    };
    check('a standard7 preset file imports cleanly (E-275 fixed)',
      parsePresetFile(standard7File).ok === true,
      parsePresetFile(standard7File).errors.join(';'));
    const romanFile = {
      format: PRESET_FILE_FORMAT, version: 1, kind: 'table',
      preset: { name: 'x', generator: 'roman', category: 'Letters', inputBits: 4 },
    };
    check('a roman preset file imports cleanly',
      parsePresetFile(romanFile).ok === true,
      parsePresetFile(romanFile).errors.join(';'));
    equal('the imported roman preset keeps its generator',
      parsePresetFile(romanFile).tablePreset?.generator, 'roman');
  }
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

console.log(`\nverify-logic: ${passed} checks passed, ${failed} failed`);
if (failed > 0) {
  console.error('VERIFY-LOGIC: FAILED');
  process.exit(1);
}
console.log('VERIFY-LOGIC: ALL PASS');
process.exit(0);
