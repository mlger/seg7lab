/**
 * Truth-table toolbar: row start code, font window (FONT preset mode), shift
 * tools (row / column / all), undo, and the preset re-apply button.
 *
 * Self-contained: subscribes to its own store slices (atomic selectors) and
 * owns the start-code draft state locally.
 */
'use client';

import { useState } from 'react';
import { ArrowLeftRight, ArrowUpDown, Undo2, Type as TypeIcon, RotateCcw } from 'lucide-react';
import { useSimulator, activeFontGlyphs, resolveFontPreset } from '@/lib/store';
import { usePresetModified, useAppliedTablePreset } from '@/lib/useEngine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FONT_GROUPS } from '@/logic/font';

export function TruthTableToolbar() {
  const inputBits = useSimulator((s) => s.inputBits);
  const varNames = useSimulator((s) => s.variableNames);
  const displayMode = useSimulator((s) => s.displayMode);
  const tableStartCode = useSimulator((s) => s.tableStartCode);
  const setTableStartCode = useSimulator((s) => s.setTableStartCode);
  const fontStart = useSimulator((s) => s.fontStart);
  const setFontStart = useSimulator((s) => s.setFontStart);
  const stepFontStart = useSimulator((s) => s.stepFontStart);
  const applyFontPreset = useSimulator((s) => s.applyFontPreset);
  const reapplyPreset = useSimulator((s) => s.reapplyPreset);
  const customFont = useSimulator((s) => s.customFont);
  const activeFontId = useSimulator((s) => s.activeFontId);
  const presetLibrary = useSimulator((s) => s.presetLibrary);
  const clearCustomFont = useSimulator((s) => s.clearCustomFont);
  const currentInput = useSimulator((s) => s.currentInput);
  const activeSegment = useSimulator((s) => s.activeSegment);
  const shiftRow = useSimulator((s) => s.shiftRow);
  const shiftColumn = useSimulator((s) => s.shiftColumn);
  const shiftAllRows = useSimulator((s) => s.shiftAllRows);
  const shiftAllColumns = useSimulator((s) => s.shiftAllColumns);
  const undoShift = useSimulator((s) => s.undoShift);
  const undoSnapshot = useSimulator((s) => s.undoSnapshot);

  const modified = usePresetModified();
  const applied = useAppliedTablePreset();

  /* start-code draft (controlled input with local text override while editing) */
  const [startCodeText, setStartCodeText] = useState<string | null>(null);

  const glyphs = activeFontGlyphs(customFont, activeFontId);
  const activeFontName = resolveFontPreset(activeFontId, presetLibrary)?.name ?? 'Chart font';
  const fontMode = displayMode === 'font';

  const applyStartCode = (raw: string) => {
    const cleaned = raw.replace(/[^01]/g, '');
    if (cleaned.length !== inputBits) return; // E-240 shown via title
    const v = parseInt(cleaned, 2);
    if (!Number.isNaN(v)) setTableStartCode(v);
    setStartCodeText(null);
  };

  const startCodeDisplay =
    startCodeText ?? tableStartCode.toString(2).padStart(inputBits, '0');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/40 px-3 py-2">
      {/* start code */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Rows start at</span>
        <Input
          value={startCodeDisplay}
          onChange={(e) => setStartCodeText(e.target.value.replace(/[^01]/g, '').slice(0, inputBits))}
          onBlur={() => applyStartCode(startCodeText ?? '')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyStartCode(startCodeText ?? '');
          }}
          className="h-7 w-[4.5rem] px-2 text-center font-mono text-xs"
          aria-label={`Starting input code (binary, ${inputBits} bits)`}
          title={`First row's ${varNames.join('')} code, wraps around (e.g. 0001 lists 0001…1111, 0000 last)`}
          inputMode="numeric"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => setTableStartCode(0)}
          title="Reset row order to 0000"
        >
          0{''}
          {'0'.repeat(inputBits - 1)}
        </Button>
      </div>

      {/* font window (FONT preset only) */}
      {fontMode && (
        <div className="flex items-center gap-1.5">
          <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-medium text-muted-foreground">Font window</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => stepFontStart(-1)}
            aria-label="Previous glyph in font"
            title="Previous glyph (window scrolls backward through the font)"
          >
            −
          </Button>
          <Select
            value={String(fontStart)}
            onValueChange={(v) => setFontStart(Number(v))}
          >
            <SelectTrigger
              className="h-7 w-[7.5rem] px-2 font-mono text-xs"
              aria-label="First glyph of the font window"
              title={`Glyph mapped to the first listed code (${glyphs.length} glyphs total)`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {customFont ? (
                glyphs.slice(0, 400).map((g, i) => (
                  <SelectItem key={i} value={String(i)} className="font-mono text-xs">
                    {g.char === ' ' ? '␠ space' : g.char} · {i}
                  </SelectItem>
                ))
              ) : (
                FONT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {group.label}
                    </div>
                    {glyphs.slice(group.from, group.to + 1).map((g, i) => {
                      const idx = group.from + i;
                      return (
                        <SelectItem key={idx} value={String(idx)} className="font-mono text-xs">
                          {g.char === ' ' ? '␠ space' : g.char} · {g.segments || 'blank'}
                        </SelectItem>
                      );
                    })}
                  </div>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => stepFontStart(1)}
            aria-label="Next glyph in font"
            title="Next glyph (window scrolls forward through the font)"
          >
            +
          </Button>
          {customFont && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                  {activeFontName}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64">
                <p className="text-xs">
                  Font <span className="font-semibold">{activeFontName}</span> with{' '}
                  {glyphs.length} glyphs is active — pick more fonts in the preset gallery
                  (header button).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 w-full text-xs"
                  onClick={clearCustomFont}
                >
                  Restore built-in chart font (74 glyphs)
                </Button>
              </PopoverContent>
            </Popover>
          )}
          {!customFont && activeFontId === 'builtin:calculator' && (
            <span className="text-[11px] text-muted-foreground" title="Calculator HEX font active — switch fonts in the preset gallery">
              {activeFontName}
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* shift tools */}
        <div className="flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="Row shifts">
          <span className="px-1 text-[10px] font-medium text-muted-foreground" title={`Row m${currentInput} (selected)`}>
            row
          </span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => shiftRow(currentInput, -1)} aria-label="Rotate selected row's values left" title={`Rotate row m${currentInput}'s values left (A←B←…←DP)`}>
            <ArrowLeftRight className="h-3 w-3 rotate-180" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => shiftRow(currentInput, 1)} aria-label="Rotate selected row's values right" title={`Rotate row m${currentInput}'s values right (A→B→…→DP)`}>
            <ArrowLeftRight className="h-3 w-3" aria-hidden />
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="Column shifts">
          <span className="px-1 text-[10px] font-medium text-muted-foreground" title={`Column ${activeSegment} (click a segment header to change)`}>
            col {activeSegment}
          </span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => shiftColumn(activeSegment, -1)} aria-label={`Rotate segment ${activeSegment} column up`} title={`Rotate column ${activeSegment}'s values up (click a segment header to pick another)`}>
            <ArrowUpDown className="h-3 w-3 rotate-180" aria-hidden />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => shiftColumn(activeSegment, 1)} aria-label={`Rotate segment ${activeSegment} column down`} title={`Rotate column ${activeSegment}'s values down`}>
            <ArrowUpDown className="h-3 w-3" aria-hidden />
          </Button>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5" role="group" aria-label="Shift everything">
          <span className="px-1 text-[10px] font-medium text-muted-foreground">all</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => shiftAllRows(-1)} title="Rotate every row's pattern up one position (wrap)">
            rows ↑
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => shiftAllRows(1)} title="Rotate every row's pattern down one position (wrap)">
            rows ↓
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => shiftAllColumns(-1)} title="Rotate every segment column up one position (wrap)">
            cols ↑
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => shiftAllColumns(1)} title="Rotate every segment column down one position (wrap)">
            cols ↓
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          onClick={undoShift}
          disabled={!undoSnapshot}
          aria-label="Undo last shift"
          title="Undo the last shift operation"
        >
          <Undo2 className="h-3 w-3" aria-hidden /> undo
        </Button>
        {modified && applied.id && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px] text-amber-600 dark:text-amber-400"
            onClick={fontMode ? applyFontPreset : reapplyPreset}
            title={`Discard edits and re-apply the preset "${applied.name}"`}
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> re-apply {fontMode ? 'font' : 'preset'}
          </Button>
        )}
      </div>
    </div>
  );
}
