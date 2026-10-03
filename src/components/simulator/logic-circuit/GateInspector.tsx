/**
 * Gate inspect panel: live inputs/output, plain-language description and the
 * simplified expression the inspected gate was built from.
 */
'use client';

import { Lightbulb } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Term } from '@/types/simulator';
import type { Circuit, CNode } from '@/logic/circuitNetlist';
import { TermView } from '../ExplainBlock';
import { GATE_INFO } from './gateVisuals';

interface GateInspectorProps {
  selectedNode: CNode;
  circuit: Circuit;
  values: Map<string, 0 | 1>;
  activeSegment: string;
  currentInput: number;
  form: 'sop' | 'pos';
  terms: Term[];
}

export function GateInspector({ selectedNode, circuit, values, activeSegment, currentInput, form, terms }: GateInspectorProps) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />
        <span className="font-mono font-semibold">{selectedNode.type.toUpperCase()}</span>
        <span className="text-muted-foreground">
          {selectedNode.type === 'input'
            ? `input variable ${selectedNode.varName}`
            : selectedNode.type === 'out'
              ? `segment output driver`
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
            ? `Drives segment ${activeSegment} for every input combination.`
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
                in{i + 1}: {src.varName ?? src.type} = {sv}
              </span>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Implemented from the simplified {form.toUpperCase()} expression:{' '}
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
