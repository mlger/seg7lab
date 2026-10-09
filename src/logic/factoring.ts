/**
 * Multi-level (factored) logic synthesis.
 *
 * A two-level SOP implements each product term with its own AND gate and
 * combines them with one OR. Multi-level logic instead SHARES common
 * sub-expressions, computing each one once as an intermediate signal that can
 * feed several gates:
 *
 *   two-level :  F = A'BC' + A'BD + AB'C + AB'D     (4 AND + 1 OR)
 *   factored  :  X1 = C' + D;  F = X1·(A'B + AB')   (X1 feeds two products)
 *
 * Two stages, both required:
 *   1. recursive common-cube factoring — pulls shared product cubes out into
 *      nested sub-expressions (adds depth, removes literals);
 *   2. structural hash-consing — two structurally identical sub-expressions
 *      collapse into ONE signal with several consumers. Without this the
 *      result is a tree (every signal used once) and nothing is actually
 *      shared.
 *
 * Chosen over full kernel/co-kernel extraction because it is explainable in a
 * teaching UI and the extra win on 4-5 variable decoder functions is marginal.
 *
 * Pure: no React, no DOM, no I/O. Covered by scripts/verify-logic.ts section 11.
 */
import type { Literal, Term } from '@/types/simulator';

/** A shared sub-expression computed once and referenced by its `id`. */
export interface FactoredSignal {
  /** Reference name, e.g. 'X1'. Appears as a literal in other terms. */
  id: string;
  /** Definition: the OR of these product terms (SOP form). */
  terms: Term[];
  /** Logic depth of this signal from the primary inputs. */
  depth: number;
  /** How many places consume this signal (2+ means genuinely shared). */
  consumers: number;
}

export interface FactoringStats {
  twoLevelGates: number;
  twoLevelLiterals: number;
  twoLevelDepth: number;
  multiLevelGates: number;
  multiLevelLiterals: number;
  multiLevelDepth: number;
  intermediates: number;
  /** Signals consumed in 2+ places. */
  sharedIntermediates: number;
}

export interface FactoredForm {
  /** Definitions in dependency order (a signal never references a later one). */
  intermediates: FactoredSignal[];
  /** Top expression over primary inputs and intermediate names. */
  output: Term[];
  stats: FactoringStats;
}

/** Canonical key for a literal ('A', "A'"). */
export function literalKey(l: Literal): string {
  return `${l.name}${l.complemented ? "'" : ""}`;
}

/** Canonical key for a product term (order-independent). */
export function termKey(t: Term): string {
  return t.literals.map(literalKey).sort().join('*');
}

/* ------------------------------------------------------------------ */
/* Expression tree used during factoring                               */
/* ------------------------------------------------------------------ */

/** One factor of a product: either a primary literal or a nested level. */
type Factor = { lit: Literal } | { sub: Expr };
/** A product (AND of factors). */
interface Product { factors: Factor[] }
/** An OR of products. */
interface Expr { terms: Product[] }

function litFactor(l: Literal): Factor {
  return { lit: l };
}

/** Structural key of a factor (used for cube matching and hash-consing). */
function factorKeyOf(f: Factor): string {
  return 'lit' in f ? literalKey(f.lit) : `(${exprKey(f.sub)})`;
}

/** Structural key of a product (order-independent). */
function productKeyOf(p: Product): string {
  return p.factors.map(factorKeyOf).sort().join('*');
}

/** Structural key of a whole expression (order-independent). */
export function exprKey(e: Expr): string {
  return e.terms.map(productKeyOf).sort().join('+');
}

/** Convert the public Term[] representation into an Expr. */
function toExpr(terms: Term[]): Expr {
  return {
    terms: terms.map((t) => ({
      factors: t.literals.map((l) => litFactor({ ...l })),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Stage 1 — recursive common-cube factoring                           */
/* ------------------------------------------------------------------ */

interface Cube {
  /** Factors shared by every member product. */
  factors: Factor[];
  /** Indices (into the current product list) containing the whole cube. */
  members: number[];
}

/**
 * Pick the best cube to factor out of `products`.
 *
 * Candidates are every pairwise product intersection plus every single factor
 * appearing in 2+ products — which catches maximal cubes no single pair yields.
 * Ranking is deterministic (most members, then widest cube, then
 * lexicographic), so the same function always factors the same way.
 */
function bestCommonCube(products: Product[]): Cube | null {
  if (products.length < 2) return null;
  const keys = products.map((p) => new Set(p.factors.map(factorKeyOf)));
  const candidates: Cube[] = [];
  const seen = new Set<string>();

  const push = (sharedKeys: string[], owner: Product) => {
    if (sharedKeys.length === 0) return;
    const sorted = [...sharedKeys].sort();
    const sig = sorted.join('*');
    if (seen.has(sig)) return;
    const members: number[] = [];
    for (let i = 0; i < products.length; i++) {
      if (sorted.every((k) => keys[i].has(k))) members.push(i);
    }
    if (members.length < 2) return; // not a common factor
    seen.add(sig);
    candidates.push({
      factors: sorted.map((k) => owner.factors.find((f) => factorKeyOf(f) === k)!),
      members,
    });
  };

  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      push([...keys[i]].filter((k) => keys[j].has(k)), products[i]);
    }
  }
  const counts = new Map<string, number>();
  for (const p of products) {
    for (const k of new Set(p.factors.map(factorKeyOf))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of counts) {
    if (n < 2) continue;
    const owner = products.find((p) => p.factors.some((f) => factorKeyOf(f) === k))!;
    push([k], owner);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.members.length !== b.members.length) return b.members.length - a.members.length;
    if (a.factors.length !== b.factors.length) return b.factors.length - a.factors.length;
    return a.factors.map(factorKeyOf).sort().join('*')
      .localeCompare(b.factors.map(factorKeyOf).sort().join('*'));
  });
  return candidates[0];
}

/** True when a product is the constant 1 (no factors). */
function isUnit(p: Product): boolean {
  return p.factors.length === 0;
}

/**
 * Factor an expression into nested sub-expressions (still a TREE at this
 * stage — hash-consing turns it into a shared DAG).
 */
function factorExpr(expr: Expr): Expr {
  let current = expr.terms.map((p) => ({ factors: [...p.factors] }));

  // Each pass removes at least one product from this level, so this halts.
  for (;;) {
    const cube = bestCommonCube(current);
    if (!cube) break;

    // Cofactors: each member product with the shared cube removed.
    const remainders: Product[] = cube.members.map((idx) => ({
      factors: current[idx].factors.filter((f) => !cube.factors.some((c) => factorKeyOf(c) === factorKeyOf(f))),
    }));

    const sub = factorExpr({ terms: remainders });
    const rest = current.filter((_, idx) => !cube.members.includes(idx));

    if (sub.terms.length === 0) {
      // Sub-expression is constant 0 — the cube contributes nothing.
      current = rest;
      continue;
    }
    if (sub.terms.length === 1 && isUnit(sub.terms[0])) {
      // Sub-expression is constant 1 — the cube stands alone, no sharing needed.
      current = [...rest, { factors: [...cube.factors] }];
      continue;
    }

    current = [...rest, { factors: [...cube.factors, { sub }] }];
  }
  return { terms: current };
}

/* ------------------------------------------------------------------ */
/* Stage 2 — structural hash-consing (tree -> shared DAG)              */
/* ------------------------------------------------------------------ */

/**
 * Result of resolving a sub-expression. `one`/`zero` carry the constant cases
 * so the parent can fold them instead of building a pointless gate.
 */
type Resolved = { kind: 'expr'; terms: Term[] } | { kind: 'one' } | { kind: 'zero' };

/** Canonical key for a resolved term list (order-independent). */
function canonicalTerms(terms: Term[]): string {
  return terms.map(termKey).sort().join('+');
}

/** True when the literal list contains both `L` and `L'` (product ≡ 0). */
function hasComplementPair(lits: Literal[]): boolean {
  const set = new Set(lits.map(literalKey));
  return lits.some((l) => set.has(`${l.name}${l.complemented ? '' : "'"}`));
}

/** True when the term list is exactly `L + L'` (expression ≡ 1). */
function isComplementPairList(terms: Term[]): boolean {
  return terms.length === 2
    && terms.every((t) => t.literals.length === 1)
    && terms[0].literals[0].name === terms[1].literals[0].name
    && terms[0].literals[0].complemented !== terms[1].literals[0].complemented;
}

/** Drop duplicate literals from a product and canonicalise their order. */
function dedupeLits(lits: Literal[]): Term {
  const seen = new Set<string>();
  const out: Literal[] = [];
  for (const l of lits) {
    const k = literalKey(l);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...l });
  }
  out.sort((a, b) => literalKey(a).localeCompare(literalKey(b)));
  return { literals: out };
}

/**
 * Walk the factored tree bottom-up, collapsing structurally identical
 * sub-expressions into ONE signal with several consumers. Children resolve
 * before parents, so signal ids come out in dependency order by construction.
 *
 * Signals are registered in `ctx`, so a caller can chain several expressions
 * through one context and let them share signals across the whole network.
 * `created` lists the ids this call introduced (used for per-expression stats).
 */
function hashCons(root: Expr, ctx: FactorContext): { intermediates: FactoredSignal[]; output: Resolved; created: string[] } {
  const byKey = ctx.byKey;
  const signals = ctx.signals;
  const created: string[] = [];

  const resolve = (e: Expr): Resolved => {
    const products: Term[] = [];

    for (const p of e.terms) {
      const lits: Literal[] = [];
      let killed = false;

      for (const f of p.factors) {
        if ('lit' in f) {
          lits.push({ ...f.lit });
          continue;
        }
        const child = resolve(f.sub);
        if (child.kind === 'zero') { killed = true; break; }
        if (child.kind === 'one') continue; // factor of 1 leaves the product unchanged
        // A single-literal sub-expression is cheaper inlined than given a signal.
        if (child.terms.length === 1 && child.terms[0].literals.length === 1) {
          lits.push({ ...child.terms[0].literals[0] });
          continue;
        }
        // Non-trivial: reuse an existing signal or create one.
        const key = canonicalTerms(child.terms);
        let id = byKey.get(key);
        if (!id) {
          id = `X${signals.length + 1}`;
          byKey.set(key, id);
          created.push(id);
          signals.push({ id, terms: child.terms.map((t) => ({ literals: t.literals.map((l) => ({ ...l })) })), depth: 0, consumers: 0 });
        }
        signals.find((s) => s.id === id)!.consumers += 1;
        lits.push({ name: id, complemented: false });
      }

      if (killed) continue;
      if (hasComplementPair(lits)) continue; // product ≡ 0
      products.push(dedupeLits(lits));
    }

    if (products.length === 0) return { kind: 'zero' };

    // Collapse duplicate products and detect the constant cases.
    const uniq = new Map<string, Term>();
    for (const t of products) uniq.set(termKey(t), t);
    const terms = [...uniq.values()];
    if (terms.some((t) => t.literals.length === 0)) return { kind: 'one' }; // 1 + X = 1
    if (isComplementPairList(terms)) return { kind: 'one' };
    return { kind: 'expr', terms };
  };

  return { intermediates: signals, output: resolve(root), created };
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function termGateCount(t: Term): number {
  return t.literals.length >= 2 ? 1 : 0;
}

function listGateCount(terms: Term[]): number {
  return terms.length >= 2 ? 1 : 0;
}

function termDepth(t: Term, depthOf: Map<string, number>): number {
  let d = 0;
  for (const l of t.literals) d = Math.max(d, depthOf.get(l.name) ?? 0);
  return t.literals.length >= 2 ? d + 1 : d;
}

function listDepth(terms: Term[], depthOf: Map<string, number>): number {
  if (terms.length === 0) return 0;
  const max = Math.max(...terms.map((t) => termDepth(t, depthOf)));
  return terms.length >= 2 ? max + 1 : max;
}

/**
 * Dualise a term list between SOP and POS shapes by De Morgan.
 *
 *   SOP  F  = p1 + p2 + …      (each pi a product)
 *   POS  F' = p1' · p2' · …    (each pi' a sum)
 *
 * Complementing every literal swaps product <-> sum and AND <-> OR, so POS
 * factoring can reuse the SOP engine unchanged: dualise, factor, dualise back.
 * Both directions are identities, so the result stays logically equivalent.
 */
function dualise(terms: Term[]): Term[] {
  return terms.map((t) => ({
    literals: t.literals.map((l) => ({ name: l.name, complemented: !l.complemented })),
  }));
}

/**
 * Factor `terms` (a two-level SOP) into a multi-level network.
 * Logically identical to the input for every input code — enforced by tests.
 */
/**
 * A hash-cons table that can span MULTIPLE expressions.
 *
 * Factoring one segment in isolation only finds sharing inside that segment.
 * Feeding several segments through one context makes structurally identical
 * sub-expressions collapse into a single signal, so a cube shared by two
 * segments is computed once for the whole decoder.
 */
export interface FactorContext {
  byKey: Map<string, string>;
  signals: FactoredSignal[];
}

export function createFactorContext(): FactorContext {
  return { byKey: new Map(), signals: [] };
}

/**
 * Factor `terms` (a two-level SOP) into a multi-level network.
 * Logically identical to the input for every input code — enforced by tests.
 *
 * When `ctx` is supplied, signals are registered in that shared table so
 * identical sub-expressions from other expressions reuse the same signal.
 */
export function factorTermsWith(terms: Term[], ctx: FactorContext): FactoredForm {
  const input: Term[] = terms.map((t) => ({ literals: t.literals.map((l) => ({ ...l })) }));
  const tree = factorExpr(toExpr(input));
  const { intermediates, output, created } = hashCons(tree, ctx);

  const outputTerms: Term[] = output.kind === 'one'
    ? [{ literals: [] }]          // constant 1
    : output.kind === 'zero'
      ? []                        // constant 0
      : output.terms;

  // Depth: signals are in dependency order, so one forward pass suffices.
  // Recomputing for the whole shared context keeps this correct when an earlier
  // expression already registered some of these signals.
  const depthOf = new Map<string, number>();
  for (const sig of ctx.signals) {
    sig.depth = listDepth(sig.terms, depthOf);
    depthOf.set(sig.id, sig.depth);
  }
  const multiLevelDepth = listDepth(outputTerms, depthOf);

  /* Stats describe THIS expression when the context is private (factorTerms
     creates a fresh one per call — the single-segment path the UI uses).
     CAVEAT: with a SHARED context (factorTermsWith via
     factoredDecoderCircuit), `intermediates` is the whole shared signal
     table, so multiLevelGates / multiLevelLiterals / stats.intermediates
     count other expressions' signals too. `mine` below IS filtered to this
     expression. The shared-path stats are currently unused (the decoder
     view computes its own gate counts) — treat them as unreliable there
     until this is split into per-expression accumulation. */
  const usedSignals = new Set<string>();
  const collect = (ts: Term[]): void => {
    for (const t of ts) for (const l of t.literals) if (depthOf.has(l.name)) usedSignals.add(l.name);
  };
  collect(outputTerms);
  for (const s of intermediates) collect(s.terms);

  /* Signals this expression owns: created here, or used by a term here. */
  const mine = intermediates.filter((s) => usedSignals.has(s.id) || created.includes(s.id));

  const multiLevelGates =
    intermediates.reduce(
      (acc, s) => acc + s.terms.reduce((a, t) => a + termGateCount(t), 0) + listGateCount(s.terms),
      0,
    )
    + outputTerms.reduce((a, t) => a + termGateCount(t), 0)
    + listGateCount(outputTerms);

  const multiLevelLiterals =
    intermediates.reduce((acc, s) => acc + s.terms.reduce((a, t) => a + t.literals.length, 0), 0)
    + outputTerms.reduce((a, t) => a + t.literals.length, 0);

  const stats: FactoringStats = {
    twoLevelGates: input.reduce((a, t) => a + termGateCount(t), 0) + listGateCount(input),
    twoLevelLiterals: input.reduce((a, t) => a + t.literals.length, 0),
    twoLevelDepth: listDepth(input, new Map()),
    multiLevelGates,
    multiLevelLiterals,
    multiLevelDepth,
    intermediates: intermediates.length,
    sharedIntermediates: intermediates.filter((s) => s.consumers >= 2).length,
  };

  return { intermediates: mine, output: outputTerms, stats };
}

/**
 * Factor one expression in isolation (the single-segment entry point).
 * Delegates to factorTermsWith with a fresh context.
 */
export function factorTerms(terms: Term[]): FactoredForm {
  return factorTermsWith(terms, createFactorContext());
}

/**
 * Factor either form of a segment's cover.
 *
 * SOP is factored directly. POS is factored by De Morgan duality: complement
 * every literal (turning the product-of-sums into a sum-of-products), factor,
 * then complement the literals of every produced term back. The transform is
 * its own inverse, so the network is logically identical to the POS input.
 *
 * The returned form's `output`/`intermediates` are POS-shaped when form==='pos':
 * an AND of sums, with any intermediate signal standing in for a shared sum group.
 */
export function factorCover(
  terms: Term[],
  form: 'sop' | 'pos',
  ctx: FactorContext = createFactorContext(),
): FactoredForm {
  if (form === 'sop') return factorTermsWith(terms, ctx);

  const dual = factorTermsWith(dualise(terms), ctx);
  return {
    intermediates: dual.intermediates.map((s) => ({ ...s, terms: dualise(s.terms) })),
    output: dualise(dual.output),
    stats: dual.stats,
  };
}
