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
