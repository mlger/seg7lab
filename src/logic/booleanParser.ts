/**
 * Boolean expression parser (recursive descent) + evaluator.
 *
 * Supported syntax (variables are the current input variable names — defaults
 * A B C D, plus E in 5-bit mode; multi-character custom names are supported):
 *   OR:      x + y   |  x | y
 *   XOR:     x ^ y
 *   AND:     x * y   |  x & y   |  x · y   |  xy (juxtaposition)
 *   NOT:     !x  ~x  ¬x   or postfix x'
 *   Constants: 0, 1
 *   Grouping: ( ... )
 *
 * Identifiers are tokenized with greedy longest-match against `allowedVars`,
 * so with vars [A, B, C, D, Q1] the text "Q1B" reads as Q1·B, while "AB" still
 * reads as the juxtaposition A·B. A digit that cannot extend a variable name
 * falls back to a constant ("A1" = A·1 unless "A1" is a variable).
 */
import type { InputWidth } from '@/types/simulator';

export type BoolAst =
  | { type: 'const'; value: 0 | 1 }
  | { type: 'var'; name: string }
  | { type: 'not'; operand: BoolAst }
  | { type: 'and'; operands: BoolAst[] }
  | { type: 'or'; operands: BoolAst[] }
  | { type: 'xor'; operands: BoolAst[] };

export interface ParseError {
  message: string;
  position: number;
}

export type ParseResult =
  | { ok: true; ast: BoolAst }
  | { ok: false; error: ParseError };

interface Token {
  kind: 'var' | 'const' | 'op' | 'lparen' | 'rparen';
  text: string;
  pos: number;
}

const OPS = ['+', '|', '^', '*', '&', '·', '!', '~', '¬', "'"];

function tokenize(src: string, allowedVars: string[]): { tokens: Token[]; error?: ParseError } {
  const tokens: Token[] = [];
  let i = 0;
  const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      // Identifier-led run (letters/digits/underscore, uppercased). Segmented by
      // greedy longest-match against allowedVars so juxtaposition keeps working
      // alongside multi-character variable names; bare 0/1 fall back to constants.
      let end = i + 1;
      while (end < src.length && isIdentChar(src[end])) end++;
      let rest = src.slice(i, end).toUpperCase();
      let off = i;
      let guard = 0;
      while (rest.length > 0) {
        if (++guard > 512) {
          return { tokens, error: { message: 'Identifier run too long', position: i } };
        }
        let matched = '';
        for (const v of allowedVars) {
          if (v.length > matched.length && rest.startsWith(v)) matched = v;
        }
        if (matched) {
          tokens.push({ kind: 'var', text: matched, pos: off });
          rest = rest.slice(matched.length);
          off += matched.length;
        } else if (rest[0] === '0' || rest[0] === '1') {
          tokens.push({ kind: 'const', text: rest[0], pos: off });
          rest = rest.slice(1);
          off += 1;
        } else {
          return {
            tokens,
            error: {
              message: `Unknown variable "${rest}" — allowed: ${allowedVars.join(', ')}`,
              position: off,
            },
          };
        }
      }
      i = end;
      continue;
    }
    if (ch === '0' || ch === '1') {
      tokens.push({ kind: 'const', text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch, pos: i });
      i++;
      continue;
    }
    if (OPS.includes(ch)) {
      tokens.push({ kind: 'op', text: ch, pos: i });
      i++;
      continue;
    }
    return { tokens, error: { message: `Unexpected character "${ch}"`, position: i } };
  }
  return { tokens };
}

export function parseBoolean(src: string, allowedVars: string[]): ParseResult {
  const { tokens, error } = tokenize(src, allowedVars);
  if (error) return { ok: false, error };
  if (tokens.length === 0) return { ok: false, error: { message: 'Empty expression', position: 0 } };

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  const isImplicitAnd = (): boolean => {
    const t = peek();
    if (!t) return false;
    return t.kind === 'var' || t.kind === 'const' || t.kind === 'lparen' ||
      (t.kind === 'op' && (t.text === '!' || t.text === '~' || t.text === '¬'));
  };

  const parseExpr = (): BoolAst | ParseError => {
    let left: BoolAst | ParseError = parseXor();
    if ('message' in left) return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.text === '+' || t.text === '|')) {
        next();
        const right = parseXor();
        if ('message' in right) return right;
        if (left.type === 'or') left = { type: 'or', operands: [...left.operands, right] };
        else left = { type: 'or', operands: [left, right] };
      } else break;
    }
    return left;
  };

  const parseXor = (): BoolAst | ParseError => {
    let left: BoolAst | ParseError = parseAnd();
    if ('message' in left) return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && t.text === '^') {
        next();
        const right = parseAnd();
        if ('message' in right) return right;
        if (left.type === 'xor') left = { type: 'xor', operands: [...left.operands, right] };
        else left = { type: 'xor', operands: [left, right] };
      } else break;
    }
    return left;
  };

  const parseAnd = (): BoolAst | ParseError => {
    let left: BoolAst | ParseError = parseUnary();
    if ('message' in left) return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.text === '*' || t.text === '&' || t.text === '·')) {
        next();
        const right = parseUnary();
        if ('message' in right) return right;
        if (left.type === 'and') left = { type: 'and', operands: [...left.operands, right] };
        else left = { type: 'and', operands: [left, right] };
      } else if (isImplicitAnd()) {
        const right = parseUnary();
        if ('message' in right) return right;
        if (left.type === 'and') left = { type: 'and', operands: [...left.operands, right] };
        else left = { type: 'and', operands: [left, right] };
      } else break;
    }
    return left;
  };

  const parseUnary = (): BoolAst | ParseError => {
    const t = peek();
    if (t && t.kind === 'op' && (t.text === '!' || t.text === '~' || t.text === '¬')) {
      next();
      const operand = parseUnary();
      if ('message' in operand) return operand;
      return { type: 'not', operand };
    }
    return parsePrimary();
  };

  const parsePrimary = (): BoolAst | ParseError => {
    const t = next();
    if (!t) return { message: 'Unexpected end of expression', position: src.length };
    if (t.kind === 'var') {
      if (!allowedVars.includes(t.text)) {
        return {
          message: `Unknown variable "${t.text}" — allowed: ${allowedVars.join(', ')}`,
          position: t.pos,
        };
      }
      let node: BoolAst = { type: 'var', name: t.text };
      // Postfix NOT chains: A''
      for (;;) {
        const p = peek();
        if (p && p.kind === 'op' && p.text === "'") {
          next();
          node = { type: 'not', operand: node };
        } else break;
      }
      return node;
    }
    if (t.kind === 'const') {
      let node: BoolAst = { type: 'const', value: t.text === '1' ? 1 : 0 };
      for (;;) {
        const p = peek();
        if (p && p.kind === 'op' && p.text === "'") {
          next();
          node = { type: 'not', operand: node };
        } else break;
      }
      return node;
    }
    if (t.kind === 'lparen') {
      const inner = parseExpr();
      if ('message' in inner) return inner;
      const close = next();
      if (!close || close.kind !== 'rparen') {
        return { message: 'Missing closing parenthesis', position: t.pos };
      }
      let node = inner;
      for (;;) {
        const p = peek();
        if (p && p.kind === 'op' && p.text === "'") {
          next();
          node = { type: 'not', operand: node };
        } else break;
      }
      return node;
    }
    return { message: `Unexpected token "${t.text}"`, position: t.pos };
  };

  const ast = parseExpr();
  if ('message' in ast) return { ok: false, error: ast };
  const trailing = peek();
  if (trailing) {
    return { ok: false, error: { message: `Unexpected trailing token "${trailing.text}"`, position: trailing.pos } };
  }
  return { ok: true, ast };
}

export function evalBool(ast: BoolAst, env: Record<string, 0 | 1>): 0 | 1 {
  switch (ast.type) {
    case 'const':
      return ast.value;
    case 'var': {
      const v = env[ast.name];
      if (v === undefined) throw new Error(`No value for variable ${ast.name}`);
      return v;
    }
    case 'not':
      return evalBool(ast.operand, env) === 1 ? 0 : 1;
    case 'and':
      return ast.operands.every((o) => evalBool(o, env) === 1) ? 1 : 0;
    case 'or':
      return ast.operands.some((o) => evalBool(o, env) === 1) ? 1 : 0;
    case 'xor':
      return ast.operands.reduce((acc, o) => acc ^ evalBool(o, env), 0) as 0 | 1;
  }
}

export function collectVars(ast: BoolAst): Set<string> {
  const out = new Set<string>();
  const walk = (node: BoolAst) => {
    switch (node.type) {
      case 'var': out.add(node.name); break;
      case 'not': walk(node.operand); break;
      case 'and': case 'or': case 'xor': node.operands.forEach(walk); break;
    }
  };
  walk(ast);
  return out;
}

/** Pretty print with ASCII notation (D' for complement). */
export function astToAscii(ast: BoolAst): string {
  switch (ast.type) {
    case 'const': return String(ast.value);
    case 'var': return ast.name;
    case 'not': {
      // A compound operand MUST be parenthesized: (A·B)' is not A·B'.
      const inner = astToAscii(ast.operand);
      const compound = ast.operand.type === 'and' || ast.operand.type === 'or' || ast.operand.type === 'xor';
      return compound ? `(${inner})'` : `${inner}'`;
    }
    case 'and':
      // or/xor operands bind looser than juxtaposition — parenthesize so the
      // printed form reparses to the same tree (e.g. (A^B)C, not A^BC).
      return ast.operands.map((o) => (o.type === 'or' || o.type === 'xor' ? `(${astToAscii(o)})` : astToAscii(o))).join('');
    case 'or':
      return ast.operands.map((o) => (o.type === 'and' || o.type === 'xor' ? `(${astToAscii(o)})` : astToAscii(o))).join(' + ');
    case 'xor':
      // + binds looser than ^ — parenthesize or-operands (A+B)^C, not A+B^C.
      return ast.operands.map((o) => (o.type === 'and' || o.type === 'or' ? `(${astToAscii(o)})` : astToAscii(o))).join(' ^ ');
  }
}

/** Count gates needed by an AST circuit: { and, or, not, xor }. */
export function astGateCount(ast: BoolAst): { and: number; or: number; not: number; xor: number } {
  const count = { and: 0, or: 0, not: 0, xor: 0 };
  const walk = (node: BoolAst) => {
    switch (node.type) {
      case 'not': count.not++; walk(node.operand); break;
      case 'and': if (node.operands.length > 1) count.and++; node.operands.forEach(walk); break;
      case 'or': if (node.operands.length > 1) count.or++; node.operands.forEach(walk); break;
      case 'xor': if (node.operands.length > 1) count.xor++; node.operands.forEach(walk); break;
    }
  };
  walk(ast);
  return count;
}

/** Default variable names for input width (MSB first, A = MSB). */
export function parserVarNames(bits: InputWidth): string[] {
  return bits === 5 ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D'];
}
