/**
 * Truth-table help: the always-visible usage paragraph and the explain-mode
 * walkthrough (rows/minterms/preview editing/variable names/font window/shift
 * tools). Fully presentational — derived values arrive as props so this adds
 * no extra useEngines/useCurrentInput computation.
 */
'use client';

import { ExplainBlock } from '../ExplainBlock';
import type { SegmentEngineMap } from '@/logic/engine';
import type { FontGlyph } from '@/logic/font';
import { inputVarNames } from '@/utils/binary';
import type { InputWidth, SegmentName, TruthTable } from '@/types/simulator';

interface TruthTableHelpProps {
  explain: boolean;
  table: TruthTable;
  inputBits: InputWidth;
  varNames: string[];
  tableStartCode: number;
  current: { input: number; bits: number; binary: string };
  engines: SegmentEngineMap;
  activeSegment: SegmentName;
  fontMode: boolean;
  glyphs: FontGlyph[];
  fontStart: number;
}

export function TruthTableHelp({
  explain, table, inputBits, varNames, tableStartCode, current, engines, activeSegment,
  fontMode, glyphs, fontStart,
}: TruthTableHelpProps) {
  return (
    <>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Every row shows a <span className="font-medium">live preview</span> (after the Hex column) of
        what the display renders for that input — its segments are directly clickable to toggle
        0 ↔ 1, and dragging a preview onto another row copies that pattern (inputs are excluded
        and never change). Keyboard equivalent: <kbd className="rounded border bg-muted px-1 font-mono">Tab</kbd> to
        a row, <kbd className="rounded border bg-muted px-1 font-mono">Enter</kbd> to select it,{' '}
        <kbd className="rounded border bg-muted px-1 font-mono">C</kbd> to copy its outputs and{' '}
        <kbd className="rounded border bg-muted px-1 font-mono">V</kbd> on another row to paste them.
        Input variables are <span className="font-mono">{varNames.join(' ')}</span> —
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
    </>
  );
}
