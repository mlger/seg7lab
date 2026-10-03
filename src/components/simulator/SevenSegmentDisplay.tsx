/**
 * Realistic, editable 7-segment SVG display.
 *
 *   ── A ──        Segments are individually clickable (toggles the truth-table
 *  │       │       cell for the current input). Supports common-anode /
 *  F       B       common-cathode polarity, reverse logic, brightness, colors,
 *  │  ── G ──      don't-care rendering (dashed) and the decimal point.
 *  E       C
 *  │       │
 *   ── D ──  ● DP
 */
'use client';

import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { hexToRgba } from '@/lib/colors';
import { HEX_PATTERNS } from '@/logic/truthTable';
import { isSegmentLit, isSegmentUndefined } from '@/logic/decoder';
import type {
  Bit,
  DisplaySettings,
  SegmentName,
  SegmentPatternX,
} from '@/types/simulator';

interface SegmentGeometry {
  /** SVG polygon points — absent for the circular DP segment. */
  points?: string;
  cx?: number;
  cy?: number;
  r?: number;
}

const GEOMETRY: Record<SegmentName, SegmentGeometry> = {
  A: { points: '38,8 122,8 130,16 122,24 38,24 30,16' },
  B: { points: '136,34 144,26 152,34 152,102 144,110 136,102' },
  C: { points: '136,138 144,130 152,138 152,206 144,214 136,206' },
  D: { points: '38,216 122,216 130,224 122,232 38,232 30,224' },
  E: { points: '8,138 16,130 24,138 24,206 16,214 8,206' },
  F: { points: '8,34 16,26 24,34 24,102 16,110 8,102' },
  G: { points: '38,112 122,112 130,120 122,128 38,128 30,120' },
  DP: { cx: 152, cy: 224, r: 9 },
};

const SEGMENT_ORDER: SegmentName[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];

export interface SevenSegmentSvgProps {
  outputs: SegmentPatternX | null;
  settings: DisplaySettings;
  interactive?: boolean;
  onSegmentClick?: (segment: SegmentName) => void;
  className?: string;
  svgRef?: React.Ref<SVGSVGElement>;
  title?: string;
}

export function SevenSegmentSvg({
  outputs,
  settings,
  interactive = false,
  onSegmentClick,
  className,
  svgRef,
  title,
}: SevenSegmentSvgProps) {
  const glowId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const litOpacity = 0.55 + 0.45 * settings.brightness;
  const transform = settings.skew ? 'translate(30,0) skewX(-8)' : 'translate(20,0)';

  const segs = useMemo(() => {
    return SEGMENT_ORDER.map((seg) => {
      const value = outputs?.[seg];
      const lit = value !== undefined && isSegmentLit(value, settings);
      const undef = value !== undefined && isSegmentUndefined(value);
      return { seg, value, lit, undef };
    });
  }, [outputs, settings]);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 200 240"
      className={cn('select-none', className)}
      role="img"
      aria-label={title ?? '7-segment display'}
    >
      <defs>
        <filter id={`glow-${glowId}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={1.5 + 7 * settings.brightness} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* housing */}
      <rect
        x="2" y="2" width="196" height="236" rx="14"
        fill="rgba(10,10,12,0.85)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="1.5"
      />
      <g transform={transform} filter={`url(#glow-${glowId})`}>
        {segs.map(({ seg, lit, undef }) => {
          if (seg === 'DP') {
            if (!settings.showDP && !lit) return null;
            return (
              <circle
                key={seg}
                cx={GEOMETRY.DP.cx}
                cy={GEOMETRY.DP.cy}
                r={GEOMETRY.DP.r}
                fill={lit ? hexToRgba(settings.activeColor, litOpacity) : hexToRgba(settings.inactiveColor, 0.6)}
                stroke={undef ? hexToRgba(settings.activeColor, 0.7) : 'none'}
                strokeWidth={undef ? 2 : 0}
                strokeDasharray={undef ? '3 3' : undefined}
                className={interactive ? 'cursor-pointer transition-opacity hover:opacity-80' : undefined}
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'switch' : undefined}
                aria-checked={lit}
                aria-label={`Decimal point, ${lit ? 'on' : 'off'}`}
                onClick={interactive ? () => onSegmentClick?.(seg) : undefined}
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSegmentClick?.(seg);
                        }
                      }
                    : undefined
                }
              />
            );
          }
          const geo = GEOMETRY[seg];
          return (
            <polygon
              key={seg}
              points={geo.points}
              fill={lit ? hexToRgba(settings.activeColor, litOpacity) : hexToRgba(settings.inactiveColor, 0.55)}
              stroke={undef ? hexToRgba(settings.activeColor, 0.75) : 'rgba(0,0,0,0.25)'}
              strokeWidth={undef ? 2 : 0.75}
              strokeDasharray={undef ? '4 3' : undefined}
              className={
                interactive
                  ? 'cursor-pointer transition-opacity hover:opacity-75 focus-visible:opacity-100'
                  : undefined
              }
              tabIndex={interactive ? 0 : undefined}
              role={interactive ? 'switch' : undefined}
              aria-checked={lit}
              aria-label={`Segment ${seg}, ${lit ? 'on' : 'off'}${undef ? ', don\u2019t care' : ''}`}
              onClick={interactive ? () => onSegmentClick?.(seg) : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSegmentClick?.(seg);
                      }
                    }
                  : undefined
              }
            />
          );
        })}
      </g>
    </svg>
  );
}

/** Small display used in bit strips / character palettes. */
export function MiniSegmentDisplay({
  pattern,
  className,
  label,
}: {
  pattern: SegmentPatternX | null;
  className?: string;
  label?: string;
}) {
  return (
    <SevenSegmentSvg
      outputs={pattern}
      settings={{
        activeColor: '#f59e0b',
        inactiveColor: '#78716c',
        brightness: 0.9,
        commonAnode: false,
        reverseLogic: false,
        showDP: false,
        skew: false,
      }}
      className={cn('h-16 w-auto', className)}
      title={label}
    />
  );
}

/** A row of mini displays showing each input bit as the digit 0 or 1. */
export function BitStripDisplay({
  bitValues,
  className,
}: {
  bitValues: Bit[];
  className?: string;
}) {
  return (
    <div className={cn('flex items-end gap-1.5', className)} role="img" aria-label={`Input bits ${bitValues.join('')}`}>
      {bitValues.map((bit, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <MiniSegmentDisplay pattern={HEX_PATTERNS[String(bit)]} className="h-14" />
          <span className="font-mono text-[10px] text-muted-foreground">{bit}</span>
        </div>
      ))}
    </div>
  );
}

/** Invisible, generously sized click zones for preview glyphs (viewBox coords). */
const HIT_ZONES: Record<Exclude<SegmentName, 'DP'>, { x: number; y: number; w: number; h: number }> = {
  A: { x: 20, y: 0, w: 120, h: 32 },
  F: { x: 0, y: 24, w: 36, h: 88 },
  B: { x: 128, y: 24, w: 36, h: 88 },
  E: { x: 0, y: 128, w: 36, h: 88 },
  C: { x: 128, y: 128, w: 36, h: 88 },
  G: { x: 20, y: 104, w: 120, h: 32 },
  D: { x: 20, y: 208, w: 120, h: 32 },
};

/**
 * Tiny bare glyph (no housing, no glow filter) for truth-table row previews.
 * Renders lit segments in amber, unlit in a faint outline and don't-cares dashed,
 * so 16–32 instances stay lightweight. Live: derived from the truth table.
 * viewBox height 240 = full A..D geometry span (y 8–232) + stroke margins —
 * a shorter box would clip segment D off the bottom of every preview.
 *
 * Optional interactivity: invisible per-segment hit zones let the user click a
 * segment directly in the table row to toggle it (DP is omitted here — edit it
 * via the output cell). Keyboard users edit via the a–g/DP cells instead, so the
 * hit zones stay out of the tab order.
 */
export function GlyphPreview({
  outputs,
  className,
  label,
  interactive = false,
  onSegmentClick,
}: {
  outputs: SegmentPatternX | null;
  className?: string;
  label?: string;
  interactive?: boolean;
  onSegmentClick?: (segment: SegmentName) => void;
}) {
  const [hover, setHover] = useState<SegmentName | null>(null);
  return (
    <svg
      viewBox="0 0 164 240"
      className={cn('h-9 w-auto', interactive && 'cursor-pointer', className)}
      role="img"
      aria-label={label ?? 'Row pattern preview'}
    >
      <g transform="translate(2,0)">
        {SEGMENT_ORDER.map((seg) => {
          if (seg === 'DP') return null; // previews omit the decimal point
          const geo = GEOMETRY[seg];
          const v = outputs?.[seg];
          const lit = v === 1;
          const undef = v === 'X';
          const hovered = interactive && hover === seg;
          return (
            <polygon
              key={seg}
              points={geo.points}
              fill={lit ? '#f59e0b' : hovered ? 'rgba(245,158,11,0.18)' : 'transparent'}
              fillOpacity={lit ? 0.92 : hovered ? 1 : 0}
              stroke={hovered ? '#b45309' : undef ? '#d97706' : '#d6d3d1'}
              strokeWidth={hovered ? 6 : undef ? 5 : 4}
              strokeOpacity={hovered ? 1 : undef ? 0.9 : 0.66}
              strokeDasharray={undef && !hovered ? '10 7' : undefined}
              strokeLinejoin="round"
            />
          );
        })}
        {interactive && (
          <g>
            {(['A', 'F', 'B', 'E', 'C', 'G', 'D'] as const).map((seg) => {
              const zone = HIT_ZONES[seg];
              const v = outputs?.[seg];
              return (
                <rect
                  key={seg}
                  x={zone.x}
                  y={zone.y}
                  width={zone.w}
                  height={zone.h}
                  fill="transparent"
                  className="cursor-pointer"
                  aria-hidden
                  onMouseEnter={() => setHover(seg)}
                  onMouseLeave={() => setHover((h) => (h === seg ? null : h))}
                  onClick={() => onSegmentClick?.(seg)}
                >
                  <title>{`Segment ${seg} = ${v ?? '?'} — click to toggle`}</title>
                </rect>
              );
            })}
          </g>
        )}
      </g>
    </svg>
  );
}
