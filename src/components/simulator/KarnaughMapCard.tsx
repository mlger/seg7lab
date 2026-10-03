/**
 * Karnaugh map: Gray-code ordered, clickable cells (0/1/X), automatic prime
 * implicant groups with colors, sizes, minterms, essential flags and
 * include/exclude controls for non-essential groups. 5-bit mode renders the
 * two-plane representation (E=0 / E=1).
 */
'use client';

import { useMemo, useState } from 'react';
import { Grid3x3, Eye, EyeOff, Star, AlertTriangle } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines, useCurrentInput } from '@/lib/useEngine';
import { ExplainBlock, TermView } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { groupColor, hexToRgba } from '@/lib/colors';
import { type CoverForm, type KMapGroup } from '@/types/simulator';
import { groupCellRects } from '@/logic/kmap';
import { SegmentSelector } from './shared/SegmentSelector';

const CELL = 48; // px

interface GroupRect {
  x: number;
  y: number;
  w: number;
  h: number;
  single: boolean;
  row: number;
  col: number;
}

/** Split a group's cells into drawable rectangles (handles wrap-around). */
function groupRects(group: KMapGroup, plane: number): GroupRect[] {
  return groupCellRects(group, plane).map((r) => ({
    x: r.c0 * CELL,
    y: r.r0 * CELL,
    w: (r.c1 - r.c0 + 1) * CELL,
    h: (r.r1 - r.r0 + 1) * CELL,
    single: r.single,
    row: r.r0,
    col: r.c0,
  }));
}

export function KarnaughMapCard() {
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);
  const expressionForm = useSimulator((s) => s.expressionForm);
  const kmapShowMinterms = useSimulator((s) => s.kmapShowMinterms);
  const setKmapShowMinterms = useSimulator((s) => s.setKmapShowMinterms);
  const cycleCell = useSimulator((s) => s.cycleCell);
  const toggleCoverGroup = useSimulator((s) => s.toggleCoverGroup);
  const resetCoverOverrides = useSimulator((s) => s.resetCoverOverrides);
  const explain = useSimulator((s) => s.explainMode);
  const currentInput = useSimulator((s) => s.currentInput);

  const engines = useEngines();
  const current = useCurrentInput();
  const engine = engines[activeSegment];

  const form: CoverForm = expressionForm === 'pos' || expressionForm === 'cpos' ? 'pos' : 'sop';
  const groups = form === 'sop' ? engine.sopGroups : engine.posGroups;
  const uncovered = form === 'sop' ? engine.uncoveredSop : engine.uncoveredPos;
  const activeTerms = form === 'sop' ? engine.activeSopTerms : engine.activePosTerms;
  // Honesty flag: false only when the minimizer's search budget was exhausted
  // (never happens for ≤ 5 variables) and a greedy heuristic cover was returned.
  const coverExact = (form === 'sop' ? engine.sop : engine.pos).exact;
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);

  const hasOverrides = useMemo(
    () => groups.some((g) => g.included !== g.inMinimalCover),
    [groups],
  );

  return (
    <Card id="kmap-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <Grid3x3 className="h-4 w-4 text-muted-foreground" aria-hidden />
            KARNAUGH MAP
          </CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="kmap-minterms" className="text-xs text-muted-foreground">minterm #</Label>
              <Switch
                id="kmap-minterms"
                checked={kmapShowMinterms}
                onCheckedChange={setKmapShowMinterms}
              />
            </div>
            <div className="flex rounded-md border p-0.5" role="group" aria-label="K-map grouping form">
              <Button
                size="sm" variant={form === 'sop' ? 'default' : 'ghost'} className="h-7 px-2.5 text-xs"
                onClick={() => useSimulator.getState().setExpressionForm('sop')}
                aria-pressed={form === 'sop'}
              >
                Group 1s (SOP)
              </Button>
              <Button
                size="sm" variant={form === 'pos' ? 'default' : 'ghost'} className="h-7 px-2.5 text-xs"
                onClick={() => useSimulator.getState().setExpressionForm('pos')}
                aria-pressed={form === 'pos'}
              >
                Group 0s (POS)
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* segment selector */}
        <SegmentSelector
          activeSegment={activeSegment}
          onSelect={setActiveSegment}
          label="K-map segment selector"
        />

        {/* the map(s) */}
        <div className="overflow-x-auto pb-1">
          <div className="flex items-start gap-6" style={{ minWidth: engine.kmap.planes.length > 1 ? 480 : 260 }}>
            {engine.kmap.planes.map((plane, planeIdx) => (
              <div key={planeIdx} className="flex flex-col items-center gap-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {engine.kmap.planeVar ? `${engine.kmap.planeVar} = ${planeIdx}` : '\u00a0'}
                </div>
                <div className="flex">
                  {/* row variable labels */}
                  <div className="flex flex-col justify-center pr-1.5">
                    <span className="rotate-180 [writing-mode:vertical-rl] font-mono text-[10px] tracking-widest text-muted-foreground">
                      {engine.kmap.rowVars.join('')}
                    </span>
                  </div>
                  <div>
                    {/* column variable labels */}
                    <div className="flex pl-7">
                      {engine.kmap.colLabels.map((cl) => (
                        <div key={cl} style={{ width: CELL }} className="text-center font-mono text-[10px] text-muted-foreground">
                          {cl}
                        </div>
                      ))}
                    </div>
                    <div className="flex">
                      {/* row labels + cells */}
                      <div className="flex flex-col justify-center">
                        {engine.kmap.rowLabels.map((rl) => (
                          <div key={rl} style={{ height: CELL }} className="flex items-center justify-end pr-1.5 font-mono text-[10px] text-muted-foreground">
                            {rl}
                          </div>
                        ))}
                      </div>
                      <div
                        className="relative border border-border"
                        style={{ width: CELL * 4, height: CELL * 4 }}
                        role="grid"
                        aria-label={`K-map for segment ${activeSegment}${engine.kmap.planeVar ? `, plane ${engine.kmap.planeVar}=${planeIdx}` : ''}`}
                      >
                        {/* group overlays */}
                        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
                          {groups.filter((g) => g.included).flatMap((g) => {
                            const color = groupColor(g.colorIndex);
                            const hovered = hoverGroup === g.key;
                            return groupRects(g, planeIdx).map((r, i) => (
                              <div
                                key={`${g.key}-${i}`}
                                className="absolute rounded-md border-2 transition-all"
                                style={{
                                  left: r.x + 2, top: r.y + 2, width: r.w - 4, height: r.h - 4,
                                  borderColor: color,
                                  borderWidth: hovered ? 3.5 : 2,
                                  boxShadow: hovered ? `0 0 10px ${hexToRgba(color, 0.6)}` : 'none',
                                  backgroundColor: hexToRgba(color, hovered ? 0.28 : 0.14),
                                }}
                              />
                            ));
                          })}
                        </div>
                        {/* cells — proper grid structure: role=grid > role=row >
                            role=gridcell wrappers around the interactive buttons */}
                        {plane.map((rowCells, r) => (
                          <div
                            key={r}
                            role="row"
                            className="absolute left-0 flex"
                            style={{ top: r * CELL, height: CELL }}
                          >
                            {rowCells.map((cell, c) => {
                              const isCurrent = cell.minterm === currentInput;
                              const isUncovered = uncovered.includes(cell.minterm);
                              return (
                                <div
                                  key={c}
                                  role="gridcell"
                                  className="relative"
                                  style={{ width: CELL, height: CELL }}
                                >
                                  <button
                                    type="button"
                                    className={cn(
                                      'absolute inset-0 flex flex-col items-center justify-center border border-border/60 font-mono text-base font-bold transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:z-20',
                                      cell.value === 1
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : cell.value === 'X'
                                          ? 'text-amber-600 dark:text-amber-400'
                                          : 'text-muted-foreground',
                                      isCurrent && 'ring-2 ring-primary ring-offset-1 ring-offset-background z-20',
                                      isUncovered && 'animate-pulse bg-destructive/15',
                                    )}
                                    onClick={() => cycleCell(cell.minterm, activeSegment)}
                                    aria-label={`Cell m${cell.minterm}, value ${cell.value}, click to cycle`}
                                    title={`m${cell.minterm} = ${cell.value} — click to cycle`}
                                  >
                                    {cell.value}
                                    {kmapShowMinterms && (
                                      <span className="absolute left-0.5 top-0.5 text-[9px] font-normal opacity-60">
                                        {cell.minterm}
                                      </span>
                                    )}
                                    {isUncovered && (
                                      <AlertTriangle
                                        className="absolute bottom-0.5 right-0.5 h-3 w-3 text-destructive"
                                        aria-hidden
                                      />
                                    )}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* uncovered minterms error */}
        {uncovered.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2.5 text-xs text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <strong>E-101:</strong> Uncovered minterm{uncovered.length > 1 ? 's' : ''}{' '}
              <span className="font-mono">{uncovered.map((m) => `m${m}`).join(', ')}</span> in{' '}
              {form.toUpperCase()} cover of segment {activeSegment}. Restore an excluded group or edit
              the K-map so every {form === 'sop' ? '1' : '0'} cell is covered.
            </span>
          </div>
        )}

        {/* groups legend */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Prime groups ({groups.filter((g) => g.included).length} in cover · {groups.length} primes)
              </h4>
              {!coverExact && (
                <Badge
                  className="gap-1 border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-600 dark:text-amber-400"
                  title="The branch-and-bound search hit its node budget before proving minimality — this cover is a greedy heuristic result and may not be minimal."
                >
                  <AlertTriangle className="h-3 w-3" aria-hidden />
                  heuristic cover — search budget limit
                </Badge>
              )}
            </div>
            {hasOverrides && (
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => resetCoverOverrides(activeSegment)}>
                Restore minimal cover
              </Button>
            )}
          </div>
          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No groups — segment {activeSegment} is constant ({form === 'sop' ? 'never 1' : 'never 0'}) for
              every defined input.
            </p>
          )}
          <ul className="max-h-56 space-y-1 overflow-y-auto custom-scroll pr-1">
            {groups.map((g) => {
              const color = groupColor(g.colorIndex);
              return (
                <li
                  key={g.key}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs',
                    g.included ? 'border-border bg-muted/30' : 'border-dashed border-border/60 bg-transparent opacity-70',
                  )}
                  onMouseEnter={() => setHoverGroup(g.key)}
                  onMouseLeave={() => setHoverGroup(null)}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border-2"
                    style={{ borderColor: color, backgroundColor: g.included ? hexToRgba(color, 0.3) : 'transparent' }}
                    aria-hidden
                  />
                  <TermView literals={g.term.literals} op={form === 'sop' ? '·' : '+'} />
                  <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                    {g.size} {g.size === 1 ? 'cell' : 'cells'}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    m({g.mintermCells.join(',')})
                  </span>
                  {g.isEssential && (
                    <Badge className="h-5 gap-1 px-1.5 text-[10px]">
                      <Star className="h-3 w-3" aria-hidden /> essential
                    </Badge>
                  )}
                  <span className="ml-auto flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={g.included ? 'ghost' : 'outline'}
                      className="h-6 gap-1 px-2 text-[10px]"
                      onClick={() => toggleCoverGroup(activeSegment, form, g.key, g.inMinimalCover)}
                      aria-label={g.included ? `Remove group ${g.key} from cover` : `Add group ${g.key} to cover`}
                      title={g.included ? 'Remove this group from the cover' : 'Add this prime group to the cover'}
                    >
                      {g.included ? (
                        <><EyeOff className="h-3.5 w-3.5" aria-hidden /> Remove</>
                      ) : (
                        <><Eye className="h-3.5 w-3.5" aria-hidden /> Add</>
                      )}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* resulting expression */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold">{activeSegment}</span>
            <span className="text-muted-foreground">=</span>
            {activeTerms.length === 0 ? (
              <span className="font-mono">{form === 'sop' ? '0' : '1'}</span>
            ) : form === 'sop' ? (
              <span className="flex flex-wrap items-center gap-1">
                {activeTerms.map((t, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">+</span>}
                    <TermView literals={t.literals} op="·" />
                  </span>
                ))}
              </span>
            ) : (
              <span className="flex flex-wrap items-center gap-1">
                {activeTerms.map((t, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">·</span>}
                    {t.literals.length > 1 && <span>(</span>}
                    <TermView literals={t.literals} op="+" />
                    {t.literals.length > 1 && <span>)</span>}
                  </span>
                ))}
              </span>
            )}
            <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
              {(form === 'sop' ? engine.stats.simplifiedSop : engine.stats.simplifiedPos).terms}T ·{' '}
              {(form === 'sop' ? engine.stats.simplifiedSop : engine.stats.simplifiedPos).literals}L
            </Badge>
          </div>
        </div>

        {explain && (
          <ExplainBlock title={`How the K-map for segment ${activeSegment} was built`}>
            <p>
              The map rearranges the truth table so that physically adjacent cells differ in exactly
              one variable (Gray-code order 00·01·11·10 on both axes; rows ={' '}
              <span className="font-mono">{engine.kmap.rowVars.join('')}</span>, columns ={' '}
              <span className="font-mono">{engine.kmap.colVars.join('')}</span>
              {engine.kmap.planeVar && <> , planes = <span className="font-mono">{engine.kmap.planeVar}</span></>}).
              Edges wrap around: column 00 is adjacent to 10, row 00 to 10
              {engine.kmap.planeVar && ', and both planes are mirror-adjacent for the same cell'}.
            </p>
            <p>
              Minterms (output = 1): <span className="font-mono">{engine.ones.join(', ') || 'none'}</span>.
              Don&apos;t-cares (X): <span className="font-mono">{engine.dontCares.join(', ') || 'none'}</span>.
              The Quine-McCluskey algorithm found {engine.sop.primes.length} prime implicant
              {engine.sop.primes.length === 1 ? '' : 's'}; the minimal cover above uses the essential ones plus
              the cheapest completion. You can remove groups from the cover or add alternative primes —
              the expressions, circuit and error checks update instantly.
            </p>
            {groups.filter((g) => g.included).slice(0, 3).map((g) => (
              <p key={g.key}>
                Group <TermView literals={g.term.literals} op={form === 'sop' ? '·' : '+'} /> covers{' '}
                {g.size} cells (m{g.mintermCells.join(', m')}):{' '}
                {g.eliminatedVars.length > 0
                  ? `${g.eliminatedVars.join(', ')} ${g.eliminatedVars.length > 1 ? 'vary' : 'varies'} across the group and ${g.eliminatedVars.length > 1 ? 'are' : 'is'} eliminated — a group must span 2^k cells in a rectangle.`
                  : 'it is a single cell, so no variable can be eliminated.'}
              </p>
            ))}
            <p>
              Click any cell to cycle its truth-table value 0 → 1 → X; the groups, expressions and
              circuit update instantly. The cell for the current input (m{current.input}) is outlined.
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
