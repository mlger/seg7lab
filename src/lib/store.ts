/**
 * The simulator store — SINGLE SOURCE OF TRUTH.
 *
 * Holds the editable truth table plus UI state. Every derived view
 * (7-seg display, K-map, expressions, logic circuit) is computed from here.
 */
'use client';

import { create } from 'zustand';
import {
  SEGMENT_NAMES,
  type CoverForm,
  type DisplayMode,
  type DisplaySettings,
  type ExpressionForm,
  type InputWidth,
  type InvalidBehavior,
  type ProjectData,
  type SegmentName,
  type SegmentOutput,
  type SegmentPattern,
  type SegmentPatternX,
  type TruthTable,
} from '@/types/simulator';
import {
  applyInvalidBehavior,
  presetTable,
  resizeTable,
  setCell as ttSetCell,
  setRow as ttSetRow,
  toggleSegment as ttToggleSegment,
  shiftRowValues as ttShiftRow,
  shiftColumnValues as ttShiftColumn,
  shiftAllRows as ttShiftAllRows,
  shiftAllColumns as ttShiftAllColumns,
} from '@/logic/truthTable';
import { buildDefaultProject, DEFAULT_DISPLAY_SETTINGS } from '@/logic/decoder';
import { validateProject } from '@/logic/project';
import { FONT_GLYPHS, type FontGlyph } from '@/logic/font';
import { maxvalue } from '@/utils/binary';
import type { CustomFont } from '@/types/simulator';

const WORKSPACE_KEY = 'sevenseg-workspace-v1';

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
  /** First glyph index of the font window (FONT preset). */
  fontStart: number;
  /** Imported font, when present (replaces the built-in chart font). */
  customFont: CustomFont | null;

  /* ---- UI state (session) ---- */
  explainMode: boolean;
  activeSegment: SegmentName;
  expressionForm: ExpressionForm;
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

  setDisplayMode: (mode: DisplayMode) => void;
  setInvalidBehavior: (behavior: InvalidBehavior) => void;

  /** Font/window controls (FONT preset). */
  setTableStartCode: (code: number) => void;
  setFontStart: (index: number) => void;
  stepFontStart: (delta: number) => void;
  applyFontPreset: () => void;
  setCustomFont: (font: CustomFont) => void;
  clearCustomFont: () => void;

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
  setKmapShowMinterms: (on: boolean) => void;

  /** Toggle a prime group in/out of the active cover (per form). */
  toggleCoverGroup: (segment: SegmentName, form: CoverForm, key: string, inMinimalCover: boolean) => void;
  resetCoverOverrides: (segment?: SegmentName) => void;
}

function persist(state: SimulatorState) {
  if (typeof window === 'undefined') return;
  try {
    const data = state.toProjectData();
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
  } catch {
    /* storage full / unavailable — demo continues in memory */
  }
}

/** Active font glyph list: imported font when present, else the built-in chart font. */
export function activeFontGlyphs(customFont: CustomFont | null): FontGlyph[] {
  return customFont?.glyphs ?? FONT_GLYPHS;
}

const defaults = buildDefaultProject();

export const useSimulator = create<SimulatorState>((set, get) => ({
  projectName: defaults.name,
  inputBits: defaults.inputBits,
  displayMode: defaults.displayMode,
  invalidBehavior: defaults.invalidBehavior,
  currentInput: defaults.currentInput,
  truthTable: defaults.truthTable,
  displaySettings: { ...defaults.displaySettings },
  coverExcluded: {},
  coverAdded: {},
  tableStartCode: 0,
  fontStart: 0,
  customFont: null,

  explainMode: false,
  activeSegment: 'A',
  expressionForm: 'sop',
  kmapShowMinterms: false,
  hydrated: false,
  lastAction: null,
  undoSnapshot: null,

  hydrate: () => {
    if (typeof window === 'undefined' || get().hydrated) return;
    try {
      const raw = window.localStorage.getItem(WORKSPACE_KEY);
      if (raw) {
        const parsed = validateProject(JSON.parse(raw));
        if (parsed.data) {
          set({
            projectName: parsed.data.name,
            inputBits: parsed.data.inputBits,
            displayMode: parsed.data.displayMode,
            invalidBehavior: parsed.data.invalidBehavior,
            currentInput: parsed.data.currentInput,
            truthTable: parsed.data.truthTable,
            displaySettings: parsed.data.displaySettings,
            coverExcluded: parsed.data.coverExcluded,
            coverAdded: parsed.data.coverAdded ?? {},
            tableStartCode: parsed.data.tableStartCode ?? 0,
            fontStart: parsed.data.fontStart ?? 0,
            customFont: parsed.data.customFont ?? null,
            hydrated: true,
          });
          return;
        }
      }
    } catch {
      /* corrupted workspace — fall back to defaults */
    }
    set({ hydrated: true });
  },

  toProjectData: () => ({
    version: 1,
    name: get().projectName,
    inputBits: get().inputBits,
    displayMode: get().displayMode,
    invalidBehavior: get().invalidBehavior,
    currentInput: get().currentInput,
    truthTable: get().truthTable,
    displaySettings: get().displaySettings,
    coverExcluded: get().coverExcluded,
    coverAdded: get().coverAdded,
    tableStartCode: get().tableStartCode,
    fontStart: get().fontStart,
    ...(get().customFont ? { customFont: get().customFont } : {}),
  }),

  loadProject: (data) => {
    set({
      projectName: data.name,
      inputBits: data.inputBits,
      displayMode: data.displayMode,
      invalidBehavior: data.invalidBehavior,
      currentInput: data.currentInput,
      truthTable: data.truthTable,
      displaySettings: data.displaySettings,
      coverExcluded: data.coverExcluded ?? {},
      coverAdded: data.coverAdded ?? {},
      tableStartCode: data.tableStartCode ?? 0,
      fontStart: data.fontStart ?? 0,
      customFont: data.customFont ?? null,
      undoSnapshot: null,
      lastAction: `Loaded project "${data.name}"`,
    });
    persist(get());
  },

  resetProject: () => {
    const d = buildDefaultProject();
    set({
      projectName: d.name,
      inputBits: d.inputBits,
      displayMode: d.displayMode,
      invalidBehavior: d.invalidBehavior,
      currentInput: d.currentInput,
      truthTable: d.truthTable,
      displaySettings: { ...d.displaySettings },
      coverExcluded: {},
      coverAdded: {},
      tableStartCode: 0,
      fontStart: 0,
      customFont: null,
      undoSnapshot: null,
      lastAction: 'Project reset to default BCD decoder',
    });
    persist(get());
  },

  setProjectName: (name) => {
    set({ projectName: name.trim().slice(0, 100) || 'Untitled project' });
    persist(get());
  },

  setInputBits: (bits) => {
    if (bits === get().inputBits) return;
    const resized = resizeTable(get().truthTable, bits);
    const withBehavior = applyInvalidBehavior(resized, get().displayMode, get().invalidBehavior);
    const fontMode = get().displayMode === 'font';
    const table = fontMode
      ? presetTable(bits, 'font', get().invalidBehavior, undefined, {
          fontStart: get().fontStart,
          tableStartCode: get().tableStartCode,
          glyphs: activeFontGlyphs(get().customFont),
        })
      : withBehavior;
    const max = maxvalue(bits);
    set({
      inputBits: bits,
      truthTable: table,
      currentInput: Math.min(get().currentInput, max),
      tableStartCode: Math.min(get().tableStartCode, max),
      undoSnapshot: null,
      lastAction: `Switched to ${bits}-bit input (${bits === 5 ? 'E D C B A' : 'D C B A'})`,
    });
    persist(get());
  },

  setInput: (value) => {
    const max = maxvalue(get().inputBits);
    const v = Math.min(Math.max(0, Math.round(value)), max);
    if (v !== get().currentInput) set({ currentInput: v });
  },

  toggleBit: (msbIndex) => {
    const { currentInput, inputBits } = get();
    const bitPos = inputBits - 1 - msbIndex; // convert MSB index to weight
    const next = currentInput ^ (1 << bitPos);
    set({ currentInput: next });
  },

  incrementInput: () => {
    const { currentInput, inputBits } = get();
    const max = maxvalue(inputBits);
    set({ currentInput: currentInput >= max ? 0 : currentInput + 1 });
  },

  decrementInput: () => {
    const { currentInput, inputBits } = get();
    const max = maxvalue(inputBits);
    set({ currentInput: currentInput <= 0 ? max : currentInput - 1 });
  },

  setDisplayMode: (mode) => {
    const prev = get().displayMode;
    if (prev === mode) return;
    const table = mode === 'font'
      ? presetTable(get().inputBits, 'font', get().invalidBehavior, undefined, {
          fontStart: get().fontStart,
          tableStartCode: get().tableStartCode,
          glyphs: activeFontGlyphs(get().customFont),
        })
      : presetTable(get().inputBits, mode, get().invalidBehavior, get().truthTable);
    set({
      displayMode: mode,
      truthTable: table,
      coverExcluded: mode === 'font' || mode === 'decimal' || mode === 'hex' ? {} : get().coverExcluded,
      undoSnapshot: null,
      lastAction:
        mode === 'decimal' ? 'Loaded BCD decimal preset (0-9)'
        : mode === 'hex' ? 'Loaded hexadecimal preset (0-F)'
        : mode === 'font' ? `Loaded ASCII font preset (${activeFontGlyphs(get().customFont).length} glyphs)`
        : mode === 'binary' ? 'Binary bit-strip display mode'
        : mode === 'custom' ? 'Custom character mode — edit any row'
        : 'Raw segment mode — display shows truth-table outputs directly',
    });
    persist(get());
  },

  setInvalidBehavior: (behavior) => {
    if (behavior === get().invalidBehavior) return;
    const table = applyInvalidBehavior(get().truthTable, get().displayMode, behavior);
    set({
      invalidBehavior: behavior,
      truthTable: table,
      lastAction:
        behavior === 'blank' ? 'Invalid BCD inputs (1010-1111+) now BLANK'
        : behavior === 'dontcare' ? 'Invalid BCD inputs (1010-1111+) now DON\'T CARE (X)'
        : 'Invalid BCD inputs kept as custom patterns',
    });
    persist(get());
  },

  /* ---- font / table-order controls ---- */

  setTableStartCode: (code) => {
    const max = maxvalue(get().inputBits);
    const v = Math.min(Math.max(0, Math.round(code)), max);
    if (v === get().tableStartCode) return;
    const fontMode = get().displayMode === 'font';
    const table = fontMode
      ? presetTable(get().inputBits, 'font', get().invalidBehavior, undefined, {
          fontStart: get().fontStart,
          tableStartCode: v,
          glyphs: activeFontGlyphs(get().customFont),
        })
      : get().truthTable; // non-font modes: row order only (logic unchanged)
    set({
      tableStartCode: v,
      truthTable: table,
      ...(fontMode ? { coverExcluded: {}, coverAdded: {} } : {}),
      undoSnapshot: null,
      lastAction: fontMode
        ? `Font mapping now starts at code ${v.toString(2).padStart(get().inputBits, '0')} (preset re-applied)`
        : `Truth table row order now starts at ${v.toString(2).padStart(get().inputBits, '0')}`,
    });
    persist(get());
  },

  setFontStart: (index) => {
    const glyphs = activeFontGlyphs(get().customFont);
    const v = ((Math.round(index) % glyphs.length) + glyphs.length) % glyphs.length;
    if (v === get().fontStart) return;
    set({ fontStart: v });
    if (get().displayMode === 'font') get().applyFontPreset();
    else persist(get());
  },

  stepFontStart: (delta) => {
    const glyphs = activeFontGlyphs(get().customFont);
    get().setFontStart(get().fontStart + delta);
    set({
      lastAction: `Font window: ${glyphs[get().fontStart]?.char ?? '?'} (index ${get().fontStart} of ${glyphs.length})`,
    });
    persist(get());
  },

  applyFontPreset: () => {
    const table = presetTable(get().inputBits, 'font', get().invalidBehavior, undefined, {
      fontStart: get().fontStart,
      tableStartCode: get().tableStartCode,
      glyphs: activeFontGlyphs(get().customFont),
    });
    set({
      truthTable: table,
      coverExcluded: {},
      coverAdded: {},
      undoSnapshot: null,
      lastAction: `Font preset re-applied (window from "${activeFontGlyphs(get().customFont)[get().fontStart]?.char ?? '?'}")`,
    });
    persist(get());
  },

  setCustomFont: (font) => {
    set({
      customFont: font,
      fontStart: Math.min(get().fontStart, Math.max(0, font.glyphs.length - 1)),
      undoSnapshot: null,
      lastAction: `Imported font "${font.name}" (${font.glyphs.length} glyphs)`,
    });
    if (get().displayMode === 'font') get().applyFontPreset();
    else persist(get());
  },

  clearCustomFont: () => {
    if (!get().customFont) return;
    set({
      customFont: null,
      fontStart: Math.min(get().fontStart, FONT_GLYPHS.length - 1),
      undoSnapshot: null,
      lastAction: 'Restored built-in chart font (74 glyphs)',
    });
    if (get().displayMode === 'font') get().applyFontPreset();
    else persist(get());
  },

  /* ---- shift operations (with one-level undo) ---- */

  shiftRow: (minterm, dir) => {
    const prev = get().truthTable;
    const next = ttShiftRow(prev, minterm, dir);
    set({
      truthTable: next,
      undoSnapshot: prev,
      lastAction: `Row m${minterm}: values rotated ${dir === 1 ? 'right (A→B→…→DP)' : 'left (DP→…→B→A)'}`,
    });
    persist(get());
  },

  shiftColumn: (segment, dir) => {
    const prev = get().truthTable;
    const next = ttShiftColumn(prev, segment, dir, get().tableStartCode);
    set({
      truthTable: next,
      undoSnapshot: prev,
      lastAction: `Column ${segment}: values rotated ${dir === 1 ? 'down' : 'up'} across all rows`,
    });
    persist(get());
  },

  shiftAllRows: (dir) => {
    const prev = get().truthTable;
    const next = ttShiftAllRows(prev, dir, get().tableStartCode);
    set({
      truthTable: next,
      undoSnapshot: prev,
      lastAction: `All rows: patterns rotated ${dir === 1 ? 'down' : 'up'} one position (wrap-around)`,
    });
    persist(get());
  },

  shiftAllColumns: (dir) => {
    const prev = get().truthTable;
    const next = ttShiftAllColumns(prev, dir, get().tableStartCode);
    set({
      truthTable: next,
      undoSnapshot: prev,
      lastAction: `All columns: values rotated ${dir === 1 ? 'down' : 'up'} one position (wrap-around)`,
    });
    persist(get());
  },

  undoShift: () => {
    const snap = get().undoSnapshot;
    if (!snap) return;
    set({
      truthTable: snap,
      undoSnapshot: null,
      lastAction: 'Shift undone — table restored',
    });
    persist(get());
  },

  cycleCell: (minterm, segment) => {
    const table = get().truthTable;
    const row = table.rows.find((r) => r.input === minterm);
    if (!row) return;
    const current = row.outputs[segment];
    const next: SegmentOutput = current === 0 ? 1 : current === 1 ? 'X' : 0;
    set({ truthTable: ttSetCell(table, minterm, segment, next), undoSnapshot: null });
    persist(get());
  },

  toggleSegmentOnDisplay: (minterm, segment) => {
    set({ truthTable: ttToggleSegment(get().truthTable, minterm, segment), undoSnapshot: null });
    persist(get());
  },

  setRowPattern: (minterm, pattern) => {
    set({ truthTable: ttSetRow(get().truthTable, minterm, pattern), undoSnapshot: null });
    persist(get());
  },

  updateDisplaySettings: (partial) => {
    set({ displaySettings: { ...get().displaySettings, ...partial } });
    persist(get());
  },

  resetDisplaySettings: () => {
    set({ displaySettings: { ...DEFAULT_DISPLAY_SETTINGS } });
    persist(get());
  },

  setExplainMode: (on) => set({ explainMode: on }),
  setActiveSegment: (segment) => set({ activeSegment: segment }),
  setExpressionForm: (form) => set({ expressionForm: form }),
  setKmapShowMinterms: (on) => set({ kmapShowMinterms: on }),

  toggleCoverGroup: (segment, form, key, inMinimalCover) => {
    const excluded = get().coverExcluded[segment]?.[form] ?? [];
    const added = get().coverAdded[segment]?.[form] ?? [];
    const nextExcluded = excluded.includes(key)
      ? excluded.filter((k) => k !== key)
      : inMinimalCover
        ? [...excluded, key]
        : excluded;
    const nextAdded = added.includes(key)
      ? added.filter((k) => k !== key)
      : inMinimalCover
        ? added
        : [...added, key];
    set({
      coverExcluded: {
        ...get().coverExcluded,
        [segment]: { ...(get().coverExcluded[segment] ?? {}), [form]: nextExcluded },
      },
      coverAdded: {
        ...get().coverAdded,
        [segment]: { ...(get().coverAdded[segment] ?? {}), [form]: nextAdded },
      },
    });
    persist(get());
  },

  resetCoverOverrides: (segment) => {
    if (!segment) {
      set({ coverExcluded: {}, coverAdded: {} });
    } else {
      const ex = { ...get().coverExcluded };
      delete ex[segment];
      const ad = { ...get().coverAdded };
      delete ad[segment];
      set({ coverExcluded: ex, coverAdded: ad });
    }
    persist(get());
  },
}));

/** Subscribe once from a client component to persist every change (debounced). */
export function attachPersistence() {
  if (typeof window === 'undefined') return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useSimulator.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persist(useSimulator.getState()), 250);
  });
  return unsub;
}

export { SEGMENT_NAMES };
