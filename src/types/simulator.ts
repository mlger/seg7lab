/**
 * Core type definitions for the 7-Segment Display Logic Simulator.
 *
 * Naming conventions (single source of truth):
 *  - Input variables, 4-bit mode: D C B A  (D = MSB, weight 8)
 *  - Input variables, 5-bit mode: E D C B A (E = MSB, weight 16)
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

export type DisplayMode = 'decimal' | 'hex' | 'binary' | 'custom' | 'raw';

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

export interface ProjectSummary {
  id: string;
  name: string;
  inputBits: number;
  createdAt: string;
  updatedAt: string;
}
