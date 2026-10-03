/**
 * Core type definitions for the 7-Segment Display Logic Simulator.
 *
 * Naming conventions (single source of truth):
 *  - Input variables, 4-bit mode: A B C D  (A = MSB, weight 8)
 *  - Input variables, 5-bit mode: A B C D E (A = MSB, weight 16)
 *    (names are editable in the truth table and persisted with the project)
 *  - Segment outputs: A B C D E F G + DP (decimal point), standard placement:
 *
 *        ── A ──
 *       │       │
 *       F       B
 *       │  ── G ──
 *       E       C
 *       │       │
 *        ── D ──   ● DP
 *
 *  - Truth-table cells may be 0, 1 or 'X' (don't care).
 */

export type SegmentName = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'DP';

export const SEGMENT_NAMES: readonly SegmentName[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'] as const;

export type SegmentOutput = 0 | 1 | 'X';

export type Bit = 0 | 1;

/** A full segment pattern: 1 = segment driven ON (logic level, before polarity). */
export type SegmentPattern = Record<SegmentName, Bit>;

/** A full segment pattern allowing don't-cares. */
export type SegmentPatternX = Record<SegmentName, SegmentOutput>;

export type InputWidth = 4 | 5;

export type DisplayMode = 'decimal' | 'hex' | 'binary' | 'custom' | 'raw' | 'font';

export type InvalidBehavior = 'blank' | 'dontcare' | 'custom';

export type ExpressionForm = 'sop' | 'pos' | 'csop' | 'cpos';

export type CoverForm = 'sop' | 'pos';

export interface TruthTableRow {
  /** Decimal value of the input combination (minterm index). */
  input: number;
  /** Output value for every segment (incl. DP). 'X' = don't care. */
  outputs: SegmentPatternX;
}

export interface TruthTable {
  inputBits: InputWidth;
  rows: TruthTableRow[];
}

export interface DisplaySettings {
  /** Color of lit segments (hex string). */
  activeColor: string;
  /** Color of unlit segments. */
  inactiveColor: string;
  /** Brightness multiplier 0.25..1 (affects fill opacity + glow). */
  brightness: number;
  /** true = common anode (active LOW drive), false = common cathode (active HIGH). */
  commonAnode: boolean;
  /** Invert the logic level before driving the display. */
  reverseLogic: boolean;
  /** Render the decimal point. */
  showDP: boolean;
  /** Italic skew of the digit (realism). */
  skew: boolean;
}

/** A single glyph of an importable font file. */
export interface FontGlyphData {
  char: string;
  segments: string;
}

/** A user-imported font (replaces the built-in chart font when present). */
export interface CustomFont {
  name: string;
  glyphs: FontGlyphData[];
}

/* ------------------------------------------------------------------ */
/* Preset library types                                                 */
/* ------------------------------------------------------------------ */

export type PresetKind = 'table' | 'font';

/** Categories shown in the preset gallery. */
export type PresetCategory = 'Digits' | 'Codes' | 'Letters' | 'Boundary' | 'User';

/** Generator identifiers of built-in table presets. 'literal' = exact stored table. */
export type PresetGenerator =
  | 'bcd' | 'hex' | 'font' | 'excess3' | 'gray' | 'aiken'
  | 'allon' | 'alloff' | 'literal';

/** Options a table preset may carry (restored on apply). */
export interface TablePresetOptions {
  /** First input code of the row order (font + code presets). */
  tableStartCode?: number;
  /** First glyph of the font window (font presets). */
  fontStart?: number;
  /** Invalid-input behavior applied when generating (bcd / hex / excess3 / aiken). */
  invalidBehavior?: InvalidBehavior;
}

/** A named truth-table preset: built-in generator or user-saved snapshot. */
export interface TablePresetDef {
  /** 'builtin:<name>' for built-ins, 'user:<uuid>' for user presets. */
  id: string;
  name: string;
  description?: string;
  category: PresetCategory;
  /** Width the preset is defined at (generators adapt to the live width). */
  inputBits: InputWidth;
  generator: PresetGenerator;
  options?: TablePresetOptions;
  /** Exact table — required for generator 'literal' (user presets). */
  table?: TruthTable;
  createdAt?: string;
  updatedAt?: string;
}

/** A named font: built-in (chart / calculator) or user-saved. */
export interface FontPresetDef {
  id: string;
  name: string;
  description?: string;
  /** true for built-in fonts (cannot be renamed/deleted). */
  builtin: boolean;
  glyphs: FontGlyphData[];
  createdAt?: string;
  updatedAt?: string;
}

/** The user's preset collection (persisted to localStorage + server). */
export interface PresetLibrary {
  tables: TablePresetDef[];
  fonts: FontPresetDef[];
}

/** Everything persisted with a project. */
export interface ProjectData {
  version: number;
  name: string;
  inputBits: InputWidth;
  displayMode: DisplayMode;
  invalidBehavior: InvalidBehavior;
  currentInput: number;
  truthTable: TruthTable;
  displaySettings: DisplaySettings;
  /** Per-segment lists of implicant keys (bits:mask) removed from the minimal cover. */
  coverExcluded: Partial<Record<SegmentName, Partial<Record<CoverForm, string[]>>>>;
  /** Per-segment lists of implicant keys added to the cover beyond the minimal one. */
  coverAdded: Partial<Record<SegmentName, Partial<Record<CoverForm, string[]>>>>;
  /** First input code of the truth table's row order (e.g. 1 → starts at 0001, wraps 0000 last). */
  tableStartCode?: number;
  /** Custom variable names, MSB first (A = MSB by default). Renamed in the truth table. */
  variableNames?: string[];
  /** Index of the first glyph of the font window (FONT preset). */
  fontStart?: number;
  /** User-imported font; when present it replaces the built-in chart font. */
  customFont?: CustomFont;
  /** Id of the table preset last applied (header indicator + reapply). */
  appliedPresetId?: string;
  /** Display name of the applied table preset. */
  appliedPresetName?: string;
  /** Id of the active font preset ('builtin:chart' | 'builtin:calculator' | 'user:…'). */
  activeFontId?: string;
}

/* ------------------------------------------------------------------ */
/* Minimizer / expression types                                        */
/* ------------------------------------------------------------------ */

/** A product (or sum) term cube: `bits` holds fixed variables, `mask` marks fixed positions. */
export interface Implicant {
  bits: number;
  mask: number;
}

export interface Literal {
  name: string;
  complemented: boolean;
}

/** A product term (SOP) or sum term (POS). literals.length === 0 means constant. */
export interface Term {
  literals: Literal[];
}

export interface PrimeInfo extends Implicant {
  key: string;
  /** Real minterms (output = 1, or 0 for POS form) covered by this implicant. */
  coveredOnes: number[];
  /** Don't-care minterms covered. */
  coveredDontCares: number[];
  literalCount: number;
  isEssential: boolean;
}

export interface MinimizeResult {
  /** All prime implicants of ones ∪ dontCares. */
  primes: PrimeInfo[];
  /** Minimal cover chosen by the solver (essential primes + exact cover completion). */
  cover: PrimeInfo[];
  /** Ones not covered by `cover` (empty when cover is complete). */
  uncovered: number[];
  /**
   * Whether `cover` is PROVEN minimal: the exact branch-and-bound search ran
   * to completion (or no search was needed — essentials alone cover, or the
   * function is constant 0). false = the search budget was exhausted, so a
   * greedy heuristic cover was returned instead (possible but not guaranteed
   * minimal). Never false for ≤ 5 variables in practice.
   */
  exact: boolean;
}

/** One highlighted group on the K-map. */
export interface KMapGroup {
  key: string;
  /** Cell coordinates covered by this group (includes don't-cares). */
  cells: { plane: number; row: number; col: number }[];
  mintermCells: number[];
  size: number;
  term: Term;
  coveredOnes: number[];
  coveredDontCares: number[];
  isEssential: boolean;
  /** Whether the prime belongs to the algorithmic minimal cover. */
  inMinimalCover: boolean;
  /** Whether the group is part of the user's active cover. */
  included: boolean;
  colorIndex: number;
  eliminatedVars: string[];
}

export interface KMapCell {
  plane: number;
  row: number;
  col: number;
  minterm: number;
  value: SegmentOutput;
}

export interface KMapData {
  numVars: number;
  rowVars: string[];
  colVars: string[];
  planeVar: string | null;
  /** planes[plane][row][col] */
  planes: KMapCell[][][];
  rowLabels: string[];
  colLabels: string[];
}

export type Notation = 'unicode' | 'ascii' | 'html' | 'verilog';

export interface ExpressionStats {
  terms: number;
  literals: number;
}

export interface SegmentEngine {
  segment: SegmentName;
  ones: number[];
  zeros: number[];
  dontCares: number[];
  sop: MinimizeResult;
  pos: MinimizeResult;
  sopGroups: KMapGroup[];
  posGroups: KMapGroup[];
  kmap: KMapData;
  /** Simplified SOP / POS terms (respecting cover exclusions). */
  activeSopTerms: Term[];
  activePosTerms: Term[];
  /** Minterms left uncovered after user exclusions. */
  uncoveredSop: number[];
  uncoveredPos: number[];
  stats: {
    canonicalSop: ExpressionStats;
    canonicalPos: ExpressionStats;
    simplifiedSop: ExpressionStats;
    simplifiedPos: ExpressionStats;
  };
}

// NOTE: REST DTOs (ProjectSummary etc.) live in ./api.ts — this file is the
// domain contract only.
