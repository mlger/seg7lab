/**
 * Minimal dependency-free PDF writer (PDF 1.4, Helvetica core fonts).
 * Supports text, lines, rectangles and colors — enough for engineering
 * reports (truth tables, K-map grids, Boolean expressions).
 *
 * Coordinate system: top-left origin (converted internally to PDF's
 * bottom-left origin). Units: points (A4 portrait = 595 × 842).
 */

const PAGE_W = 595;
const PAGE_H = 842;

function esc(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
}

/* ------------------------------------------------------------------ */
/* Text metrics (Helvetica AFM widths) — needed to measure expressions */
/* before drawing them, so long SOP/POS strings wrap or ellipsize      */
/* instead of overlapping neighbouring lines / running off the page.   */
/* ------------------------------------------------------------------ */

/** Helvetica widths per mille for ASCII 32..126 (Adobe AFM metrics). */
const HELV_W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Helvetica-Bold widths per mille for ASCII 32..126. */
const HELV_BOLD_W = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Rendered width of `s` in points at the given font size. */
export function textWidth(s: string, size: number, bold = false): number {
  const t = bold ? HELV_BOLD_W : HELV_W;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i) - 32;
    w += c >= 0 && c < t.length ? t[c] : 556;
  }
  return (w / 1000) * size;
}

/**
 * Greedy word-wrap to `maxWidth` points. Words longer than the whole line
 * (giant unspaced terms) are hard-broken so every line fits.
 */
export function wrapText(s: string, size: number, bold: number | boolean, maxWidth: number): string[] {
  const boldFlag = bold === true;
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (textWidth(candidate, size, boldFlag) <= maxWidth || !cur) {
      // first word always taken; oversized single words hard-break below
      if (!cur && textWidth(word, size, boldFlag) > maxWidth) {
        let piece = '';
        for (const ch of word) {
          if (textWidth(piece + ch, size, boldFlag) > maxWidth && piece) {
            lines.push(piece);
            piece = ch;
          } else {
            piece += ch;
          }
        }
        cur = piece;
        continue;
      }
      cur = candidate;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Ellipsize `s` with a trailing "..." so it fits `maxWidth` points. */
export function fitText(s: string, size: number, bold: number | boolean, maxWidth: number): string {
  const boldFlag = bold === true;
  if (textWidth(s, size, boldFlag) <= maxWidth) return s;
  const ell = '...';
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(s.slice(0, mid) + ell, size, boldFlag) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + ell;
}

function n2(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

interface RectOpts {
  stroke?: [number, number, number];
  fill?: [number, number, number];
  strokeWidth?: number;
  dashed?: boolean;
}

export class PdfDoc {
  readonly pageWidth = PAGE_W;
  readonly pageHeight = PAGE_H;
  private pages: string[][] = [];
  private current: string[] | null = null;

  newPage(): void {
    this.current = [];
    this.pages.push(this.current);
  }

  private ensure(): string[] {
    if (!this.current) this.newPage();
    return this.current!;
  }

  text(x: number, y: number, s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number] } = {}): void {
    const size = opts.size ?? 9;
    const font = opts.bold ? '/F2' : '/F1';
    const c = opts.color ?? [0.1, 0.1, 0.12];
    this.ensure().push(
      `${n2(c[0])} ${n2(c[1])} ${n2(c[2])} rg BT ${font} ${n2(size)} Tf 1 0 0 1 ${n2(x)} ${n2(PAGE_H - y)} Tm (${esc(s)}) Tj ET`,
    );
  }

  rect(x: number, y: number, w: number, h: number, opts: RectOpts = {}): void {
    const ops: string[] = [];
    if (opts.stroke) {
      ops.push(`${n2(opts.stroke[0])} ${n2(opts.stroke[1])} ${n2(opts.stroke[2])} RG ${n2(opts.strokeWidth ?? 0.8)} w`);
    }
    if (opts.fill) {
      ops.push(`${n2(opts.fill[0])} ${n2(opts.fill[1])} ${n2(opts.fill[2])} rg`);
    }
    ops.push(`${n2(x)} ${n2(PAGE_H - y - h)} ${n2(w)} ${n2(h)} re ${opts.fill && opts.stroke ? 'B' : opts.fill ? 'f' : 'S'}`);
    this.ensure().push(...ops);
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { color?: [number, number, number]; width?: number } = {}): void {
    const c = opts.color ?? [0.75, 0.75, 0.78];
    this.ensure().push(
      `${n2(c[0])} ${n2(c[1])} ${n2(c[2])} RG ${n2(opts.width ?? 0.8)} w ${n2(x1)} ${n2(PAGE_H - y1)} m ${n2(x2)} ${n2(PAGE_H - y2)} l S`,
    );
  }

  build(): Blob {
    if (this.pages.length === 0) this.newPage();
    const objects: string[] = [];
    // object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page obj, content obj
    const pageCount = this.pages.length;
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);
    this.pages.forEach((ops, i) => {
      const content = ops.join('\n');
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
      );
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}
