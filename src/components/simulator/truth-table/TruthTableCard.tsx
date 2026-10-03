/**
 * Truth table: auto-generated for the selected input width, fully editable
 * (click an output cell to cycle 0 → 1 → X, or click a segment directly on the
 * row's preview glyph). Clicking a row selects that input.
 *
 * This module is the composition root + state owner: stable per-row handlers
 * (see the handler block below — they keep TruthRow's React.memo effective),
 * drag-to-copy + keyboard clipboard, ordered rows / per-row character labels,
 * and the table shell. Toolbar, header and help/explain live in sibling files.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Table as TableIcon } from 'lucide-react';
import { useSimulator, activeFontGlyphs } from '@/lib/store';
import { useEngines, useCurrentInput } from '@/lib/useEngine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody } from '@/components/ui/table';
import { SEGMENT_NAMES, type SegmentName, type SegmentPatternX } from '@/types/simulator';
import { cn } from '@/lib/utils';
import { listedCodes, fontCharAt } from '@/logic/font';
import { valueToChar } from '@/logic/truthTable';
import { toast } from '@/hooks/use-toast';
import { TruthRow } from './TruthRow';
import { TruthTableToolbar } from './TruthTableToolbar';
import { TruthTableHeader } from './TruthTableHeader';
import { TruthTableHelp } from './TruthTableHelp';

export function TruthTableCard() {
  const table = useSimulator((s) => s.truthTable);
  const currentInput = useSimulator((s) => s.currentInput);
  const setInput = useSimulator((s) => s.setInput);
  const cycleCell = useSimulator((s) => s.cycleCell);
  const explain = useSimulator((s) => s.explainMode);
  const activeSegment = useSimulator((s) => s.activeSegment);
  const inputBits = useSimulator((s) => s.inputBits);
  const displayMode = useSimulator((s) => s.displayMode);
  const tableStartCode = useSimulator((s) => s.tableStartCode);
  const fontStart = useSimulator((s) => s.fontStart);
  const customFont = useSimulator((s) => s.customFont);
  const activeFontId = useSimulator((s) => s.activeFontId);
  const toggleSegmentOnDisplay = useSimulator((s) => s.toggleSegmentOnDisplay);
  const setRowPattern = useSimulator((s) => s.setRowPattern);
  const varNames = useSimulator((s) => s.variableNames);

  const engines = useEngines();
  const current = useCurrentInput();
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  /* ---- row drag-and-drop (copy output pattern; inputs excluded) ---- */
  const [dragRow, setDragRow] = useState<number | null>(null);
  const [dropRow, setDropRow] = useState<number | null>(null);

  /* ---- keyboard clipboard (copy/paste row outputs — the drag-to-copy twin) ---- */
  const rowClipboardRef = useRef<{ source: number; outputs: SegmentPatternX } | null>(null);

  const glyphs = activeFontGlyphs(customFont, activeFontId);
  const fontMode = displayMode === 'font';

  const handleRowDrop = useCallback((e: React.DragEvent<HTMLTableRowElement>, targetInput: number) => {
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
  }, [table, inputBits, setRowPattern]);

  /* ---- stable per-row handlers (keep TruthRow memoization effective) ---- */
  const registerRowRef = useCallback((input: number, el: HTMLTableRowElement | null) => {
    rowRefs.current[input] = el;
  }, []);
  const handleSelectRow = useCallback((input: number) => {
    setInput(input);
  }, [setInput]);
  const handleTogglePreviewSegment = useCallback((input: number, seg: SegmentName) => {
    setInput(input);
    toggleSegmentOnDisplay(input, seg);
  }, [setInput, toggleSegmentOnDisplay]);
  const handleDragRowStart = useCallback((input: number) => {
    setDragRow(input);
  }, []);
  const handleDragRowEnd = useCallback(() => {
    setDragRow(null);
    setDropRow(null);
  }, []);
  /** Only move the highlight when the hovered row actually changed — repeated
   *  dragover events on the same row bail out without a re-render. */
  const handleRowHover = useCallback((input: number) => {
    setDropRow((prev) => (prev === input ? prev : input));
  }, []);
  const handleRowLeave = useCallback((input: number) => {
    setDropRow((prev) => (prev === input ? null : prev));
  }, []);
  /** Keyboard interactions on a focused row: Enter/Space select it, "c" copies
   *  its segment outputs into an internal clipboard, "v" pastes the clipboard
   *  onto the focused row — the exact same apply logic + toast the drag path
   *  uses (setRowPattern, inputs excluded). */
  const handleRowKeyDown = useCallback((e: React.KeyboardEvent<HTMLTableRowElement>, input: number) => {
    // Inner controls (segment toggle buttons) handle their own keys — only act
    // when the row itself is focused.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setInput(input);
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'c') {
      const source = table.rows[input];
      if (!source) return;
      rowClipboardRef.current = { source: input, outputs: source.outputs };
      toast({
        title: 'Outputs copied',
        description: `m${input} — focus another row and press V to paste its segment outputs there.`,
      });
      return;
    }
    if (key === 'v') {
      const clip = rowClipboardRef.current;
      if (!clip) {
        toast({ title: 'Nothing to paste', description: 'Press C on a row first to copy its segment outputs.' });
        return;
      }
      if (clip.source === input) return;
      setRowPattern(input, clip.outputs);
      toast({
        title: 'Pattern copied',
        description: `m${clip.source} → m${input}: segment outputs copied, inputs excluded (row stays ${input.toString(2).padStart(inputBits, '0')}).`,
      });
    }
  }, [table, inputBits, setInput, setRowPattern]);

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
        <TruthTableToolbar />

        <div className="max-h-96 overflow-auto rounded-lg border custom-scroll">
          <Table className="min-w-[600px] border-collapse text-sm">
            <TruthTableHeader />
            <TableBody>
              {orderedRows.map((row) =>
                row ? (
                  <TruthRow
                    key={row.input}
                    row={row}
                    inputBits={inputBits}
                    char={rowChar(row.input)}
                    active={row.input === currentInput}
                    isDragSource={dragRow === row.input}
                    isDropTarget={dropRow === row.input && dragRow !== null && dragRow !== row.input}
                    registerRef={registerRowRef}
                    onSelectRow={handleSelectRow}
                    onCycleCell={cycleCell}
                    onTogglePreviewSegment={handleTogglePreviewSegment}
                    onDragRowStart={handleDragRowStart}
                    onDragRowEnd={handleDragRowEnd}
                    onRowDrop={handleRowDrop}
                    onRowHover={handleRowHover}
                    onRowLeave={handleRowLeave}
                    onRowKeyDown={handleRowKeyDown}
                  />
                ) : null,
              )}
            </TableBody>
          </Table>
        </div>

        <TruthTableHelp
          explain={explain}
          table={table}
          inputBits={inputBits}
          varNames={varNames}
          tableStartCode={tableStartCode}
          current={current}
          engines={engines}
          activeSegment={activeSegment}
          fontMode={fontMode}
          glyphs={glyphs}
          fontStart={fontStart}
        />
      </CardContent>
    </Card>
  );
}
