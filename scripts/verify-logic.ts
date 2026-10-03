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
import { grayAxisOrder } from '@/utils/binary';
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
/* Summary                                                             */
/* ------------------------------------------------------------------ */

console.log(`\nverify-logic: ${passed} checks passed, ${failed} failed`);
if (failed > 0) {
  console.error('VERIFY-LOGIC: FAILED');
  process.exit(1);
}
console.log('VERIFY-LOGIC: ALL PASS');
process.exit(0);
