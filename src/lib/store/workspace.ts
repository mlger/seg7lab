/**
 * Workspace slice — the project data + UI session state.
 *
 * Everything here is moved VERBATIM from the original store monolith: same
 * field defaults, same action bodies, same lastAction strings, same persist()
 * call sites. Only the module boundaries changed.
 *
 * The truth table is the app's single source of truth; every action that
 * touches it goes through this slice (or regenerates it via preset logic in
 * the library slice).
 */
import { type StateCreator } from 'zustand';
import type {
  CoverForm,
  InputWidth,
  ProjectData,
  SegmentName,
  SegmentOutput,
  SegmentPattern,
  SegmentPatternX,
  TruthTable,
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
import { buildPresetTable, findBuiltinTablePreset } from '@/logic/presets';
import { inputVarNames, maxvalue } from '@/logic/binary';
import type { SimulatorState } from './types';
import { loadLibrary, persist, WORKSPACE_KEY } from './persistence';
import {
  activeFontGlyphs,
  builtinForMode,
  BEHAVIOR_SENSITIVE,
  FONT_CUSTOM_SENTINEL,
  reconcileFont,
  resolveTablePreset,
} from './presets';

/** The workspace slice's fields + actions (see SimulatorState for docs). */
export interface WorkspaceSlice {
  projectName: string;
  inputBits: InputWidth;
  displayMode: SimulatorState['displayMode'];
  invalidBehavior: SimulatorState['invalidBehavior'];
  currentInput: number;
  truthTable: TruthTable;
  displaySettings: SimulatorState['displaySettings'];
  coverExcluded: ProjectData['coverExcluded'];
  coverAdded: ProjectData['coverAdded'];
  tableStartCode: number;
  variableNames: string[];
  fontStart: number;
  customFont: SimulatorState['customFont'];
  activeFontId: string;
  explainMode: boolean;
  activeSegment: SegmentName;
  expressionForm: SimulatorState['expressionForm'];
  circuitStyle: SimulatorState['circuitStyle'];
  kmapShowMinterms: boolean;
  hydrated: boolean;
  lastAction: string | null;
  undoSnapshot: TruthTable | null;

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

  setVariableName: (index: number, name: string) => void;
  resetVariableNames: () => void;

  setDisplayMode: (mode: SimulatorState['displayMode']) => void;
  setInvalidBehavior: (behavior: SimulatorState['invalidBehavior']) => void;

  setTableStartCode: (code: number) => void;
  setFontStart: (index: number) => void;
  stepFontStart: (delta: number) => void;
  applyFontPreset: () => void;

  shiftRow: (minterm: number, dir: 1 | -1) => void;
  shiftColumn: (segment: SegmentName, dir: 1 | -1) => void;
  shiftAllRows: (dir: 1 | -1) => void;
  shiftAllColumns: (dir: 1 | -1) => void;
  undoShift: () => void;

  cycleCell: (minterm: number, segment: SegmentName) => void;
  toggleSegmentOnDisplay: (minterm: number, segment: SegmentName) => void;
  setRowPattern: (minterm: number, pattern: SegmentPatternX | SegmentPattern) => void;

  updateDisplaySettings: (partial: Partial<SimulatorState['displaySettings']>) => void;
  resetDisplaySettings: () => void;

  setExplainMode: (on: boolean) => void;
  setActiveSegment: (segment: SegmentName) => void;
  setExpressionForm: (form: SimulatorState['expressionForm']) => void;
  setCircuitStyle: (style: SimulatorState['circuitStyle']) => void;
  setKmapShowMinterms: (on: boolean) => void;

  toggleCoverGroup: (
    segment: SegmentName,
    form: CoverForm,
    key: string,
    inMinimalCover: boolean,
  ) => void;
  resetCoverOverrides: (segment?: SegmentName) => void;
}

const defaults = buildDefaultProject();

export const createWorkspaceSlice: StateCreator<SimulatorState, [], [], WorkspaceSlice> = (set, get) => ({
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
  variableNames: inputVarNames(defaults.inputBits),
  fontStart: 0,
  customFont: null,
  activeFontId: 'builtin:chart',

  explainMode: false,
  activeSegment: 'A',
  expressionForm: 'sop',
  circuitStyle: 'basic',
  kmapShowMinterms: false,
  hydrated: false,
  lastAction: null,
  undoSnapshot: null,

  hydrate: () => {
    if (typeof window === 'undefined' || get().hydrated) return;
    const library = loadLibrary();
    try {
      const raw = window.localStorage.getItem(WORKSPACE_KEY);
      if (raw) {
        const parsed = validateProject(JSON.parse(raw));
        if (parsed.data) {
          const data = parsed.data;
          const activeFontId = data.activeFontId
            ?? (data.customFont ? FONT_CUSTOM_SENTINEL : 'builtin:chart');
          const fontPatch = reconcileFont(data.customFont ?? null, activeFontId, library);
          const modePreset = data.appliedPresetId
            ? null
            : builtinForMode(data.displayMode);
          set({
            projectName: data.name,
            inputBits: data.inputBits,
            displayMode: data.displayMode,
            invalidBehavior: data.invalidBehavior,
            currentInput: data.currentInput,
            truthTable: data.truthTable,
            displaySettings: data.displaySettings,
            coverExcluded: data.coverExcluded,
            coverAdded: data.coverAdded ?? {},
            tableStartCode: data.tableStartCode ?? 0,
            variableNames: data.variableNames ?? inputVarNames(data.inputBits),
            fontStart: data.fontStart ?? 0,
            customFont: 'customFont' in fontPatch ? fontPatch.customFont! : (data.customFont ?? null),
            activeFontId: fontPatch.activeFontId ?? activeFontId,
            presetLibrary: fontPatch.library ?? library,
            appliedPresetId: data.appliedPresetId ?? modePreset?.id ?? null,
            appliedPresetName: data.appliedPresetName ?? modePreset?.name ?? null,
            hydrated: true,
          });
          return;
        }
      }
    } catch {
      /* corrupted workspace — fall back to defaults */
    }
    set({ hydrated: true, presetLibrary: library });
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
    variableNames: get().variableNames,
    fontStart: get().fontStart,
    ...(get().customFont ? { customFont: get().customFont ?? undefined } : {}),
    ...(get().appliedPresetId ? { appliedPresetId: get().appliedPresetId ?? undefined } : {}),
    ...(get().appliedPresetName ? { appliedPresetName: get().appliedPresetName ?? undefined } : {}),
    activeFontId: get().activeFontId,
  }),

  loadProject: (data) => {
    const library = get().presetLibrary;
    const activeFontId = data.activeFontId
      ?? (data.customFont ? FONT_CUSTOM_SENTINEL : 'builtin:chart');
    const fontPatch = reconcileFont(data.customFont ?? null, activeFontId, library);
    const modePreset = data.appliedPresetId ? null : builtinForMode(data.displayMode);
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
      variableNames: data.variableNames ?? inputVarNames(data.inputBits),
      fontStart: data.fontStart ?? 0,
      customFont: 'customFont' in fontPatch ? fontPatch.customFont! : (data.customFont ?? null),
      activeFontId: fontPatch.activeFontId ?? activeFontId,
      presetLibrary: fontPatch.library ?? library,
      appliedPresetId: data.appliedPresetId ?? modePreset?.id ?? null,
      appliedPresetName: data.appliedPresetName ?? modePreset?.name ?? null,
      undoSnapshot: null,
      lastAction: `Loaded project "${data.name}"`,
    });
    persist(get());
  },

  resetProject: () => {
    const d = buildDefaultProject();
    const bcd = findBuiltinTablePreset('builtin:bcd')!;
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
      variableNames: inputVarNames(d.inputBits),
      fontStart: 0,
      customFont: null,
      activeFontId: 'builtin:chart',
      appliedPresetId: bcd.id,
      appliedPresetName: bcd.name,
      undoSnapshot: null,
      lastAction: 'Project reset to the default decoder',
    });
    persist(get());
  },

  setProjectName: (name) => {
    set({ projectName: name.trim().slice(0, 100) || 'Untitled project' });
    persist(get());
  },

  setInputBits: (bits) => {
    if (bits === get().inputBits) return;
    const fontMode = get().displayMode === 'font';
    const applied = resolveTablePreset(get().appliedPresetId, get().presetLibrary);
    const regen = applied && ['excess3', 'gray', 'aiken', 'standard7', 'roman', 'allon', 'alloff'].includes(applied.generator);
    let table: TruthTable;
    if (fontMode) {
      table = presetTable(bits, 'font', get().invalidBehavior, undefined, {
        fontStart: get().fontStart,
        tableStartCode: get().tableStartCode,
        glyphs: activeFontGlyphs(get().customFont, get().activeFontId),
      });
    } else if (regen && applied) {
      table = buildPresetTable(applied, bits, get().invalidBehavior, activeFontGlyphs(get().customFont, get().activeFontId));
    } else {
      const resized = resizeTable(get().truthTable, bits);
      table = applyInvalidBehavior(resized, get().displayMode, get().invalidBehavior);
    }
    const max = maxvalue(bits);
    set({
      inputBits: bits,
      truthTable: table,
      currentInput: Math.min(get().currentInput, max),
      tableStartCode: Math.min(get().tableStartCode, max),
      variableNames: inputVarNames(bits),
      undoSnapshot: null,
      lastAction: `Switched to ${bits}-bit input (${inputVarNames(bits).join(' ')})`,
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
          glyphs: activeFontGlyphs(get().customFont, get().activeFontId),
        })
      : presetTable(get().inputBits, mode, get().invalidBehavior, get().truthTable);
    const implied = builtinForMode(mode);
    set({
      displayMode: mode,
      truthTable: table,
      coverExcluded: mode === 'font' || mode === 'decimal' || mode === 'hex' ? {} : get().coverExcluded,
      undoSnapshot: null,
      appliedPresetId: implied?.id ?? null,
      appliedPresetName: implied?.name ?? null,
      lastAction:
        mode === 'decimal' ? 'Loaded BCD decimal preset (0-9)'
        : mode === 'hex' ? 'Loaded hexadecimal preset (0-F)'
        : mode === 'font' ? `Loaded ASCII font preset (${activeFontGlyphs(get().customFont, get().activeFontId).length} glyphs)`
        : mode === 'binary' ? 'Binary bit-strip display mode'
        : mode === 'custom' ? 'Custom character mode — edit any row'
        : 'Raw segment mode — display shows truth-table outputs directly',
    });
    persist(get());
  },

  setInvalidBehavior: (behavior) => {
    if (behavior === get().invalidBehavior) return;
    const applied = resolveTablePreset(get().appliedPresetId, get().presetLibrary);
    const table = applied && BEHAVIOR_SENSITIVE.has(applied.generator)
      ? buildPresetTable(
          { ...applied, options: { ...applied.options, invalidBehavior: undefined } },
          get().inputBits,
          behavior,
          activeFontGlyphs(get().customFont, get().activeFontId),
          get().truthTable,
        )
      : applyInvalidBehavior(get().truthTable, get().displayMode, behavior);
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
          glyphs: activeFontGlyphs(get().customFont, get().activeFontId),
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
    const glyphs = activeFontGlyphs(get().customFont, get().activeFontId);
    const v = ((Math.round(index) % glyphs.length) + glyphs.length) % glyphs.length;
    if (v === get().fontStart) return;
    set({ fontStart: v });
    if (get().displayMode === 'font') get().applyFontPreset();
    else persist(get());
  },

  stepFontStart: (delta) => {
    const glyphs = activeFontGlyphs(get().customFont, get().activeFontId);
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
      glyphs: activeFontGlyphs(get().customFont, get().activeFontId),
    });
    set({
      truthTable: table,
      coverExcluded: {},
      coverAdded: {},
      undoSnapshot: null,
      appliedPresetId: 'builtin:font',
      appliedPresetName: findBuiltinTablePreset('builtin:font')?.name ?? 'ASCII Chart Font',
      lastAction: `Font preset re-applied (window from "${activeFontGlyphs(get().customFont, get().activeFontId)[get().fontStart]?.char ?? '?'}")`,
    });
    persist(get());
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

  setVariableName: (index, name) => {
    const names = get().variableNames;
    const clean = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 3);
    if (
      index < 0 || index >= names.length || !clean
      || names.some((n, i) => i !== index && n === clean)
    ) return;
    if (names[index] === clean) return;
    set({
      variableNames: names.map((n, i) => (i === index ? clean : n)),
      lastAction: `Renamed input variable ${names[index]} → ${clean}`,
    });
    persist(get());
  },

  resetVariableNames: () => {
    const defaultNames = inputVarNames(get().inputBits);
    if (get().variableNames.join('') === defaultNames.join('')) return;
    set({ variableNames: defaultNames, lastAction: 'Variable names reset to defaults' });
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
  setCircuitStyle: (style) => set({ circuitStyle: style }),
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
});
