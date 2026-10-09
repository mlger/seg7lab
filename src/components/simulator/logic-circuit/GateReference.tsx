/**
 * Collapsible gate reference: symbol + Boolean identity for each of the seven
 * gate types, plus the plain-language AND/OR/NOT/XOR descriptions.
 */
'use client';

import { Separator } from '@/components/ui/separator';
import type { GateType } from '@/logic/circuitNetlist';
import { GATE_INFO, gateSymbol } from './gateVisuals';

export function GateReference() {
  return (
    <details className="rounded-lg border bg-muted/20 p-3">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Gate reference (AND · OR · NOT · NAND · NOR · XOR · XNOR)
      </summary>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">        {(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'] as GateType[]).map((t) => (
          <div key={t} className="flex flex-col items-center gap-1.5 rounded-md border bg-background/60 p-2">
            <svg viewBox="0 0 80 44" className="h-10 w-full text-foreground" role="img" aria-label={`${t.toUpperCase()} gate symbol`}>
              {gateSymbol(t, 6, 4, 62, 36, false)}
            </svg>
            <span className="font-mono text-[10px] font-semibold">{t.toUpperCase()}</span>
            <span className="text-center font-mono text-[9px] leading-tight text-muted-foreground">
              {GATE_INFO[t.toUpperCase()].expr}
            </span>
            <span className="mt-auto text-center font-mono text-[8px] leading-tight text-muted-foreground/80">
              {GATE_INFO[t.toUpperCase()].part}
            </span>
          </div>
        ))}
      </div>
      <Separator className="my-3" />
      <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
        {(['and', 'or', 'not', 'xor'] as GateType[]).map((t) => (
          <div key={t} className="flex items-center gap-2">
            <span className="w-10 font-mono font-semibold text-foreground/80">{t.toUpperCase()}</span>
            <span>{GATE_INFO[t.toUpperCase()].desc}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
