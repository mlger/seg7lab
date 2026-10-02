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
  type FontPresetDef,
  type InputWidth,
  type InvalidBehavior,
  type PresetKind,
  type PresetLibrary,
  type ProjectData,
  type SegmentName,
  type SegmentOutput,
  type SegmentPattern,
  type SegmentPatternX,
  type TablePresetDef,
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
import { FONT_GLYPHS, type FontGlyph, listedCodes } from '@/logic/font';
import {
  CALCULATOR_GLYPHS,
  buildPresetTable,
  findBuiltinFont,
  findBuiltinTablePreset,
  newUserId,
  parsePresetFile,
  presetDisplayMode,
  validateLibraryFontPreset,
  validateLibraryTablePreset,
} from '@/logic/presets';
import { patternToChar } from '@/logic/truthTable';
import { inputVarNames, maxvalue } from '@/utils/binary';
import type { CustomFont } from '@/types/simulator';

const WORKSPACE_KEY = 'sevenseg-workspace-v1';
const PRESET_LIB_KEY = 'sevenseg-presets-v1';

/** Sentinel font id meaning "the customFont blob is the active font" (legacy projects). */
const FONT_CUSTOM_SENTINEL = 'user:custom';

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
  /** One-shot server sync (merge server presets down, push local-only up). Call once on mount. */
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

/** Write the preset library to localStorage. */
function persistLibrary(library: PresetLibrary) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRESET_LIB_KEY, JSON.stringify(library));
  } catch {
    /* storage full — library stays in memory for this session */
  }
}

/** Load + validate the preset library from localStorage. */
function loadLibrary(): PresetLibrary {
  if (typeof window === 'undefined') return { tables: [], fonts: [] };
  try {
    const raw = window.localStorage.getItem(PRESET_LIB_KEY);
    if (!raw) return { tables: [], fonts: [] };
    const parsed = JSON.parse(raw) as { tables?: unknown; fonts?: unknown };
    const tables = Array.isArray(parsed.tables)
      ? parsed.tables.map(validateLibraryTablePreset).filter((t): t is TablePresetDef => t !== null)
      : [];
    const fonts = Array.isArray(parsed.fonts)
      ? parsed.fonts.map(validateLibraryFontPreset).filter((f): f is FontPresetDef => f !== null)
      : [];
    return { tables, fonts };
  } catch {
    return { tables: [], fonts: [] };
  }
}

/** Best-effort server sync of one library preset (fire and forget). */
async function apiUpsertPreset(def: TablePresetDef | FontPresetDef, kind: PresetKind): Promise<void> {
  try {
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: def.id, kind, name: def.name, data: def }),
    });
    if (res.status === 409) {
      await fetch(`/api/presets/${def.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: def.name, data: def }),
      });
    }
  } catch {
    /* offline — localStorage remains the source of truth */
  }
}

/** Resolve a table preset by id across built-ins and the user library. */
export function resolveTablePreset(id: string | null, library: PresetLibrary): TablePresetDef | null {
  if (!id) return null;
  return findBuiltinTablePreset(id) ?? library.tables.find((t) => t.id === id) ?? null;
}

/** Resolve a font preset by id across built-ins and the user library. */
export function resolveFontPreset(id: string, library: PresetLibrary): FontPresetDef | null {
  const builtin = findBuiltinFont(id);
  if (builtin) return builtin;
  return library.fonts.find((f) => f.id === id) ?? null;
}

/** Active font glyph list: builtin ids select builtin fonts; otherwise customFont wins. */
export function activeFontGlyphs(customFont: CustomFont | null, activeFontId = 'builtin:chart'): FontGlyph[] {
  if (activeFontId === 'builtin:calculator') return CALCULATOR_GLYPHS as FontGlyph[];
  if (activeFontId === 'builtin:chart') return FONT_GLYPHS;
  return customFont?.glyphs ?? FONT_GLYPHS;
}

/** Table presets that regenerate fully when the invalid-behavior setting changes. */
const BEHAVIOR_SENSITIVE = new Set(['bcd', 'hex', 'excess3', 'aiken']);

/** Synthesize the builtin table preset id/name implied by a display mode. */
function builtinForMode(mode: DisplayMode): { id: string; name: string } | null {
  if (mode === 'decimal') {
    const p = findBuiltinTablePreset('builtin:bcd')!;
    return { id: p.id, name: p.name };
  }
  if (mode === 'hex') {
    const p = findBuiltinTablePreset('builtin:hex')!;
    return { id: p.id, name: p.name };
  }
  if (mode === 'font') {
    const p = findBuiltinTablePreset('builtin:font')!;
    return { id: p.id, name: p.name };
  }
  return null;
}

/**
 * Make customFont / activeFontId / library consistent:
 * a user font id must have a library entry AND a customFont blob.
 * Returns the patch to apply (empty object when already consistent).
 */
function reconcileFont(
  customFont: CustomFont | null,
  activeFontId: string,
  library: PresetLibrary,
): { customFont?: CustomFont | null; activeFontId?: string; library?: PresetLibrary } {
  if (activeFontId === 'builtin:chart' || activeFontId === 'builtin:calculator') {
    return customFont ? { customFont: null } : {};
  }
  // user font id (or legacy sentinel)
  const entry = library.fonts.find((f) => f.id === activeFontId);
  if (entry) {
    if (customFont && customFont.name === entry.name
      && JSON.stringify(customFont.glyphs) === JSON.stringify(entry.glyphs)) return {};
    return { customFont: { name: entry.name, glyphs: entry.glyphs } };
  }
  // not in library — synthesize from customFont when possible
  if (customFont) {
    const id = activeFontId === FONT_CUSTOM_SENTINEL ? newUserId() : activeFontId;
    const def: FontPresetDef = {
      id,
      name: customFont.name,
      builtin: false,
      glyphs: customFont.glyphs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return {
      activeFontId: id,
      library: { tables: library.tables, fonts: [...library.fonts, def] },
    };
  }
  return { activeFontId: 'builtin:chart' };
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
  variableNames: inputVarNames(defaults.inputBits),
  fontStart: 0,
  customFont: null,
  activeFontId: 'builtin:chart',

  presetLibrary: { tables: [], fonts: [] },
  appliedPresetId: 'builtin:bcd',
  appliedPresetName: findBuiltinTablePreset('builtin:bcd')?.name ?? null,

  explainMode: false,
  activeSegment: 'A',
  expressionForm: 'sop',
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
    ...(get().customFont ? { customFont: get().customFont } : {}),
    ...(get().appliedPresetId ? { appliedPresetId: get().appliedPresetId } : {}),
    ...(get().appliedPresetName ? { appliedPresetName: get().appliedPresetName } : {}),
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
    const fontMode = get().displayMode === 'font';
    const applied = resolveTablePreset(get().appliedPresetId, get().presetLibrary);
    const regen = applied && ['excess3', 'gray', 'aiken', 'allon', 'alloff'].includes(applied.generator);
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

  setCustomFont: (font) => {
    // register the font in the library so it appears in the gallery
    const library = get().presetLibrary;
    const existing = library.fonts.find(
      (f) => f.name === font.name && JSON.stringify(f.glyphs) === JSON.stringify(font.glyphs),
    );
    const id = existing?.id ?? newUserId();
    const def: FontPresetDef = {
      id,
      name: font.name,
      builtin: false,
      glyphs: font.glyphs,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const nextLibrary = {
      tables: library.tables,
      fonts: existing
        ? library.fonts.map((f) => (f.id === id ? def : f))
        : [...library.fonts, def],
    };
    set({
      customFont: { name: font.name, glyphs: font.glyphs },
      activeFontId: id,
      presetLibrary: nextLibrary,
      fontStart: Math.min(get().fontStart, Math.max(0, font.glyphs.length - 1)),
      undoSnapshot: null,
      lastAction: `Imported font "${font.name}" (${font.glyphs.length} glyphs)`,
    });
    persistLibrary(nextLibrary);
    void apiUpsertPreset(def, 'font');
    if (get().displayMode === 'font') get().applyFontPreset();
    else persist(get());
  },

  clearCustomFont: () => {
    if (!get().customFont) return;
    set({
      customFont: null,
      activeFontId: 'builtin:chart',
      fontStart: Math.min(get().fontStart, FONT_GLYPHS.length - 1),
      undoSnapshot: null,
      lastAction: 'Restored built-in chart font (74 glyphs)',
    });
    if (get().displayMode === 'font') get().applyFontPreset();
    else persist(get());
  },

  /* ---- preset library ---- */

  applyPreset: (id) => {
    const preset = resolveTablePreset(id, get().presetLibrary);
    if (!preset) return;
    const glyphs = activeFontGlyphs(get().customFont, get().activeFontId);
    const behavior = preset.options?.invalidBehavior ?? get().invalidBehavior;
    const bits = preset.generator === 'literal' ? preset.inputBits : get().inputBits;
    const max = maxvalue(bits);
    const fontStart = preset.options?.fontStart ?? get().fontStart;
    const tableStartCode = Math.min(preset.options?.tableStartCode ?? get().tableStartCode, max);
    const effective: TablePresetDef = {
      ...preset,
      options: { ...preset.options, fontStart, tableStartCode },
    };
    const table = buildPresetTable(effective, bits, behavior, glyphs, get().truthTable);
    const mode = presetDisplayMode(preset);
    set({
      inputBits: bits,
      truthTable: table,
      displayMode: mode,
      invalidBehavior: behavior,
      tableStartCode,
      currentInput: Math.min(get().currentInput, max),
      appliedPresetId: preset.id,
      appliedPresetName: preset.name,
      coverExcluded: {},
      coverAdded: {},
      undoSnapshot: null,
      lastAction: `Preset applied: ${preset.name}`,
    });
    persist(get());
  },

  activateFont: (id) => {
    const font = resolveFontPreset(id, get().presetLibrary);
    if (!font) return;
    if (font.builtin) {
      set({
        customFont: null,
        activeFontId: font.id,
        fontStart: Math.min(get().fontStart, Math.max(0, font.glyphs.length - 1)),
        undoSnapshot: null,
        lastAction: `Font activated: ${font.name}`,
      });
      if (get().displayMode !== 'font') get().setDisplayMode('font');
      else get().applyFontPreset();
    } else {
      get().setCustomFont({ name: font.name, glyphs: font.glyphs });
      if (get().displayMode !== 'font') get().setDisplayMode('font');
      // setCustomFont re-applies the font table when already in font mode
    }
  },

  reapplyPreset: () => {
    const id = get().appliedPresetId;
    if (!id) return;
    get().applyPreset(id);
  },

  saveCurrentUserPreset: (name) => {
    const trimmed = name.trim().slice(0, 100);
    if (!trimmed) return false;
    const now = new Date().toISOString();
    const def: TablePresetDef = {
      id: newUserId(),
      name: trimmed,
      category: 'User',
      inputBits: get().inputBits,
      generator: 'literal',
      options: {
        tableStartCode: get().tableStartCode,
        invalidBehavior: get().invalidBehavior,
        ...(get().displayMode === 'font' ? { fontStart: get().fontStart } : {}),
      },
      table: get().truthTable,
      createdAt: now,
      updatedAt: now,
    };
    const library = get().presetLibrary;
    const next = { ...library, tables: [...library.tables, def] };
    set({
      presetLibrary: next,
      appliedPresetId: def.id,
      appliedPresetName: def.name,
      lastAction: `Preset saved: ${def.name}`,
    });
    persistLibrary(next);
    void apiUpsertPreset(def, 'table');
    persist(get());
    return true;
  },

  saveCurrentTableAsFont: (name) => {
    const trimmed = name.trim().slice(0, 100);
    if (!trimmed) return false;
    const { truthTable, inputBits, tableStartCode } = get();
    const codes = listedCodes(inputBits, tableStartCode);
    const glyphs = codes.map((code, i) => {
      const row = truthTable.rows.find((r) => r.input === code);
      const outputs = row?.outputs;
      const segments = outputs ? SEGMENT_NAMES.filter((s) => outputs[s] === 1).join('') : '';
      let char: string | null = null;
      if (outputs) {
        const bits = {} as SegmentPattern;
        for (const s of SEGMENT_NAMES) bits[s] = outputs[s] === 1 ? 1 : 0;
        char = patternToChar(bits);
      }
      return { char: char ?? `#${i}`, segments };
    });
    set({ fontStart: 0 });
    get().setCustomFont({ name: trimmed, glyphs });
    if (get().displayMode !== 'font') get().setDisplayMode('font');
    set({ lastAction: `Table saved as font: ${trimmed} (${glyphs.length} glyphs — X cells become unlit)` });
    return true;
  },

  renameUserPreset: (kind, id, name) => {
    const trimmed = name.trim().slice(0, 100);
    if (!trimmed) return;
    const library = get().presetLibrary;
    const now = new Date().toISOString();
    if (kind === 'table') {
      const def = library.tables.find((t) => t.id === id);
      if (!def) return;
      const next = { ...def, name: trimmed, updatedAt: now };
      const nextLib = { ...library, tables: library.tables.map((t) => (t.id === id ? next : t)) };
      set({
        presetLibrary: nextLib,
        ...(get().appliedPresetId === id ? { appliedPresetName: trimmed } : {}),
        lastAction: `Preset renamed to "${trimmed}"`,
      });
      persistLibrary(nextLib);
      void apiUpsertPreset(next, 'table');
    } else {
      const def = library.fonts.find((f) => f.id === id);
      if (!def) return;
      const next = { ...def, name: trimmed, updatedAt: now };
      const nextLib = { ...library, fonts: library.fonts.map((f) => (f.id === id ? next : f)) };
      const activePatch = get().activeFontId === id && get().customFont
        ? { customFont: { name: trimmed, glyphs: get().customFont!.glyphs } }
        : {};
      set({
        presetLibrary: nextLib,
        ...activePatch,
        lastAction: `Font preset renamed to "${trimmed}"`,
      });
      persistLibrary(nextLib);
      void apiUpsertPreset(next, 'font');
    }
    persist(get());
  },

  duplicateUserPreset: (kind, id) => {
    const library = get().presetLibrary;
    const now = new Date().toISOString();
    if (kind === 'table') {
      const def = library.tables.find((t) => t.id === id);
      if (!def) return;
      const copy: TablePresetDef = { ...def, id: newUserId(), name: `${def.name} (copy)`, createdAt: now, updatedAt: now };
      const nextLib = { ...library, tables: [...library.tables, copy] };
      set({ presetLibrary: nextLib, lastAction: `Preset duplicated: ${copy.name}` });
      persistLibrary(nextLib);
      void apiUpsertPreset(copy, 'table');
    } else {
      const def = library.fonts.find((f) => f.id === id);
      if (!def) return;
      const copy: FontPresetDef = { ...def, id: newUserId(), name: `${def.name} (copy)`, createdAt: now, updatedAt: now };
      const nextLib = { ...library, fonts: [...library.fonts, copy] };
      set({ presetLibrary: nextLib, lastAction: `Font preset duplicated: ${copy.name}` });
      persistLibrary(nextLib);
      void apiUpsertPreset(copy, 'font');
    }
  },

  deleteUserPreset: (kind, id) => {
    const library = get().presetLibrary;
    if (kind === 'table') {
      const def = library.tables.find((t) => t.id === id);
      if (!def) return;
      const nextLib = { ...library, tables: library.tables.filter((t) => t.id !== id) };
      set({
        presetLibrary: nextLib,
        ...(get().appliedPresetId === id ? { appliedPresetId: null, appliedPresetName: null } : {}),
        lastAction: `Preset deleted: ${def.name}`,
      });
      persistLibrary(nextLib);
    } else {
      const def = library.fonts.find((f) => f.id === id);
      if (!def) return;
      const nextLib = { ...library, fonts: library.fonts.filter((f) => f.id !== id) };
      const wasActive = get().activeFontId === id;
      set({
        presetLibrary: nextLib,
        ...(wasActive
          ? { customFont: null, activeFontId: 'builtin:chart', fontStart: Math.min(get().fontStart, FONT_GLYPHS.length - 1) }
          : {}),
        lastAction: `Font preset deleted: ${def.name}`,
      });
      if (wasActive && get().displayMode === 'font') get().applyFontPreset();
      persistLibrary(nextLib);
      persist(get());
    }
    void (async () => {
      try {
        await fetch(`/api/presets/${id}`, { method: 'DELETE' });
      } catch {
        /* offline — server copy will be re-synced later */
      }
    })();
  },

  importPresetFile: (raw) => {
    const res = parsePresetFile(raw);
    if (res.tablePreset) {
      const def = res.tablePreset;
      const library = get().presetLibrary;
      const nextLib = { ...library, tables: [...library.tables, def] };
      set({ presetLibrary: nextLib, lastAction: `Preset imported: ${def.name}` });
      persistLibrary(nextLib);
      void apiUpsertPreset(def, 'table');
      return { ok: res.ok, errors: res.errors, name: def.name, kind: 'table' as PresetKind };
    }
    if (res.fontPreset) {
      const def = res.fontPreset;
      const library = get().presetLibrary;
      const nextLib = { ...library, fonts: [...library.fonts, def] };
      set({ presetLibrary: nextLib, lastAction: `Font preset imported: ${def.name}` });
      persistLibrary(nextLib);
      void apiUpsertPreset(def, 'font');
      return { ok: res.ok, errors: res.errors, name: def.name, kind: 'font' as PresetKind };
    }
    return { ok: false, errors: res.errors };
  },

  syncPresetsFromServer: async () => {
    if (typeof window === 'undefined') return;
    // wait for hydration so the local library is loaded first
    for (let i = 0; i < 100 && !useSimulator.getState().hydrated; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    let rows: { id: string; kind: string; data: unknown; updatedAt?: string }[] = [];
    try {
      const res = await fetch('/api/presets?full=1');
      if (!res.ok) return;
      rows = await res.json();
    } catch {
      return; // offline — the local library stands
    }
    if (!Array.isArray(rows)) return;
    const lib = useSimulator.getState().presetLibrary;
    let tables = [...lib.tables];
    let fonts = [...lib.fonts];
    let changed = false;
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string') continue;
      if (row.kind !== 'table' && row.kind !== 'font') continue;
      seen.add(row.id);
      if (row.kind === 'table') {
        const def = validateLibraryTablePreset(row.data);
        if (!def) continue;
        const existing = tables.find((t) => t.id === row.id);
        if (!existing) {
          tables.push(def);
          changed = true;
        } else if ((existing.updatedAt ?? '') < (def.updatedAt ?? row.updatedAt ?? '')
          && JSON.stringify(existing) !== JSON.stringify(def)) {
          tables = tables.map((t) => (t.id === row.id ? def : t));
          changed = true;
        }
      } else {
        const def = validateLibraryFontPreset(row.data);
        if (!def) continue;
        const existing = fonts.find((f) => f.id === row.id);
        if (!existing) {
          fonts.push(def);
          changed = true;
        } else if ((existing.updatedAt ?? '') < (def.updatedAt ?? row.updatedAt ?? '')
          && JSON.stringify(existing) !== JSON.stringify(def)) {
          fonts = fonts.map((f) => (f.id === row.id ? def : f));
          changed = true;
        }
      }
    }
    // push local-only presets up to the server
    for (const t of tables) if (!seen.has(t.id)) void apiUpsertPreset(t, 'table');
    for (const f of fonts) if (!seen.has(f.id)) void apiUpsertPreset(f, 'font');
    if (changed) {
      const library = { tables, fonts };
      useSimulator.setState({ presetLibrary: library });
      persistLibrary(library);
    }
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
    const defaults = inputVarNames(get().inputBits);
    if (get().variableNames.join('') === defaults.join('')) return;
    set({ variableNames: defaults, lastAction: 'Variable names reset to defaults' });
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
