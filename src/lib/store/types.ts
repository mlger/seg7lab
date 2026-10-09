/**
 * The simulator store's public state + action contract.
 *
 * One flat Zustand state object remains the SINGLE SOURCE OF TRUTH (see
 * src/lib/store/index.ts for how the slices compose). Kept as one interface
 * — verbatim from the original monolith — so every consumer's selector and
 * the persisted JSON shape stay byte-identical.
 */
import type {
  CoverForm,
  CustomFont,
  DisplayMode,
  DisplaySettings,
  ExpressionForm,
  InputWidth,
  InvalidBehavior,
  PresetKind,
  PresetLibrary,
  ProjectData,
  SegmentName,
  SegmentPattern,
  SegmentPatternX,
  TruthTable,
} from '@/types/simulator';
import type { GateStyle } from '@/logic/circuitNetlist';

export interface SimulatorState {
  /* ---- project data (persisted) ---- */
  projectName: string;
  inputBits: InputWidth;
  displayMode: DisplayMode;
  invalidBehavior: InvalidBehavior;
  currentInput: number;
  truthTable: TruthTable;
  displaySettings: DisplaySettings;
  coverExcluded: ProjectData['coverExcluded'];
  coverAdded: ProjectData['coverAdded'];
  /** First input code of the truth table row order (0 default; e.g. 1 → starts at 0001). */
  tableStartCode: number;
  /** Variable names, MSB first (defaults A B C D / A B C D E; A = MSB). Editable in the truth table. */
  variableNames: string[];
  /** First glyph index of the font window (FONT preset). */
  fontStart: number;
  /** Imported font, when present (replaces the built-in chart font). */
  customFont: CustomFont | null;
  /** Id of the active font preset ('builtin:chart' | 'builtin:calculator' | 'user:…'). */
  activeFontId: string;

  /* ---- preset library (persisted separately + server-synced) ---- */
  presetLibrary: PresetLibrary;
  /** Id/name of the table preset currently applied (drives header indicator + reapply). */
  appliedPresetId: string | null;
  appliedPresetName: string | null;

  /* ---- UI state (session) ---- */
  explainMode: boolean;
  activeSegment: SegmentName;
  expressionForm: ExpressionForm;
  /** Gate implementation style of the circuit view (and of exports that
   *  follow it — the Falstad export). Lifted from LogicCircuitCard so the
   *  export menu can read it; session state like expressionForm. */
  circuitStyle: GateStyle;
  kmapShowMinterms: boolean;
  hydrated: boolean;
  lastAction: string | null;
  /** One-level undo snapshot for shift operations. */
  undoSnapshot: TruthTable | null;

  /* ---- actions ---- */
  hydrate: () => void;
  toProjectData: () => ProjectData;
  loadProject: (data: ProjectData) => void;
  resetProject: () => void;
  setProjectName: (name: string) => void;

  setInputBits: (bits: InputWidth) => void;
  setInput: (value: number) => void;
  toggleBit: (msbIndex: number) => void;
  incrementInput: () => void;
  decrementInput: () => void;

  /** Rename the variable at `index` (0 = MSB). Sanitized: A-Z, 0-9, _; ≤ 3 chars; unique. */
  setVariableName: (index: number, name: string) => void;
  /** Restore default variable names for the current input width. */
  resetVariableNames: () => void;

  setDisplayMode: (mode: DisplayMode) => void;
  setInvalidBehavior: (behavior: InvalidBehavior) => void;

  /** Font/window controls (FONT preset). */
  setTableStartCode: (code: number) => void;
  setFontStart: (index: number) => void;
  stepFontStart: (delta: number) => void;
  applyFontPreset: () => void;
  setCustomFont: (font: CustomFont) => void;
  clearCustomFont: () => void;

  /* ---- preset library ---- */
  /** Apply a table preset (builtin or user) — regenerates the truth table. */
  applyPreset: (id: string) => void;
  /** Activate a font preset (builtin or user) and switch to font display mode. */
  activateFont: (id: string) => void;
  /** Re-apply the currently applied table preset (revert manual edits). */
  reapplyPreset: () => void;
  /** Save the current truth table as a named user preset. */
  saveCurrentUserPreset: (name: string) => boolean;
  /** Convert the current truth table into a named font preset and activate it. */
  saveCurrentTableAsFont: (name: string) => boolean;
  renameUserPreset: (kind: PresetKind, id: string, name: string) => void;
  duplicateUserPreset: (kind: PresetKind, id: string) => void;
  deleteUserPreset: (kind: PresetKind, id: string) => void;
  /** Import a sevenseg-preset file into the library (does not apply). */
  importPresetFile: (raw: unknown) => { ok: boolean; errors: string[]; name?: string; kind?: PresetKind };
  /**
   * Server sync (merge server presets down by updatedAt, push local-only up).
   * Runs once on mount plus on window focus / preset-library storage events
   * (see attachPersistence); concurrent runs are deduped to one in-flight pass.
   */
  syncPresetsFromServer: () => Promise<void>;

  /** Shift (rotate) operations on the truth table with one-level undo. */
  shiftRow: (minterm: number, dir: 1 | -1) => void;
  shiftColumn: (segment: SegmentName, dir: 1 | -1) => void;
  shiftAllRows: (dir: 1 | -1) => void;
  shiftAllColumns: (dir: 1 | -1) => void;
  undoShift: () => void;

  cycleCell: (minterm: number, segment: SegmentName) => void;
  toggleSegmentOnDisplay: (minterm: number, segment: SegmentName) => void;
  setRowPattern: (minterm: number, pattern: SegmentPatternX | SegmentPattern) => void;

  updateDisplaySettings: (partial: Partial<DisplaySettings>) => void;
  resetDisplaySettings: () => void;

  setExplainMode: (on: boolean) => void;
  setActiveSegment: (segment: SegmentName) => void;
  setExpressionForm: (form: ExpressionForm) => void;
  setCircuitStyle: (style: GateStyle) => void;
  setKmapShowMinterms: (on: boolean) => void;

  /** Toggle a prime group in/out of the active cover (per form). */
  toggleCoverGroup: (segment: SegmentName, form: CoverForm, key: string, inMinimalCover: boolean) => void;
  resetCoverOverrides: (segment?: SegmentName) => void;
}

/** The workspace slice's state fields (project data + UI session state). */
export interface WorkspaceState {
  projectName: string;
  inputBits: InputWidth;
  displayMode: DisplayMode;
  invalidBehavior: InvalidBehavior;
  currentInput: number;
  truthTable: TruthTable;
  displaySettings: DisplaySettings;
  coverExcluded: ProjectData['coverExcluded'];
  coverAdded: ProjectData['coverAdded'];
  tableStartCode: number;
  variableNames: string[];
  fontStart: number;
  customFont: CustomFont | null;
  activeFontId: string;
  explainMode: boolean;
  activeSegment: SegmentName;
  expressionForm: ExpressionForm;
  circuitStyle: GateStyle;
  kmapShowMinterms: boolean;
  hydrated: boolean;
  lastAction: string | null;
  undoSnapshot: TruthTable | null;
}

/** The preset-library slice's state fields. */
export interface LibraryState {
  presetLibrary: PresetLibrary;
  appliedPresetId: string | null;
  appliedPresetName: string | null;
}
