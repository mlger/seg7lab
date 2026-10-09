/**
 * The simulator store — SINGLE SOURCE OF TRUTH.
 *
 * Holds the editable truth table plus UI state. Every derived view
 * (7-seg display, K-map, expressions, logic circuit) is computed from here.
 *
 * Composition (was one 1,389-line monolith, same public surface):
 *  - ./workspace.ts    — project data + UI session state + truth-table actions
 *  - ./library.ts      — preset library + font activation + sync facade
 *  - ./presets.ts      — pure resolvers (also re-exported below for the UI)
 *  - ./persistence.ts  — localStorage keys + read/write (shapes unchanged)
 *  - ../preset-sync.ts — the server sync/conflict engine, injected here
 *
 * The sync engine is created AFTER the store (it reads/writes the store
 * through a narrow access interface — see preset-sync.ts), which is why
 * `syncEngine` is assigned in two phases below. Slice actions only call it
 * inside action bodies, so the late assignment is safe.
 */
'use client';

import { create } from 'zustand';
import { SEGMENT_NAMES } from '@/types/simulator';
import { createPresetSyncEngine, type PresetSyncEngine } from '@/lib/preset-sync';
import type { SimulatorState } from './types';
import { persist, persistLibrary, PRESET_LIB_KEY } from './persistence';
import { createWorkspaceSlice } from './workspace';
import { createLibrarySlice } from './library';

// The engine is created after the store (it binds to the store's getState);
// the library slice receives it through this lazy handle.
let syncEngine: PresetSyncEngine | undefined;

export const useSimulator = create<SimulatorState>()((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createLibrarySlice(() => syncEngine!)(...a),
}));

// Two-phase wiring: now that the store exists, build the engine bound to it.
syncEngine = createPresetSyncEngine({
  getLibrary: () => useSimulator.getState().presetLibrary,
  isHydrated: () => useSimulator.getState().hydrated,
  applyLibrary: (library) => {
    useSimulator.setState({ presetLibrary: library });
    persistLibrary(library);
  },
});

export type { SimulatorState } from './types';
export {
  resolveTablePreset,
  resolveFontPreset,
  activeFontGlyphs,
  FONT_CUSTOM_SENTINEL,
} from './presets';
export { SEGMENT_NAMES };

/** Module flag — the window-level sync listeners attach at most once. */
let syncTriggersAttached = false;

/**
 * Subscribe once from a client component to persist every change (debounced).
 *
 * Also registers the server-sync triggers beyond the initial mount sync:
 * window focus and preset-library storage events (the latter fire only in
 * tabs OTHER than the one that wrote — multi-tab coordination). Both are
 * debounced ~2s and deduped inside syncPresetsFromServer, so refocusing
 * rapidly never spams the API. The listeners live for the page lifetime;
 * the module flag prevents double-attachment (there is no detach path for
 * them by design — the app shell never unmounts).
 */
export function attachPersistence() {
  if (typeof window === 'undefined') return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useSimulator.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persist(useSimulator.getState()), 250);
  });

  if (!syncTriggersAttached) {
    syncTriggersAttached = true;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (syncTimer !== null) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        void useSimulator.getState().syncPresetsFromServer();
      }, 2000);
    };
    window.addEventListener('focus', scheduleSync);
    window.addEventListener('storage', (event: StorageEvent) => {
      // another tab changed the shared preset library → merge it in
      if (event.key === PRESET_LIB_KEY) scheduleSync();
    });
  }
  return unsub;
}
