/**
 * Project manager: create / save / load / rename / duplicate / delete
 * projects via the REST API (Prisma SQLite), with automatic fallback to
 * localStorage when the backend is unavailable (offline demo mode).
 * Also handles JSON import (validated) and project reset.
 *
 * Presentation only — the transport/state machine lives in
 * src/lib/use-projects-manager.ts (cloud/local fallback, busy guards,
 * push-up reconciliation) on top of the typed client in src/lib/api-client.ts.
 */
'use client';

import { useRef, useState } from 'react';
import {
  FolderOpen, Save, Plus, Copy, Trash2, Upload, RotateCcw, Cloud, HardDrive, RefreshCw, Loader2,
} from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { parseFontFile, validateProject } from '@/logic/project';
import { DEFAULT_PROJECT_NAME } from '@/logic/decoder';
import { detectImportFormat } from '@/logic/presets';
import { downloadText } from '@/utils/download';
import { buildProjectJson } from '@/utils/exporters';
import { useProjectsManager, type LocalProject } from '@/lib/use-projects-manager';
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

export function ProjectManagerCard() {
  const toProjectData = useSimulator((s) => s.toProjectData);
  const resetProject = useSimulator((s) => s.resetProject);
  const setProjectName = useSimulator((s) => s.setProjectName);
  const projectName = useSimulator((s) => s.projectName);
  const explain = useSimulator((s) => s.explainMode);
  const setCustomFont = useSimulator((s) => s.setCustomFont);
  const setDisplayMode = useSimulator((s) => s.setDisplayMode);
  const displayMode = useSimulator((s) => s.displayMode);
  const importPresetFile = useSimulator((s) => s.importPresetFile);

  const {
    mode, projects, currentId, busy, rowBusy,
    refresh, saveCurrent, load, duplicate, remove, clearCurrentId, detachCurrentId,
  } = useProjectsManager();

  const [nameDraft, setNameDraft] = useState(projectName);
  /** Render-phase sync (the codebase's idiom, see InputControlsCard): keep the
   *  draft aligned with store-driven projectName changes (load/reset/import)
   *  without an effect and without clobbering in-progress typing. */
  const [lastSyncedName, setLastSyncedName] = useState(projectName);
  if (projectName !== lastSyncedName) {
    setNameDraft(projectName);
    setLastSyncedName(projectName);
  }
  /** Project awaiting delete confirmation in the AlertDialog. */
  const [deleteTarget, setDeleteTarget] = useState<LocalProject | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleLoad = (p: LocalProject) => {
    const data = load(p);
    if (data) setNameDraft(data.name);
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
      useSimulator.getState().loadProject(v.data);
      setNameDraft(v.data.name);
      detachCurrentId();
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
          <Button size="sm" onClick={() => void saveCurrent((nameDraft.trim() || 'Untitled project').slice(0, 100))} disabled={busy}>
            <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {currentId ? 'Save' : 'Create'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearCurrentId}
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
                onClick={() => void duplicate(p)}
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
          <Button size="sm" variant="outline" onClick={() => { resetProject(); setNameDraft(DEFAULT_PROJECT_NAME); }}>
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
                  if (deleteTarget) void remove(deleteTarget);
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
