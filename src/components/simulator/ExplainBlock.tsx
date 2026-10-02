/**
 * ExplainBlock — contextual educational panel shown across the app when
 * "Explain mode" is enabled. Content is generated from live engine data.
 */
'use client';

import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ExplainBlock({
  title,
  children,
  className,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={cn(
        'rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-200/90 dark:text-amber-200/90',
        className,
      )}
      role="note"
      aria-label={`Explanation: ${title}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left font-medium text-amber-500 dark:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded"
        aria-expanded={open}
      >
        <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
        <span className="flex-1">{title}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 leading-relaxed text-foreground/85 text-[13px]">
          {children}
        </div>
      )}
    </div>
  );
}

/** Inline literal with optional overline for complemented variables. */
export function Lit({ name, complemented }: { name: string; complemented?: boolean }) {
  return complemented ? (
    <span className="font-mono" style={{ textDecoration: 'overline' }} aria-label={`NOT ${name}`}>
      {name}
    </span>
  ) : (
    <span className="font-mono">{name}</span>
  );
}

/** Render a product term (op "·") or sum term (op "+") with proper overlines. */
export function TermView({
  literals,
  op,
}: {
  literals: { name: string; complemented: boolean }[];
  op: '·' | '+';
}) {
  if (literals.length === 0) {
    return <span className="font-mono">{op === '·' ? '1' : '0'}</span>;
  }
  return (
    <span className="whitespace-nowrap font-mono">
      {literals.map((l, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span className="mx-0.5 opacity-60">{op}</span>}
          <Lit name={l.name} complemented={l.complemented} />
        </span>
      ))}
    </span>
  );
}
