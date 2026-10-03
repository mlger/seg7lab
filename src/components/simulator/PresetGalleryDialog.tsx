/**
 * Preset gallery: first-class named presets (tables + fonts).
 *
 *  - Tables tab: built-in generators (BCD, hex, chart font, excess-3, Gray
 *    counter, Aiken, boundary) + user-saved literal presets. Every card shows
 *    a live mini-preview strip of the table it would produce.
 *  - Fonts tab: built-in chart & calculator fonts + user fonts.
 *  - Save the current table as a named preset, or convert it into a font.
 *  - User presets can be renamed, duplicated, deleted and exported as
 *    sevenseg-preset files (importable via the Import button).
 */
'use client';

import { useMemo, useState } from 'react';
import {
  Save, Copy, Trash2, Pencil, Download, Table2, Type as TypeIcon, Check, X,
} from 'lucide-react';
import { useSimulator, activeFontGlyphs } from '@/lib/store';
import { usePresetModified } from '@/lib/useEngine';
import {
  BUILTIN_FONTS,
  BUILTIN_TABLE_PRESETS,
  buildFontPresetFile,
  buildPresetTable,
  buildTablePresetFile,
} from '@/logic/presets';
import { fontPattern, listedCodes } from '@/logic/font';
import { GlyphPreview } from './SevenSegmentDisplay';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { downloadText, sanitizeFilename } from '@/utils/download';
import { cn } from '@/lib/utils';
import type { FontGlyphData, FontPresetDef, PresetKind, TablePresetDef } from '@/types/simulator';

const PREVIEW_ROWS = 8;
const PREVIEW_GLYPHS = 6;

/** Mini strip of the first rows a table preset produces. */
function TablePreviewStrip({ preset, bits, behavior, glyphs }: {
  preset: TablePresetDef;
  bits: 4 | 5;
  behavior: 'blank' | 'dontcare' | 'custom';
  glyphs: FontGlyphData[];
}) {
  const rows = useMemo(() => {
    const previewBits = preset.generator === 'literal' ? preset.inputBits : bits;
    const table = buildPresetTable(preset, previewBits, behavior, glyphs as never);
    const codes = listedCodes(previewBits, preset.options?.tableStartCode ?? 0).slice(0, PREVIEW_ROWS);
    return codes.map((c) => table.rows.find((r) => r.input === c) ?? null);
  }, [preset, bits, behavior, glyphs]);
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto custom-scroll py-0.5" aria-hidden>
      {rows.map((r, i) => (
        <GlyphPreview key={i} outputs={r?.outputs ?? null} className="h-8 w-auto shrink-0" />
      ))}
    </div>
  );
}

/** Mini strip of a font's first glyphs. */
function FontPreviewStrip({ glyphs }: { glyphs: FontGlyphData[] }) {
  const patterns = useMemo(
    () => glyphs.slice(0, PREVIEW_GLYPHS).map((g) => fontPattern(g.segments)),
    [glyphs],
  );
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto custom-scroll py-0.5" aria-hidden>
      {patterns.map((p, i) => (
        <GlyphPreview key={i} outputs={p} className="h-8 w-auto shrink-0" />
      ))}
    </div>
  );
}

export function PresetGalleryDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputBits = useSimulator((s) => s.inputBits);
  const invalidBehavior = useSimulator((s) => s.invalidBehavior);
  const customFont = useSimulator((s) => s.customFont);
  const activeFontId = useSimulator((s) => s.activeFontId);
  const library = useSimulator((s) => s.presetLibrary);
  const appliedPresetId = useSimulator((s) => s.appliedPresetId);
  const applyPreset = useSimulator((s) => s.applyPreset);
  const activateFont = useSimulator((s) => s.activateFont);
  const saveCurrentUserPreset = useSimulator((s) => s.saveCurrentUserPreset);
  const saveCurrentTableAsFont = useSimulator((s) => s.saveCurrentTableAsFont);
  const renameUserPreset = useSimulator((s) => s.renameUserPreset);
  const duplicateUserPreset = useSimulator((s) => s.duplicateUserPreset);
  const deleteUserPreset = useSimulator((s) => s.deleteUserPreset);
  const modified = usePresetModified();

  const [saveName, setSaveName] = useState('');
  const [fontName, setFontName] = useState('');
  const [renaming, setRenaming] = useState<{ kind: PresetKind; id: string; name: string } | null>(null);
  /** User preset awaiting delete confirmation in the AlertDialog. */
  const [deleteTarget, setDeleteTarget] = useState<{ kind: PresetKind; id: string; name: string } | null>(null);

  const glyphs = activeFontGlyphs(customFont, activeFontId);
  const tablePresets = useMemo(
    () => [...BUILTIN_TABLE_PRESETS, ...library.tables],
    [library.tables],
  );
  const fontPresets = useMemo(() => [...BUILTIN_FONTS, ...library.fonts], [library.fonts]);

  const handleApply = (p: TablePresetDef) => {
    applyPreset(p.id);
    toast({
      title: 'Preset applied',
      description: `"${p.name}" — K-maps, expressions and circuit re-derived.`,
    });
  };

  const handleActivateFont = (f: FontPresetDef) => {
    activateFont(f.id);
    toast({
      title: 'Font activated',
      description: `"${f.name}" (${f.glyphs.length} glyphs) now drives the font preset.`,
    });
  };

  const handleSavePreset = () => {
    if (saveCurrentUserPreset(saveName)) {
      toast({ title: 'Preset saved', description: `"${saveName.trim()}" added to your library.` });
      setSaveName('');
    } else {
      toast({ title: 'Name required', description: 'Enter a preset name before saving.', variant: 'destructive' });
    }
  };

  const handleSaveFont = () => {
    if (saveCurrentTableAsFont(fontName)) {
      toast({
        title: 'Table converted to font',
        description: `"${fontName.trim()}" — the current table is now an importable font.`,
      });
      setFontName('');
    } else {
      toast({ title: 'Name required', description: 'Enter a font name before saving.', variant: 'destructive' });
    }
  };

  const handleRename = (kind: PresetKind, id: string) => {
    if (!renaming || renaming.kind !== kind || renaming.id !== id) return;
    renameUserPreset(kind, id, renaming.name);
    toast({ title: 'Preset renamed', description: `"${renaming.name.trim()}"` });
    setRenaming(null);
  };

  const exportPreset = (kind: PresetKind, def: TablePresetDef | FontPresetDef) => {
    const file = kind === 'table' ? buildTablePresetFile(def as TablePresetDef) : buildFontPresetFile(def as FontPresetDef);
    downloadText(
      JSON.stringify(file, null, 2),
      `${sanitizeFilename(def.name)}.preset.json`,
      'application/json',
    );
    toast({ title: 'Preset exported', description: `${def.name}.preset.json downloaded.` });
  };

  const cardActions = (kind: PresetKind, id: string, name: string) => {
    const isRenamingThis = renaming?.kind === kind && renaming?.id === id;
    return (
      <div className="flex flex-wrap items-center gap-1">
        {isRenamingThis ? (
          <>
            <Input
              value={renaming!.name}
              onChange={(e) => setRenaming({ kind, id, name: e.target.value.slice(0, 100) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(kind, id);
                if (e.key === 'Escape') setRenaming(null);
              }}
              className="h-7 w-40 px-2 text-xs"
              aria-label="New preset name"
              autoFocus
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRename(kind, id)} aria-label="Confirm rename">
              <Check className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setRenaming(null)} aria-label="Cancel rename">
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost" size="sm" className="h-7 w-7 p-0"
              onClick={() => setRenaming({ kind, id, name })}
              aria-label={`Rename ${name}`}
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 w-7 p-0"
              onClick={() => {
                duplicateUserPreset(kind, id);
                toast({ title: 'Preset duplicated', description: `"${name} (copy)" created.` });
              }}
              aria-label={`Duplicate ${name}`}
              title="Duplicate"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 w-7 p-0"
              onClick={() => exportPreset(kind, kind === 'table'
                ? library.tables.find((t) => t.id === id)!
                : library.fonts.find((f) => f.id === id)!)}
              aria-label={`Export ${name} as preset file`}
              title="Export as sevenseg-preset file"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive"
              onClick={() => setDeleteTarget({ kind, id, name })}
              aria-label={`Delete ${name}`}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Preset gallery
          </DialogTitle>
          <DialogDescription>
            Named truth-table presets and fonts. Applying a preset regenerates the table — every
            derived view updates instantly. User presets sync to the database and can be exported
            as files.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="tables">
          <TabsList className="w-full">
            <TabsTrigger value="tables" className="gap-1.5 flex-1">
              <Table2 className="h-3.5 w-3.5" aria-hidden /> Table presets ({tablePresets.length})
            </TabsTrigger>
            <TabsTrigger value="fonts" className="gap-1.5 flex-1">
              <TypeIcon className="h-3.5 w-3.5" aria-hidden /> Fonts ({fontPresets.length})
            </TabsTrigger>
          </TabsList>

          {/* ---------------- tables ---------------- */}
          <TabsContent value="tables" className="mt-3 space-y-3">
            <div className="flex gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value.slice(0, 100))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); }}
                placeholder="Name for the current table…"
                aria-label="Name for a new preset"
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={handleSavePreset}>
                <Save className="h-3.5 w-3.5" aria-hidden /> Save as preset
              </Button>
            </div>

            <div className="max-h-[52vh] space-y-2 overflow-y-auto custom-scroll pr-1" role="list" aria-label="Table presets">
              {tablePresets.map((p) => {
                const isApplied = appliedPresetId === p.id;
                const isUser = p.id.startsWith('user:');
                return (
                  <div
                    key={p.id}
                    role="listitem"
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      isApplied && 'border-primary/60 bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          {isApplied && (
                            <Badge className="h-5 px-1.5 text-[10px]" title={modified ? 'Applied — table has manual edits' : 'Applied'}>
                              {modified ? 'active · modified' : 'active'}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{p.category}</Badge>
                          <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                            {p.generator === 'literal' ? `${p.inputBits}-bit` : '4/5-bit'}
                          </Badge>
                          {p.generator !== 'literal' && (
                            <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]" title="Regenerates exactly at any input width">
                              {p.generator}
                            </Badge>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{p.description}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={isApplied ? 'secondary' : 'default'}
                        className="h-7 shrink-0"
                        onClick={() => handleApply(p)}
                      >
                        {isApplied ? (modified ? 'Re-apply' : 'Re-apply') : 'Apply'}
                      </Button>
                    </div>
                    <div className="mt-1.5">
                      <TablePreviewStrip preset={p} bits={inputBits} behavior={invalidBehavior} glyphs={glyphs} />
                    </div>
                    {isUser && <div className="mt-2 border-t pt-2">{cardActions('table', p.id, p.name)}</div>}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* ---------------- fonts ---------------- */}
          <TabsContent value="fonts" className="mt-3 space-y-3">
            <div className="flex gap-2">
              <Input
                value={fontName}
                onChange={(e) => setFontName(e.target.value.slice(0, 100))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveFont(); }}
                placeholder="Name for the current table as a font…"
                aria-label="Name for a new font"
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 shrink-0 gap-1.5" onClick={handleSaveFont}>
                <TypeIcon className="h-3.5 w-3.5" aria-hidden /> Save table as font
              </Button>
            </div>

            <div className="max-h-[52vh] space-y-2 overflow-y-auto custom-scroll pr-1" role="list" aria-label="Fonts">
              {fontPresets.map((f) => {
                const isActive = activeFontId === f.id;
                const isUser = !f.builtin;
                return (
                  <div
                    key={f.id}
                    role="listitem"
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      isActive && 'border-primary/60 bg-primary/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{f.name}</span>
                          {isActive && <Badge className="h-5 px-1.5 text-[10px]">active font</Badge>}
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                            {f.glyphs.length} glyphs
                          </Badge>
                          {!f.builtin && <Badge variant="outline" className="h-5 px-1.5 text-[10px]">user</Badge>}
                        </div>
                        {f.description && (
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{f.description}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={isActive ? 'secondary' : 'default'}
                        className="h-7 shrink-0"
                        onClick={() => handleActivateFont(f)}
                      >
                        {isActive ? 'Re-activate' : 'Activate'}
                      </Button>
                    </div>
                    <div className="mt-1.5">
                      <FontPreviewStrip glyphs={f.glyphs} />
                    </div>
                    {isUser && <div className="mt-2 border-t pt-2">{cardActions('font', f.id, f.name)}</div>}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        {/* destructive-action confirmation for user-preset deletes */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete preset?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes “{deleteTarget?.name}” from your preset library. Cancel leaves
                everything untouched; deleting cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  if (deleteTarget) {
                    deleteUserPreset(deleteTarget.kind, deleteTarget.id);
                    toast({ title: 'Preset deleted', description: `“${deleteTarget.name}” removed from the library.` });
                  }
                  setDeleteTarget(null);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
