/**
 * Export suite: CSV (truth table), JSON (project), Verilog (synthesizable
 * module), SVG/PNG (7-segment display) and PDF (engineering report:
 * truth table + K-maps + Boolean equations).
 */
import type { ProjectData, SegmentEngineMap, SegmentName, Term } from '@/types/simulator';
import { SEGMENT_NAMES } from '@/types/simulator';
import { inputVarNames, formatHex } from './binary';
import { sopToString, posToString } from '@/logic/expressions';
import { generateVerilog } from '@/logic/verilogGenerator';
import { groupCellRects } from '@/logic/kmap';
import { FONT_GLYPHS } from '@/logic/font';
import { PdfDoc } from './pdf';

const GROUP_PALETTE = [
  '#f59e0b', '#10b981', '#f43f5e', '#a855f7',
  '#fb923c', '#14b8a6', '#eab308', '#ec4899',
];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* ------------------------------------------------------------------ */
/* Text exports                                                        */
/* ------------------------------------------------------------------ */

export function buildTruthTableCsv(project: ProjectData): string {
  const vars = inputVarNames(project.inputBits);
  const header = [...vars, 'Decimal', 'Hex', ...SEGMENT_NAMES];
  const lines = [header.join(',')];
  for (const row of project.truthTable.rows) {
    const bits = row.input.toString(2).padStart(project.inputBits, '0');
    lines.push([
      ...bits.split(''),
      String(row.input),
      formatHex(row.input),
      ...SEGMENT_NAMES.map((s) => String(row.outputs[s])),
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

export function buildProjectJson(project: ProjectData): string {
  return JSON.stringify(project, null, 2);
}

/**
 * Font file: the current truth table exported as a shareable glyph set.
 * Importing this file elsewhere (or here) rebuilds the exact table window.
 */
export function buildFontJson(project: ProjectData): string {
  const glyphs = project.truthTable.rows.map((row) => {
    const segments = SEGMENT_NAMES.filter((s) => row.outputs[s] === 1 && s !== 'DP').join('');
    return {
      code: row.input,
      binary: row.input.toString(2).padStart(project.inputBits, '0'),
      segments,
      pattern: SEGMENT_NAMES.filter((s) => s !== 'DP').map((s) => (row.outputs[s] === 1 ? 1 : 0)).join(''),
    };
  });
  return JSON.stringify(
    {
      format: 'sevenseg-font',
      version: 1,
      name: `${project.name} — table window`,
      inputBits: project.inputBits,
      startCode: project.tableStartCode ?? 0,
      note: 'Each glyph lists the lit segments (A-G). Import to reproduce this exact truth-table window.',
      glyphs,
    },
    null,
    2,
  );
}

/** The full built-in reference-chart font as a font file (74 glyphs). */
export function buildBuiltinFontJson(): string {
  return JSON.stringify(
    {
      format: 'sevenseg-font',
      version: 1,
      name: 'Reference chart font (74 glyphs)',
      note: 'Uppercase A-Z, lowercase a-z and punctuation exactly as drawn on the reference chart.',
      glyphs: FONT_GLYPHS,
    },
    null,
    2,
  );
}

export function buildVerilogModule(project: ProjectData, engines: SegmentEngineMap): string {
  const expressions: Partial<Record<SegmentName, Term[]>> = {};
  const mintermLists: Partial<Record<SegmentName, { ones: number[]; dontCares: number[] }>> = {};
  for (const seg of SEGMENT_NAMES) {
    expressions[seg] = engines[seg].activeSopTerms;
    mintermLists[seg] = { ones: engines[seg].ones, dontCares: engines[seg].dontCares };
  }
  return generateVerilog(project.inputBits, expressions, {
    moduleName: project.name,
    mintermLists,
  });
}

/* ------------------------------------------------------------------ */
/* Image exports                                                       */
/* ------------------------------------------------------------------ */

export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  return new XMLSerializer().serializeToString(clone);
}

export function buildSvgBlob(svg: SVGSVGElement): Blob {
  return new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' });
}

export async function buildPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const data = serializeSvg(svg);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('E-230: failed to rasterize display SVG'));
    img.src = url;
  });
  const vb = svg.viewBox.baseVal;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vb.width * scale);
  canvas.height = Math.round(vb.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('E-231: canvas unavailable');
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('E-232: PNG encoding failed'))),
      'image/png',
    );
  });
}

/* ------------------------------------------------------------------ */
/* PDF engineering report                                              */
/* ------------------------------------------------------------------ */

export function buildPdfReport(project: ProjectData, engines: SegmentEngineMap): Blob {
  const doc = new PdfDoc();
  const vars = inputVarNames(project.inputBits);
  const dark: [number, number, number] = [0.12, 0.12, 0.15];
  const gray: [number, number, number] = [0.45, 0.45, 0.5];
  const M = 40; // margin

  /* ---- page 1: header + truth table ---- */
  doc.newPage();
  doc.text(M, 52, '7-SEGMENT LOGIC SIMULATOR', { size: 18, bold: true, color: dark });
  doc.text(M, 70, 'Engineering Report - Combinational Decoder Analysis', { size: 10, color: gray });
  const meta = [
    `Project: ${project.name}`,
    `Input width: ${project.inputBits}-bit (${vars.join(' ')}, ${vars[0]} = MSB)`,
    `Display mode: ${project.displayMode}   Invalid behavior: ${project.invalidBehavior}`,
    `Generated: ${new Date().toLocaleString()}`,
    `Minimization: Quine-McCluskey with don't-care handling (SOP & POS)`,
  ];
  meta.forEach((m, i) => doc.text(M, 92 + i * 13, m, { size: 9, color: gray }));

  // truth table
  const ttTop = 170;
  const colVal = 34;
  const colBits = project.inputBits * 9 + 8;
  const colSeg = 30;
  const tableW = colVal + colBits + colSeg * SEGMENT_NAMES.length;
  doc.text(M, ttTop - 8, 'TRUTH TABLE', { size: 11, bold: true, color: dark });
  // header row
  let cx = M;
  const rowH = 17;
  doc.rect(M, ttTop, colVal, rowH, { fill: [0.92, 0.92, 0.94] });
  doc.text(cx + 8, ttTop + 12, 'm', { size: 8, bold: true });
  cx += colVal;
  doc.rect(cx, ttTop, colBits, rowH, { fill: [0.92, 0.92, 0.94] });
  doc.text(cx + 4, ttTop + 12, vars.join(' '), { size: 8, bold: true });
  cx += colBits;
  SEGMENT_NAMES.forEach((seg) => {
    doc.rect(cx, ttTop, colSeg, rowH, { fill: [0.92, 0.92, 0.94] });
    doc.text(cx + colSeg / 2 - 3, ttTop + 12, seg, { size: 8, bold: true });
    cx += colSeg;
  });
  doc.rect(M, ttTop, tableW, rowH, { stroke: [0.7, 0.7, 0.75] });

  project.truthTable.rows.forEach((row, i) => {
    const y = ttTop + rowH * (i + 1);
    if (i % 2 === 1) doc.rect(M, y, tableW, rowH, { fill: [0.96, 0.96, 0.97] });
    let x = M;
    doc.text(x + 12, y + 12, String(row.input), { size: 8 });
    x += colVal;
    doc.text(x + 4, y + 12, row.input.toString(2).padStart(project.inputBits, '0'), { size: 8 });
    x += colBits;
    SEGMENT_NAMES.forEach((seg) => {
      const v = row.outputs[seg];
      const color = v === 1 ? [0.05, 0.55, 0.35] : v === 'X' ? [0.75, 0.5, 0.05] : gray;
      doc.text(x + colSeg / 2 - 3, y + 12, String(v), { size: 8, color });
      x += colSeg;
    });
    doc.rect(M, y, tableW, rowH, { stroke: [0.85, 0.85, 0.88], strokeWidth: 0.4 });
  });
  doc.text(M, ttTop + rowH * (project.truthTable.rows.length + 1) + 14,
    'X = don\'t care (used by the minimizer). Segment order: A B C D E F G, DP.', { size: 8, color: gray });

  /* ---- K-map pages ---- */
  const cell = 34;
  const kmapTop = 96;
  const drawKmapGrid = (x0: number, y0: number, engine: SegmentEngineMap[SegmentName], plane: number, planeLabel: string | null) => {
    const kmap = engine.kmap;
    // column labels
    kmap.colLabels.forEach((cl, c) => {
      doc.text(x0 + c * cell + cell / 2 - 6, y0 - 6, cl, { size: 7, color: gray });
    });
    // row labels
    kmap.rowLabels.forEach((rl, r) => {
      doc.text(x0 - 16, y0 + r * cell + cell / 2 + 2, rl, { size: 7, color: gray });
    });
    // grid + values
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const mintermCell = kmap.planes[plane][r][c];
        doc.rect(x0 + c * cell, y0 + r * cell, cell, cell, {
          stroke: [0.75, 0.75, 0.8],
          fill: [0.98, 0.98, 0.99],
          strokeWidth: 0.6,
        });
        const v = mintermCell.value;
        const color = v === 1 ? [0.05, 0.55, 0.35] : v === 'X' ? [0.75, 0.5, 0.05] : [0.55, 0.55, 0.6];
        doc.text(x0 + c * cell + cell / 2 - 4, y0 + r * cell + cell / 2 + 6, String(v), { size: 11, bold: true, color });
        doc.text(x0 + c * cell + 2, y0 + r * cell + 8, String(mintermCell.minterm), { size: 5.5, color: [0.65, 0.65, 0.7] });
      }
    }
    // group rectangles
    const groups = engine.sopGroups.filter((g) => g.included);
    groups.forEach((g) => {
      const rgb = hexToRgb(GROUP_PALETTE[g.colorIndex % GROUP_PALETTE.length]);
      groupCellRects(g, plane).forEach((r) => {
        doc.rect(x0 + r.c0 * cell + 1.5, y0 + r.r0 * cell + 1.5, (r.c1 - r.c0 + 1) * cell - 3, (r.r1 - r.r0 + 1) * cell - 3, {
          stroke: rgb,
          strokeWidth: 1.6,
        });
      });
    });
    // axis titles
    doc.text(x0 + 2 * cell - 6, y0 - 18, `${kmap.colVars.join('')} (cols)`, { size: 7, color: gray });
    doc.text(x0 - 34, y0 + 2 * cell + 2, `${kmap.rowVars.join('')} (rows)`, { size: 7, color: [0.9, 0.9, 0.9] });
    if (planeLabel) doc.text(x0 + 2 * cell - 14, y0 + 4 * cell + 12, planeLabel, { size: 8, bold: true, color: dark });
  };

  let pageCursor = 0;
  const perPage = project.inputBits === 5 ? 1 : 2;
  SEGMENT_NAMES.forEach((seg, idx) => {
    const engine = engines[seg];
    if (pageCursor % perPage === 0) {
      doc.newPage();
      doc.text(M, 52, 'KARNAUGH MAPS', { size: 14, bold: true, color: dark });
      doc.text(M, 68, `Simplified SOP groups per segment - Gray-code ordering (00 01 11 10)`, { size: 9, color: gray });
      pageCursor = 0;
    }
    const slot = pageCursor;
    pageCursor++;
    const yBase = kmapTop + slot * 330;
    doc.text(M, yBase - 26, `Segment ${seg}`, { size: 11, bold: true, color: dark });
    const expr = sopToString(engine.activeSopTerms, 'ascii') || '0';
    doc.text(M + 70, yBase - 26, `${seg} = ${expr}`, { size: 9 });
    doc.text(M, yBase - 14,
      `SOP: ${engine.stats.simplifiedSop.terms}T/${engine.stats.simplifiedSop.literals}L  (canonical ${engine.stats.canonicalSop.terms}T/${engine.stats.canonicalSop.literals}L)   POS: ${posToString(engine.activePosTerms, 'ascii')}`,
      { size: 7.5, color: gray });

    const planes = engine.kmap.planes;
    planes.forEach((_, p) => {
      const x0 = M + 34 + p * (4 * cell + 90);
      drawKmapGrid(x0, yBase, engine, p, planes.length > 1 ? `E = ${p}` : null);
    });
    // group legend
    const legendX = M + 34 + planes.length * (4 * cell + 90) - 70;
    const groups = engine.sopGroups;
    if (groups.length > 0) {
      doc.text(legendX, yBase + 6, 'Groups:', { size: 8, bold: true, color: dark });
      groups.slice(0, 7).forEach((g, i) => {
        const rgb = hexToRgb(GROUP_PALETTE[g.colorIndex % GROUP_PALETTE.length]);
        doc.rect(legendX, yBase + 12 + i * 12, 8, 8, { stroke: rgb, fill: [rgb[0] * 0.15 + 0.85, rgb[1] * 0.15 + 0.85, rgb[2] * 0.15 + 0.85] });
        doc.text(legendX + 12, yBase + 20 + i * 12,
          `${sopToString([g.term], 'ascii')} (${g.size} cells${g.isEssential ? ', essential' : ''})`,
          { size: 7.5 });
      });
    } else {
      doc.text(legendX, yBase + 6, `No groups: ${seg} is constant for all defined inputs.`, { size: 8, color: gray });
    }
    void idx;
  });

  /* ---- expressions summary page ---- */
  doc.newPage();
  doc.text(M, 52, 'BOOLEAN EXPRESSIONS', { size: 14, bold: true, color: dark });
  doc.text(M, 68, `Minimized with Quine-McCluskey; variables ${vars.join(' ')} (${vars[0]} = MSB). A' denotes NOT A.`, { size: 9, color: gray });
  let ey = 100;
  SEGMENT_NAMES.forEach((seg) => {
    const engine = engines[seg];
    doc.text(M, ey, `Segment ${seg}`, { size: 10, bold: true, color: dark });
    doc.text(M + 70, ey, `SOP: ${sopToString(engine.activeSopTerms, 'ascii')}`, { size: 9 });
    doc.text(M + 70, ey + 12, `POS: ${posToString(engine.activePosTerms, 'ascii')}`, { size: 9 });
    doc.text(M, ey + 12,
      `m(${engine.ones.join(',') || '-'}) d(${engine.dontCares.join(',') || '-'})`,
      { size: 7.5, color: gray });
    doc.text(M, ey + 24,
      `primes: ${engine.sop.primes.length}   cover: ${engine.stats.simplifiedSop.terms} terms / ${engine.stats.simplifiedSop.literals} literals   canonical: ${engine.stats.canonicalSop.literals} literals`,
      { size: 7.5, color: gray });
    doc.line(M, ey + 32, doc.pageWidth - M, ey + 32, { color: [0.88, 0.88, 0.9], width: 0.5 });
    ey += 46;
    if (ey > doc.pageHeight - 60) {
      doc.newPage();
      ey = 70;
    }
  });

  /* ---- verilog appendix ---- */
  doc.newPage();
  doc.text(M, 52, 'VERILOG IMPLEMENTATION', { size: 14, bold: true, color: dark });
  doc.text(M, 68, 'Synthesizable continuous assignments from the minimized SOP covers.', { size: 9, color: gray });
  const vlog = buildVerilogModule(project, engines);
  vlog.split('\n').slice(0, 60).forEach((line, i) => {
    doc.text(M, 92 + i * 11.5, line.length > 95 ? line.slice(0, 95) : line, { size: 7.5 });
  });

  return doc.build();
}
