/**
 * Karnaugh map construction with correct Gray-code ordering.
 *
 * 4-variable map (inputs A B C D, A = MSB):
 *              CD (cols)
 *              00  01  11  10
 *      AB(rows) 00
 *              01
 *              11
 *              10
 *  minterm = A·8 + B·4 + C·2 + D·1  = (grayRow << 2) | grayCol
 *
 * 5-variable map: two 4-variable planes — A = 0 (left) and A = 1 (right),
 * A = MSB with weight 16. Groups may span both planes (mirror adjacency).
 * Variable names are customizable — defaults A B C D (E), MSB first.
 */
import type {
  InputWidth,
  KMapCell,
  KMapData,
  KMapGroup,
  MinimizeResult,
  PrimeInfo,
  SegmentOutput,
  Term,
} from '@/types/simulator';
import { grayAxisOrder, inputVarNames } from '@/logic/binary';
import { implicantToSopTerm, implicantToPosTerm } from './expressions';

export function buildKMap(
  bits: InputWidth,
  getValue: (minterm: number) => SegmentOutput,
  varNames?: string[],
): KMapData {
  const names = varNames ?? inputVarNames(bits);
  // MSB-first names: 4-bit rows = n0 n1, cols = n2 n3;
  // 5-bit plane = MSB (weight 16), rows = n1 n2, cols = n3 n4.
  const rowVars = bits === 5 ? names.slice(1, 3) : names.slice(0, 2);
  const colVars = bits === 5 ? names.slice(3, 5) : names.slice(2, 4);
  const planeVar = bits === 5 ? (names[0] ?? 'A') : null;
  const rowOrder = grayAxisOrder(2); // [0, 1, 3, 2]
  const colOrder = grayAxisOrder(2);
  const planeCount = bits === 5 ? 2 : 1;

  const planes: KMapCell[][][] = [];
  for (let plane = 0; plane < planeCount; plane++) {
    const rows: KMapCell[][] = [];
    for (let r = 0; r < 4; r++) {
      const rowCells: KMapCell[] = [];
      for (let c = 0; c < 4; c++) {
        const minterm = plane * 16 + rowOrder[r] * 4 + colOrder[c];
        rowCells.push({ plane, row: r, col: c, minterm, value: getValue(minterm) });
      }
      rows.push(rowCells);
    }
    planes.push(rows);
  }

  return {
    numVars: bits,
    rowVars,
    colVars,
    planeVar,
    planes,
    rowLabels: rowOrder.map((v) => v.toString(2).padStart(2, '0')),
    colLabels: colOrder.map((v) => v.toString(2).padStart(2, '0')),
  };
}

/**
 * Convert a minimize result into displayable K-map groups.
 * Shows every prime implicant: cover members are "included" (minus user
 * exclusions) and non-cover primes appear as alternates the user can add.
 */
export function coverToGroups(
  result: MinimizeResult,
  kmap: KMapData,
  form: 'sop' | 'pos',
  overrides: { added?: string[]; excluded?: string[] } = {},
  varNames?: string[],
): KMapGroup[] {
  const excludedSet = new Set(overrides.excluded ?? []);
  const addedSet = new Set(overrides.added ?? []);
  const coverSet = new Set(result.cover.map((p) => p.key));

  const groups: KMapGroup[] = result.primes.map((prime, index) => {
    const cells: { plane: number; row: number; col: number }[] = [];
    const mintermCells: number[] = [];
    for (const plane of kmap.planes) {
      for (const row of plane) {
        for (const cell of row) {
          if ((cell.minterm & prime.mask) === (prime.bits & prime.mask)) {
            cells.push({ plane: cell.plane, row: cell.row, col: cell.col });
            mintermCells.push(cell.minterm);
          }
        }
      }
    }
    const term: Term =
      form === 'sop'
        ? implicantToSopTerm(prime, kmap.numVars, varNames)
        : implicantToPosTerm(prime, kmap.numVars, varNames);

    // Eliminated-variable names: bitPos 0 = LSB → last MSB-first name.
    const names = varNames ?? inputVarNames(kmap.numVars === 5 ? 5 : 4);
    const eliminatedVars: string[] = [];
    for (let bitPos = 0; bitPos < kmap.numVars; bitPos++) {
      if (!(prime.mask & (1 << bitPos))) eliminatedVars.push(names[kmap.numVars - 1 - bitPos] ?? '?');
    }

    return {
      key: prime.key,
      cells,
      mintermCells,
      size: cells.length,
      term,
      coveredOnes: prime.coveredOnes,
      coveredDontCares: prime.coveredDontCares,
      isEssential: prime.isEssential,
      inMinimalCover: coverSet.has(prime.key),
      included: (coverSet.has(prime.key) && !excludedSet.has(prime.key)) || addedSet.has(prime.key),
      colorIndex: index,
      eliminatedVars,
    };
  });

  return groups;
}

/** A drawable rectangle in cell coordinates. */
export interface GroupRectCells {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  single: boolean;
}

/**
 * Split a group's cells in one plane into rectangles (handles wrap-around
 * groups that are not contiguous). Used by the UI overlays and the PDF export.
 */
export function groupCellRects(group: KMapGroup, plane: number): GroupRectCells[] {
  const cells = group.cells.filter((c) => c.plane === plane);
  if (cells.length === 0) return [];
  const r0 = Math.min(...cells.map((c) => c.row));
  const r1 = Math.max(...cells.map((c) => c.row));
  const c0 = Math.min(...cells.map((c) => c.col));
  const c1 = Math.max(...cells.map((c) => c.col));
  if (cells.length === (r1 - r0 + 1) * (c1 - c0 + 1)) {
    return [{ r0, r1, c0, c1, single: false }];
  }
  return cells.map((c) => ({ r0: c.row, r1: c.row, c0: c.col, c1: c.col, single: true }));
}

/** Human explanation of which variables were eliminated by a group. */
export function groupEliminationText(group: KMapGroup): string {
  if (group.eliminatedVars.length === 0) return 'no variables eliminated (single minterm)';
  const kept = group.term.literals.map((l) => (l.complemented ? `\u0305${l.name}` : l.name)).join('');
  return `${group.eliminatedVars.join(', ')} eliminated — constant across the group; term keeps ${kept}`;
}
