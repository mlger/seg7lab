/**
 * Preset library server-sync engine — extracted verbatim from the store
 * monolith (behavior preserved: same URLs, status handling, console.warn
 * messages, in-flight semantics, conflict recovery).
 *
 * Dependency-inverted: the engine does NOT import the store. Instead it
 * receives an {@link PresetSyncAccess} handle (wired in
 * src/lib/store/index.ts) for reading/applying the library and checking
 * hydration. That makes the whole merge/reconcile policy reviewable — and
 * later testable — without a Zustand store.
 */

import type {
  FontPresetDef,
  PresetKind,
  PresetLibrary,
  TablePresetDef,
} from '@/types/simulator';
import {
  validateLibraryFontPreset,
  validateLibraryTablePreset,
} from '@/logic/presets';
import { ownerHeaders } from '@/lib/client-owner';

/** Store access the sync engine needs (injected by src/lib/store/index.ts). */
export interface PresetSyncAccess {
  /** Current preset library (called between awaits — always fresh). */
  getLibrary(): PresetLibrary;
  /** True once the local library has been loaded from localStorage. */
  isHydrated(): boolean;
  /** Apply a merged library: store update + localStorage persistence. */
  applyLibrary(library: PresetLibrary): void;
}

/** Preset ids the API stores: "user:" + URL-safe charset (single path segment). */
const PRESET_ID_RE = /^user:[A-Za-z0-9_-]{1,94}$/;

/** Full preset row as returned by /api/presets (list ?full=1, GET/POST/PUT). */
type ServerPresetRow = {
  id?: unknown;
  kind?: unknown;
  data?: unknown;
  corrupt?: unknown;
  updatedAt?: unknown;
};

/**
 * Last-seen server row.updatedAt per preset id — the optimistic-lock tokens.
 * Populated from every GET/POST/PUT response; expectedUpdatedAt on PUTs is
 * taken from here (falling back to the local def stamp when this browser has
 * never seen the row, which makes the server answer 409 and triggers the
 * merge recovery in {@link reconcilePresetConflict}).
 */
const serverUpdatedAt = new Map<string, string>();

/** Preset ids with an already-logged server-sync warning (once per session). */
const warnedServerIds = new Set<string>();

/** Log a server-sync problem once per preset id (keeps repeated syncs quiet). */
function warnServerIssue(id: string, message: string) {
  if (warnedServerIds.has(id)) return;
  warnedServerIds.add(id);
  console.warn(`[presets] ${message}`);
}

/** Record a server row's updatedAt as the optimistic-lock token for its id. */
function rememberServerUpdatedAt(id: string, row: ServerPresetRow) {
  if (typeof row.updatedAt === 'string') serverUpdatedAt.set(id, row.updatedAt);
}

/**
 * Pure merge-by-updatedAt of one preset into a library list — the sync policy:
 * a server copy replaces the local one only when it is strictly newer AND the
 * content actually differs; otherwise the local side is kept (never clobbered).
 */
export function mergePresetIntoList<T extends { id: string; updatedAt?: string }>(
  list: T[],
  def: T,
  rowUpdatedAt?: string,
): { list: T[]; changed: boolean } {
  const existing = list.find((p) => p.id === def.id);
  if (!existing) return { list: [...list, def], changed: true };
  if (
    (existing.updatedAt ?? '') < (def.updatedAt ?? rowUpdatedAt ?? '')
    && JSON.stringify(existing) !== JSON.stringify(def)
  ) {
    return { list: list.map((p) => (p.id === def.id ? def : p)), changed: true };
  }
  return { list, changed: false };
}

/** The sync engine's surface (obtained via createPresetSyncEngine). */
export interface PresetSyncEngine {
  /** Full merge pass: pull server rows, merge by updatedAt, push local-only. */
  sync(): Promise<void>;
  /** Best-effort upsert of one preset (POST, 409 → PUT with locking). */
  upsert(def: TablePresetDef | FontPresetDef, kind: PresetKind): Promise<void>;
  /** Fire-and-forget server delete of one preset row. */
  removeServerRow(id: string): void;
}

/** Build the sync engine bound to a store-access handle. */
export function createPresetSyncEngine(access: PresetSyncAccess): PresetSyncEngine {
  /**
   * Best-effort server sync of one library preset (fire and forget).
   * POST creates the row; when the id already exists (409) the preset is updated
   * through {@link apiPutPreset} with optimistic locking.
   */
  async function apiUpsertPreset(def: TablePresetDef | FontPresetDef, kind: PresetKind): Promise<void> {
    // The API only stores routable ids and 1..100-char names — legacy local
    // presets violating either stay local-only (warned once) instead of
    // failing against the server on every sync.
    const name = def.name.trim();
    if (!PRESET_ID_RE.test(def.id) || name.length === 0 || name.length > 100) {
      warnServerIssue(def.id, `preset "${def.name}" cannot be stored server-side (id/name rejected by the API) — kept local-only`);
      return;
    }
    try {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
        body: JSON.stringify({ id: def.id, kind, name, data: def }),
      });
      if (res.status === 201) {
        rememberServerUpdatedAt(def.id, (await res.json()) as ServerPresetRow);
        return;
      }
      if (res.status === 409) {
        // already on the server → update it with optimistic locking
        await apiPutPreset(def, kind, serverUpdatedAt.get(def.id) ?? def.updatedAt);
        return;
      }
      warnServerIssue(def.id, `POST /api/presets/${def.id} → ${res.status} (kept local-only)`);
    } catch {
      /* offline — localStorage remains the source of truth */
    }
  }

  /**
   * PUT one preset row with optimistic locking. `expectedUpdatedAt` is the
   * last-seen updatedAt of the server row (undefined → unconditional write,
   * the pre-locking legacy behavior). On 409 the fresh row is fetched and
   * merged by updatedAt — the newer side always wins, never silently.
   */
  async function apiPutPreset(
    def: TablePresetDef | FontPresetDef,
    kind: PresetKind,
    expectedUpdatedAt: string | undefined,
    allowConflictRecovery = true,
  ): Promise<void> {
    try {
      const name = def.name.trim();
      if (name.length === 0 || name.length > 100) {
        warnServerIssue(def.id, `preset "${def.name}" cannot be stored server-side (name rejected by the API) — kept local-only`);
        return;
      }
      const res = await fetch(`/api/presets/${encodeURIComponent(def.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
        body: JSON.stringify({
          name,
          data: def,
          ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
        }),
      });
      if (res.ok) {
        // chain the next optimistic lock on the row's new updatedAt
        rememberServerUpdatedAt(def.id, (await res.json()) as ServerPresetRow);
        return;
      }
      if (res.status === 409 && allowConflictRecovery) {
        console.warn(`[presets] "${def.name}" (${def.id}) changed on the server since we last saw it — merging by updatedAt`);
        await reconcilePresetConflict(def, kind);
        return;
      }
      if (res.status === 409) {
        // still conflicting after one recovery attempt — another writer is active
        console.warn(`[presets] "${def.name}" (${def.id}) still conflicts after merge — keeping the local copy`);
        return;
      }
      // 403 (another browser's row) / 404 (deleted meanwhile) / 400 (validation)
      warnServerIssue(def.id, `PUT /api/presets/${def.id} → ${res.status} (kept local-only)`);
    } catch {
      /* offline — localStorage remains the source of truth */
    }
  }

  /**
   * Recover from a 409 optimistic-lock conflict: re-fetch the row, then re-run
   * the merge-by-updatedAt policy between the local and the fresh server copy.
   * A corrupt/invalid server blob never overwrites a good local preset — the
   * row is instead repaired from the local copy (single guarded attempt). When
   * the server copy is newer it replaces local; when the local edit is newer it
   * is re-pushed once with the fresh lock token so the newer side survives.
   */
  async function reconcilePresetConflict(def: TablePresetDef | FontPresetDef, kind: PresetKind): Promise<void> {
    let row: ServerPresetRow;
    try {
      const res = await fetch(`/api/presets/${encodeURIComponent(def.id)}`, { headers: { ...ownerHeaders() } });
      if (!res.ok) {
        warnServerIssue(def.id, `GET /api/presets/${def.id} after conflict → ${res.status} (kept local-only)`);
        return;
      }
      row = (await res.json()) as ServerPresetRow;
    } catch {
      return; // offline — the local copy stands
    }
    rememberServerUpdatedAt(def.id, row);
    const token = serverUpdatedAt.get(def.id);

    // Corrupt (unparseable) or invalid (fails preset validation) server blob:
    // never import it over a good local preset — repair the row from local.
    if (row.corrupt === true || row.data == null) {
      warnServerIssue(def.id, `server row ${def.id} holds a corrupt blob — keeping the local copy, repairing the row`);
      await apiPutPreset(def, kind, token, false);
      return;
    }
    const serverDef = kind === 'table'
      ? validateLibraryTablePreset(row.data)
      : validateLibraryFontPreset(row.data);
    if (serverDef === null) {
      warnServerIssue(def.id, `server row ${def.id} failed preset validation — keeping the local copy, repairing the row`);
      await apiPutPreset(def, kind, token, false);
      return;
    }

    // Re-run the merge-by-updatedAt policy between local and fresh server copy.
    const lib = access.getLibrary();
    const merged = kind === 'table'
      ? mergePresetIntoList(lib.tables, serverDef as TablePresetDef)
      : mergePresetIntoList(lib.fonts, serverDef as FontPresetDef);
    if (merged.changed) {
      // server copy is newer (or missing locally) → adopt it
      const library = kind === 'table'
        ? { tables: merged.list as TablePresetDef[], fonts: lib.fonts }
        : { tables: lib.tables, fonts: merged.list as FontPresetDef[] };
      access.applyLibrary(library);
      return;
    }
    // local copy is newer or identical → keep it and re-push once with the
    // fresh lock token so the newer local edit also wins server-side.
    await apiPutPreset(def, kind, token, false);
  }

  /** Only one preset sync in flight — the mount/focus/storage triggers overlap. */
  let presetSyncInFlight: Promise<void> | null = null;

  return {
    async sync(): Promise<void> {
      if (typeof window === 'undefined') return;
      // Dedup concurrent runs: the mount sync and the focus/storage triggers
      // can overlap — a second pass would re-push local-only presets (churn).
      if (presetSyncInFlight) return presetSyncInFlight;
      const run = (async () => {
        // wait for hydration so the local library is loaded first
        for (let i = 0; i < 100 && !access.isHydrated(); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        let rows: ServerPresetRow[] = [];
        try {
          const res = await fetch('/api/presets?full=1', { headers: { ...ownerHeaders() } });
          if (!res.ok) return;
          rows = await res.json();
        } catch {
          return; // offline — the local library stands
        }
        if (!Array.isArray(rows)) return;
        const lib = access.getLibrary();
        let tables = [...lib.tables];
        let fonts = [...lib.fonts];
        let changed = false;
        const seen = new Set<string>();
        for (const row of rows) {
          if (!row || typeof row.id !== 'string') continue;
          if (row.kind !== 'table' && row.kind !== 'font') continue;
          seen.add(row.id);
          // remember the row version as the optimistic-lock token for later PUTs
          rememberServerUpdatedAt(row.id, row);
          // Corrupt server blob (failed JSON.parse) or one that fails preset
          // validation: never import it and never let it overwrite a good local
          // preset — keep whatever exists locally (warned once per row id).
          if (row.corrupt === true || row.data == null) {
            warnServerIssue(row.id, `server row ${row.id} has a corrupt blob — skipped, local copy kept`);
            continue;
          }
          const def = row.kind === 'table'
            ? validateLibraryTablePreset(row.data)
            : validateLibraryFontPreset(row.data);
          if (def === null) {
            warnServerIssue(row.id, `server row ${row.id} failed preset validation — skipped, local copy kept`);
            continue;
          }
          const rowUpdatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : undefined;
          if (row.kind === 'table') {
            const merged = mergePresetIntoList(tables, def as TablePresetDef, rowUpdatedAt);
            tables = merged.list;
            changed = changed || merged.changed;
          } else {
            const merged = mergePresetIntoList(fonts, def as FontPresetDef, rowUpdatedAt);
            fonts = merged.list;
            changed = changed || merged.changed;
          }
        }
        // push local-only presets up to the server
        for (const t of tables) if (!seen.has(t.id)) void apiUpsertPreset(t, 'table');
        for (const f of fonts) if (!seen.has(f.id)) void apiUpsertPreset(f, 'font');
        if (changed) {
          access.applyLibrary({ tables, fonts });
        }
      })();
      presetSyncInFlight = run.finally(() => {
        presetSyncInFlight = null;
      });
      return presetSyncInFlight;
    },

    upsert: apiUpsertPreset,

    removeServerRow(id: string): void {
      void (async () => {
        try {
          const res = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { ...ownerHeaders() },
          });
          // success is 204 No Content — there is no body to parse; 403/404 mean
          // the row was already gone or belongs to another browser.
          if (res.ok) {
            serverUpdatedAt.delete(id);
          } else if (res.status !== 403 && res.status !== 404) {
            warnServerIssue(id, `DELETE /api/presets/${id} → ${res.status}`);
          }
        } catch {
          /* offline — server copy will be re-synced later */
        }
      })();
    },
  };
}
