/**
 * localStorage persistence for the simulator store.
 *
 * Two keys, unchanged from the original monolith (compatibility requirement):
 *  - `sevenseg-workspace-v1` — the current workspace (validated on read in
 *    hydrate(); corrupted data falls back to defaults, never crashes).
 *  - `sevenseg-presets-v1`   — the user preset library (validated on read;
 *    corrupt entries are dropped, see loadLibrary).
 *
 * Writes are best-effort: storage-full/unavailable keeps the session in
 * memory (silent by design).
 */
import type { PresetLibrary } from '@/types/simulator';
import type { FontPresetDef, TablePresetDef } from '@/types/simulator';
import { validateLibraryFontPreset, validateLibraryTablePreset } from '@/logic/presets';

export const WORKSPACE_KEY = 'sevenseg-workspace-v1';
export const PRESET_LIB_KEY = 'sevenseg-presets-v1';

/** Minimal store surface persist() needs (avoids importing the real store). */
export interface SimulatorStateLike {
  toProjectData: () => unknown;
}

/** Write the current workspace to localStorage. */
export function persist(state: SimulatorStateLike): void {
  if (typeof window === 'undefined') return;
  try {
    const data = state.toProjectData();
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(data));
  } catch {
    /* storage full / unavailable — demo continues in memory */
  }
}

/** Write the preset library to localStorage. */
export function persistLibrary(library: PresetLibrary): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRESET_LIB_KEY, JSON.stringify(library));
  } catch {
    /* storage full — library stays in memory for this session */
  }
}

/** Load + validate the preset library from localStorage. */
export function loadLibrary(): PresetLibrary {
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
