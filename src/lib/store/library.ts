/**
 * Preset-library slice — the user preset library, font activation and the
 * server-sync facade.
 *
 * Everything here is moved VERBATIM from the original store monolith. The
 * only structural change: the fetch/merge/reconcile sync machinery now lives
 * in src/lib/preset-sync.ts (injected here as {@link PresetSyncEngine} via
 * the lazy `getEngine` thunk wired in index.ts — the engine needs the store,
 * the store needs the engine, so construction happens in two phases).
 */
import { type StateCreator } from 'zustand';
import type {
  CustomFont,
  FontPresetDef,
  PresetKind,
  PresetLibrary,
  SegmentPattern,
  TablePresetDef,
} from '@/types/simulator';
import { SEGMENT_NAMES } from '@/types/simulator';
import { patternToChar } from '@/logic/truthTable';
import { FONT_GLYPHS } from '@/logic/font';
import { listedCodes } from '@/logic/font';
import {
  buildPresetTable,
  findBuiltinTablePreset,
  newUserId,
  parsePresetFile,
  presetDisplayMode,
} from '@/logic/presets';
import { maxvalue } from '@/logic/binary';
import type { SimulatorState } from './types';
import { persist, persistLibrary } from './persistence';
import {
  activeFontGlyphs,
  resolveFontPreset,
  resolveTablePreset,
} from './presets';
import type { PresetSyncEngine } from '@/lib/preset-sync';

/** The library slice's fields + actions (see SimulatorState for docs). */
export interface LibrarySlice {
  presetLibrary: PresetLibrary;
  appliedPresetId: string | null;
  appliedPresetName: string | null;

  setCustomFont: (font: CustomFont) => void;
  clearCustomFont: () => void;

  applyPreset: (id: string) => void;
  activateFont: (id: string) => void;
  reapplyPreset: () => void;
  saveCurrentUserPreset: (name: string) => boolean;
  saveCurrentTableAsFont: (name: string) => boolean;
  renameUserPreset: (kind: PresetKind, id: string, name: string) => void;
  duplicateUserPreset: (kind: PresetKind, id: string) => void;
  deleteUserPreset: (kind: PresetKind, id: string) => void;
  importPresetFile: (raw: unknown) => { ok: boolean; errors: string[]; name?: string; kind?: PresetKind };
  syncPresetsFromServer: () => Promise<void>;
}

/**
 * Build the library slice.
 *
 * @param getEngine lazy thunk for the sync engine (two-phase construction:
 *   index.ts creates the store first, then the engine bound to it).
 */
export const createLibrarySlice = (
  getEngine: () => PresetSyncEngine,
): StateCreator<SimulatorState, [], [], LibrarySlice> => (set, get) => ({
  presetLibrary: { tables: [], fonts: [] },
  appliedPresetId: 'builtin:bcd',
  appliedPresetName: findBuiltinTablePreset('builtin:bcd')?.name ?? null,

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
    void getEngine().upsert(def, 'font');
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
    void getEngine().upsert(def, 'table');
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
      void getEngine().upsert(next, 'table');
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
      void getEngine().upsert(next, 'font');
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
      void getEngine().upsert(copy, 'table');
    } else {
      const def = library.fonts.find((f) => f.id === id);
      if (!def) return;
      const copy: FontPresetDef = { ...def, id: newUserId(), name: `${def.name} (copy)`, createdAt: now, updatedAt: now };
      const nextLib = { ...library, fonts: [...library.fonts, copy] };
      set({ presetLibrary: nextLib, lastAction: `Font preset duplicated: ${copy.name}` });
      persistLibrary(nextLib);
      void getEngine().upsert(copy, 'font');
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
    getEngine().removeServerRow(id);
  },

  importPresetFile: (raw) => {
    const res = parsePresetFile(raw);
    if (res.tablePreset) {
      const def = res.tablePreset;
      const library = get().presetLibrary;
      const nextLib = { ...library, tables: [...library.tables, def] };
      set({ presetLibrary: nextLib, lastAction: `Preset imported: ${def.name}` });
      persistLibrary(nextLib);
      void getEngine().upsert(def, 'table');
      return { ok: res.ok, errors: res.errors, name: def.name, kind: 'table' as PresetKind };
    }
    if (res.fontPreset) {
      const def = res.fontPreset;
      const library = get().presetLibrary;
      const nextLib = { ...library, fonts: [...library.fonts, def] };
      set({ presetLibrary: nextLib, lastAction: `Font preset imported: ${def.name}` });
      persistLibrary(nextLib);
      void getEngine().upsert(def, 'font');
      return { ok: res.ok, errors: res.errors, name: def.name, kind: 'font' as PresetKind };
    }
    return { ok: false, errors: res.errors };
  },

  syncPresetsFromServer: async () => {
    await getEngine().sync();
  },
});
