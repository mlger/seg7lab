/**
 * Shared toolbar chrome + live-output panel for the logic-circuit card.
 *
 * The card renders the same zoom / level-trace / band-stepper controls in TWO
 * places — the inline card-header toolbar and the fullscreen floating toolbar
 * — and those copies used to be hand-maintained JSX that could drift apart.
 * This module holds that chrome once: the card passes the view state and the
 * handlers it already owns. The JSX is moved verbatim from LogicCircuitCard
 * (same classNames, aria attributes, button props and titles).
 *
 *  - ZoomControl: zoom readout + preset menu (moved here unchanged);
 *  - ZoomButtons: zoom in / zoom out / preset readout / fit;
 *  - TraceControls: TRACE toggle + layer stepper;
 *  - BandStepButtons: sequential tour of the decoder's segment bands;
 *  - LiveOutputPanel: the LIVE OUTPUT seven-segment readout + sweep player
 *    (single call site, kept here so all circuit-card presentation chrome
 *    lives in one module).
 */
'use client';

import type { ReactNode } from 'react';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Layers, Maximize, Pause,
  Play, ZoomIn, ZoomOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SevenSegmentSvg } from '../SevenSegmentDisplay';
import type { DisplaySettings, SegmentName, SegmentPatternX } from '@/types/simulator';

/** Zoom steps offered in the toolbar preset menu. */
const ZOOM_PRESETS = [0.5, 1, 2] as const;

/**
 * Input auto-sweep speeds — shared by the card's sweep timer (ms per tick)
 * and the LIVE OUTPUT panel's speed chip (label + cycle length).
 */
export const SWEEP_SPEEDS = [
  { ms: 500, label: '1×' },
  { ms: 250, label: '2×' },
  { ms: 1000, label: '½×' },
];

/**
 * Zoom readout + preset menu (Fit / 50 / 100 / 200 %). Shared by the card
 * toolbar and the fullscreen overlay so the two cannot drift apart.
 */
export function ZoomControl({
  zoom,
  onFit,
  onPreset,
}: {
  zoom: number;
  onFit: () => void;
  onPreset: (z: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm" variant="outline" className="h-7 min-w-[52px] px-1 font-mono text-[10px]"
          title="Zoom level — pick a preset, or double-click to fit"
          aria-label={`Zoom ${Math.round(zoom * 100)} percent. Open zoom presets.`}
        >
          {Math.round(zoom * 100)}%
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onFit}>Fit to panel</DropdownMenuItem>
        {ZOOM_PRESETS.map((z) => (
          <DropdownMenuItem key={z} onSelect={() => onPreset(z)}>
            {z * 100}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Zoom in / zoom out / preset readout / fit. Identical in the card-header
 * toolbar and the fullscreen floating toolbar; the card keeps the extra
 * chrome around them (reset layout, fullscreen toggle, export, exit) inline.
 */
export function ZoomButtons({
  zoom,
  onZoomStep,
  onFit,
  onZoomPreset,
}: {
  zoom: number;
  onZoomStep: (dir: 1 | -1) => void;
  onFit: () => void;
  onZoomPreset: (z: number) => void;
}) {
  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onZoomStep(1)} aria-label="Zoom in">
        <ZoomIn className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => onZoomStep(-1)} aria-label="Zoom out">
        <ZoomOut className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <ZoomControl
        zoom={zoom}
        onFit={onFit}
        onPreset={onZoomPreset}
      />
      <Button size="sm" variant="outline" className="h-7 px-2" onClick={onFit} aria-label="Fit circuit to view">
        <Maximize className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </>
  );
}

/**
 * TRACE toggle + layer stepper (propagation step-through). Identical in the
 * card-header toolbar and the fullscreen floating toolbar. The stepper calls
 * back with a step direction; the caller owns the reveal state and clamps it
 * with the same Math.max/Math.min bounds the inline steppers used.
 */
export function TraceControls({
  trace,
  onToggleTrace,
  reveal,
  maxLevel,
  onStepReveal,
}: {
  trace: boolean;
  onToggleTrace: () => void;
  /** Currently revealed layer — null while the trace is off. */
  reveal: number | null;
  maxLevel: number;
  onStepReveal: (delta: 1 | -1) => void;
}) {
  return (
    <>
      {/* level trace */}
      <Button
        size="sm" variant={trace ? 'secondary' : 'outline'}
        className="h-7 gap-1 px-2 text-[11px]"
        onClick={onToggleTrace}
        aria-pressed={trace}
        title="Layer trace — reveal the circuit one logic LAYER at a time (propagation order)"
      >
        <Layers className="h-3.5 w-3.5" aria-hidden /> TRACE
      </Button>
      {trace && (
        <div className="flex items-center gap-0.5" role="group" aria-label="Revealed logic layer">
          <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => onStepReveal(-1)} aria-label="Hide one level">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <span className="min-w-[62px] text-center font-mono text-[10px] text-muted-foreground" aria-live="polite">
            layer {reveal}/{maxLevel}
          </span>
          <Button size="sm" variant="outline" className="h-7 px-1.5" onClick={() => onStepReveal(1)} aria-label="Reveal one more level">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Band stepper — sequential tour of the decoder's segment bands. The inline
 * card-header variant renders the two buttons inside a labeled group and
 * carries title tooltips (withTitles); the fullscreen floating toolbar
 * renders them bare (no titles) with the center-band letter readout between
 * them, passed as children so the DOM order (up · readout · down) is
 * preserved exactly. The surrounding group wrapper / separator stay at the
 * call sites, where they differ.
 */
export function BandStepButtons({
  atFirst,
  atLast,
  onStep,
  withTitles,
  children,
}: {
  atFirst: boolean;
  atLast: boolean;
  onStep: (dir: 1 | -1) => void;
  withTitles?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <Button
        size="sm" variant="outline" className="h-7 px-1.5"
        onClick={() => onStep(-1)} disabled={atFirst}
        aria-label="Previous segment band (Page Up)"
        title={withTitles ? 'Previous band (Page Up)' : undefined}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {children}
      <Button
        size="sm" variant="outline" className="h-7 px-1.5"
        onClick={() => onStep(1)} disabled={atLast}
        aria-label="Next segment band (Page Down)"
        title={withTitles ? 'Next band (Page Down)' : undefined}
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </>
  );
}

/**
 * LIVE OUTPUT panel: a compact interactive seven-segment display showing the
 * logic level every segment's SOP/POS circuit drives RIGHT NOW for the current
 * input, the m-value readout, the selected segment's output badge, and the
 * input auto-sweep player (play/pause + speed). Clicking a segment switches
 * the circuit to it. All state stays in the card; only the presentation
 * lives here.
 */
export function LiveOutputPanel({
  liveOutputs,
  liveSettings,
  onSegmentClick,
  form,
  mode,
  currentInput,
  inputBits,
  outValue,
  activeSegment,
  playing,
  onTogglePlaying,
  sweepIdx,
  onCycleSweepSpeed,
}: {
  liveOutputs: SegmentPatternX;
  liveSettings: DisplaySettings;
  onSegmentClick: (seg: SegmentName) => void;
  form: 'sop' | 'pos';
  mode: 'segment' | 'decoder';
  currentInput: number;
  inputBits: number;
  outValue: number;
  activeSegment: SegmentName;
  playing: boolean;
  onTogglePlaying: () => void;
  sweepIdx: number;
  onCycleSweepSpeed: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <SevenSegmentSvg
        outputs={liveOutputs}
        settings={liveSettings}
        interactive
        onSegmentClick={onSegmentClick}
        className="h-24 w-auto"
        clickHint="click to view this segment's circuit"
        title={`Live output — logic levels every segment's ${form.toUpperCase()} circuit drives for input m${currentInput}. Click a segment to ${mode === 'decoder' ? 'jump to its band' : 'view its circuit'}.`}
      />
      <div className="flex flex-col items-start gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-widest text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          LIVE OUTPUT
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          m{currentInput} · {currentInput.toString(2).padStart(inputBits, '0')}
        </span>
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'font-mono text-[11px]',
              outValue === 1
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {activeSegment} = {outValue}
          </Badge>
          {/* input auto-sweep */}
          <Button
            size="sm" variant={playing ? 'secondary' : 'outline'}
            className="h-6 px-1.5"
            onClick={onTogglePlaying}
            aria-pressed={playing}
            aria-label={playing ? 'Pause input sweep' : 'Play input sweep (cycles all input codes)'}
            title="Auto-sweep: cycles the input so every circuit, map and row lights up in sequence"
          >
            {playing ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
          </Button>
          <Button
            size="sm" variant="outline" className="h-6 px-1.5 font-mono text-[10px]"
            onClick={onCycleSweepSpeed}
            aria-label={`Sweep speed ${SWEEP_SPEEDS[sweepIdx].label} — click to change`}
            title="Sweep speed"
          >
            {SWEEP_SPEEDS[sweepIdx].label}
          </Button>
        </div>
      </div>
    </div>
  );
}
