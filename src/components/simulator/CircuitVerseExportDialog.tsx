/**
 * CircuitVerse export dialog: builds a `.cv` project file (importable at
 * circuitverse.org → File → Import) from the current decoder logic.
 *
 *  - Logic source picks minimized (Quine-McCluskey cover) or direct
 *    canonical SOP so students can compare gate counts side by side.
 *  - Live gate-count preview recompute on every option change — but NOT on
 *    every title keystroke: the stats (gate counts, depth, per-segment chips)
 *    are title-independent, so the preview memo deliberately omits `title`
 *    and builds with a placeholder instead. The full 50KB JSON is built
 *    exactly once, inside the download handler, with the real title.
 *  - Education panel explains how to import and what is inside the file.
 */
'use client';

import { useMemo, useState } from 'react';
import { CircuitBoard, Download, GraduationCap, Loader2, TriangleAlert } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { buildCircuitverseProject, type CircuitverseLogicSource } from '@/logic/circuitverse';
import { downloadText, sanitizeFilename } from '@/utils/download';
import { toast } from '@/hooks/use-toast';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/** "1 AND gate" / "26 AND gates". */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Small stat tile for the gate-count preview grid. */
function StatTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-2xl font-semibold leading-none tabular-nums">{value}</p>
      <p className="mt-1.5 text-[10px] leading-none text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Numbered-step row for the education panel. */
function Step({ n, children }: { n: number; children: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background font-mono text-[10px] font-semibold"
        aria-hidden
      >
        {n}
      </span>
      <p className="text-xs leading-snug">{children}</p>
    </li>
  );
}

const OPEN_STEPS = [
  'Download the .cv file.',
  'Open the CircuitVerse simulator at circuitverse.org.',
  'Choose File → Import and select the downloaded file — no account needed, the circuit runs immediately.',
];

/** Placeholder title for the stats-only preview build (title never affects gate counts). */
const PREVIEW_TITLE = 'SevenSeg Decoder';

export function CircuitVerseExportDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const projectName = useSimulator((s) => s.projectName);
  const inputBits = useSimulator((s) => s.inputBits);
  const variableNames = useSimulator((s) => s.variableNames);
  const engines = useEngines();

  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [logicSource, setLogicSource] = useState<CircuitverseLogicSource>('minimized');
  const [busy, setBusy] = useState(false);

  /** Title defaults to the project name (re-synced on every open). */
  const title = titleOverride ?? (projectName.trim() || 'SevenSeg Decoder');

  /**
   * Live gate-count preview — intentionally title-INDEPENDENT (the title only
   * lands in the JSON metadata and the filename). Deps are the real inputs to
   * the stats, so typing in the title field no longer rebuilds the whole .cv
   * document; the downloadable bytes are built once in handleDownload.
   */
  const { stats, error } = useMemo<{ stats: ReturnType<typeof buildCircuitverseProject>['stats'] | null; error: string | null }>(() => {
    try {
      return {
        stats: buildCircuitverseProject(inputBits, engines, {
          title: PREVIEW_TITLE,
          logicSource,
          varNames: variableNames,
        }).stats,
        error: null,
      };
    } catch (err) {
      return {
        stats: null,
        error: err instanceof Error ? err.message : 'Unknown error while building the CircuitVerse project.',
      };
    }
  }, [inputBits, engines, logicSource, variableNames]);

  const handleOpenChange = (o: boolean) => {
    if (!o) setTitleOverride(null); // next open re-syncs with the project name
    onOpenChange(o);
  };

  const handleDownload = async () => {
    if (!stats || busy) return;
    setBusy(true);
    try {
      // Single build at click time — cheap, and it picks up the CURRENT title.
      const built = buildCircuitverseProject(inputBits, engines, {
        title,
        logicSource,
        varNames: variableNames,
      });
      downloadText(
        built.json,
        `${sanitizeFilename(title) || 'sevenseg'}-circuitverse.cv`,
        'application/json',
      );
      toast({
        title: 'CircuitVerse file downloaded',
        description: 'Import it at circuitverse.org → File → Import.',
      });
      // Dialog stays open: options can be tweaked and the file re-downloaded.
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Unknown error while exporting.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <CircuitBoard className="h-4 w-4 text-muted-foreground" aria-hidden />
            Export to CircuitVerse
          </DialogTitle>
          <DialogDescription>
            Generate an importable CircuitVerse project file (.cv) with this decoder as a live,
            simulated gate circuit.
          </DialogDescription>
        </DialogHeader>

        <div className="custom-scroll min-h-0 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* ---------------- options ---------------- */}
          <div className="space-y-2">
            <Label htmlFor="cv-project-title">Project title</Label>
            <Input
              id="cv-project-title"
              value={title}
              onChange={(e) => setTitleOverride(e.target.value.slice(0, 100))}
              placeholder="SevenSeg Decoder"
              className="h-11"
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              This becomes the project name inside the .cv file.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">Logic source</p>
            <RadioGroup
              value={logicSource}
              onValueChange={(v) => setLogicSource(v === 'direct' ? 'direct' : 'minimized')}
              className="gap-2"
              aria-label="Logic source"
            >
              <label
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  logicSource === 'minimized' ? 'border-primary/60 bg-primary/5' : 'hover:bg-muted/40',
                )}
              >
                <RadioGroupItem value="minimized" className="mt-0.5" />
                <span className="flex-1 space-y-1">
                  <span className="block text-sm font-medium leading-none">
                    Minimized (Quine-McCluskey)
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    The same compact circuit as the Logic Circuit card — one AND per product term,
                    one OR per segment.
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  logicSource === 'direct' ? 'border-primary/60 bg-primary/5' : 'hover:bg-muted/40',
                )}
              >
                <RadioGroupItem value="direct" className="mt-0.5" />
                <span className="flex-1 space-y-1">
                  <span className="block text-sm font-medium leading-none">Direct SOP (canonical)</span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    One AND gate for every truth-table row where the segment lights. Compare gate
                    counts to see what minimization saves.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {/* ---------------- live gate-count preview ---------------- */}
          {stats ? (
            <div className="space-y-2">
              <p className="text-sm font-medium leading-none">Gate-count preview</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatTile label="Inputs" value={stats.inputs} hint="input toggles" />
                <StatTile label="AND gates" value={stats.andGates} hint="product terms" />
                <StatTile label="OR gates" value={stats.orGates} hint="segment sums" />
                <StatTile label="NOT gates" value={stats.inverters} hint="shared inverters" />
                <StatTile label="Constants" value={stats.constants} hint="always on / off" />
                <StatTile label="Wires" value={stats.wires} hint="connections" />
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Logic depth: {stats.maxDepth} gate{stats.maxDepth === 1 ? '' : 's'} on the longest
                input-to-display path · {stats.intermediates} wire bend{stats.intermediates === 1 ? '' : 's'}.
              </p>
            </div>
          ) : (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>Circuit could not be built</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* ---------------- per-segment strip ---------------- */}
          {stats && (
            <div className="space-y-2">
              <p className="text-sm font-medium leading-none">Per-segment breakdown</p>
              <div className="flex flex-wrap gap-1.5">
                {stats.segments.map((seg) => {
                  const isOn = seg.constant === 1;
                  const isOff = seg.constant === 0;
                  return (
                    <span
                      key={seg.segment}
                      title={isOn
                        ? `Segment ${seg.segment}: constant 1 (always on)`
                        : isOff
                          ? `Segment ${seg.segment}: constant 0 (always off)`
                          : `Segment ${seg.segment}: ${count(seg.andGates, 'AND gate')}, ${count(seg.orGates, 'OR gate')}`}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] leading-none',
                        isOn
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : isOff
                            ? 'border-border bg-muted/40 text-muted-foreground'
                            : 'border-border bg-muted/40',
                      )}
                    >
                      <span className="font-semibold">{seg.segment}</span>
                      <span className="text-muted-foreground">·</span>
                      {isOn ? (
                        <span>always on</span>
                      ) : isOff ? (
                        <span>always off</span>
                      ) : (
                        <>
                          <span>{seg.andGates} AND</span>
                          <span className="text-muted-foreground">·</span>
                          <span>{seg.orGates} OR</span>
                        </>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* ---------------- education panel ---------------- */}
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-amber-500" aria-hidden />
              <h3 className="text-sm font-semibold leading-none">How to open in CircuitVerse</h3>
            </div>
            <ol className="mt-2.5 space-y-1.5">
              {OPEN_STEPS.map((text, i) => <Step key={i} n={i + 1}>{text}</Step>)}
            </ol>
            {stats && (
              <p className="mt-3 border-t pt-2.5 text-[11px] leading-snug text-muted-foreground">
                Inside the file: {count(stats.inputs, 'input toggle')} labeled{' '}
                {variableNames.join(', ')} (MSB → LSB), {count(stats.andGates, 'AND gate')}{' '}
                — one per product term, {count(stats.orGates, 'OR gate')} labeled a–g feeding a
                7-segment display with decimal point, {count(stats.inverters, 'shared NOT gate')}{' '}
                for complemented inputs, and {count(stats.constants, 'constant')} for always-on/off
                segments.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button variant="outline" className="h-11" disabled={busy}>Cancel</Button>
          </DialogClose>
          <Button className="h-11 gap-2" onClick={handleDownload} disabled={busy || !stats}>
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Download className="h-4 w-4" aria-hidden />}
            {busy ? 'Building…' : 'Download .cv'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
