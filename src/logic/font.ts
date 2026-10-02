/**
 * ASCII font for 7-segment displays — extracted pixel-by-pixel from the
 * user-supplied reference chart (3 rows: Uppercase / Lowercase / Punctuation).
 *
 * Every glyph was verified against the chart image (red segments = lit over a
 * gray ghost "8" outline) and cross-checked with the well-known
 * LED-Segment-ASCII font family. Conventions of THIS font:
 *   - uppercase B renders as the full "8", D and O as "0" (their digit twins)
 *   - lowercase forms follow the classic conventions (b c d h n o t u y …)
 *   - ':' renders like '=' (two bars) and '(' ')' render like '[' ']' because
 *     seven segments cannot distinguish them; the chart lists them separately.
 *
 * The font is a DATA table only — no logic depends on specific entries, so
 * users can import their own font files and everything downstream
 * (K-maps, minimizer, circuit, exports) re-derives automatically.
 */
import {
  SEGMENT_NAMES,
  type InputWidth,
  type SegmentName,
  type SegmentPatternX,
  type TruthTable,
} from '@/types/simulator';

export interface FontGlyph {
  /** Display label of the glyph (single character, may be a space). */
  char: string;
  /** Lit segments (subset of A..G; DP is never used by this font). */
  segments: string;
}

/** The 74-glyph font exactly as drawn in the reference chart. */
export const FONT_GLYPHS: FontGlyph[] = [
  // ---- Uppercase (A-Z) ----
  { char: 'A', segments: 'ABCEFG' },
  { char: 'B', segments: 'ABCDEFG' }, // drawn as full 8 in the chart
  { char: 'C', segments: 'ADEF' },
  { char: 'D', segments: 'ABCDEF' }, // drawn as 0 in the chart
  { char: 'E', segments: 'ADEFG' },
  { char: 'F', segments: 'AEFG' },
  { char: 'G', segments: 'ACDEF' },
  { char: 'H', segments: 'BCEFG' },
  { char: 'I', segments: 'BC' },
  { char: 'J', segments: 'BCDE' },
  { char: 'K', segments: 'BDEFG' },
  { char: 'L', segments: 'DEF' },
  { char: 'M', segments: 'ACEG' },
  { char: 'N', segments: 'ABCEF' },
  { char: 'O', segments: 'ABCDEF' }, // drawn as 0 in the chart
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
  { char: ':', segments: 'DG' }, // renders like '=' — chart shows both
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
  { char: '(', segments: 'ADEF' }, // renders like '[' — chart shows both
  { char: ')', segments: 'ABCD' }, // renders like ']' — chart shows both
];

/** Row group labels of the reference chart (used by the font picker UI). */
export const FONT_GROUPS: { label: string; from: number; to: number }[] = [
  { label: 'Uppercase', from: 0, to: 25 },
  { label: 'Lowercase', from: 26, to: 51 },
  { label: 'Punctuation', from: 52, to: 73 },
];

export const BUILTIN_FONT_LENGTH = FONT_GLYPHS.length;

/** Parse a segment string like "ABCEFG" into a full tri-state pattern. */
export function fontPattern(segments: string): SegmentPatternX {
  const out = {} as SegmentPatternX;
  for (const s of SEGMENT_NAMES) out[s] = (segments.includes(s) ? 1 : 0) as 0 | 1;
  return out;
}

export function isSegmentName(ch: string): ch is SegmentName {
  return (SEGMENT_NAMES as readonly string[]).includes(ch);
}

/**
 * Input codes in "listed order": starting from `startCode` and wrapping around.
 * Example (4-bit, start 1): 1, 2, 3, … 15, 0.
 */
export function listedCodes(bits: InputWidth, startCode: number): number[] {
  const n = 1 << bits;
  const s = ((Math.round(startCode) % n) + n) % n;
  return Array.from({ length: n }, (_, i) => (s + i) % n);
}

/**
 * Build a FONT preset truth table.
 *
 * Glyph `i` of the font window (starting at `fontStart`, wrapping around the
 * font) is assigned to the i-th code in listed order (starting at
 * `tableStartCode`, wrapping around the code space). With defaults (0/0) on
 * 4-bit this maps A→0000 … P→1111; with startCode = 1 the font starts at
 * DCBA = 0001 and the last glyph wraps onto 0000.
 */
export function buildFontTable(
  bits: InputWidth,
  fontStart: number,
  tableStartCode: number,
  glyphs: FontGlyph[] = FONT_GLYPHS,
): TruthTable {
  const n = 1 << bits;
  const codes = listedCodes(bits, tableStartCode);
  const rows = codes.map((code, i) => {
    const glyph = glyphs[((Math.round(fontStart) % glyphs.length) + glyphs.length + i) % glyphs.length];
    return { input: code, outputs: fontPattern(glyph.segments) };
  });
  // rows must be sorted by input for the rest of the engine (minterm order)
  rows.sort((a, b) => a.input - b.input);
  return { inputBits: bits, rows: rows as TruthTable['rows'] };
}

/** Character label the font assigns to a code (window mapping, see buildFontTable). */
export function fontCharAt(
  code: number,
  bits: InputWidth,
  fontStart: number,
  tableStartCode: number,
  glyphs: FontGlyph[] = FONT_GLYPHS,
): string {
  const n = 1 << bits;
  const codes = listedCodes(bits, tableStartCode);
  const i = codes.indexOf(code);
  if (i < 0) return '?';
  const glyph = glyphs[((Math.round(fontStart) % glyphs.length) + glyphs.length + i) % glyphs.length];
  return glyph.char;
}

/** Index of a glyph in a font by its char label (first match), or -1. */
export function fontIndexOf(char: string, glyphs: FontGlyph[] = FONT_GLYPHS): number {
  return glyphs.findIndex((g) => g.char === char);
}
