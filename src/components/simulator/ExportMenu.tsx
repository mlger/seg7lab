/**
 * Export menu: CSV (truth table), JSON (project), SVG / PNG (7-segment
 * display), PDF (engineering report), Verilog (synthesizable module) and
 * CircuitVerse (interactive .cv gate circuit — opens a dialog).
 *
 * Busy UX: while an export runs the dropdown STAYS OPEN (onSelect calls
 * preventDefault), the running item shows a spinner, every item is disabled
 * and the trigger swaps its icon for a spinner — then the menu closes
 * programmatically when the export finishes. Completion is announced via
 * toast. This guarantees visible feedback and makes double-triggers
 * impossible.
 */
'use client';

import { useState } from 'react';
import { Download, FileJson, FileText, FileCode2, FileSpreadsheet, Image as ImageIcon, FileImage, Type, LayoutTemplate, CircuitBoard, Loader2 } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import { buildTablePresetFile, newUserId } from '@/logic/presets';
import {
  buildTruthTableCsv, buildProjectJson, buildVerilogModule,
  buildSvgBlob, buildPngBlob, buildPdfReport, buildFontJson, buildBuiltinFontJson,
} from '@/utils/exporters';
import { downloadBlob, downloadText, sanitizeFilename } from '@/utils/download';
import { toast } from '@/hooks/use-toast';
import { CircuitVerseExportDialog } from './CircuitVerseExportDialog';
import { buildFalstadDisplayNetlist, falstadDisplayFilename } from '@/logic/falstad';
import { SEGMENT_NAMES } from '@/types/simulator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

export function ExportMenu({ displaySvgRef }: { displaySvgRef: React.RefObject<SVGSVGElement | null> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);
  const toProjectData = useSimulator((s) => s.toProjectData);
  const projectName = useSimulator((s) => s.projectName);
  const engines = useEngines();
  const truthTable = useSimulator((s) => s.truthTable);
  const expressionForm = useSimulator((s) => s.expressionForm);
  const circuitStyle = useSimulator((s) => s.circuitStyle);
  const inputBits = useSimulator((s) => s.inputBits);
  const tableStartCode = useSimulator((s) => s.tableStartCode);
  const invalidBehavior = useSimulator((s) => s.invalidBehavior);

  const base = sanitizeFilename(projectName);

  /** Current table as a literal sevenseg-preset file (importable anywhere). */
  const buildCurrentPresetFile = () => {
    const now = new Date().toISOString();
    return JSON.stringify(
      buildTablePresetFile({
        id: newUserId(),
        name: projectName,
        category: 'User',
        inputBits,
        generator: 'literal',
        options: { tableStartCode, invalidBehavior },
        table: truthTable,
        createdAt: now,
        updatedAt: now,
      }),
      null,
      2,
    );
  };

  const run = async (kind: string, fn: () => void | Promise<void>) => {
    if (busy !== null) return;
    setBusy(kind);
    try {
      await fn();
      toast({ title: 'Export complete', description: `${kind} downloaded.` });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Unknown error while exporting.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  /** Item props shared by every export entry: keep the menu open while the
   *  export runs (preventDefault on select) and disable re-entry. */
  const exportItem = (kind: string, fn: () => void | Promise<void>) => ({
    disabled: busy !== null,
    onSelect: (e: Event) => {
      e.preventDefault();
      void run(kind, fn);
    },
  });

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Export menu" disabled={busy !== null}>
            {busy !== null
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Download className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline ml-1">Export</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Simulator exports</DropdownMenuLabel>
          <DropdownMenuItem {...exportItem('JSON project', () => downloadText(buildProjectJson(toProjectData()), `${base}.json`, 'application/json'))}>
            <FileJson className="mr-2 h-4 w-4" aria-hidden /> Project JSON
            {busy === 'JSON project' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem {...exportItem('Font JSON (table window)', () => downloadText(buildFontJson(toProjectData()), `${base}-font.json`, 'application/json'))}>
            <Type className="mr-2 h-4 w-4" aria-hidden /> Font JSON — current table
            {busy === 'Font JSON (table window)' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem {...exportItem('Font JSON (full chart font)', () => downloadText(buildBuiltinFontJson(), 'sevenseg-reference-font.json', 'application/json'))}>
            <Type className="mr-2 h-4 w-4" aria-hidden /> Font JSON — full chart font
            {busy === 'Font JSON (full chart font)' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem {...exportItem('Preset JSON', () => downloadText(buildCurrentPresetFile(), `${base}-preset.json`, 'application/json'))}>
            <LayoutTemplate className="mr-2 h-4 w-4" aria-hidden /> Preset JSON — current table
            {busy === 'Preset JSON' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem {...exportItem('CSV truth table', () => downloadText(buildTruthTableCsv(toProjectData()), `${base}-truth-table.csv`, 'text/csv'))}>
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden /> Truth table CSV
            {busy === 'CSV truth table' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem {...exportItem('Verilog module', () => downloadText(buildVerilogModule(toProjectData(), engines), `${base}.v`, 'text/x-verilog'))}>
            <FileCode2 className="mr-2 h-4 w-4" aria-hidden /> Verilog module
            {busy === 'Verilog module' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy !== null} onSelect={() => setCvOpen(true)}>
            <CircuitBoard className="mr-2 h-4 w-4" aria-hidden /> CircuitVerse circuit (.cv)
          </DropdownMenuItem>
          <DropdownMenuItem
            {...exportItem('Falstad netlist', () => {
              // ONE file with the whole app in it: every segment decoder, a
              // SHARED input bus (one switch per variable) and a real 7-segment
              // display element (157) — open it at falstad.com/circuit via
              // File → Open File… or "Import From Text", flip the switches,
              // watch the digit. Follows the on-screen form and gate style
              // (canonical forms export their unminimized netlists; factored
              // falls back to basic there, exactly like the circuit tab).
              const proj = toProjectData();
              const varNames = proj.variableNames ?? [];
              const isCanonical = expressionForm === 'csop' || expressionForm === 'cpos';
              const form: 'sop' | 'pos' =
                expressionForm === 'pos' || expressionForm === 'cpos' ? 'pos' : 'sop';
              const style: typeof circuitStyle =
                isCanonical && circuitStyle === 'factored' ? 'basic' : circuitStyle;
              const opts = { form, style, canonical: isCanonical };
              const built = buildFalstadDisplayNetlist(engines, proj.inputBits, varNames, opts);
              downloadText(
                built.text,
                `${falstadDisplayFilename(proj.name, opts)}.txt`,
                'text/plain',
              );
            })}
          >
            <CircuitBoard className="mr-2 h-4 w-4" aria-hidden /> Falstad / CircuitJS1 (.txt)
            {busy === 'Falstad netlist' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Display &amp; report</DropdownMenuLabel>
          <DropdownMenuItem
            {...exportItem('SVG display', () => {
              const svg = displaySvgRef.current;
              if (!svg) throw new Error('E-233: display not available for export');
              downloadBlob(buildSvgBlob(svg), `${base}-display.svg`);
            })}
          >
            <ImageIcon className="mr-2 h-4 w-4" aria-hidden /> Display SVG
            {busy === 'SVG display' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem
            {...exportItem('PNG display', async () => {
              const svg = displaySvgRef.current;
              if (!svg) throw new Error('E-233: display not available for export');
              downloadBlob(await buildPngBlob(svg), `${base}-display.png`);
            })}
          >
            <FileImage className="mr-2 h-4 w-4" aria-hidden /> Display PNG
            {busy === 'PNG display' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
          <DropdownMenuItem {...exportItem('PDF report', () => downloadBlob(buildPdfReport(toProjectData(), engines), `${base}-report.pdf`))}>
            <FileText className="mr-2 h-4 w-4" aria-hidden /> PDF report (table + K-maps + equations)
            {busy === 'PDF report' && <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CircuitVerseExportDialog open={cvOpen} onOpenChange={setCvOpen} />
    </>
  );
}
