/**
 * Shared segment-selector button group (A B C D E F G DP) — one definition
 * for the K-map, circuit and any future panel that targets a segment.
 * Renders a role=tablist of role=tab buttons; the active segment is
 * highlighted, and selection is reported through onSelect.
 */
'use client';

import { cn } from '@/lib/utils';
import { SEGMENT_NAMES, type SegmentName } from '@/types/simulator';

interface SegmentSelectorProps {
  activeSegment: SegmentName;
  onSelect: (segment: SegmentName) => void;
  /** Accessible name for the group (e.g. "K-map segment selector"). */
  label: string;
}

export function SegmentSelector({ activeSegment, onSelect, label }: SegmentSelectorProps) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {SEGMENT_NAMES.map((seg) => (
        <button
          key={seg}
          type="button"
          role="tab"
          aria-selected={seg === activeSegment}
          onClick={() => onSelect(seg)}
          className={cn(
            'h-8 min-w-9 rounded-md border px-2 font-mono text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            seg === activeSegment
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40',
          )}
        >
          {seg}
        </button>
      ))}
    </div>
  );
}
