/**
 * Application header: brand, input-width toggle, display-mode selector,
 * explain-mode switch, engineering issues panel, export menu, theme toggle.
 */
'use client';

import { useMemo } from 'react';
import { Cpu, BookOpen, AlertTriangle, Moon, Sun, Info } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSimulator } from '@/lib/store';
import { useEngines, usePresetModified } from '@/lib/useEngine';
import { ExportMenu } from './ExportMenu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SEGMENT_NAMES, type DisplayMode, type InputWidth } from '@/types/simulator';

const DISPLAY_MODES: { value: DisplayMode; label: string; hint: string }[] = [
  { value: 'decimal', label: 'DEC', hint: 'BCD preset 0-9; invalid inputs follow the behavior setting' },
  { value: 'hex', label: 'HEX', hint: 'Hex preset 0-F (A b C d E F); 16+ follow the behavior setting' },
  { value: 'binary', label: 'BIN', hint: 'Binary bit-strip display of the input bits' },
  { value: 'custom', label: 'CUSTOM', hint: 'Free editing — design custom characters per input' },
  { value: 'raw', label: 'RAW', hint: 'Raw segment mode — display shows truth-table outputs directly' },
];

export function AppHeader({ displaySvgRef }: { displaySvgRef: React.RefObject<SVGSVGElement | null> }) {
  const inputBits = useSimulator((s) => s.inputBits);
  const setInputBits = useSimulator((s) => s.setInputBits);
  const displayMode = useSimulator((s) => s.displayMode);
  const setDisplayMode = useSimulator((s) => s.setDisplayMode);
  const explainMode = useSimulator((s) => s.explainMode);
  const setExplainMode = useSimulator((s) => s.setExplainMode);
  const engines = useEngines();
  const modified = usePresetModified();
  const displayModeLabel = useSimulator((s) => s.displayMode);
  const { resolvedTheme, setTheme } = useTheme();

  const issues = useMemo(() => {
    const list: { severity: 'error' | 'info'; code: string; message: string }[] = [];
    for (const seg of SEGMENT_NAMES) {
      const e = engines[seg];
      if (e.uncoveredSop.length > 0) {
        list.push({
          severity: 'error',
          code: 'E-101',
          message: `Segment ${seg}: SOP cover misses minterm(s) ${e.uncoveredSop.map((m) => `m${m}`).join(', ')} — restore an excluded K-map group.`,
        });
      }
      if (e.uncoveredPos.length > 0) {
        list.push({
          severity: 'error',
          code: 'E-101',
          message: `Segment ${seg}: POS cover misses maxterm(s) ${e.uncoveredPos.map((m) => `M${m}`).join(', ')} — restore an excluded K-map group.`,
        });
      }
    }
    if (modified) {
      list.push({
        severity: 'info',
        code: 'W-110',
        message: 'Truth table diverges from its preset (user edits present) — this is expected in custom designs.',
      });
    }
    return list;
  }, [engines, modified]);

  const errorCount = issues.filter((i) => i.severity === 'error').length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
          {/* brand */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Cpu className="h-5 w-5" aria-hidden />
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-wide sm:text-base">7-SEGMENT LOGIC SIMULATOR</h1>
              <p className="hidden text-[10px] text-muted-foreground sm:block">
                Digital Logic Laboratory · decoder design · K-map solver
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
            {/* explain mode */}
            <div className="flex items-center gap-1.5">
              <BookOpen className={cn('h-4 w-4', explainMode ? 'text-amber-500' : 'text-muted-foreground')} aria-hidden />
              <Label htmlFor="explain-mode" className="hidden text-xs text-muted-foreground sm:block">Explain</Label>
              <Switch
                id="explain-mode"
                checked={explainMode}
                onCheckedChange={setExplainMode}
                aria-label="Toggle educational explain mode"
              />
            </div>

            {/* issues */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label={`Engineering issues: ${errorCount} errors`} className="gap-1.5">
                  <AlertTriangle
                    className={cn('h-4 w-4', errorCount > 0 ? 'text-destructive' : 'text-muted-foreground')}
                    aria-hidden
                  />
                  <span className="font-mono text-xs">{errorCount}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    Engineering checks
                  </h4>
                  {issues.length === 0 && (
                    <p className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                      <Info className="h-3.5 w-3.5" aria-hidden />
                      All checks pass — covers complete, truth table valid.
                    </p>
                  )}
                  <ul className="space-y-1.5">
                    {issues.map((i, idx) => (
                      <li
                        key={idx}
                        className={cn(
                          'rounded-md border p-2 text-[11px] leading-snug',
                          i.severity === 'error'
                            ? 'border-destructive/40 bg-destructive/5 text-destructive'
                            : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
                        )}
                      >
                        <span className="font-mono font-semibold">{i.code}</span> — {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </PopoverContent>
            </Popover>

            <ExportMenu displaySvgRef={displaySvgRef} />

            {/* theme — both icons render identically on server and client; visibility is
                driven purely by the .dark class that next-themes applies before hydration,
                so no localStorage-dependent branch exists during render (no hydration mismatch). */}
            <Button
              variant="outline"
              size="sm"
              className="relative h-8 w-8 p-0"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle color theme"
            >
              <Sun
                className="h-4 w-4 -rotate-90 scale-0 transition-transform duration-200 motion-reduce:transition-none dark:rotate-0 dark:scale-100"
                aria-hidden
              />
              <Moon
                className="absolute h-4 w-4 rotate-0 scale-100 transition-transform duration-200 motion-reduce:transition-none dark:rotate-90 dark:scale-0"
                aria-hidden
              />
            </Button>
          </div>

          {/* mode controls row */}
          <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2 sm:border-t-0 sm:pt-0">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Input width">
              {([4, 5] as InputWidth[]).map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant={inputBits === b ? 'default' : 'ghost'}
                  className="h-7 px-3 font-mono text-xs"
                  onClick={() => setInputBits(b)}
                  aria-pressed={inputBits === b}
                >
                  {b}-BIT
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-0.5" role="group" aria-label="Display mode">
              {DISPLAY_MODES.map((m) => (
                <Tooltip key={m.value}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={displayMode === m.value ? 'default' : 'ghost'}
                      className={cn(
                        'h-7 px-2.5 text-xs',
                        m.value === 'custom' && 'min-w-[4.6rem]',
                      )}
                      onClick={() => setDisplayMode(m.value)}
                      aria-pressed={displayMode === m.value}
                    >
                      {m.label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <p className="max-w-56">{m.hint}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {modified && (
              <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-400">
                table modified
              </Badge>
            )}
            <span className="hidden font-mono text-[10px] text-muted-foreground lg:block">
              {displayModeLabel} mode · {inputBits === 5 ? 'E D C B A' : 'D C B A'}
            </span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
