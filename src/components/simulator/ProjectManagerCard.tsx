/**
 * Project manager: create / save / load / rename / duplicate / delete
 * projects via the REST API (Prisma SQLite), with automatic fallback to
 * localStorage when the backend is unavailable (offline demo mode).
 * Also handles JSON import (validated) and project reset.
 *
 * Transport notes: the list is fetched with ONE paginated `?full=1` request
 * (full rows, no per-id follow-up GETs — no N+1). Every request carries the
 * owner header so rows this browser creates are tagged and the list filters
 * to "shared + mine". Local-mode projects are pushed up to the server once
 * after a successful refresh (best-effort, non-blocking).
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Save, Plus, Copy, Trash2, Upload, RotateCcw, Cloud, HardDrive, RefreshCw, Loader2,
} from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { ownerHeaders } from '@/lib/client-owner';
import { validateProject, parseFontFile } from '@/logic/project';
import { DEFAULT_PROJECT_NAME } from '@/logic/decoder';
import { detectImportFormat } from '@/logic/presets';
import { downloadText } from '@/utils/download';
import { buildProjectJson } from '@/utils/exporters';
import { ExplainBlock } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ProjectData } from '@/types/simulator';
import type { ProjectRow, ProjectSummary } from '@/types/api';

const LS_PROJECTS_KEY = 'sevenseg-projects-v1';
/** Ids of local projects already pushed to the server (or permanently rejected) — never re-attempted. */
const LS_PUSHED_KEY = 'sevenseg-projects-pushed-v1';

interface LocalProject extends ProjectSummary {
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

export function ProjectManagerCard() {
  const toProjectData = useSimulator((s) => s.toProjectData);
  const loadProject = useSimulator((s) => s.loadProject);
  const resetProject = useSimulator((s) => s.resetProject);
  const setProjectName = useSimulator((s) => s.setProjectName);
  const projectName = useSimulator((s) => s.projectName);
  const explain = useSimulator((s) => s.explainMode);
  const setCustomFont = useSimulator((s) => s.setCustomFont);
  const setDisplayMode = useSimulator((s) => s.setDisplayMode);
  const displayMode = useSimulator((s) => s.displayMode);
  const importPresetFile = useSimulator((s) => s.importPresetFile);

  const [mode, setMode] = useState<'cloud' | 'local' | 'checking'>('checking');
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState(projectName);
  /** Per-row async op in flight (id → op). Row buttons disable their whole row
   *  while an op runs — prevents double-click duplicate POSTs without freezing
   *  unrelated rows. */
  const [rowBusy, setRowBusy] = useState<Record<string, 'duplicate' | 'delete'>>({});
  /** Synchronous mirror of rowBusy — refs update immediately, so a double
   *  click (two clicks before React commits the disabled state) is still
   *  rejected by the handler guard below. */
  const rowBusyRef = useRef<Set<string>>(new Set());
  /** Project awaiting delete confirmation in the AlertDialog. */
  const [deleteTarget, setDeleteTarget] = useState<LocalProject | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNameDraft(projectName), [projectName]);

  /**
   * Best-effort push-up of local-mode projects: rows that exist only in
   * localStorage (created while the backend was unreachable) are POSTed to
   * the server once, keeping their client id (409 = already there → success).
   * Runs in the background after a successful cloud refresh — a failed push
   * never breaks the list UI; transient failures are retried on the next
   * refresh, permanent ones (400/413) are marked so they are not retried.
   */
  const pushUpLocalOnly = useCallback(async (serverRows: ProjectRow[]): Promise<number> => {
    const serverIds = new Set(serverRows.map((r) => r.id));
    const pushed = readPushedIds();
    const pending = readLocalProjects().filter(
      (p) => p.data !== null && !serverIds.has(p.id) && !pushed.has(p.id),
    );
    if (pending.length === 0) return 0;
    let count = 0;
    for (const p of pending) {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
          body: JSON.stringify({ id: p.id, name: p.name, inputBits: p.inputBits, data: p.data }),
        });
        if (res.ok || res.status === 409) {
          pushed.add(p.id); // on the server now (or already was)
          count++;
        } else if (res.status === 400 || res.status === 413) {
          pushed.add(p.id); // permanently rejected — do not retry forever
        }
      } catch {
        // network error mid-push — leave unmarked so the next refresh retries
      }
    }
    if (pushed.size > 0) writePushedIds(pushed);
    return count;
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      // ONE paginated full-row request — no per-id follow-up GETs (was N+1).
      // Slim vs full is a server-side select; full rows arrive pre-validated
      // with a `corrupt` flag for blobs that failed validation.
      const res = await fetch('/api/projects?full=1&limit=200', { headers: ownerHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as ProjectRow[];
      setProjects(
        rows.map((r): LocalProject => {
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
      void pushUpLocalOnly(rows);
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

  const persistCurrent = useCallback(async (): Promise<string | null> => {
    const data = toProjectData();
    const name = (nameDraft.trim() || 'Untitled project').slice(0, 100);
    setBusy(true);
    try {
      if (mode === 'cloud') {
        if (currentId) {
          const res = await fetch(`/api/projects/${currentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
            body: JSON.stringify({ name, inputBits: data.inputBits, data }),
          });
          if (!res.ok) throw new Error(`E-240: save failed (HTTP ${res.status})`);
          await refresh();
          toast({ title: 'Project saved', description: `"${name}" updated in the database.` });
          return currentId;
        }
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
          body: JSON.stringify({ name, inputBits: data.inputBits, data }),
        });
        if (!res.ok) throw new Error(`E-240: create failed (HTTP ${res.status})`);
        const created = await res.json();
        setCurrentId(created.id);
        await refresh();
        toast({ title: 'Project created', description: `"${name}" saved to the database.` });
        return created.id as string;
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
  }, [mode, currentId, nameDraft, toProjectData, refresh]);

  const handleLoad = (p: LocalProject) => {
    if (p.corrupt || p.data === null) {
      toast({
        title: 'Load failed',
        description: 'The stored data of this row failed validation on the server — it cannot be loaded. Delete it and re-save, or import a valid project JSON.',
        variant: 'destructive',
      });
      return;
    }
    const v = validateProject(p.data);
    if (!v.data) {
      toast({ title: 'Load failed', description: v.errors[0] ?? 'Invalid project data.', variant: 'destructive' });
      return;
    }
    loadProject(v.data);
    setNameDraft(v.data.name);
    setCurrentId(p.id);
    toast({
      title: 'Project loaded',
      description: `"${p.name}" (${p.inputBits}-bit) restored.${v.errors.length ? ` ${v.errors.length} validation note(s).` : ''}`,
    });
  };

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

  const handleDuplicate = async (p: LocalProject) => {
    if (p.corrupt || p.data === null) {
      toast({ title: 'Duplicate failed', description: 'Corrupt rows have no readable data to copy.', variant: 'destructive' });
      return;
    }
    if (rowBusyRef.current.has(p.id)) return;
    markRowBusy(p.id, 'duplicate');
    try {
      if (mode === 'cloud') {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...ownerHeaders() },
          body: JSON.stringify({ name: `${p.name} (copy)`, inputBits: p.inputBits, data: p.data }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  };

  const handleDelete = async (p: LocalProject) => {
    if (rowBusyRef.current.has(p.id)) return;
    markRowBusy(p.id, 'delete');
    try {
      if (mode === 'cloud') {
        // 204 with NO body — check res.ok, never res.json() here.
        const res = await fetch(`/api/projects/${p.id}`, { method: 'DELETE', headers: ownerHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const format = detectImportFormat(raw);

      // Font file? (format: "sevenseg-font") — load as the active font.
      if (format === 'font') {
        const f = parseFontFile(raw);
        if (!f.font) {
          toast({ title: 'Font import rejected', description: f.errors.slice(0, 2).join(' '), variant: 'destructive' });
          return;
        }
        setCustomFont(f.font);
        if (displayMode !== 'font') setDisplayMode('font');
        toast({
          title: 'Font imported',
          description:
            `"${f.font.name}" — ${f.font.glyphs.length} glyphs now active.` +
            (f.errors.length ? ` ${f.errors.length} glyph(s) dropped: ${f.errors[0]}` : ''),
        });
        return;
      }

      // Preset file? (format: "sevenseg-preset") — add to the gallery library.
      if (format === 'preset') {
        const r = importPresetFile(raw);
        if (!r.name) {
          toast({ title: 'Preset import rejected', description: r.errors.slice(0, 2).join(' ') || 'Unknown preset file error.', variant: 'destructive' });
          return;
        }
        toast({
          title: r.kind === 'font' ? 'Font preset added' : 'Preset added to gallery',
          description:
            `"${r.name}" — apply it from the preset gallery (header button).` +
            (r.errors.length ? ` ${r.errors.length} warning(s): ${r.errors[0]}` : ''),
        });
        return;
      }

      if (format === null) {
        toast({ title: 'Import rejected', description: 'E-251: unrecognized file — expected a project, font or preset JSON.', variant: 'destructive' });
        return;
      }

      const v = validateProject(raw);
      if (!v.data) {
        toast({ title: 'Import rejected', description: v.errors.slice(0, 2).join(' '), variant: 'destructive' });
        return;
      }
      loadProject(v.data);
      setNameDraft(v.data.name);
      setCurrentId(null);
      toast({
        title: 'Project imported',
        description: v.errors.length === 0
          ? `"${v.data.name}" loaded — schema valid.`
          : `"${v.data.name}" loaded with ${v.errors.length} validation warning(s): ${v.errors[0]}`,
      });
    } catch {
      toast({ title: 'Import failed', description: 'E-250: file is not valid JSON.', variant: 'destructive' });
    }
  };

  return (
    <Card id="projects-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
            PROJECTS
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 font-mono text-[10px]',
              mode === 'cloud' && 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
              mode === 'local' && 'border-amber-500/50 text-amber-600 dark:text-amber-400',
            )}
          >
            {mode === 'cloud' ? <Cloud className="h-3 w-3" aria-hidden /> : <HardDrive className="h-3 w-3" aria-hidden />}
            {mode === 'cloud' ? 'SQLite backend' : mode === 'local' ? 'Local mode' : 'checking…'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* workspace */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label htmlFor="project-name" className="text-xs text-muted-foreground">Working project name</Label>
            <Input
              id="project-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => nameDraft.trim() && setProjectName(nameDraft)}
              placeholder="My decoder"
              aria-label="Project name"
            />
          </div>
          <Button size="sm" onClick={() => void persistCurrent()} disabled={busy}>
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {currentId ? 'Save' : 'Create'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setCurrentId(null); toast({ title: 'New project', description: 'Saving will create a fresh database record.' }); }}
            disabled={busy || !currentId}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> New
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy} aria-label="Refresh project list">
            <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} aria-hidden />
          </Button>
        </div>

        {/* project list */}
        <div className="max-h-64 space-y-1.5 overflow-y-auto custom-scroll pr-1" role="list" aria-label="Saved projects">
          {projects.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
              No saved projects yet — design a decoder and press <strong>Create</strong>.
            </p>
          )}
          {projects.map((p) => {
            const rowOp = rowBusy[p.id] ?? null;
            return (
            <div
              key={p.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-sm',
                currentId === p.id ? 'border-primary/60 bg-primary/5' : 'bg-muted/30',
                p.corrupt && 'border-destructive/30',
              )}
              role="listitem"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{p.name}</span>
                  {p.corrupt && (
                    <Badge
                      variant="outline"
                      className="h-4 shrink-0 border-destructive/40 px-1 font-mono text-[9px] text-destructive"
                      title="The stored data blob failed validation — this row cannot be loaded or duplicated."
                    >
                      corrupt
                    </Badge>
                  )}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {p.inputBits}-bit · updated {new Date(p.updatedAt).toLocaleString()}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="h-7"
                onClick={() => handleLoad(p)}
                disabled={p.corrupt || rowOp !== null}
                aria-label={p.corrupt ? `Cannot load ${p.name} — stored data is corrupt` : `Load ${p.name}`}
              >
                {rowOp === null
                  ? <FolderOpen className="mr-1 h-3 w-3" aria-hidden />
                  : <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
                Load
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => void handleDuplicate(p)}
                disabled={p.corrupt || rowOp !== null}
                aria-label={`Duplicate ${p.name}`}
              >
                {rowOp === 'duplicate'
                  ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  : <Copy className="h-3 w-3" aria-hidden />}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0 text-destructive"
                onClick={() => setDeleteTarget(p)}
                disabled={rowOp !== null}
                aria-label={`Delete ${p.name}`}
              >
                {rowOp === 'delete'
                  ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  : <Trash2 className="h-3 w-3" aria-hidden />}
              </Button>
            </div>
            );
          })}
        </div>

        {/* import / export / reset */}
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = '';
            }}
            aria-label="Import project JSON file"
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} title="Import a project, font (sevenseg-font) or preset (sevenseg-preset) JSON file">
            <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Import JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadText(buildProjectJson(toProjectData()), 'seven-segment-project.json', 'application/json')}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Download JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => { resetProject(); setNameDraft(DEFAULT_PROJECT_NAME); setCurrentId(null); }}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reset to default
          </Button>
        </div>

        {mode === 'local' && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
            Backend unreachable — running in local demo mode. Projects are stored in this browser&apos;s
            localStorage; the simulator remains fully functional.
          </p>
        )}

        {explain && (
          <ExplainBlock title="How projects are stored">
            <p>
              A project captures the entire simulator state: input width, display mode, invalid-input
              behavior, the full truth table (including don&apos;t-cares), display settings and any
              K-map group exclusions. The Boolean expressions, K-maps and circuits are always
              re-derived on load — only the source data is persisted.
            </p>
            <p>
              {mode === 'cloud'
                ? 'The SQLite backend (Prisma) is serving /api/projects — create, load, duplicate and delete persist across sessions.'
                : 'The backend is unavailable, so projects live in localStorage. This guarantees the lab works offline.'}
            </p>
            <p>
              Import validates every field with engineering error codes (E-2xx) before loading, so a
              corrupted file can never crash the simulator.
            </p>
          </ExplainBlock>
        )}

        {/* destructive-action confirmation for project deletes */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes “{deleteTarget?.name}” from the{' '}
                {mode === 'cloud' ? 'database' : 'browser storage'}. The loaded simulator state is
                unaffected, but this action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  if (deleteTarget) void handleDelete(deleteTarget);
                  setDeleteTarget(null);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
