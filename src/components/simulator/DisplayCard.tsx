/**
 * Display card: the 7-segment display, segment state readout, binary strip
 * (binary mode), and display settings (colors, brightness, polarity, etc).
 */
'use client';

import { useRef } from 'react';
import { RotateCcw, Settings2 } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useCurrentInput, usePresetModified } from '@/lib/useEngine';
import { SEGMENT_DESCRIPTIONS } from '@/logic/decoder';
import { SevenSegmentSvg, BitStripDisplay } from './SevenSegmentDisplay';
import { ExplainBlock } from './ExplainBlock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES } from '@/types/simulator';

export function DisplayCard({ svgRef }: { svgRef?: React.RefObject<SVGSVGElement | null> }) {
  const current = useCurrentInput();
  const modified = usePresetModified();
  const explain = useSimulator((s) => s.explainMode);
  const displayMode = useSimulator((s) => s.displayMode);
  const settings = useSimulator((s) => s.displaySettings);
  const toggleSegmentOnDisplay = useSimulator((s) => s.toggleSegmentOnDisplay);
  const updateDisplaySettings = useSimulator((s) => s.updateDisplaySettings);
  const resetDisplaySettings = useSimulator((s) => s.resetDisplaySettings);
  const inputBits = useSimulator((s) => s.inputBits);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-wide">7-SEGMENT DISPLAY</CardTitle>
          <div className="flex items-center gap-2">
            {modified && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                modified
              </Badge>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Display settings">
                  <Settings2 className="h-4 w-4" />
                  <span className="hidden sm:inline ml-1">Display</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="space-y-4">
                  <h4 className="text-xs font-semibold tracking-wide text-muted-foreground">
                    SEGMENT DRIVE &amp; STYLE
                  </h4>

                  <div className="space-y-2">
                    <Label className="text-xs">Polarity</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={settings.commonAnode ? 'outline' : 'default'}
                        onClick={() => updateDisplaySettings({ commonAnode: false })}
                        aria-pressed={!settings.commonAnode}
                      >
                        Common cathode
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={settings.commonAnode ? 'default' : 'outline'}
                        onClick={() => updateDisplaySettings({ commonAnode: true })}
                        aria-pressed={settings.commonAnode}
                      >
                        Common anode
                      </Button>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {settings.commonAnode
                        ? 'Common anode: segments light on logic 0 (active LOW).'
                        : 'Common cathode: segments light on logic 1 (active HIGH).'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="reverse-logic" className="text-xs">Reverse segment logic</Label>
                    <Switch
                      id="reverse-logic"
                      checked={settings.reverseLogic}
                      onCheckedChange={(v) => updateDisplaySettings({ reverseLogic: v })}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="brightness" className="text-xs">Brightness</Label>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {Math.round(settings.brightness * 100)}%
                      </span>
                    </div>
                    <Slider
                      id="brightness"
                      min={25}
                      max={100}
                      step={5}
                      value={[Math.round(settings.brightness * 100)]}
                      onValueChange={([v]) => updateDisplaySettings({ brightness: v / 100 })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="active-color" className="text-xs">Active color</Label>
                      <Input
                        id="active-color"
                        type="color"
                        className="h-9 p-1 cursor-pointer"
                        value={settings.activeColor}
                        onChange={(e) => updateDisplaySettings({ activeColor: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="inactive-color" className="text-xs">Inactive color</Label>
                      <Input
                        id="inactive-color"
                        type="color"
                        className="h-9 p-1 cursor-pointer"
                        value={settings.inactiveColor}
                        onChange={(e) => updateDisplaySettings({ inactiveColor: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="show-dp" className="text-xs">Show decimal point</Label>
                    <Switch
                      id="show-dp"
                      checked={settings.showDP}
                      onCheckedChange={(v) => updateDisplaySettings({ showDP: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="skew" className="text-xs">Italic skew</Label>
                    <Switch
                      id="skew"
                      checked={settings.skew}
                      onCheckedChange={(v) => updateDisplaySettings({ skew: v })}
                    />
                  </div>

                  <Button variant="outline" size="sm" className="w-full" onClick={resetDisplaySettings}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Reset display settings
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-center gap-6">
          <SevenSegmentSvg
            svgRef={svgRef}
            outputs={current.outputs}
            settings={settings}
            interactive
            onSegmentClick={(seg) => toggleSegmentOnDisplay(current.input, seg)}
            className="h-56 w-auto drop-shadow-lg sm:h-64"
            title={`7-segment display showing truth-table row m${current.input}`}
          />
          {displayMode === 'binary' && (
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] font-medium tracking-widest text-muted-foreground">
                BINARY BIT STRIP
              </span>
              <BitStripDisplay bitValues={current.bitValues} />
            </div>
          )}
        </div>

        {/* input readout */}
        <div className="grid grid-cols-3 gap-2 text-center font-mono text-sm">
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Binary</div>
            <div className="font-semibold">{current.binary}</div>
          </div>
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Decimal</div>
            <div className="font-semibold">{current.decimal}</div>
          </div>
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hex</div>
            <div className="font-semibold">0x{current.hex}</div>
          </div>
        </div>

        {/* segment state line */}
        <div
          className="flex flex-wrap items-center justify-center gap-1.5"
          role="group"
          aria-label="Current segment logic states"
        >
          {SEGMENT_NAMES.map((seg) => {
            const v = current.outputs?.[seg];
            return (
              <div
                key={seg}
                className={cn(
                  'flex min-w-[2.4rem] flex-col items-center rounded-md border px-1.5 py-1 font-mono text-xs',
                  v === 1
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : v === 'X'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'border-border bg-muted/40 text-muted-foreground',
                )}
                title={`Segment ${seg} (${SEGMENT_DESCRIPTIONS[seg]}) — logic level ${v ?? '?'}`}
              >
                <span className="text-[10px] opacity-70">{seg}</span>
                <span className="font-semibold" aria-label={`Segment ${seg} value ${v ?? '?'}`}>
                  {v ?? '–'}
                </span>
              </div>
            );
          })}
        </div>

        {explain && (
          <ExplainBlock title={`Why does the display look like this? (input m${current.input})`}>
            <p>
              The input <strong className="font-mono">{current.binary}</strong> ({current.bits}-bit,
              variables {current.bits === 5 ? 'E D C B A' : 'D C B A'}) selects truth-table row{' '}
              <strong className="font-mono">m{current.input}</strong>. That row defines the logic level of
              each segment:
            </p>
            <p className="font-mono">
              {SEGMENT_NAMES.map((s) => `${s}=${current.outputs?.[s] ?? '?'}`).join('  ')}
            </p>
            <p>
              Physical lighting applies{' '}
              <span className="font-mono">lit = output XOR reverseLogic XOR commonAnode</span> —
              currently {settings.commonAnode ? 'common ANODE (active LOW)' : 'common CATHODE (active HIGH)'}
              {settings.reverseLogic ? ' with reversed segment logic' : ''}. A value of X means the cell is a
              don&apos;t-care: the segment is undefined and drawn with a dashed outline.
            </p>
            <p>Click any segment to toggle its truth-table cell for this input between 0 and 1.</p>
            {displayMode === 'binary' && (
              <p>
                Binary display mode additionally renders one mini-display per input bit (MSB left),
                showing each bit as the digit 0 or 1.
              </p>
            )}
            {inputBits === 5 && (
              <p>5-bit mode covers input values 0–31; rows 0–15 mirror the 4-bit table where preserved.</p>
            )}
          </ExplainBlock>
        )}
      </CardContent>
    </Card>
  );
}
