/**
 * One memoized truth-table row.
 *
 * Extracted from the card so drag feedback (dropRow changes) and other parent
 * re-renders never re-render the other 15–31 rows: every prop is a primitive,
 * a stable ref from the immutable store, or a useCallback handler, so
 * React.memo's shallow compare holds.
 *
 * Keyboard support: the row itself is focusable (Tab) — Enter/Space select it,
 * "c" copies its segment outputs to an internal clipboard and "v" pastes the
 * clipboard onto the focused row (the keyboard twin of drag-to-copy).
 *
 * HARD RULE (do not break): the parent must pass STABLE handlers — never
 * inline lambdas in the row map, or the memoization silently stops working.
 */
'use client';

import { memo } from 'react';
import { Table, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  SEGMENT_NAMES,
  type InputWidth,
  type SegmentName,
  type SegmentOutput,
  type TruthTableRow,
} from '@/types/simulator';
import { formatHex } from '@/utils/binary';
import { GlyphPreview } from '../SevenSegmentDisplay';

function cellColor(v: SegmentOutput): string {
  return v === 1
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : v === 'X'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'border-transparent text-muted-foreground';
}

export interface TruthRowProps {
  row: TruthTableRow;
  inputBits: InputWidth;
  /** Character label for the Char column (font glyph / hex digit / null). */
  char: string | null;
  active: boolean;
  isDragSource: boolean;
  isDropTarget: boolean;
  registerRef: (input: number, el: HTMLTableRowElement | null) => void;
  onSelectRow: (input: number) => void;
  onCycleCell: (input: number, segment: SegmentName) => void;
  onTogglePreviewSegment: (input: number, segment: SegmentName) => void;
  onDragRowStart: (input: number) => void;
  onDragRowEnd: () => void;
  onRowDrop: (e: React.DragEvent<HTMLTableRowElement>, targetInput: number) => void;
  /** Drop-hover highlight setter (parent guards against redundant updates). */
  onRowHover: (input: number) => void;
  onRowLeave: (input: number) => void;
  /** Key handler for the focused row (select / copy / paste). */
  onRowKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>, input: number) => void;
}

export const TruthRow = memo(function TruthRow({
  row, inputBits, char, active, isDragSource, isDropTarget,
  registerRef, onSelectRow, onCycleCell, onTogglePreviewSegment,
  onDragRowStart, onDragRowEnd, onRowDrop, onRowHover, onRowLeave, onRowKeyDown,
}: TruthRowProps) {
  const bits = row.input.toString(2).padStart(inputBits, '0');
  return (
    <TableRow
      ref={(el) => {
        registerRef(row.input, el);
      }}
      tabIndex={0}
      className={cn(
        'cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        active ? 'bg-primary/10' : 'hover:bg-muted/50',
        isDragSource && 'opacity-50',
        isDropTarget && 'bg-primary/15 ring-2 ring-inset ring-primary/50',
      )}
      onClick={() => onSelectRow(row.input)}
      onKeyDown={(e) => onRowKeyDown(e, row.input)}
      aria-label={`Truth table row m${row.input} (${bits}) — Enter selects, C copies outputs, V pastes`}
      aria-keyshortcuts="Enter Space c v"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/x-sevenseg-row')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        onRowHover(row.input);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onRowLeave(row.input);
        }
      }}
      onDrop={(e) => onRowDrop(e, row.input)}
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
            onDragRowStart(row.input);
          }}
          onDragEnd={() => {
            onDragRowEnd();
          }}
          title={`Pattern of m${row.input} — click a segment to toggle it (0 ↔ 1); drag onto another row to copy this pattern (inputs are excluded and stay unchanged)`}
        >
          <GlyphPreview
            outputs={row.outputs}
            interactive
            onSegmentClick={(seg) => {
              onTogglePreviewSegment(row.input, seg);
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
                onCycleCell(row.input, seg);
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
});
