/**
 * Truth table: auto-generated for the selected input width, fully editable
 * (click an output cell to cycle 0 → 1 → X, or click a segment directly on the
 * row's preview glyph). Clicking a row selects that input.
 *
 * Features:
 *  - Live mini 7-segment preview of every row (derived from the table itself),
 *    shown after the Hex column; its segments are clickable to toggle cells.
 *  - Drag a row's preview glyph onto another row to copy its output pattern —
 *    inputs are excluded, they always stay untouched.
 *  - Input variables default to A B C D / A B C D E (A = MSB) and can be
 *    renamed by clicking a variable header — names flow through expressions,
 *    K-map, circuit and every export.
 *  - Row order can start from any code (e.g. ABCD = 0001, wrapping around).
 *  - Shift tools: rotate one row's values, one segment's column, or the whole
 *    table (all rows / all columns) — with one-level undo.
 *  - FONT preset window controls (which glyph starts the mapping).
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Table as TableIcon, ArrowLeftRight, ArrowUpDown, Undo2, Type as TypeIcon, RotateCcw, Pencil } from 'lucide-react';
import { useSimulator, activeFontGlyphs, resolveFontPreset } from '@/lib/store';
import { useEngines, useCurrentInput, usePresetModified, useAppliedTablePreset } from '@/lib/useEngine';
import { ExplainBlock } from './ExplainBlock';
import { GlyphPreview } from './SevenSegmentDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES, type SegmentOutput } from '@/types/simulator';
import { formatHex, inputVarNames } from '@/utils/binary';
import { fontCharAt, listedCodes, FONT_GROUPS } from '@/logic/font';
import { valueToChar } from '@/logic/truthTable';
import { toast } from '@/hooks/use-toast';

function cellColor(v: SegmentOutput): string {
  return v === 1
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : v === 'X'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'border-transparent text-muted-foreground';
}

export function TruthTableCard() {
  const table = useSimulator((s) => s.truthTable);
  const currentInput = useSimulator((s) => s.currentInput);
  const setInput = useSimulator((s) => s.setInput);
  const cycleCell = useSimulator((s) => s.cycleCell);
  const explain = useSimulator((s) => s.explainMode);
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const inputBits = useSimulator((s) => s.inputBits);
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
  const shiftRow = useSimulator((s) => s.shiftRow);
  const shiftColumn = useSimulator((s) => s.shiftColumn);
  const shiftAllRows = useSimulator((s) => s.shiftAllRows);
  const shiftAllColumns = useSimulator((s) => s.shiftAllColumns);
  const undoShift = useSimulator((s) => s.undoShift);
  const undoSnapshot = useSimulator((s) => s.undoSnapshot);
  const toggleSegmentOnDisplay = useSimulator((s) => s.toggleSegmentOnDisplay);
  const setRowPattern = useSimulator((s) => s.setRowPattern);
  const setVariableName = useSimulator((s) => s.setVariableName);
  const resetVariableNames = useSimulator((s) => s.resetVariableNames);
  const engines = useEngines();
  const current = useCurrentInput();
  const modified = usePresetModified();
  const applied = useAppliedTablePreset();
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});
  const [startCodeText, setStartCodeText] = useState<string | null>(null);

  /* ---- inline variable-name editing ---- */
  const [editingVar, setEditingVar] = useState<number | null>(null);
  const [varDraft, setVarDraft] = useState('');

  /* ---- row drag-and-drop (copy output pattern; inputs excluded) ---- */
  const [dragRow, setDragRow] = useState<number | null>(null);
  const [dropRow, setDropRow] = useState<number | null>(null);

  const varNames = useSimulator((s) => s.variableNames);
  const namesCustomized = varNames.join('') !== inputVarNames(inputBits).join('');
  const glyphs = activeFontGlyphs(customFont, activeFontId);
  const activeFontName = resolveFontPreset(activeFontId, presetLibrary)?.name ?? 'Chart font';
  const fontMode = displayMode === 'font';

  const commitVarName = (index: number, raw: string) => {
    setEditingVar(null);
    const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 3);
    if (!clean || clean === varNames[index]) return;
    if (varNames.some((n, i) => i !== index && n === clean)) {
      toast({
        title: 'Name already in use',
        description: `“${clean}” is taken by another variable — names must stay unique.`,
        variant: 'destructive',
      });
      return;
    }
    setVariableName(index, clean);
  };

  const handleRowDrop = (e: React.DragEvent<HTMLTableRowElement>, targetInput: number) => {
    e.preventDefault();
    setDropRow(null);
    const source = Number(e.dataTransfer.getData('text/x-sevenseg-row'));
    if (!Number.isInteger(source) || source === targetInput || source < 0 || source >= table.rows.length) return;
    const sourceRow = table.rows.find((r) => r.input === source);
    if (!sourceRow) return;
    setRowPattern(targetInput, sourceRow.outputs);
    toast({
      title: 'Pattern copied',
      description: `m${source} → m${targetInput}: segment outputs copied, inputs excluded (row stays ${targetInput.toString(2).padStart(inputBits, '0')}).`,
    });
  };

  /** Rows in listed order (from tableStartCode, wrapping). */
  const orderedRows = useMemo(
    () => listedCodes(inputBits, tableStartCode).map((code) => table.rows[code]),
    [table, inputBits, tableStartCode],
  );

  /** Character label for a row: font glyph, hex digit, or none. */
  const rowChar = useMemo(() => {
    return (code: number): string | null => {
      if (fontMode) return fontCharAt(code, inputBits, fontStart, tableStartCode, glyphs);
      if (displayMode === 'hex') return valueToChar(code);
      if (displayMode === 'decimal') return code <= 9 ? String(code) : null;
      return null;
    };
  }, [fontMode, displayMode, inputBits, fontStart, tableStartCode, glyphs]);

  useEffect(() => {
    rowRefs.current[currentInput]?.scrollIntoView({ block: 'nearest' });
  }, [currentInput]);

  const totalOnes = SEGMENT_NAMES.filter((s) => engines[s].ones.length > 0).length;

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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <TableIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
            TRUTH TABLE
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <Badge variant="secondary" className="font-mono">
              {table.rows.length} rows × {SEGMENT_NAMES.length} outputs
            </Badge>
            <span className="inline-flex items-center gap-1">
              <span className={cn('h-1.5 w-1.5 rounded-full', 'animate-pulse bg-emerald-500')} aria-hidden />
              live
            </span>
            <span>{totalOnes} active segments</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---- toolbar: start code · font window · shifts ---- */}
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

        <div className="max-h-96 overflow-auto rounded-lg border custom-scroll">
          <Table className="min-w-[720px] border-collapse text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead
                  colSpan={varNames.length + 3}
                  className="border-r border-border/70 bg-muted px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-1.5">
                    Inputs
                    {namesCustomized && (
                      <button
                        type="button"
                        onClick={resetVariableNames}
                        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] font-normal normal-case tracking-normal transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={`Reset variable names to ${inputVarNames(inputBits).join(' ')}`}
                        aria-label="Reset variable names to defaults"
                      >
                        <RotateCcw className="h-2.5 w-2.5" aria-hidden /> {varNames.join('')}
                      </button>
                    )}
                  </span>
                </TableHead>
                <TableHead
                  colSpan={SEGMENT_NAMES.length + 1}
                  className="bg-muted px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Segment outputs (click to edit: 0 → 1 → X)
                </TableHead>
              </TableRow>
              <TableRow className="bg-muted/80 hover:bg-muted/80">
                {varNames.map((v, i) => (
                  <TableHead key={`${i}-${v}`} className="bg-muted/80 px-1 py-1 text-center font-mono text-xs">
                    {editingVar === i ? (
                      <Input
                        autoFocus
                        value={varDraft}
                        onChange={(e) => setVarDraft(e.target.value.slice(0, 8))}
                        onBlur={() => commitVarName(i, varDraft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitVarName(i, varDraft);
                          if (e.key === 'Escape') setEditingVar(null);
                        }}
                        className="h-6 w-12 px-1 text-center font-mono text-xs"
                        aria-label={`Rename variable ${v}`}
                        title="Enter to apply · Escape to cancel"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingVar(i);
                          setVarDraft(v);
                        }}
                        className="group/var inline-flex items-center gap-0.5 rounded border-b border-dashed border-muted-foreground/60 px-1.5 py-0.5 font-mono text-xs transition-colors hover:border-foreground/60 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={`Rename variable ${v} (weight ${1 << (inputBits - 1 - i)}) — names flow into expressions, K-map, circuit and exports`}
                        aria-label={`Rename variable ${v}`}
                      >
                        {v}
                        <Pencil className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover/var:opacity-60" aria-hidden />
                      </button>
                    )}
                  </TableHead>
                ))}
                <TableHead className="bg-muted/80 px-2 py-1 text-center font-mono text-xs">Dec</TableHead>
                <TableHead className="bg-muted/80 px-2 py-1 text-center font-mono text-xs">Hex</TableHead>
                <TableHead className="border-r border-border/70 bg-muted/80 px-2 py-1 text-center font-mono text-xs">
                  {fontMode ? 'Char' : '·'}
                </TableHead>
                <TableHead
                  className="bg-muted/80 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  title="Live pattern preview — click a segment to toggle it; drag onto another row to copy the pattern (inputs stay unchanged)"
                >
                  Preview
                </TableHead>
                {SEGMENT_NAMES.map((seg) => (
                  <TableHead key={seg} className="bg-muted/80 p-0.5 text-center">
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded px-1 py-1 font-mono text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        seg === activeSegment && 'bg-accent text-accent-foreground',
                        seg === 'DP' && 'border-l border-border/70',
                      )}
                      onClick={() => setActiveSegment(seg)}
                      aria-pressed={seg === activeSegment}
                      title={`Output segment ${seg} — click to target column shifts`}
                    >
                      {seg}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedRows.map((row) => {
                if (!row) return null;
                const active = row.input === currentInput;
                const bits = row.input.toString(2).padStart(inputBits, '0');
                const char = rowChar(row.input);
                const isDropTarget = dropRow === row.input && dragRow !== null && dragRow !== row.input;
                return (
                  <TableRow
                    key={row.input}
                    ref={(el) => {
                      rowRefs.current[row.input] = el;
                    }}
                    className={cn(
                      'cursor-pointer',
                      active ? 'bg-primary/10' : 'hover:bg-muted/50',
                      dragRow === row.input && 'opacity-50',
                      isDropTarget && 'bg-primary/15 ring-2 ring-inset ring-primary/50',
                    )}
                    onClick={() => setInput(row.input)}
                    aria-label={`Select input row ${row.input}`}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes('text/x-sevenseg-row')) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      if (dropRow !== row.input) setDropRow(row.input);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDropRow((d) => (d === row.input ? null : d));
                      }
                    }}
                    onDrop={(e) => handleRowDrop(e, row.input)}
                  >
                    {[...bits].map((b, i) => (
                      <TableCell key={i} className="px-2 py-1 text-center font-mono text-xs tabular-nums">
                        {b}
                      </TableCell>
                    ))}
                    <TableCell className="px-2 py-1 text-center font-mono text-xs tabular-nums">
                      {row.input}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-center font-mono text-xs">
                      {formatHex(row.input)}
                    </TableCell>
                    <TableCell className="border-r border-border/70 px-2 py-1 text-center font-mono text-xs">
                      {char === null ? '' : char === ' ' ? '␠' : char}
                    </TableCell>
                    <TableCell className="px-1 py-0.5 text-center">
                      <div
                        className="group relative flex cursor-grab flex-col items-center leading-none active:cursor-grabbing"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/x-sevenseg-row', String(row.input));
                          e.dataTransfer.effectAllowed = 'copy';
                          setDragRow(row.input);
                        }}
                        onDragEnd={() => {
                          setDragRow(null);
                          setDropRow(null);
                        }}
                        title={`Pattern of m${row.input} — click a segment to toggle it (0 ↔ 1); drag onto another row to copy this pattern (inputs are excluded and stay unchanged)`}
                      >
                        <GlyphPreview
                          outputs={row.outputs}
                          interactive
                          onSegmentClick={(seg) => {
                            setInput(row.input);
                            toggleSegmentOnDisplay(row.input, seg);
                          }}
                          className="relative z-0 h-10 origin-center transition-transform duration-150 ease-out group-hover:z-20 group-hover:scale-[1.65]"
                          label={`Pattern of row ${row.input}${char ? ` (${char})` : ''} — segments clickable`}
                        />
                      </div>
                    </TableCell>
                    {SEGMENT_NAMES.map((seg) => {
                      const v = row.outputs[seg];
                      return (
                        <TableCell
                          key={seg}
                          className={cn('px-1 py-1 text-center', seg === 'DP' && 'border-l border-border/70')}
                        >
                          <button
                            type="button"
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded border font-mono text-xs font-semibold transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              cellColor(v),
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              cycleCell(row.input, seg);
                            }}
                            aria-label={`Row ${row.input} segment ${seg}: ${v}, click to cycle`}
                            title={`m${row.input} · ${seg} = ${v} — click to cycle`}
                          >
                            {v}
                          </button>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          Every row shows a <span className="font-medium">live preview</span> (after the Hex column) of
          what the display renders for that input — its segments are directly clickable to toggle
          0 ↔ 1, and dragging a preview onto another row copies that pattern (inputs are excluded
          and never change). Input variables are <span className="font-mono">{varNames.join(' ')}</span> —
          click a variable header to rename it. Rows are listed starting from{' '}
          <span className="font-mono">{tableStartCode.toString(2).padStart(inputBits, '0')}</span>
          {tableStartCode !== 0 && ' (wrapping around)'}. The shift tools rotate values within the
          selected row, within the selected segment column (click a segment header to pick it), or
          across the whole table — every change instantly re-derives the K-maps, Boolean
          expressions, logic circuit and display.
        </p>

        {explain && (
          <ExplainBlock title="How the truth table works">
            <p>
              A truth table lists every input combination and the required output for each segment.
              With {current.bits} inputs there are 2^{current.bits} = {table.rows.length} rows. Row{' '}
              <span className="font-mono">m{current.input}</span> is currently active
              (<span className="font-mono">{current.binary}</span>).
              {tableStartCode !== 0 && (
                <>
                  {' '}The row order starts at{' '}
                  <span className="font-mono">
                    {tableStartCode.toString(2).padStart(inputBits, '0')}
                  </span>{' '}
                  because the start code is set to {tableStartCode} — the mapping itself is
                  unchanged, only the listing order (and font assignment order) rotates.
                </>
              )}
            </p>
            <p>
              For segment <span className="font-mono">{activeSegment}</span>, the minterm set is{' '}
              <span className="font-mono">Σm({engines[activeSegment].ones.join(', ') || '—'})</span>{' '}
              and the don&apos;t-cares are{' '}
              <span className="font-mono">d({engines[activeSegment].dontCares.join(', ') || '—'})</span>.
              Minterms are rows where the output is 1; the minimizer may treat X rows as either 0 or 1,
              whichever yields the simplest logic.
            </p>
            <p>
              The preview column is a direct editor: click any segment of a row&apos;s glyph to toggle
              that single cell between 0 and 1 (a don&apos;t-care becomes 1) — the same edit the big
              display offers, one row at a time. Dragging a preview glyph onto another row copies
              its segment outputs to the target row; the input columns are excluded from the drag,
              so the mapping (which input shows which pattern) is what changes, never the inputs
              themselves.
            </p>
            <p>
              Variables default to <span className="font-mono">{inputVarNames(inputBits).join(' ')}</span>{' '}
              (MSB first, {varNames[0]} has weight {1 << (inputBits - 1)}). Click a variable header in
              the table to rename it (A-Z, 0-9, _; up to 3 characters, unique) — the new name
              immediately appears in the Boolean expressions, K-map labels, circuit inputs, parser
              and every file export. When the input width changes, names reset to the defaults.
            </p>
            {fontMode && (
              <p>
                The FONT preset maps {glyphs.length} glyphs from the reference chart onto the codes
                in listed order: glyph <span className="font-mono">&quot;{glyphs[fontStart]?.char}&quot;</span>{' '}
                (index {fontStart}) is assigned to{' '}
                <span className="font-mono">{tableStartCode.toString(2).padStart(inputBits, '0')}</span>, the
                next glyph to the next code, wrapping around both the font and the code space.
              </p>
            )}
            <p>
              Shift operations are pattern tools: rotating a row slides its segment values
              (A→B→…→DP→A), rotating a column slides one segment&apos;s outputs across codes, and
              the &quot;all&quot; buttons rotate the entire mapping — useful for building scrolling
              marquees or exploring how K-map groupings change.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
