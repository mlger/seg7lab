/**
 * useProjectsManager — the Projects tab's client-side application behavior:
 * cloud/local fallback, list refresh, save/load/duplicate/delete, row busy
 * guards and the one-time push-up of local-mode projects.
 *
 * Extracted VERBATIM from ProjectManagerCard (same requests via the typed
 * api-client, same localStorage fallback semantics, same toasts, same
 * busy-guard timing). The component now owns presentation only.
 *
 * Transport decisions preserved from the original:
 *  - the list is ONE paginated `?full=1&limit=200` request (no per-id GETs);
 *  - local-mode rows created while offline are POSTed up once after a
 *    successful refresh (409 = already there = success; 400/413 = permanent
 *    reject, never retried; network errors retried next refresh);
 *  - saves do NOT send expectedUpdatedAt (pre-existing behavior; the server
 *    supports optimistic locking, the client-side follow-up is tracked in
 *    docs/VERIFICATION.md as a known gap).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimulator } from '@/lib/store';
import { createProject, deleteProject, listProjects, updateProject } from '@/lib/api-client';
import { validateProject } from '@/logic/project';
import { toast } from '@/hooks/use-toast';
import type { ProjectData } from '@/types/simulator';
import type { ProjectSummary } from '@/types/api';

const LS_PROJECTS_KEY = 'sevenseg-projects-v1';
/** Ids of local projects already pushed to the server (or permanently rejected) — never re-attempted. */
const LS_PUSHED_KEY = 'sevenseg-projects-pushed-v1';

export interface LocalProject extends ProjectSummary {
  /** null when the server row's stored blob failed validation (corrupt). */
  data: ProjectData | null;
  /** True when the stored blob could not be read back — Load/Duplicate disabled. */
  corrupt?: boolean;
}

function readLocalProjects(): LocalProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LS_PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as LocalProject[]) : [];
  } catch {
    return [];
  }
}

function writeLocalProjects(list: LocalProject[]): void {
  try {
    window.localStorage.setItem(LS_PROJECTS_KEY, JSON.stringify(list));
  } catch {
    toast({ title: 'Local storage full', description: 'Could not persist project list.', variant: 'destructive' });
  }
}

function readPushedIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(LS_PUSHED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writePushedIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(LS_PUSHED_KEY, JSON.stringify([...ids]));
  } catch {
    /* best-effort marker only */
  }
}

function localId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The hook's surface (all names preserved from the original component). */
export interface ProjectsManager {
  mode: 'cloud' | 'local' | 'checking';
  projects: LocalProject[];
  currentId: string | null;
  busy: boolean;
  /** Per-row async op in flight (id → op) — row buttons disable their row. */
  rowBusy: Record<string, 'duplicate' | 'delete'>;
  refresh: () => Promise<void>;
  /** Create or update the current project under `name`. Returns its id, or null on failure. */
  saveCurrent: (name: string) => Promise<string | null>;
  /** Load a row into the simulator (validates first). Returns the canonical ProjectData, or null. */
  load: (p: LocalProject) => ProjectData | null;
  duplicate: (p: LocalProject) => Promise<void>;
  remove: (p: LocalProject) => Promise<void>;
  /** Start a fresh project (next save creates a new row). */
  clearCurrentId: () => void;
  /** Detach from the current row WITHOUT the "New project" toast (import path). */
  detachCurrentId: () => void;
}

export function useProjectsManager(): ProjectsManager {
  const toProjectData = useSimulator((s) => s.toProjectData);
  const loadProject = useSimulator((s) => s.loadProject);

  const [mode, setMode] = useState<'cloud' | 'local' | 'checking'>('checking');
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Record<string, 'duplicate' | 'delete'>>({});
  /** Synchronous mirror of rowBusy — refs update immediately, so a double
   *  click (two clicks before React commits the disabled state) is still
   *  rejected by the handler guard below. */
  const rowBusyRef = useRef<Set<string>>(new Set());

  /**
   * Best-effort push-up of local-mode projects: rows that exist only in
   * localStorage (created while the backend was unreachable) are POSTed to
   * the server once, keeping their client id (409 = already there → success).
   * Runs in the background after a successful cloud refresh — a failed push
   * never breaks the list UI; transient failures are retried on the next
   * refresh, permanent ones (400/413) are marked so they are not retried.
   */
  const pushUpLocalOnly = useCallback(async (serverRows: { id: string }[]): Promise<number> => {
    const serverIds = new Set(serverRows.map((r) => r.id));
    const pushed = readPushedIds();
    const pending = readLocalProjects().filter(
      (p) => p.data !== null && !serverIds.has(p.id) && !pushed.has(p.id),
    );
    if (pending.length === 0) return 0;
    let count = 0;
    for (const p of pending) {
      const result = await createProject({ id: p.id, name: p.name, inputBits: p.inputBits, data: p.data as ProjectData });
      if (result.ok || result.status === 409) {
        pushed.add(p.id); // on the server now (or already was)
        count++;
      } else if (result.status === 400 || result.status === 413) {
        pushed.add(p.id); // permanently rejected — do not retry forever
      }
      // network error mid-push (status 0) — leave unmarked so the next refresh retries
    }
    if (pushed.size > 0) writePushedIds(pushed);
    return count;
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      // ONE paginated full-row request — no per-id follow-up GETs (was N+1).
      // Full rows arrive pre-validated with a `corrupt` flag for blobs that
      // failed validation.
      const result = await listProjects({ full: true, limit: 200 });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      setProjects(
        result.value.map((r): LocalProject => {
          const corrupt = r.corrupt === true || r.data === null;
          return {
            id: r.id,
            name: r.name,
            inputBits: r.inputBits,
            ownerId: r.ownerId ?? null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            data: corrupt ? null : (r.data as ProjectData),
            corrupt,
          };
        }),
      );
      setMode('cloud');
      // Fire-and-forget: never let a background push break the list UI.
      void pushUpLocalOnly(result.value);
    } catch {
      setProjects(readLocalProjects());
      setMode('local');
    } finally {
      setBusy(false);
    }
  }, [pushUpLocalOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveCurrent = useCallback(async (name: string): Promise<string | null> => {
    const data = toProjectData();
    setBusy(true);
    try {
      if (mode === 'cloud') {
        if (currentId) {
          const result = await updateProject(currentId, { name, inputBits: data.inputBits, data });
          if (!result.ok) throw new Error(`E-240: save failed (HTTP ${result.status})`);
          await refresh();
          toast({ title: 'Project saved', description: `"${name}" updated in the database.` });
          return currentId;
        }
        const result = await createProject({ name, inputBits: data.inputBits, data });
        if (!result.ok) throw new Error(`E-240: create failed (HTTP ${result.status})`);
        setCurrentId(result.value.id);
        await refresh();
        toast({ title: 'Project created', description: `"${name}" saved to the database.` });
        return result.value.id;
      }
      // local mode
      const list = readLocalProjects();
      const now = new Date().toISOString();
      if (currentId) {
        const idx = list.findIndex((p) => p.id === currentId);
        if (idx >= 0) {
          list[idx] = { ...list[idx], name, inputBits: data.inputBits, data, updatedAt: now };
          writeLocalProjects(list);
          setProjects(list);
          toast({ title: 'Project saved (local)', description: `"${name}" updated in localStorage.` });
          return currentId;
        }
      }
      const id = localId();
      list.unshift({ id, name, inputBits: data.inputBits, data, createdAt: now, updatedAt: now });
      writeLocalProjects(list);
      setProjects(list);
      setCurrentId(id);
      toast({ title: 'Project created (local)', description: `"${name}" saved to localStorage.` });
      return id;
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown error while saving.',
        variant: 'destructive',
      });
      return null;
    } finally {
      setBusy(false);
    }
  }, [mode, currentId, toProjectData, refresh]);

  const load = useCallback((p: LocalProject): ProjectData | null => {
    if (p.corrupt || p.data === null) {
      toast({
        title: 'Load failed',
        description: 'The stored data of this row failed validation on the server — it cannot be loaded. Delete it and re-save, or import a valid project JSON.',
        variant: 'destructive',
      });
      return null;
    }
    const v = validateProject(p.data);
    if (!v.data) {
      toast({ title: 'Load failed', description: v.errors[0] ?? 'Invalid project data.', variant: 'destructive' });
      return null;
    }
    loadProject(v.data);
    setCurrentId(p.id);
    toast({
      title: 'Project loaded',
      description: `"${p.name}" (${p.inputBits}-bit) restored.${v.errors.length ? ` ${v.errors.length} validation note(s).` : ''}`,
    });
    return v.data;
  }, [loadProject]);

  const markRowBusy = (id: string, op: 'duplicate' | 'delete') => {
    rowBusyRef.current.add(id);
    setRowBusy((m) => ({ ...m, [id]: op }));
  };
  const clearRowBusy = (id: string) => {
    rowBusyRef.current.delete(id);
    setRowBusy((m) => {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
  };

  const duplicate = useCallback(async (p: LocalProject) => {
    if (p.corrupt || p.data === null) {
      toast({ title: 'Duplicate failed', description: 'Corrupt rows have no readable data to copy.', variant: 'destructive' });
      return;
    }
    if (rowBusyRef.current.has(p.id)) return;
    markRowBusy(p.id, 'duplicate');
    try {
      if (mode === 'cloud') {
        const result = await createProject({ name: `${p.name} (copy)`, inputBits: p.inputBits, data: p.data });
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
      } else {
        const list = readLocalProjects();
        const now = new Date().toISOString();
        const id = localId();
        list.unshift({ id, name: `${p.name} (copy)`, inputBits: p.inputBits, data: p.data, createdAt: now, updatedAt: now });
        writeLocalProjects(list);
      }
      await refresh();
      toast({ title: 'Project duplicated', description: `"${p.name} (copy)" created.` });
    } catch (err) {
      toast({ title: 'Duplicate failed', description: err instanceof Error ? err.message : 'Unknown error.', variant: 'destructive' });
    } finally {
      clearRowBusy(p.id);
    }
  }, [mode, refresh]);

  const remove = useCallback(async (p: LocalProject) => {
    if (rowBusyRef.current.has(p.id)) return;
    markRowBusy(p.id, 'delete');
    try {
      if (mode === 'cloud') {
        // 204 with NO body — the api-client checks res.ok and never parses it.
        const result = await deleteProject(p.id);
        if (!result.ok) throw new Error(`HTTP ${result.status}`);
      } else {
        writeLocalProjects(readLocalProjects().filter((x) => x.id !== p.id));
      }
      if (currentId === p.id) setCurrentId(null);
      await refresh();
      toast({ title: 'Project deleted', description: `"${p.name}" removed.` });
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : 'Unknown error.', variant: 'destructive' });
    } finally {
      clearRowBusy(p.id);
    }
  }, [mode, currentId, refresh]);

  const clearCurrentId = useCallback(() => {
    setCurrentId(null);
    toast({ title: 'New project', description: 'Saving will create a fresh database record.' });
  }, []);

  const detachCurrentId = useCallback(() => {
    setCurrentId(null);
  }, []);

  return { mode, projects, currentId, busy, rowBusy, refresh, saveCurrent, load, duplicate, remove, clearCurrentId, detachCurrentId };
}
