/**
 * Project manager: create / save / load / rename / duplicate / delete
 * projects via the REST API (Prisma SQLite), with automatic fallback to
 * localStorage when the backend is unavailable (offline demo mode).
 * Also handles JSON import (validated) and project reset.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FolderOpen, Save, Plus, Copy, Trash2, Upload, RotateCcw, Cloud, HardDrive, RefreshCw,
} from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { validateProject, parseFontFile } from '@/logic/project';
import { detectImportFormat } from '@/logic/presets';
import { downloadText } from '@/utils/download';
import { buildProjectJson } from '@/utils/exporters';
import { ExplainBlock } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { ProjectData, ProjectSummary } from '@/types/simulator';

const LS_PROJECTS_KEY = 'sevenseg-projects-v1';

interface LocalProject extends ProjectSummary {
  data: ProjectData;
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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setNameDraft(projectName), [projectName]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as ProjectSummary[];
      // hydrate full data for each project (list endpoint omits data)
      const full = await Promise.all(
        list.map(async (p) => {
          const r = await fetch(`/api/projects/${p.id}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          return { ...p, data: d.data as ProjectData };
        }),
      );
      setProjects(full);
      setMode('cloud');
    } catch {
      setProjects(readLocalProjects());
      setMode('local');
    } finally {
      setBusy(false);
    }
  }, []);

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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, inputBits: data.inputBits, data }),
          });
          if (!res.ok) throw new Error(`E-240: save failed (HTTP ${res.status})`);
          await refresh();
          toast({ title: 'Project saved', description: `"${name}" updated in the database.` });
          return currentId;
        }
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

  const handleDuplicate = async (p: LocalProject) => {
    setBusy(true);
    try {
      if (mode === 'cloud') {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      setBusy(false);
    }
  };

  const handleDelete = async (p: LocalProject) => {
    setBusy(true);
    try {
      if (mode === 'cloud') {
        const res = await fetch(`/api/projects/${p.id}`, { method: 'DELETE' });
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
      setBusy(false);
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
          {projects.map((p) => (
            <div
              key={p.id}
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-sm',
                currentId === p.id ? 'border-primary/60 bg-primary/5' : 'bg-muted/30',
              )}
              role="listitem"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {p.inputBits}-bit · updated {new Date(p.updatedAt).toLocaleString()}
                </div>
              </div>
              <Button size="sm" variant="secondary" className="h-7" onClick={() => handleLoad(p)}>
                <FolderOpen className="mr-1 h-3 w-3" aria-hidden /> Load
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => void handleDuplicate(p)} aria-label={`Duplicate ${p.name}`}>
                <Copy className="h-3 w-3" aria-hidden />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-destructive" onClick={() => void handleDelete(p)} aria-label={`Delete ${p.name}`}>
                <Trash2 className="h-3 w-3" aria-hidden />
              </Button>
            </div>
          ))}
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
          <Button size="sm" variant="outline" onClick={() => { resetProject(); setNameDraft('BCD Decoder (default)'); setCurrentId(null); }}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reset to default BCD
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
      </CardContent>
    </Card>
  );
}
