/**
 * Binary / decimal / hexadecimal conversion helpers with strict validation.
 * All functions use MSB-first bit ordering.
 */
import type { Bit, InputWidth } from '@/types/simulator';

/**
 * Default variable names for the given input width, MSB first
 * (4-bit: A B C D, 5-bit: A B C D E — A = MSB). Renamable in the truth table.
 */
export function inputVarNames(bits: InputWidth): string[] {
  return bits === 5 ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
}

/** Weight (2^k) of the variable at `varIndex` (0 = MSB). */
export function varWeight(numVars: number, varIndex: number): number {
  return 1 << (numVars - 1 - varIndex);
}

/** Split a value into bits, MSB first. */
export function toBits(value: number, bits: number): Bit[] {
  const out: Bit[] = [];
  for (let i = bits - 1; i >= 0; i--) out.push(((value >> i) & 1) as Bit);
  return out;
}

/** Join MSB-first bits into a number. */
export function bitsToNumber(bits: Bit[]): number {
  return bits.reduce((acc, b) => (acc << 1) | b, 0);
}

export function maxvalue(bits: number): number {
  return (1 << bits) - 1;
}

export function formatBinary(value: number, bits: number): string {
  return value.toString(2).padStart(bits, '0');
}

export function formatHex(value: number): string {
  return value.toString(16).toUpperCase();
}

export interface ParseResult {
  ok: boolean;
  value?: number;
  error?: string;
}

/** Parse a binary string such as "1010". Accepts leading/trailing spaces, 0/1 only. */
export function parseBinary(text: string, bits: number): ParseResult {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'Empty binary string' };
  if (!/^[01]+$/.test(t)) {
    const bad = [...t].find((ch) => ch !== '0' && ch !== '1') ?? '?';
    return { ok: false, error: `Invalid binary digit "${bad}" — only 0 and 1 allowed` };
  }
  if (t.length > bits) return { ok: false, error: `Too many bits: ${t.length} > ${bits}` };
  return { ok: true, value: parseInt(t, 2) };
}

/** Parse a decimal string within [0, 2^bits - 1]. */
export function parseDecimal(text: string, bits: number): ParseResult {
  const t = text.trim();
  if (t === '') return { ok: false, error: 'Empty decimal string' };
  if (!/^[0-9]+$/.test(t)) return { ok: false, error: 'Invalid decimal — digits 0-9 only' };
  const v = parseInt(t, 10);
  const max = maxvalue(bits);
  if (v > max) return { ok: false, error: `Out of range: ${v} > ${max} (max for ${bits}-bit input)` };
  return { ok: true, value: v };
}

/** Parse a hexadecimal string such as "1F" within range. */
export function parseHex(text: string, bits: number): ParseResult {
  const t = text.trim().replace(/^0[xX]/, '');
  if (t === '') return { ok: false, error: 'Empty hexadecimal string' };
  if (!/^[0-9a-fA-F]+$/.test(t)) return { ok: false, error: 'Invalid hex — digits 0-9, A-F only' };
  const v = parseInt(t, 16);
  const max = maxvalue(bits);
  if (v > max) return { ok: false, error: `Out of range: 0x${formatHex(v)} > 0x${formatHex(max)} (max for ${bits}-bit input)` };
  return { ok: true, value: v };
}

/** Cycle a three-valued cell: 0 -> 1 -> X -> 0. */
export function cycleTri(value: 0 | 1 | 'X'): 0 | 1 | 'X' {
  if (value === 0) return 1;
  if (value === 1) return 'X';
  return 0;
}

/** Gray-code value at position i (0,1,3,2,...) — the K-map axis ordering. */
export function grayCode(i: number): number {
  return i ^ (i >> 1);
}

/** The full Gray-code axis ordering for an axis with `bits` variables, e.g. [0,1,3,2]. */
export function grayAxisOrder(bits: number): number[] {
  return Array.from({ length: 1 << bits }, (_, i) => grayCode(i));
}

export function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}
