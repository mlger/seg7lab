/**
 * Export menu: CSV (truth table), JSON (project), SVG / PNG (7-segment
 * display), PDF (engineering report) and Verilog (synthesizable module).
 */
'use client';

import { useState } from 'react';
import { Download, FileJson, FileText, FileCode2, FileSpreadsheet, Image as ImageIcon, FileImage, Type } from 'lucide-react';
import { useSimulator } from '@/lib/store';
import { useEngines } from '@/lib/useEngine';
import {
  buildTruthTableCsv, buildProjectJson, buildVerilogModule,
  buildSvgBlob, buildPngBlob, buildPdfReport, buildFontJson, buildBuiltinFontJson,
} from '@/utils/exporters';
import { downloadBlob, downloadText, sanitizeFilename } from '@/utils/download';
import { toast } from '@/hooks/use-toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

export function ExportMenu({ displaySvgRef }: { displaySvgRef: React.RefObject<SVGSVGElement | null> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const toProjectData = useSimulator((s) => s.toProjectData);
  const projectName = useSimulator((s) => s.projectName);
  const engines = useEngines();

  const base = sanitizeFilename(projectName);

  const run = async (kind: string, fn: () => void | Promise<void>) => {
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
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Export menu" disabled={busy !== null}>
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline ml-1">Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Simulator exports</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => run('JSON project', () => downloadText(buildProjectJson(toProjectData()), `${base}.json`, 'application/json'))}>
          <FileJson className="mr-2 h-4 w-4" aria-hidden /> Project JSON {busy === 'JSON project' && '…'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('Font JSON (table window)', () => downloadText(buildFontJson(toProjectData()), `${base}-font.json`, 'application/json'))}>
          <Type className="mr-2 h-4 w-4" aria-hidden /> Font JSON — current table {busy === 'Font JSON (table window)' && '…'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('Font JSON (full chart font)', () => downloadText(buildBuiltinFontJson(), 'sevenseg-reference-font.json', 'application/json'))}>
          <Type className="mr-2 h-4 w-4" aria-hidden /> Font JSON — full chart font {busy === 'Font JSON (full chart font)' && '…'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('CSV truth table', () => downloadText(buildTruthTableCsv(toProjectData()), `${base}-truth-table.csv`, 'text/csv'))}>
          <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden /> Truth table CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('Verilog module', () => downloadText(buildVerilogModule(toProjectData(), engines), `${base}.v`, 'text/x-verilog'))}>
          <FileCode2 className="mr-2 h-4 w-4" aria-hidden /> Verilog module
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Display &amp; report</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => run('SVG display', () => {
            const svg = displaySvgRef.current;
            if (!svg) throw new Error('E-233: display not available for export');
            downloadBlob(buildSvgBlob(svg), `${base}-display.svg`);
          })}
        >
          <ImageIcon className="mr-2 h-4 w-4" aria-hidden /> Display SVG
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => run('PNG display', async () => {
            const svg = displaySvgRef.current;
            if (!svg) throw new Error('E-233: display not available for export');
            downloadBlob(await buildPngBlob(svg), `${base}-display.png`);
          })}
        >
          <FileImage className="mr-2 h-4 w-4" aria-hidden /> Display PNG
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run('PDF report', () => downloadBlob(buildPdfReport(toProjectData(), engines), `${base}-report.pdf`))}>
          <FileText className="mr-2 h-4 w-4" aria-hidden /> PDF report (table + K-maps + equations)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
