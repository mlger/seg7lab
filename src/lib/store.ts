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
} from '@/logic/truthTable';
import { buildDefaultProject, DEFAULT_DISPLAY_SETTINGS } from '@/logic/decoder';
import { validateProject } from '@/logic/project';
import { maxvalue } from '@/utils/binary';

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

  /* ---- UI state (session) ---- */
  explainMode: boolean;
  activeSegment: SegmentName;
  expressionForm: ExpressionForm;
  kmapShowMinterms: boolean;
  hydrated: boolean;
  lastAction: string | null;

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

  explainMode: false,
  activeSegment: 'A',
  expressionForm: 'sop',
  kmapShowMinterms: false,
  hydrated: false,
  lastAction: null,

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
    set({
      inputBits: bits,
      truthTable: withBehavior,
      currentInput: Math.min(get().currentInput, maxvalue(bits)),
      lastAction: `Switched to ${bits}-bit input (E D C B A)`,
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
    const table = presetTable(get().inputBits, mode, get().invalidBehavior, get().truthTable);
    set({
      displayMode: mode,
      truthTable: table,
      lastAction:
        mode === 'decimal' ? 'Loaded BCD decimal preset (0-9)'
        : mode === 'hex' ? 'Loaded hexadecimal preset (0-F)'
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

  cycleCell: (minterm, segment) => {
    const table = get().truthTable;
    const row = table.rows.find((r) => r.input === minterm);
    if (!row) return;
    const current = row.outputs[segment];
    const next: SegmentOutput = current === 0 ? 1 : current === 1 ? 'X' : 0;
    set({ truthTable: ttSetCell(table, minterm, segment, next) });
    persist(get());
  },

  toggleSegmentOnDisplay: (minterm, segment) => {
    set({ truthTable: ttToggleSegment(get().truthTable, minterm, segment) });
    persist(get());
  },

  setRowPattern: (minterm, pattern) => {
    set({ truthTable: ttSetRow(get().truthTable, minterm, pattern) });
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
