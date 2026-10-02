/**
 * Verilog HDL generator: emits a synthesizable combinational decoder module
 * built from the ACTUALLY minimized Boolean expressions (never hard-coded).
 */
import type { InputWidth, SegmentName, Term } from '@/types/simulator';

const SEGMENT_INDEX: Record<SegmentName, number> = {
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, DP: 7,
};

/** Default variable names, MSB first (A = MSB). */
function defaultVarNames(bits: InputWidth): string[] {
  return bits === 5 ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
}

/** Map each variable name to its bit index (MSB = highest bit). */
function nameToBitMap(varNames: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  varNames.forEach((name, i) => {
    map[name] = varNames.length - 1 - i;
  });
  return map;
}

function sanitizeModule(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned || /^[0-9]/.test(cleaned)) return `seven_segment_decoder`;
  return cleaned;
}

function termToVerilog(term: Term, nameToBit: Record<string, number>): string {
  if (term.literals.length === 0) return "1'b1";
  return term.literals
    .map((l) => (l.complemented ? `~in[${nameToBit[l.name] ?? 0}]` : `in[${nameToBit[l.name] ?? 0}]`))
    .join(' & ');
}

export interface VerilogOptions {
  moduleName?: string;
  includeTruthTableComment?: boolean;
  mintermLists?: Partial<Record<SegmentName, { ones: number[]; dontCares: number[] }>>;
  /** Variable names, MSB first (defaults A B C D / A B C D E). */
  varNames?: string[];
}

export function generateVerilog(
  inputBits: InputWidth,
  expressions: Partial<Record<SegmentName, Term[]>>,
  options: VerilogOptions = {},
): string {
  const bits = inputBits;
  const varNames = options.varNames?.length === bits ? options.varNames : defaultVarNames(bits);
  const nameToBit = nameToBitMap(varNames);
  const moduleName = sanitizeModule(options.moduleName ?? 'seven_segment_decoder');
  const lines: string[] = [];

  lines.push('// ------------------------------------------------------------');
  lines.push('// 7-Segment Display Logic Simulator — generated Verilog');
  lines.push(`// Module: ${moduleName}`);
  lines.push(`// Input mapping : in[${bits - 1}]..in[0] = ${varNames.join(',')} (MSB..LSB)`);
  lines.push('// Output mapping: seg[0]=A seg[1]=B seg[2]=C seg[3]=D seg[4]=E');
  lines.push('//                seg[5]=F seg[6]=G seg[7]=DP');
  lines.push('// Polarity     : active-HIGH (common cathode). For a common-anode');
  lines.push('//                display, invert each output (~seg[k]).');
  lines.push('// Expressions  : minimized with Quine-McCluskey + don\'t-care');
  lines.push('//                handling in the simulator (SOP cover).');
  lines.push('// ------------------------------------------------------------');
  lines.push(`module ${moduleName} (`);
  lines.push(`    input  [${bits - 1}:0] in,`);
  lines.push('    output [7:0] seg');
  lines.push(');');
  lines.push('');

  const segments: SegmentName[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
  for (const seg of segments) {
    const terms = expressions[seg];
    if (options.mintermLists?.[seg]) {
      const { ones, dontCares } = options.mintermLists[seg]!;
      if (ones.length > 0) {
        lines.push(`    // Segment ${seg}: minterms ${ones.join(', ')}` + (dontCares.length ? `; don't-cares ${dontCares.join(', ')}` : ''));
      } else if (dontCares.length === 0) {
        lines.push(`    // Segment ${seg}: always OFF`);
      }
    }
    if (!terms || terms.length === 0) {
      lines.push(`    assign seg[${SEGMENT_INDEX[seg]}] = 1'b0;`);
    } else if (terms.length === 1 && terms[0].literals.length === 0) {
      lines.push(`    assign seg[${SEGMENT_INDEX[seg]}] = 1'b1;`);
    } else {
      const rhs = terms.map((t) => termToVerilog(t, nameToBit)).join(' | ');
      lines.push(`    assign seg[${SEGMENT_INDEX[seg]}] = ${rhs};`);
    }
    lines.push('');
  }

  lines.push('endmodule');
  return lines.join('\n');
}
