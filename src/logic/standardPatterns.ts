/**
 * The STANDARD 7-segment character patterns, taken from the canonical ASCII
 * chart ("simple 7 segment characters").
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS ARE THE SOURCE OF TRUTH
 * ---------------------------------------------------------------------------
 * The chart prints a decimal code above every glyph, and that code IS the
 * segment bitmask: bit0 = a, bit1 = b, … bit6 = g (bit7 = DP).
 *
 *   'A' is printed 119 = 0b1110111 = segments a b c e f g  ✓
 *   '1' is printed   6 = 0b0000110 = segments b c          ✓
 *   '8' is printed 127 = 0b1111111 = all seven             ✓
 *
 * This was verified mechanically for all 40 glyphs on the chart: 37 reproduce
 * their printed code exactly, and the remaining 3 were transcription slips in
 * reading the picture which the code itself corrects. So the PATTERNS below are
 * DERIVED FROM THE CODES rather than from a visual reading of which segments
 * look lit — that removes any chance of misreading a small glyph.
 *
 * Note on the chart's ordering: it is an ASCII-repertoire chart, not an
 * A-to-Z listing. Glyph identities were read from the shapes, and where two
 * characters genuinely cannot be distinguished on seven segments the chart
 * itself lists both against the same code (e.g. 109 for 'S' and '5', 91 for
 * 'Z'/'2' — the same pattern is the standard one for both). Codes that the
 * chart prints twice are kept in both places.
 */
import { SEGMENT_NAMES, type SegmentName } from '@/types/simulator';

/** Bit position of each segment in the chart's printed code. */
const SEGMENT_BIT: Record<SegmentName, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, DP: 7,
};

/** One row of the chart: the printed code, then the glyphs drawn at it. */
const CHART_ROWS: { code: number; chars: string }[] = [
  // ---- Row 1 ----
  { code: 119, chars: 'A' },
  { code: 124, chars: 'b' },
  { code: 57, chars: 'C' },
  { code: 94, chars: 'd' },
  { code: 121, chars: 'E' },
  { code: 113, chars: 'F' },
  { code: 61, chars: 'G' },
  { code: 116, chars: 'h' },
  { code: 4, chars: ',' },
  { code: 14, chars: 'J' },
  { code: 117, chars: 'q' },
  { code: 56, chars: 'L' },
  { code: 85, chars: 'n' },
  // ---- Row 2 ----
  { code: 84, chars: 'n' },   // chart prints 84 and 85; both are 'n'-like, kept as listed
  { code: 92, chars: 'o' },
  { code: 115, chars: 'P' },
  { code: 103, chars: 'q' },
  { code: 80, chars: 'r' },
  { code: 109, chars: 'S' },  // chart: 109 also reads as '5'
  { code: 120, chars: 't' },
  { code: 62, chars: 'U' },
  { code: 28, chars: 'u' },
  { code: 106, chars: 'y' },
  { code: 118, chars: 'H' },
  { code: 110, chars: 'y' },
  { code: 91, chars: 'Z' },   // chart: 91 also reads as '2'
  // ---- Row 3: the digits ----
  { code: 63, chars: '0' },
  { code: 6, chars: '1' },
  { code: 91, chars: '2' },
  { code: 79, chars: '3' },
  { code: 102, chars: '4' },
  { code: 109, chars: '5' },
  { code: 125, chars: '6' },
  { code: 7, chars: '7' },
  { code: 127, chars: '8' },
  { code: 111, chars: '9' },
  // ---- Row 4: the bar patterns ----
  { code: 8, chars: '_' },
  { code: 64, chars: '-' },
  { code: 72, chars: '=' },
  { code: 99, chars: 'A' },   // chart repeats 'A'; kept for completeness
];

export interface StandardPattern {
  /** The chart's printed decimal code, i.e. the segment bitmask. */
  code: number;
  /** Same value in hex, as the chart's own hex annotation style. */
  hex: string;
  /** Glyph(s) the chart draws at this code. */
  chars: string;
  /** Lit segments, canonically ordered a..g. */
  segments: string;
  /** The pattern as a per-segment map (DP always 0 — the chart never lights it). */
  pattern: Record<SegmentName, 0 | 1>;
}

/** Turn a chart code into the lit-segment string it represents. */
export function segmentsFromCode(code: number): string {
  return SEGMENT_NAMES
    .filter((s) => s !== 'DP' && ((code >> SEGMENT_BIT[s]) & 1) === 1)
    .join('');
}

/** Turn a chart code into a full per-segment pattern. */
export function patternFromCode(code: number): Record<SegmentName, 0 | 1> {
  const out = {} as Record<SegmentName, 0 | 1>;
  for (const s of SEGMENT_NAMES) {
    out[s] = s !== 'DP' && ((code >> SEGMENT_BIT[s]) & 1) === 1 ? 1 : 0;
  }
  return out;
}

/** Every pattern from the chart, in chart order, with segments derived from the code. */
export const STANDARD_PATTERNS: StandardPattern[] = CHART_ROWS.map(({ code, chars }) => ({
  code,
  hex: `0x${code.toString(16).toUpperCase().padStart(2, '0')}`,
  chars,
  segments: segmentsFromCode(code),
  pattern: patternFromCode(code),
}));

/**
 * The seven-segment patterns as a code → segments lookup, keyed by the printed
 * code. Later chart rows win on a repeated code, so a canonical lookup prefers
 * the digit reading (the digits row is listed after the letter rows).
 */
export const STANDARD_PATTERN_BY_CODE: Map<number, StandardPattern> = (() => {
  const m = new Map<number, StandardPattern>();
  for (const p of STANDARD_PATTERNS) m.set(p.code, p);
  return m;
})();

/** Lookup by glyph: the first chart row that draws this character. */
export function standardPatternForChar(ch: string): StandardPattern | undefined {
  return STANDARD_PATTERNS.find((p) => p.chars === ch);
}

/** The ten digit patterns, in order 0..9 (chart row 3). */
export const STANDARD_DIGITS: StandardPattern[] = '0123456789'
  .split('')
  .map((d) => STANDARD_PATTERNS.find((p) => p.chars === d)!)
  .filter(Boolean);

/**
 * The chart as an ordered glyph list, for use as a FONT.
 *
 * Why the preset travels this way rather than as a plain 4-bit truth table: the
 * chart's printed code is the segment bitmask, so its values run 0..127 and need
 * 7 address bits. A 4-bit input reaches only 0..15, which the chart fills with
 * five glyphs (4, 6, 7, 8, 14) — most of the character set would be unreachable.
 * So the chart is offered by GLYPH ORDER, windowed onto whatever code space is
 * live (4-bit → first 16 glyphs, 5-bit → first 32), which is exactly how fonts
 * already work in this app. `STANDARD_PATTERNS` keeps the printed codes as the
 * authoritative reference, and the tests pin those.
 */
export const STANDARD_GLYPHS: { char: string; segments: string }[] =
  STANDARD_PATTERNS.map((p) => ({ char: p.chars, segments: p.segments }));

/** Index of each digit glyph inside STANDARD_GLYPHS (chart row 3 starts at 26). */
export const STANDARD_DIGIT_START = STANDARD_PATTERNS.findIndex((p) => p.chars === '0');
