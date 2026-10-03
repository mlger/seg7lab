/**
 * Decoder: reads the truth table for a given input and drives the physical display.
 * Handles common-anode / common-cathode polarity and reverse-logic configuration.
 */
import type {
  DisplaySettings,
  ProjectData,
  SegmentName,
  SegmentOutput,
} from '@/types/simulator';
import { presetTable } from './truthTable';

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  activeColor: '#ff2d2d',
  inactiveColor: '#3a1214',
  brightness: 0.95,
  commonAnode: false,
  reverseLogic: false,
  showDP: true,
  skew: true,
};

/**
 * Physical lighting rule:
 *   lit = output XOR reverseLogic XOR commonAnode
 *  - common cathode (commonAnode = false): segment lights when output = 1.
 *  - common anode  (commonAnode = true):  segment lights when output = 0 (active LOW).
 *  - reverseLogic flips the logical drive before polarity is applied.
 *  - don't-care (X) is undefined and never lights the segment.
 */
export function isSegmentLit(output: SegmentOutput, settings: DisplaySettings): boolean {
  if (output === 'X') return false;
  const drive = output === 1 !== settings.reverseLogic; // logical drive after reverse
  return drive !== settings.commonAnode; // physical LED state after polarity
}

/** A don't-care segment is "undefined" — rendered specially (dashed outline). */
export function isSegmentUndefined(output: SegmentOutput): boolean {
  return output === 'X';
}

/**
 * Default project name. Generic on purpose: the simulator covers any table
 * (hex, fonts, custom patterns), not just BCD — the default table merely
 * boots as the classic 0-9 decimal decoder.
 */
export const DEFAULT_PROJECT_NAME = '7-Segment Decoder (default)';

/** Default project: classic 0-9 decimal decoder, don't-cares for 10-15. */
export function buildDefaultProject(): ProjectData {
  const inputBits = 4;
  const table = presetTable(inputBits, 'decimal', 'dontcare');
  return {
    version: 1,
    name: DEFAULT_PROJECT_NAME,
    inputBits,
    displayMode: 'decimal',
    invalidBehavior: 'dontcare',
    currentInput: 8,
    truthTable: table,
    displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
    coverExcluded: {},
    coverAdded: {},
  };
}

/** Segment placement description used for a11y labels and education panels. */
export const SEGMENT_DESCRIPTIONS: Record<SegmentName, string> = {
  A: 'top horizontal',
  B: 'upper right vertical',
  C: 'lower right vertical',
  D: 'bottom horizontal',
  E: 'lower left vertical',
  F: 'upper left vertical',
  G: 'middle horizontal',
  DP: 'decimal point',
};
