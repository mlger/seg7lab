/**
 * Gate inspect panel: live inputs/output, plain-language description, the
 * expression the inspected gate was built from, and — for term gates — the
 * matching K-map cover group (color swatch + size + essentiality).
 */
'use client';

import { Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Term } from '@/types/simulator';
import type { Circuit, CNode } from '@/logic/circuitNetlist';
import { TermView } from '../ExplainBlock';
import { GATE_INFO } from './gateVisuals';

/** K-map cover group info for a term gate (matches the K-map tab's colors). */
export interface InspectorAccent {
  color: string;
  size: number;
  essential: boolean;
}

interface GateInspectorProps {
  selectedNode: CNode;
  circuit: Circuit;
  values: Map<string, 0 | 1>;
  activeSegment: string;
  currentInput: number;
  form: 'sop' | 'pos';
  terms: Term[];
  /** Decoder mode: the segment owning the selected node. */
  ownerSegment?: string;
  /** Canonical form flag — changes the "implemented from" wording. */
  isCanonical?: boolean;
  /** K-map group accent when the node is a term gate. */
  accent?: InspectorAccent | null;
}

export function GateInspector({
  selectedNode, circuit, values, activeSegment, currentInput, form, terms,
  ownerSegment, isCanonical, accent,
}: GateInspectorProps) {
  const segLabel = ownerSegment ?? activeSegment;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
        <span className="font-mono font-semibold">{selectedNode.type.toUpperCase()}</span>
        <span className="text-muted-foreground">
          {selectedNode.type === 'input'
            ? `input variable ${selectedNode.varName}`
            : selectedNode.type === 'out'
              ? `segment ${segLabel} output driver`
              : `${selectedNode.operandIds.length}-input gate`}
        </span>
        <Badge className={cn(
          'font-mono',
          (values.get(selectedNode.id) ?? 0) === 1
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : 'bg-muted text-muted-foreground',
        )}>
          out = {values.get(selectedNode.id) ?? 0}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {GATE_INFO[selectedNode.type.toUpperCase()]?.desc ??
          (selectedNode.type === 'out'
            ? `Drives segment ${segLabel} for every input combination.`
            : `Current value with input m${currentInput}.`)}
        {GATE_INFO[selectedNode.type.toUpperCase()] && (
          <span className="ml-1 font-mono">{GATE_INFO[selectedNode.type.toUpperCase()].expr}</span>
        )}
      </p>
      {selectedNode.operandIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedNode.operandIds.map((id, i) => {
            const src = circuit.byId.get(id)!;
            const sv = values.get(id) ?? 0;
            return (
              <span
                key={id}
                className={cn(
                  'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                  sv === 1
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-border bg-muted/40 text-muted-foreground',
                )}
              >
                in{i + 1}: {src.varName ?? src.label} = {sv}
              </span>
            );
          })}
        </div>
      )}
      {accent && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block h-3 w-3 rounded-sm border"
            style={{ backgroundColor: `${accent.color}33`, borderColor: accent.color }}
            aria-hidden
          />
          K-map group · {accent.size} cell{accent.size === 1 ? '' : 's'}
          {accent.essential ? ' · essential prime implicant' : ''} — the same color outlines it
          in the K-map tab.
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Implemented from the {isCanonical ? 'canonical' : 'simplified'} {form.toUpperCase()} expression of
        segment {segLabel}:{' '}
        {terms.length === 0
          ? form === 'sop' ? 'constant 0' : 'constant 1'
          : terms.map((t, i) => (
              <span key={i} className="mr-1 inline-flex items-center">
                {i > 0 && <span className="mr-1 text-muted-foreground">{form === 'sop' ? '+' : '·'}</span>}
                <TermView literals={t.literals} op={form === 'sop' ? '·' : '+'} />
              </span>
            ))}
      </p>
    </div>
  );
}
