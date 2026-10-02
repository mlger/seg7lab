/**
 * Boolean expression formatting: converts implicants/terms into SOP / POS /
 * canonical forms with several notations (unicode overline, ASCII apostrophe,
 * HTML markup, Verilog).
 */
import type {
  ExpressionStats,
  Implicant,
  Literal,
  Notation,
  Term,
} from '@/types/simulator';
import { inputVarNames } from '@/utils/binary';
import type { InputWidth } from '@/types/simulator';

const COMBINING_OVERLINE = '\u0305';

/** Variable (MSB-first) name for bit position `bitPos` (LSB = position 0). */
function varAtBit(numVars: number, bitPos: number): string {
  const names = numVars === 5 ? ['E', 'D', 'C', 'B', 'A'] : ['D', 'C', 'B', 'A'];
  return names[numVars - 1 - bitPos];
}

export function literalToString(l: Literal, notation: Notation): string {
  switch (notation) {
    case 'unicode':
      return l.complemented ? l.name + COMBINING_OVERLINE : l.name;
    case 'ascii':
      return l.complemented ? `${l.name}'` : l.name;
    case 'html':
      return l.complemented ? `<span class="overline">${l.name}</span>` : l.name;
    case 'verilog':
      return l.name; // caller maps to in[k] / ~in[k]
  }
}

function joinLiterals(term: Term, notation: Notation, separator: string): string {
  if (term.literals.length === 0) return '';
  return term.literals.map((l) => literalToString(l, notation)).join(separator);
}

/** SOP product term, e.g. D·C̄·A (unicode) or D&C'&A (never verilog — see verilog module). */
export function sopTermToString(term: Term, notation: Notation): string {
  if (term.literals.length === 0) return '1';
  const sep = notation === 'ascii' ? '' : notation === 'html' ? '' : '·';
  return joinLiterals(term, notation, sep);
}

/** POS sum term, e.g. D+C̄+A. */
export function posTermToString(term: Term, notation: Notation): string {
  if (term.literals.length === 0) return '0';
  return joinLiterals(term, notation, '+');
}

/** Full SOP: terms joined with +. Empty -> "0". */
export function sopToString(terms: Term[], notation: Notation): string {
  if (terms.length === 0) return '0';
  if (terms.length === 1) return sopTermToString(terms[0], notation);
  return terms.map((t) => {
    const s = sopTermToString(t, notation);
    return t.literals.length <= 1 ? s : s;
  }).join(notation === 'ascii' ? ' + ' : ' + ');
}

/** Full POS: product of sum terms. Empty product -> "1". */
export function posToString(terms: Term[], notation: Notation): string {
  if (terms.length === 0) return '1';
  if (terms.length === 1) return posTermToString(terms[0], notation);
  return terms.map((t) => {
    const s = posTermToString(t, notation);
    return t.literals.length <= 1 ? s : `(${s})`;
  }).join(notation === 'ascii' ? '' : '·');
}

/** SOP term for an implicant: fixed bit 1 -> variable, fixed bit 0 -> complement. */
export function implicantToSopTerm(imp: Implicant, numVars: number): Term {
  const literals: Literal[] = [];
  for (let bitPos = 0; bitPos < numVars; bitPos++) {
    if (imp.mask & (1 << bitPos)) {
      literals.push({ name: varAtBit(numVars, bitPos), complemented: (imp.bits & (1 << bitPos)) === 0 });
    }
  }
  // Order MSB-first for natural reading.
  literals.reverse();
  return { literals };
}

/** POS sum term via De Morgan on the SOP complement: fixed bit 1 -> complement. */
export function implicantToPosTerm(imp: Implicant, numVars: number): Term {
  const literals: Literal[] = [];
  for (let bitPos = 0; bitPos < numVars; bitPos++) {
    if (imp.mask & (1 << bitPos)) {
      literals.push({ name: varAtBit(numVars, bitPos), complemented: ((imp.bits >> bitPos) & 1) === 1 });
    }
  }
  literals.reverse();
  return { literals };
}

/** Canonical SOP minterm for a specific input combination. */
export function mintermToTerm(minterm: number, numVars: number): Term {
  const literals: Literal[] = [];
  for (let i = numVars - 1; i >= 0; i--) {
    literals.push({ name: varAtBit(numVars, i), complemented: (minterm & (1 << i)) === 0 });
  }
  return { literals };
}

/** Canonical POS maxterm for a specific input combination. */
export function maxtermToTerm(minterm: number, numVars: number): Term {
  const literals: Literal[] = [];
  for (let i = numVars - 1; i >= 0; i--) {
    literals.push({ name: varAtBit(numVars, i), complemented: (minterm & (1 << i)) === 1 });
  }
  return { literals };
}

export function termStats(terms: Term[]): ExpressionStats {
  return {
    terms: terms.length,
    literals: terms.reduce((acc, t) => acc + t.literals.length, 0),
  };
}

/** Σ-notation minterm list, e.g. "Σm(1, 3, 5)". */
export function sigmaNotation(values: number[]): string {
  return `Σm(${values.join(', ')})`;
}

/** Π-notation maxterm list. */
export function piNotation(values: number[]): string {
  return `ΠM(${values.join(', ')})`;
}

/** d-notation don't-care list. */
export function dontCareNotation(values: number[]): string {
  return `d(${values.join(', ')})`;
}

/** Variable names (MSB first) for the input width — re-exported convenience. */
export function expressionVarNames(bits: InputWidth): string[] {
  return inputVarNames(bits);
}
