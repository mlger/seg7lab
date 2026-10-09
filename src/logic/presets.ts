/**
 * Preset registry: built-in table presets (generators), built-in fonts,
 * preset application / matching, and the sevenseg-preset file format.
 *
 * A preset is a FIRST-CLASS named object. Table presets either generate
 * their truth table (bcd / hex / font / excess3 / gray / aiken / boundary)
 * or store it exactly ('literal' — user-saved presets). Font presets carry
 * a full glyph list. Everything downstream (K-maps, minimizer, circuit,
 * exports) is derived from the truth table as usual — no special cases.
 *
 * Error codes E-270..E-279 belong to the preset file format.
 */
import {
  SEGMENT_NAMES,
  type DisplayMode,
  type FontGlyphData,
  type InputWidth,
  type InvalidBehavior,
  type PresetCategory,
  type PresetGenerator,
  type PresetKind,
  type SegmentOutput,
  type SegmentPatternX,
  type TablePresetDef,
  type TruthTable,
  type FontPresetDef,
} from '@/types/simulator';
import {
  blankRowX,
  dontCareRowX,
  HEX_PATTERNS,
  patternToX,
  presetTable,
  resizeTable,
  valueToChar,
} from './truthTable';
import { buildFontTable, FONT_GLYPHS, type FontGlyph } from './font';
import { STANDARD_PATTERNS } from './standardPatterns';
import { isSegmentOutput, parseGlyphEntry } from './validation';

export const PRESET_FILE_FORMAT = 'sevenseg-preset';
export const PRESET_FILE_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Code-preset generators                                              */
/* ------------------------------------------------------------------ */

/** Excess-3 (XS-3) code: digit d lives at code d+3 (0011-1100). Self-complementing BCD. */
export function excess3Table(bits: InputWidth, behavior: InvalidBehavior, existing?: TruthTable): TruthTable {
  const n = 1 << bits;
  return {
    inputBits: bits,
    rows: Array.from({ length: n }, (_, m) => {
      const d = m - 3;
      if (d >= 0 && d <= 9) return { input: m, outputs: patternToX(HEX_PATTERNS[valueToChar(d)]) };
      if (behavior === 'dontcare') return { input: m, outputs: dontCareRowX() };
      if (behavior === 'custom' && existing && existing.inputBits === bits) {
        return { input: m, outputs: existing.rows[m].outputs };
      }
      return { input: m, outputs: blankRowX() };
    }),
  };
}

/** Aiken 2-4-2-1 code: digits 0-4 at 0000-0100, digits 5-9 at 1011-1111. Self-complementing. */
export function aikenTable(bits: InputWidth, behavior: InvalidBehavior, existing?: TruthTable): TruthTable {
  const n = 1 << bits;
  return {
    inputBits: bits,
    rows: Array.from({ length: n }, (_, m) => {
      let digit = -1;
      if (m <= 4) digit = m;
      else if (m >= 11 && m <= 15) digit = m - 6;
      if (digit >= 0) return { input: m, outputs: patternToX(HEX_PATTERNS[valueToChar(digit)]) };
      if (behavior === 'dontcare') return { input: m, outputs: dontCareRowX() };
      if (behavior === 'custom' && existing && existing.inputBits === bits) {
        return { input: m, outputs: existing.rows[m].outputs };
      }
      return { input: m, outputs: blankRowX() };
    }),
  };
}

/** Gray → binary (position) decode: b = g ^ (g>>1) ^ (g>>2) ^ … */
function grayDecode(g: number): number {
  let b = g;
  for (let mask = b >> 1; mask !== 0; mask >>= 1) b ^= mask;
  return b;
}

/**
 * Gray-code counter decode: the row at Gray code g(i) = i ^ (i>>1) displays
 * the counter position i. 4-bit shows all positions 0-F (hex).
 * 5-bit: positions 0-15 shown; positions 16-31 cannot fit one digit → don't-care.
 */
export function grayCounterTable(bits: InputWidth): TruthTable {
  const n = 1 << bits;
  return {
    inputBits: bits,
    rows: Array.from({ length: n }, (_, m) => {
      const position = grayDecode(m);
      if (position <= 15) {
        return { input: m, outputs: patternToX(HEX_PATTERNS[valueToChar(position)]) };
      }
      return { input: m, outputs: dontCareRowX() };
    }),
  };
}

/** Boundary preset: every segment (incl. DP) ON or OFF on every code. */
export function allSegmentsTable(bits: InputWidth, on: boolean): TruthTable {
  const n = 1 << bits;
  const fill = (): SegmentPatternX => {
    const out = {} as SegmentPatternX;
    for (const s of SEGMENT_NAMES) out[s] = (on ? 1 : 0) as SegmentOutput;
    return out;
  };
  return { inputBits: bits, rows: Array.from({ length: n }, (_, m) => ({ input: m, outputs: fill() })) };
}

/* ------------------------------------------------------------------ */
/* Built-in fonts                                                       */
/* ------------------------------------------------------------------ */

/**
 * Calculator HEX font: the 16 glyphs 0-F with DISTINCT lowercase b and d
 * forms (b without the top bar, d without the top-left bar) — unlike the
 * chart font where B renders as "8" and D/O render as "0".
 */
export const CALCULATOR_GLYPHS: FontGlyphData[] = [
  { char: '0', segments: 'ABCDEF' },
  { char: '1', segments: 'BC' },
  { char: '2', segments: 'ABDEG' },
  { char: '3', segments: 'ABCDG' },
  { char: '4', segments: 'BCFG' },
  { char: '5', segments: 'ACDFG' },
  { char: '6', segments: 'ACDEFG' },
  { char: '7', segments: 'ABC' },
  { char: '8', segments: 'ABCDEFG' },
  { char: '9', segments: 'ABCDFG' },
  { char: 'A', segments: 'ABCEFG' },
  { char: 'b', segments: 'CDEFG' },
  { char: 'C', segments: 'ADEF' },
  { char: 'd', segments: 'BCDEG' },
  { char: 'E', segments: 'ADEFG' },
  { char: 'F', segments: 'AEFG' },
];

/** Built-in fonts selectable in the gallery. */
export const BUILTIN_FONTS: FontPresetDef[] = [
  {
    id: 'builtin:chart',
    name: 'Chart Font (74 glyphs)',
    description: 'The reference chart: uppercase, lowercase and punctuation exactly as drawn (B = "8", D/O = "0").',
    builtin: true,
    glyphs: FONT_GLYPHS as FontGlyphData[],
  },
  {
    id: 'builtin:calculator',
    name: 'Calculator HEX (16 glyphs)',
    description: 'Calculator-style hex digits with distinct lowercase b and d forms.',
    builtin: true,
    glyphs: CALCULATOR_GLYPHS,
  },
];

/** Resolve a built-in font by id. */
export function findBuiltinFont(id: string): FontPresetDef | undefined {
  return BUILTIN_FONTS.find((f) => f.id === id);
}

/* ------------------------------------------------------------------ */
/* Built-in table presets                                               */
/* ------------------------------------------------------------------ */

export const BUILTIN_TABLE_PRESETS: TablePresetDef[] = [
  {
    id: 'builtin:bcd',
    name: 'BCD Decimal (0-9)',
    description: 'Classic 8421 BCD decoder: digits 0-9 at codes 0000-1001. Invalid inputs follow the invalid-behavior setting.',
    category: 'Digits',
    inputBits: 4,
    generator: 'bcd',
  },
  {
    id: 'builtin:hex',
    name: 'Hexadecimal (0-F)',
    description: 'Full 4-bit hex decoder 0-F (calculator-style letters). On 5-bit, codes 16-31 follow the invalid-behavior setting.',
    category: 'Digits',
    inputBits: 4,
    generator: 'hex',
  },
  {
    id: 'builtin:font',
    name: 'ASCII Chart Font',
    description: 'The 74-glyph chart font windowed onto the input code space (window position configurable after applying).',
    category: 'Letters',
    inputBits: 4,
    generator: 'font',
  },
  {
    id: 'builtin:excess3',
    name: 'Excess-3 Code',
    description: 'Self-complementing BCD code: digit d is stored at code d+3 (0011-1100). Classic minimization exercise.',
    category: 'Codes',
    inputBits: 4,
    generator: 'excess3',
  },
  {
    id: 'builtin:standard7',
    name: 'Standard 7-Segment Patterns',
    description:
      "The canonical ASCII 7-segment character set: the chart's printed decimal code IS the segment bitmask (a=bit0 .. g=bit6), so every glyph is stored at that very code, and the table doubles as a reference.",
    category: 'Codes',
    inputBits: 4,
    generator: 'standard7',
  },
  {
    id: 'builtin:gray',
    name: 'Gray-Code Counter',
    description: 'Row at each Gray code g(i) = i XOR (i>>1) displays the counter position i (hex). On 5-bit, positions 16-31 become don\'t-cares.',
    category: 'Codes',
    inputBits: 4,
    generator: 'gray',
  },
  {
    id: 'builtin:aiken',
    name: 'Aiken 2-4-2-1 Code',
    description: 'Digits 0-4 at 0000-0100 and 5-9 at 1011-1111. Self-complementing like excess-3.',
    category: 'Codes',
    inputBits: 4,
    generator: 'aiken',
  },
  {
    id: 'builtin:allon',
    name: 'All Segments ON',
    description: 'Every segment (incl. DP) lit on every code — polarity and wiring debug pattern.',
    category: 'Boundary',
    inputBits: 4,
    generator: 'allon',
  },
  {
    id: 'builtin:alloff',
    name: 'All Segments OFF',
    description: 'Every segment dark on every code — blank-screen / leakage debug pattern.',
    category: 'Boundary',
    inputBits: 4,
    generator: 'alloff',
  },
];

/** Resolve a built-in table preset by id. */
export function findBuiltinTablePreset(id: string): TablePresetDef | undefined {
  return BUILTIN_TABLE_PRESETS.find((p) => p.id === id);
}

/** Display mode a table preset applies with (drives editing semantics). */
export function presetDisplayMode(preset: TablePresetDef): DisplayMode {
  switch (preset.generator) {
    case 'bcd': return 'decimal';
    case 'hex': return 'hex';
    case 'font': return 'font';
    default: return 'custom';
  }
}

/* ------------------------------------------------------------------ */
/* Preset application / matching                                        */
/* ------------------------------------------------------------------ */

/** Build the truth table of a table preset at the given width. */
export function buildPresetTable(
  preset: TablePresetDef,
  bits: InputWidth,
  behavior: InvalidBehavior,
  glyphs: FontGlyph[] = FONT_GLYPHS,
  existing?: TruthTable,
): TruthTable {
  switch (preset.generator) {
    case 'bcd':
      return presetTable(bits, 'decimal', preset.options?.invalidBehavior ?? behavior, existing);
    case 'hex':
      return presetTable(bits, 'hex', preset.options?.invalidBehavior ?? behavior, existing);
    case 'font':
      return buildFontTable(
        bits,
        preset.options?.fontStart ?? 0,
        preset.options?.tableStartCode ?? 0,
        glyphs,
      );
    case 'excess3':
      return excess3Table(bits, preset.options?.invalidBehavior ?? behavior, existing);
    case 'standard7':
      return standardPatternTable(bits, existing);
    case 'aiken':
      return aikenTable(bits, preset.options?.invalidBehavior ?? behavior, existing);
    case 'gray':
      return grayCounterTable(bits);
    case 'allon':
      return allSegmentsTable(bits, true);
    case 'alloff':
      return allSegmentsTable(bits, false);
    case 'literal':
      if (preset.table) {
        return preset.table.inputBits === bits ? preset.table : resizeTable(preset.table, bits);
      }
      return presetTable(bits, 'custom', behavior, existing);
    default:
      return presetTable(bits, 'custom', behavior, existing);
  }
}

/**
 * Standard 7-segment character patterns as a truth table.
 *
 * Each glyph from the canonical chart is stored at the chart's OWN printed
 * code, which is the segment bitmask itself (a=bit0 .. g=bit6). So the table is
 * a direct transcription of the reference rather than a re-derivation.
 *
 * Two consequences worth knowing:
 *  - only the addresses the chart actually lists get a pattern; every other
 *    code is left as a don't-care so the minimizer is free to exploit them;
 *  - a code the chart prints more than once (e.g. 109 for both the digit 5 and
 *    the letter S) holds one pattern, which is correct — seven segments cannot
 *    distinguish those glyphs at all.
 */
export function standardPatternTable(bits: InputWidth, existing?: TruthTable): TruthTable {
  const n = 1 << bits;
  // Every row starts as a don't-care, then the glyphs are written in order.
  const rows = Array.from({ length: n }, (_, code) => ({
    input: code,
    outputs: dontCareRowX(),
  })) as TruthTable['rows'];

  // Address by GLYPH ORDER, not by the chart's printed code: those codes are
  // 0..127 (they are the bitmask) and a 4-bit space only reaches 0..15, so
  // addressing by code would leave 11 of 16 rows empty. See the note in
  // ./standardPatterns for why the chart travels as a font instead.
  for (let i = 0; i < n && i < STANDARD_PATTERNS.length; i++) {
    rows[i] = { input: i, outputs: { ...STANDARD_PATTERNS[i].pattern } as never };
  }

  void existing;
  return { inputBits: bits, rows };
}

/** Does the live table still equal the preset's table (at the live width)? */
export function matchesTablePreset(
  table: TruthTable,
  preset: TablePresetDef,
  behavior: InvalidBehavior,
  glyphs: FontGlyph[] = FONT_GLYPHS,
): boolean {
  const ref = buildPresetTable(preset, table.inputBits, behavior, glyphs);
  if (ref.rows.length !== table.rows.length) return false;
  return ref.rows.every((pr, i) => {
    const r = table.rows[i]; // both arrays are in minterm order
    return r !== undefined && r.input === pr.input && SEGMENT_NAMES.every((s) => r.outputs[s] === pr.outputs[s]);
  });
}

/* ------------------------------------------------------------------ */
/* sevenseg-preset file format (E-270..E-279)                           */
/* ------------------------------------------------------------------ */

export interface PresetFileResult {
  ok: boolean;
  kind?: PresetKind;
  /** Present when kind = 'table'. Ready to add to the library (fresh user id). */
  tablePreset?: TablePresetDef;
  /** Present when kind = 'font'. Ready to add to the library (fresh user id). */
  fontPreset?: FontPresetDef;
  errors: string[];
}

/** Generate a fresh user preset id (works in Node, Bun and browsers). */
export function newUserId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `user:${c.randomUUID()}`;
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const GENERATORS: readonly PresetGenerator[] = ['bcd', 'hex', 'font', 'excess3', 'gray', 'aiken', 'allon', 'alloff', 'literal'];
const CATEGORIES: readonly PresetCategory[] = ['Digits', 'Codes', 'Letters', 'Boundary', 'User'];

/** Validate a literal truth table (user presets must be exact). */
function validateLiteralTable(raw: unknown, bits: InputWidth): TruthTable | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const rows = (raw as Record<string, unknown>).rows;
  if (!Array.isArray(rows) || rows.length !== (1 << bits)) return null;
  const out: TruthTable['rows'] = [];
  for (let m = 0; m < rows.length; m++) {
    const row = rows[m];
    if (typeof row !== 'object' || row === null) return null;
    const outputsRaw = (row as Record<string, unknown>).outputs;
    if (typeof outputsRaw !== 'object' || outputsRaw === null) return null;
    const outputs = {} as SegmentPatternX;
    for (const seg of SEGMENT_NAMES) {
      const v = (outputsRaw as Record<string, unknown>)[seg];
      if (!isSegmentOutput(v)) return null;
      outputs[seg] = v;
    }
    out.push({ input: m, outputs });
  }
  return { inputBits: bits, rows: out };
}

function parseGlyphs(raw: unknown, errors: string[], fatalCode: string): FontGlyphData[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push(`${fatalCode}: Preset font "glyphs" must be a non-empty array.`);
    return [];
  }
  if (raw.length > 1024) {
    errors.push(`${fatalCode}: Preset font has too many glyphs (> 1024).`);
    return [];
  }
  const glyphs: FontGlyphData[] = [];
  raw.forEach((g, i) => {
    const entry = parseGlyphEntry(g);
    if (entry) {
      glyphs.push(entry);
      return;
    }
    errors.push(`E-278: Glyph ${i} invalid (needs "char": string and "segments": subset of ABCDEFGDP) — dropped.`);
  });
  if (glyphs.length === 0 && raw.length > 0) {
    errors.push(`${fatalCode}: No valid glyphs remain after validation.`);
  }
  return glyphs;
}

/** Parse and validate a sevenseg-preset file. Imported presets get fresh user ids. */
export function parsePresetFile(raw: unknown): PresetFileResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['E-270: Preset file root must be a JSON object.'] };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== PRESET_FILE_FORMAT) {
    return { ok: false, errors: ['E-271: Not a sevenseg-preset file — missing "format": "sevenseg-preset".'] };
  }
  const version = typeof obj.version === 'number' ? obj.version : PRESET_FILE_VERSION;
  if (version > PRESET_FILE_VERSION) {
    errors.push(`E-272a: Unsupported preset version ${version} — trying to read anyway.`);
  }
  if (obj.kind !== 'table' && obj.kind !== 'font') {
    return { ok: false, errors: ['E-272: Preset "kind" must be "table" or "font".'] };
  }
  if (typeof obj.preset !== 'object' || obj.preset === null || Array.isArray(obj.preset)) {
    return { ok: false, errors: ['E-273: Preset file "preset" must be an object.'] };
  }
  const p = obj.preset as Record<string, unknown>;
  const now = new Date().toISOString();

  if (obj.kind === 'font') {
    const name = typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim().slice(0, 100) : 'Imported font';
    const glyphs = parseGlyphs(p.glyphs, errors, 'E-279');
    if (glyphs.length === 0) {
      return { ok: false, errors, kind: 'font' };
    }
    const description = typeof p.description === 'string' ? p.description.slice(0, 300) : undefined;
    return {
      ok: errors.length === 0,
      kind: 'font',
      fontPreset: {
        id: newUserId(),
        name,
        ...(description ? { description } : {}),
        builtin: false,
        glyphs,
        createdAt: now,
        updatedAt: now,
      },
      errors,
    };
  }

  // ---- table preset ----
  const name = typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim().slice(0, 100) : 'Imported preset';

  let inputBits: InputWidth = 4;
  if (p.inputBits === 4 || p.inputBits === 5) inputBits = p.inputBits;
  else errors.push(`E-274: Table preset "inputBits" must be 4 or 5 (got ${JSON.stringify(p.inputBits)}) — using 4.`);

  let generator: PresetGenerator = 'literal';
  if (typeof p.generator === 'string' && (GENERATORS as readonly string[]).includes(p.generator)) {
    generator = p.generator as PresetGenerator;
  } else {
    return { ok: false, errors: [...errors, `E-275: Unknown table preset "generator" ${JSON.stringify(p.generator)}.`], kind: 'table' };
  }

  let category: PresetCategory = 'User';
  if (typeof p.category === 'string' && (CATEGORIES as readonly string[]).includes(p.category)) {
    category = p.category as PresetCategory;
  } else if (p.category !== undefined) {
    errors.push(`E-277: Preset "category" invalid — using "User".`);
  }

  let table: TruthTable | undefined;
  if (generator === 'literal') {
    const validated = validateLiteralTable(p.table, inputBits);
    if (validated) table = validated;
    else {
      return {
        ok: false,
        errors: [...errors, 'E-276: Literal preset "table" invalid (needs rows for every code with outputs 0/1/"X").'],
        kind: 'table',
      };
    }
  } else if (p.table !== undefined) {
    errors.push('E-276a: "table" is only stored for literal presets — ignored.');
  }

  let options: TablePresetDef['options'];
  if (p.options !== undefined) {
    if (typeof p.options === 'object' && p.options !== null && !Array.isArray(p.options)) {
      const o = p.options as Record<string, unknown>;
      options = {};
      if (typeof o.tableStartCode === 'number' && Number.isInteger(o.tableStartCode)) {
        options.tableStartCode = Math.min(Math.max(o.tableStartCode, 0), (1 << inputBits) - 1);
      }
      if (typeof o.fontStart === 'number' && Number.isInteger(o.fontStart) && o.fontStart >= 0) {
        options.fontStart = o.fontStart;
      }
      if (o.invalidBehavior === 'blank' || o.invalidBehavior === 'dontcare' || o.invalidBehavior === 'custom') {
        options.invalidBehavior = o.invalidBehavior;
      }
      if (Object.keys(options).length === 0) options = undefined;
    } else {
      errors.push('E-278: "options" invalid — ignored.');
    }
  }

  const description = typeof p.description === 'string' ? p.description.slice(0, 300) : undefined;
  return {
    ok: errors.length === 0,
    kind: 'table',
    tablePreset: {
      id: newUserId(),
      name,
      ...(description ? { description } : {}),
      category,
      inputBits,
      generator,
      ...(options ? { options } : {}),
      ...(table ? { table } : {}),
      createdAt: now,
      updatedAt: now,
    },
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Export helpers + import format detection                             */
/* ------------------------------------------------------------------ */

/** Build a downloadable sevenseg-preset file for a table preset. */
export function buildTablePresetFile(preset: TablePresetDef): object {
  return { format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, kind: 'table', preset };
}

/** Build a downloadable sevenseg-preset file for a font preset. */
export function buildFontPresetFile(preset: FontPresetDef): object {
  return { format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, kind: 'font', preset };
}

export type ImportFormat = 'project' | 'font' | 'preset';

/** Detect which of the three importable formats a parsed JSON object is. */
export function detectImportFormat(raw: unknown): ImportFormat | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.format === 'sevenseg-font') return 'font';
  if (obj.format === PRESET_FILE_FORMAT) return 'preset';
  if ('truthTable' in obj || ('version' in obj && 'name' in obj)) return 'project';
  return null;
}

/** Font preset glyph list → engine glyph list (identical shapes). */
export function fontGlyphsOf(font: FontPresetDef): FontGlyph[] {
  return font.glyphs as FontGlyph[];
}

/**
 * Validate a raw table-preset def (server row data / localStorage library entry).
 *
 * The stored `createdAt`/`updatedAt` are preserved (NOT restamped to now): the
 * sync merge in store.ts compares these timestamps to decide whether a server
 * copy is newer than a local offline edit — restamping them here would make the
 * server copy always win and silently revert local edits.
 */
export function validateLibraryTablePreset(raw: unknown): TablePresetDef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const res = parsePresetFile({ format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, kind: 'table', preset: raw });
  if (!res.tablePreset) return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string' || !id.startsWith('user:') || id.length > 100) return null;
  const createdAt = typeof obj.createdAt === 'string' && obj.createdAt !== '' ? obj.createdAt : res.tablePreset.createdAt;
  const updatedAt = typeof obj.updatedAt === 'string' && obj.updatedAt !== '' ? obj.updatedAt : res.tablePreset.updatedAt;
  return { ...res.tablePreset, id, createdAt, updatedAt };
}

/** Validate a raw font-preset def (server row data / localStorage library entry) — timestamps preserved, see above. */
export function validateLibraryFontPreset(raw: unknown): FontPresetDef | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const res = parsePresetFile({ format: PRESET_FILE_FORMAT, version: PRESET_FILE_VERSION, kind: 'font', preset: raw });
  if (!res.fontPreset) return null;
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string' || !id.startsWith('user:') || id.length > 100) return null;
  const createdAt = typeof obj.createdAt === 'string' && obj.createdAt !== '' ? obj.createdAt : res.fontPreset.createdAt;
  const updatedAt = typeof obj.updatedAt === 'string' && obj.updatedAt !== '' ? obj.updatedAt : res.fontPreset.updatedAt;
  return { ...res.fontPreset, id, createdAt, updatedAt };
}
