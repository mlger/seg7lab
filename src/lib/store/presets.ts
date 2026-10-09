/**
 * Pure preset-resolution helpers shared by the store slices and the UI.
 *
 * Moved verbatim from the original store monolith (module-level functions,
 * no store access) — same signatures, same behavior.
 */
import type { CustomFont, DisplayMode, FontPresetDef, PresetLibrary, TablePresetDef } from '@/types/simulator';
import { FONT_GLYPHS, type FontGlyph } from '@/logic/font';
import {
  CALCULATOR_GLYPHS,
  findBuiltinFont,
  findBuiltinTablePreset,
  newUserId,
} from '@/logic/presets';

/** Sentinel font id meaning "the customFont blob is the active font" (legacy projects). */
export const FONT_CUSTOM_SENTINEL = 'user:custom';

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
export const BEHAVIOR_SENSITIVE = new Set(['bcd', 'hex', 'excess3', 'aiken']);

/** Synthesize the builtin table preset id/name implied by a display mode. */
export function builtinForMode(mode: DisplayMode): { id: string; name: string } | null {
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
export function reconcileFont(
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
