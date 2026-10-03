/**
 * Truth-table engine: presets (BCD decimal, hexadecimal), row editing,
 * and minterm/maxterm extraction. The truth table is the SINGLE SOURCE OF TRUTH
 * of the simulator — K-maps, expressions, circuits and the display are derived from it.
 */
import {
  SEGMENT_NAMES,
  type Bit,
  type DisplayMode,
  type InvalidBehavior,
  type InputWidth,
  type SegmentName,
  type SegmentOutput,
  type SegmentPattern,
  type SegmentPatternX,
  type TruthTable,
  type TruthTableRow,
} from '@/types/simulator';
import { buildFontTable, FONT_GLYPHS, type FontGlyph } from './font';

/** Standard hexadecimal 7-segment patterns (A..G order, 1 = ON, common cathode logic). */
export const HEX_PATTERNS: Record<string, SegmentPattern> = {
  '0': { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 0, DP: 0 },
  '1': { A: 0, B: 1, C: 1, D: 0, E: 0, F: 0, G: 0, DP: 0 },
  '2': { A: 1, B: 1, C: 0, D: 1, E: 1, F: 0, G: 1, DP: 0 },
  '3': { A: 1, B: 1, C: 1, D: 1, E: 0, F: 0, G: 1, DP: 0 },
  '4': { A: 0, B: 1, C: 1, D: 0, E: 0, F: 1, G: 1, DP: 0 },
  '5': { A: 1, B: 0, C: 1, D: 1, E: 0, F: 1, G: 1, DP: 0 },
  '6': { A: 1, B: 0, C: 1, D: 1, E: 1, F: 1, G: 1, DP: 0 },
  '7': { A: 1, B: 1, C: 1, D: 0, E: 0, F: 0, G: 0, DP: 0 },
  '8': { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, DP: 0 },
  '9': { A: 1, B: 1, C: 1, D: 1, E: 0, F: 1, G: 1, DP: 0 },
  A: { A: 1, B: 1, C: 1, D: 0, E: 1, F: 1, G: 1, DP: 0 },
  b: { A: 0, B: 0, C: 1, D: 1, E: 1, F: 1, G: 1, DP: 0 },
  C: { A: 1, B: 0, C: 0, D: 1, E: 1, F: 1, G: 0, DP: 0 },
  d: { A: 0, B: 1, C: 1, D: 1, E: 1, F: 0, G: 1, DP: 0 },
  E: { A: 1, B: 0, C: 0, D: 1, E: 1, F: 1, G: 1, DP: 0 },
  F: { A: 1, B: 0, C: 0, D: 0, E: 1, F: 1, G: 1, DP: 0 },
};

export const BLANK_PATTERN: SegmentPattern = {
  A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, DP: 0,
};

export function patternToX(p: SegmentPattern): SegmentPatternX {
  const out = {} as SegmentPatternX;
  for (const s of SEGMENT_NAMES) out[s] = p[s];
  return out;
}

/** Display character for input value 0-15 (hex letters use display case: A b C d E F). */
const VALUE_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'b', 'C', 'd', 'E', 'F'];

export function valueToChar(m: number): string {
  return VALUE_CHARS[m] ?? '?';
}

export function blankRowX(): SegmentPatternX {
  return patternToX(BLANK_PATTERN);
}

export function dontCareRowX(): SegmentPatternX {
  const out = {} as SegmentPatternX;
  for (const s of SEGMENT_NAMES) out[s] = 'X' as SegmentOutput;
  return out;
}

function makeRows(bits: InputWidth, fill: (minterm: number) => SegmentPatternX): TruthTableRow[] {
  return Array.from({ length: 1 << bits }, (_, m) => ({ input: m, outputs: fill(m) }));
}

export function createEmptyTable(bits: InputWidth): TruthTable {
  return { inputBits: bits, rows: makeRows(bits, () => blankRowX()) };
}

/** Highest input value covered by the preset's character set. */
function presetCharLimit(mode: DisplayMode): number {
  switch (mode) {
    case 'decimal': return 9;
    case 'hex': return 15;
    default: return -1; // binary / custom / raw / font have no preset range
  }
}

/** Options for presetTable when used with the FONT preset. */
export interface FontPresetOptions {
  fontStart: number;
  tableStartCode: number;
  glyphs: FontGlyph[];
}

/**
 * Build a preset truth table.
 * decimal: 0-9 BCD digits, invalid inputs (>= 10) follow `behavior`.
 * hex: 0-F hex digits; for 5-bit, 16-31 follow `behavior`.
 * font: window of the ASCII font chart (see buildFontTable).
 * binary / custom / raw: no preset — existing rows are preserved.
 */
export function presetTable(
  bits: InputWidth,
  mode: DisplayMode,
  behavior: InvalidBehavior,
  existing?: TruthTable,
  fontOpts?: FontPresetOptions,
): TruthTable {
  if (mode === 'font') {
    const o = fontOpts ?? { fontStart: 0, tableStartCode: 0, glyphs: FONT_GLYPHS };
    return buildFontTable(bits, o.fontStart, o.tableStartCode, o.glyphs);
  }
  if (mode === 'binary' || mode === 'custom' || mode === 'raw') {
    if (existing && existing.inputBits === bits) return existing;
    return createEmptyTable(bits);
  }
  const limit = presetCharLimit(mode);
  return {
    inputBits: bits,
    rows: makeRows(bits, (m) => {
      if (m <= limit) {
        return patternToX(HEX_PATTERNS[valueToChar(m)]);
      }
      if (behavior === 'blank') return blankRowX();
      if (behavior === 'dontcare') return dontCareRowX();
      // custom: keep the existing row when available
      if (existing && existing.inputBits === bits) return existing.rows[m].outputs;
      return blankRowX();
    }),
  };
}

/** Apply the invalid-input behavior (blank / don't-care / custom) to out-of-range rows. */
export function applyInvalidBehavior(
  table: TruthTable,
  mode: DisplayMode,
  behavior: InvalidBehavior,
): TruthTable {
  const limit = presetCharLimit(mode);
  if (limit < 0) return table;
  return {
    ...table,
    rows: table.rows.map((row) => {
      if (row.input <= limit) return row;
      if (behavior === 'blank') return { ...row, outputs: blankRowX() };
      if (behavior === 'dontcare') return { ...row, outputs: dontCareRowX() };
      return row; // custom keeps whatever is there
    }),
  };
}

/** Change input width, preserving overlapping rows where possible. */
export function resizeTable(table: TruthTable, bits: InputWidth): TruthTable {
  if (table.inputBits === bits) return table;
  const oldCount = table.rows.length;
  const newCount = 1 << bits;
  const rows: TruthTableRow[] = [];
  for (let m = 0; m < newCount; m++) {
    if (m < oldCount) rows.push({ ...table.rows[m], input: m });
    else rows.push({ input: m, outputs: dontCareRowX() });
  }
  return { inputBits: bits, rows };
}

export function setCell(
  table: TruthTable,
  minterm: number,
  segment: SegmentName,
  value: SegmentOutput,
): TruthTable {
  const rows = table.rows.map((r) =>
    r.input === minterm ? { ...r, outputs: { ...r.outputs, [segment]: value } } : r,
  );
  return { ...table, rows };
}

export function setRow(
  table: TruthTable,
  minterm: number,
  outputs: SegmentPatternX,
): TruthTable {
  const rows = table.rows.map((r) => (r.input === minterm ? { ...r, outputs: { ...outputs } } : r));
  return { ...table, rows };
}

/** Toggle a segment 0 <-> 1 (keeps X -> 1). Used by clicking the display. */
export function toggleSegment(table: TruthTable, minterm: number, segment: SegmentName): TruthTable {
  const row = table.rows.find((r) => r.input === minterm);
  if (!row) return table;
  const current = row.outputs[segment];
  const next: SegmentOutput = current === 1 ? 0 : 1;
  return setCell(table, minterm, segment, next);
}

export function getRow(table: TruthTable, minterm: number): TruthTableRow | undefined {
  return table.rows.find((r) => r.input === minterm);
}

export function getCell(table: TruthTable, minterm: number, segment: SegmentName): SegmentOutput {
  return getRow(table, minterm)?.outputs[segment] ?? 0;
}

/** Extract minterm lists per segment: indices where output = 1 / 0 / X. */
export function segmentSets(
  table: TruthTable,
  segment: SegmentName,
): { ones: number[]; zeros: number[]; dontCares: number[] } {
  const ones: number[] = [];
  const zeros: number[] = [];
  const dontCares: number[] = [];
  for (const row of table.rows) {
    const v = row.outputs[segment];
    if (v === 1) ones.push(row.input);
    else if (v === 0) zeros.push(row.input);
    else dontCares.push(row.input);
  }
  return { ones, zeros, dontCares };
}

/** Convert a pattern of bits (1 = ON) into a displayable character guess, or null.
 *  `X` (don't-care) segments never match a hex pattern, so rows containing
 *  them simply yield null. */
export function patternToChar(p: SegmentPatternX): string | null {
  const key = (c: string) => HEX_PATTERNS[c];
  for (const c of Object.keys(HEX_PATTERNS)) {
    const hp = key(c);
    if (SEGMENT_NAMES.every((s) => hp[s] === p[s])) return c;
  }
  return null;
}

export function bitPattern(p: SegmentPatternX, segment: SegmentName): Bit {
  return p[segment] === 1 ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* Shift operations (pattern rotation tools)                           */
/* ------------------------------------------------------------------ */

import { listedCodes } from './font';

/** Rotate one row's segment values horizontally (A→B→…→DP→A or reverse).
 *  dir = 1 moves values RIGHT (A→B); dir = -1 moves them LEFT. */
export function shiftRowValues(
  table: TruthTable,
  minterm: number,
  dir: 1 | -1,
): TruthTable {
  const row = getRow(table, minterm);
  if (!row) return table;
  const n = SEGMENT_NAMES.length;
  const outputs = {} as SegmentPatternX;
  SEGMENT_NAMES.forEach((seg, i) => {
    const j = (((i + dir) % n) + n) % n;
    outputs[SEGMENT_NAMES[j]] = row.outputs[seg];
  });
  return setRow(table, minterm, outputs);
}

/** Rotate one segment's column of values vertically across all rows (listed order).
 *  dir = 1 moves values DOWN one row (with wrap); dir = -1 moves them UP. */
export function shiftColumnValues(
  table: TruthTable,
  segment: SegmentName,
  dir: 1 | -1,
  startCode = 0,
): TruthTable {
  const codes = listedCodes(table.inputBits, startCode);
  const values = codes.map((c) => getCell(table, c, segment));
  const n = values.length;
  const rotated = values.map((_, i) => values[(((i - dir) % n) + n) % n]);
  let out = table;
  codes.forEach((c, i) => {
    out = setCell(out, c, segment, rotated[i]);
  });
  return out;
}

/** Rotate every row's whole pattern between codes (listed order).
 *  dir = 1 moves patterns DOWN one row (with wrap); dir = -1 moves them UP. */
export function shiftAllRows(
  table: TruthTable,
  dir: 1 | -1,
  startCode = 0,
): TruthTable {
  const codes = listedCodes(table.inputBits, startCode);
  const patterns = codes.map((c) => ({ ...getRow(table, c)!.outputs }));
  const n = patterns.length;
  const rotated = patterns.map((_, i) => patterns[(((i - dir) % n) + n) % n]);
  let out = table;
  codes.forEach((c, i) => {
    out = setRow(out, c, rotated[i]);
  });
  return out;
}

/** Rotate every column of values vertically (listed order). */
export function shiftAllColumns(
  table: TruthTable,
  dir: 1 | -1,
  startCode = 0,
): TruthTable {
  let out = table;
  for (const seg of SEGMENT_NAMES) out = shiftColumnValues(out, seg, dir, startCode);
  return out;
}
