/**
 * Truth table: auto-generated for the selected input width, fully editable
 * (click an output cell to cycle 0 → 1 → X). Clicking a row selects that input.
 */
'use client';

import { useEffect, useRef } from 'react';
import { Table as TableIcon } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines, useCurrentInput } from '@/lib/useEngine';
import { ExplainBlock } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES, type SegmentOutput } from '@/types/simulator';
import { formatHex } from '@/utils/binary';

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
  const engines = useEngines();
  const current = useCurrentInput();
  const rowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  const varNames = current.bits === 5 ? ['E', 'D', 'C', 'B', 'A'] : ['D', 'C', 'B', 'A'];

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
            <span>{totalOnes} active segments</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-96 overflow-auto rounded-lg border custom-scroll">
          <Table className="min-w-[620px] border-collapse text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead
                  colSpan={varNames.length + 2}
                  className="border-r border-border/70 bg-muted px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Inputs
                </TableHead>
                <TableHead
                  colSpan={SEGMENT_NAMES.length}
                  className="bg-muted px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Segment outputs (click to edit: 0 → 1 → X)
                </TableHead>
              </TableRow>
              <TableRow className="bg-muted/80 hover:bg-muted/80">
                {varNames.map((v) => (
                  <TableHead key={v} className="bg-muted/80 px-2 py-1 text-center font-mono text-xs">
                    {v}
                  </TableHead>
                ))}
                <TableHead className="bg-muted/80 px-2 py-1 text-center font-mono text-xs">Dec</TableHead>
                <TableHead className="border-r border-border/70 bg-muted/80 px-2 py-1 text-center font-mono text-xs">Hex</TableHead>
                {SEGMENT_NAMES.map((seg) => (
                  <TableHead
                    key={seg}
                    className={cn(
                      'bg-muted/80 px-1 py-1 text-center font-mono text-xs',
                      seg === 'DP' && 'border-l border-border/70',
                    )}
                    title={`Output segment ${seg}`}
                  >
                    {seg}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row) => {
                const active = row.input === currentInput;
                const bits = row.input.toString(2).padStart(table.inputBits, '0');
                return (
                  <TableRow
                    key={row.input}
                    ref={(el) => {
                      rowRefs.current[row.input] = el;
                    }}
                    className={cn(
                      'cursor-pointer',
                      active ? 'bg-primary/10' : 'hover:bg-muted/50',
                    )}
                    onClick={() => setInput(row.input)}
                    aria-label={`Select input row ${row.input}`}
                  >
                    {[...bits].map((b, i) => (
                      <TableCell key={i} className="px-2 py-1 text-center font-mono text-xs tabular-nums">
                        {b}
                      </TableCell>
                    ))}
                    <TableCell className="px-2 py-1 text-center font-mono text-xs tabular-nums">
                      {row.input}
                    </TableCell>
                    <TableCell className="border-r border-border/70 px-2 py-1 text-center font-mono text-xs">
                      {formatHex(row.input)}
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
          Inputs are enumerated exhaustively ({varNames.join(' ')} with{' '}
          {varNames[0]} as MSB). Output cells accept <span className="font-mono">0</span>,{' '}
          <span className="font-mono">1</span> or <span className="font-mono">X</span> (don&apos;t
          care, used by the minimizer). Every edit instantly re-derives the K-maps, Boolean
          expressions and logic circuit.
        </p>

        {explain && (
          <ExplainBlock title="How the truth table works">
            <p>
              A truth table lists every input combination and the required output for each segment.
              With {current.bits} inputs there are 2^{current.bits} = {table.rows.length} rows. Row{' '}
              <span className="font-mono">m{current.input}</span> is currently active
              (<span className="font-mono">{current.binary}</span>).
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
              Example: with input <span className="font-mono">0101</span> (decimal 5), the table row
              drives segments A, C, D, F, G to 1 — lighting the digit &quot;5&quot;.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
