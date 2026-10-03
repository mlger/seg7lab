/**
 * Truth-table header: the Inputs/Outputs banner row plus the variable-name
 * headers (click to rename inline), Char/Preview columns and the
 * clickable segment-output headers (select the shift-target column).
 *
 * Owns the inline variable-name editing state (editingVar / varDraft) locally.
 */
'use client';

import { useState } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { Table, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES } from '@/types/simulator';
import { inputVarNames } from '@/utils/binary';
import { toast } from '@/hooks/use-toast';

export function TruthTableHeader() {
  const inputBits = useSimulator((s) => s.inputBits);
  const varNames = useSimulator((s) => s.variableNames);
  const setVariableName = useSimulator((s) => s.setVariableName);
  const resetVariableNames = useSimulator((s) => s.resetVariableNames);
  const displayMode = useSimulator((s) => s.displayMode);
  const activeSegment = useSimulator((s) => s.activeSegment);
  const setActiveSegment = useSimulator((s) => s.setActiveSegment);

  const fontMode = displayMode === 'font';
  const namesCustomized = varNames.join('') !== inputVarNames(inputBits).join('');

  /* ---- inline variable-name editing ---- */
  const [editingVar, setEditingVar] = useState<number | null>(null);
  const [varDraft, setVarDraft] = useState('');

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

  return (
    <TableHeader className="sticky top-0 z-10">
      <TableRow className="bg-muted hover:bg-muted">
        <TableHead
          colSpan={varNames.length + 1}
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
  );
}
