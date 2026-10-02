/**
 * Custom character editor: visual pattern designer per input value.
 * Click a slot to open the editor — toggling segments writes directly into
 * the truth table (single source of truth), so K-maps / expressions / circuit
 * update instantly. Includes the invalid-BCD behavior controls.
 */
'use client';

import { useState } from 'react';
import { Shapes, X } from 'lucide-react';
import { useSimulator, activeFontGlyphs } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { ExplainBlock } from './ExplainBlock';
import { SevenSegmentSvg } from './SevenSegmentDisplay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES, type SegmentName } from '@/types/simulator';
import { HEX_PATTERNS, valueToChar, patternToChar, blankRowX, dontCareRowX } from '@/logic/truthTable';
import { fontCharAt } from '@/logic/font';

const PRESET_CHARS = Object.keys(HEX_PATTERNS);

export function CustomCharacterCard() {
  const table = useSimulator((s) => s.truthTable);
  const inputBits = useSimulator((s) => s.inputBits);
  const displayMode = useSimulator((s) => s.displayMode);
  const invalidBehavior = useSimulator((s) => s.invalidBehavior);
  const setInvalidBehavior = useSimulator((s) => s.setInvalidBehavior);
  const toggleSegmentOnDisplay = useSimulator((s) => s.toggleSegmentOnDisplay);
  const setRowPattern = useSimulator((s) => s.setRowPattern);
  const explain = useSimulator((s) => s.explainMode);
  const engines = useEngines();

  const [editing, setEditing] = useState<number | null>(null);
  const settings = useSimulator((s) => s.displaySettings);
  const fontStart = useSimulator((s) => s.fontStart);
  const tableStartCode = useSimulator((s) => s.tableStartCode);
  const customFont = useSimulator((s) => s.customFont);
  const activeFontId = useSimulator((s) => s.activeFontId);
  const glyphs = activeFontGlyphs(customFont, activeFontId);

  const editingRow = editing !== null ? table.rows.find((r) => r.input === editing) : null;
  const varNames = inputBits === 5 ? ['E', 'D', 'C', 'B', 'A'] : ['D', 'C', 'B', 'A'];
  const invalidFrom = displayMode === 'hex' && inputBits === 5 ? 16 : 10;

  /** Label for an input: font glyph in font mode, else the hex-style guess. */
  const charFor = (input: number): string | null => {
    if (displayMode === 'font') return fontCharAt(input, inputBits, fontStart, tableStartCode, glyphs);
    const outputs = table.rows[input]?.outputs;
    return outputs ? patternToChar(outputs) : null;
  };

  return (
    <Card id="characters-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide">
            <Shapes className="h-4 w-4 text-muted-foreground" aria-hidden />
            CUSTOM CHARACTERS
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">Invalid inputs ({invalidFrom}+):</Label>
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Invalid input behavior">
              {(['blank', 'dontcare', 'custom'] as const).map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant={invalidBehavior === b ? 'default' : 'ghost'}
                  className="h-7 px-2.5 text-xs capitalize"
                  onClick={() => setInvalidBehavior(b)}
                  aria-pressed={invalidBehavior === b}
                >
                  {b === 'dontcare' ? "don't care" : b}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="list" aria-label="Character slots per input value">
          {table.rows.map((row) => {
            const char = charFor(row.input);
            const isEditing = editing === row.input;
            return (
              <button
                key={row.input}
                type="button"
                role="listitem"
                onClick={() => setEditing(row.input)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-2 transition-all hover:border-muted-foreground/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isEditing && 'border-primary bg-primary/10',
                )}
                aria-label={`Edit character for input ${row.input} (${row.input.toString(2).padStart(inputBits, '0')})`}
              >
                <SevenSegmentSvg
                  outputs={row.outputs}
                  settings={{ ...settings, brightness: 0.85 }}
                  className="h-12 w-auto"
                />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {row.input.toString(2).padStart(inputBits, '0')}
                </span>
                <span className="font-mono text-xs font-semibold">
                  {row.input}
                  {char && <span className="ml-1 text-muted-foreground">· {char === ' ' ? '␠' : char}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-mono">
                Character for input m{editing}
                {editing !== null && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    ({editing.toString(2).padStart(inputBits, '0')}) ={' '}
                    {displayMode === 'font'
                      ? `"${charFor(editing) ?? editing}"`
                      : valueToChar(editing) === '?' ? editing : valueToChar(editing)}
                  </span>
                )}
              </DialogTitle>
              <DialogDescription>
                Click segments to toggle them (0 ↔ 1). Edits write straight into the truth table.
              </DialogDescription>
            </DialogHeader>

            {editingRow && (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <SevenSegmentSvg
                    outputs={editingRow.outputs}
                    settings={settings}
                    interactive
                    onSegmentClick={(seg) => toggleSegmentOnDisplay(editing!, seg)}
                    className="h-48 w-auto"
                    title={`Pattern editor for input ${editing}`}
                  />
                </div>

                <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="Segment toggles">
                  {SEGMENT_NAMES.map((seg) => (
                    <button
                      key={seg}
                      type="button"
                      onClick={() => toggleSegmentOnDisplay(editing!, seg)}
                      className={cn(
                        'h-8 min-w-9 rounded-md border font-mono text-xs font-semibold transition-colors',
                        editingRow.outputs[seg] === 1
                          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'border-border bg-muted/40 text-muted-foreground',
                      )}
                      aria-label={`Segment ${seg}: ${editingRow.outputs[seg]}, click to toggle`}
                    >
                      {seg}
                    </button>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Apply a standard pattern</Label>
                  <div className="flex flex-wrap gap-1">
                    {PRESET_CHARS.map((c) => (
                      <Button
                        key={c}
                        size="sm"
                        variant="outline"
                        className="h-8 w-8 p-0 font-mono"
                        onClick={() => setRowPattern(editing!, { ...HEX_PATTERNS[c] })}
                        aria-label={`Apply pattern for character ${c}`}
                      >
                        {c}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => setRowPattern(editing!, blankRowX())}
                    >
                      Blank
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => setRowPattern(editing!, dontCareRowX())}
                    >
                      All X
                    </Button>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    Minterm m{editing} · variables {varNames.join(' ')}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(null)}>
                    <X className="mr-1 h-3.5 w-3.5" aria-hidden /> Done
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {explain && (
          <ExplainBlock title="Custom characters and the truth table">
            <p>
              A 7-segment decoder can show more than 0-9. Each input value maps to a segment pattern —
              a custom character. Editing a pattern here rewrites row{' '}
              <span className="font-mono">m{editing ?? '…'}</span> of the truth table, so the K-map
              groups, minimized equations and gate circuit for every segment change instantly.
            </p>
            <p>
              The current table uses{' '}
              {engines.A.dontCares.length > 0 ? (
                <>
                  <span className="font-mono">{engines.A.dontCares.length}</span> don&apos;t-care rows
                  (X) which the minimizer exploits for simpler logic.
                </>
              ) : (
                'no don&apos;t-care rows — every input is fully defined.'
              )}
            </p>
            <p>
              For inputs {invalidFrom}+ the &quot;invalid behavior&quot; selector chooses BLANK (all
              segments off), DON&apos;T CARE (all X — best for minimization) or CUSTOM (keep the
              patterns you draw).
            </p>
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
