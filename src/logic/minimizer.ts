/**
 * Quine-McCluskey boolean minimizer with don't-care handling.
 *
 * This is a REAL algorithm — nothing about the 7-segment decoder is hard-coded:
 *  1. Generate all prime implicants of (ones ∪ don't-cares) by iterative combining.
 *  2. Build the prime implicant chart over the real minterms only.
 *  3. Select essential prime implicants.
 *  4. Complete the cover with an exact branch-and-bound search that minimizes
 *     (number of terms, total literals) lexicographically.
 *
 * Works for any number of variables (4 and 5 are used by this app) and any
 * user-defined truth table.
 */
import type { Implicant, MinimizeResult, PrimeInfo } from '@/types/simulator';
import { popcount } from '@/utils/binary';

export function implicantKey(imp: Implicant): string {
  return `${imp.bits}:${imp.mask}`;
}

function isPow2(x: number): boolean {
  return x !== 0 && (x & (x - 1)) === 0;
}

/** All minterms covered by an implicant (m & mask) === (bits & mask). */
export function implicantMinterms(imp: Implicant, numVars: number): number[] {
  const total = 1 << numVars;
  const out: number[] = [];
  const fixedBits = imp.bits & imp.mask;
  for (let m = 0; m < total; m++) {
    if ((m & imp.mask) === fixedBits) out.push(m);
  }
  return out;
}

/** Generate every prime implicant of the function defined by care-set `terms`. */
export function primeImplicants(terms: number[], numVars: number): Implicant[] {
  const fullMask = (1 << numVars) - 1;
  if (terms.length === 0) return [];

  // Deduplicate and normalize the starting singleton implicants.
  const start = [...new Set(terms)]
    .sort((a, b) => a - b)
    .map((m) => ({ bits: m & fullMask, mask: fullMask }));

  const primes = new Map<string, Implicant>();
  let current = start;
  let guard = 0;
  const MAX_ITER = numVars + 2;

  while (current.length > 0 && guard++ < MAX_ITER) {
    const used = new Array<boolean>(current.length).fill(false);
    const nextMap = new Map<string, Implicant>();

    // Group by mask for O(n²/8) comparisons instead of O(n²).
    const byMask = new Map<number, { imp: Implicant; idx: number }[]>();
    current.forEach((imp, idx) => {
      const list = byMask.get(imp.mask) ?? [];
      list.push({ imp, idx });
      byMask.set(imp.mask, list);
    });

    for (const group of byMask.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i].imp;
          const b = group[j].imp;
          const diff = a.bits ^ b.bits;
          if (diff !== 0 && isPow2(diff)) {
            used[group[i].idx] = true;
            used[group[j].idx] = true;
            const merged: Implicant = { bits: a.bits & ~diff, mask: a.mask & ~diff };
            nextMap.set(implicantKey(merged), merged);
          }
        }
      }
    }

    for (let i = 0; i < current.length; i++) {
      if (!used[i]) primes.set(implicantKey(current[i]), current[i]);
    }
    current = [...nextMap.values()];
  }

  return [...primes.values()];
}

interface CoverCost {
  terms: number;
  literals: number;
}

function costOf(primes: PrimeInfo[]): CoverCost {
  return {
    terms: primes.length,
    literals: primes.reduce((acc, p) => acc + p.literalCount, 0),
  };
}

function costWorse(a: CoverCost, b: CoverCost): boolean {
  // true when a is lexicographically worse than b (more terms, or equal terms & more literals)
  if (a.terms !== b.terms) return a.terms > b.terms;
  return a.literals > b.literals;
}

/**
 * Full minimization for one output function.
 * @param ones       minterms where the output is 1
 * @param dontCares  minterms where the output is X (usable for grouping, never required)
 * @param numVars    number of input variables
 */
export function minimize(ones: number[], dontCares: number[], numVars: number): MinimizeResult {
  const onesSet = new Set(ones);
  const dcSet = new Set(dontCares);

  // Special case: constant 0 — no minterms to cover, no search needed.
  if (onesSet.size === 0) {
    return { primes: [], cover: [], uncovered: [], exact: true };
  }

  const rawPrimes = primeImplicants([...onesSet, ...dcSet], numVars);

  // Annotate primes with chart information.
  const primes: PrimeInfo[] = rawPrimes
    .map((imp) => {
      const ms = implicantMinterms(imp, numVars);
      const coveredOnes = ms.filter((m) => onesSet.has(m));
      const coveredDontCares = ms.filter((m) => dcSet.has(m));
      return {
        ...imp,
        key: implicantKey(imp),
        coveredOnes,
        coveredDontCares,
        literalCount: popcount(imp.mask),
        isEssential: false,
      };
    })
    .filter((p) => p.coveredOnes.length > 0) // primes covering only don't-cares are useless
    .sort((a, b) => a.key.localeCompare(b.key));

  // Chart: which primes cover each required minterm.
  const coverersOf = new Map<number, PrimeInfo[]>();
  for (const m of onesSet) {
    coverersOf.set(
      m,
      primes.filter((p) => p.coveredOnes.includes(m)),
    );
  }

  // Every required minterm must be coverable (it is by construction: the largest
  // cube containing it is prime), but guard defensively.
  const uncovered: number[] = [];
  for (const [m, coverers] of coverersOf) {
    if (coverers.length === 0) uncovered.push(m);
  }

  // Essential primes: sole coverer of some minterm.
  const essential = primes.filter((p) =>
    p.coveredOnes.some((m) => (coverersOf.get(m) ?? []).length === 1),
  );
  for (const p of essential) p.isEssential = true;

  const coveredByEssential = new Set<number>();
  for (const p of essential) for (const m of p.coveredOnes) coveredByEssential.add(m);

  const remaining = [...onesSet].filter((m) => !coveredByEssential.has(m));

  let best: PrimeInfo[] | null = null;
  let bestCost: CoverCost | null = null;
  let budget = 500_000; // safety recursion budget — far beyond 5-variable needs
  let budgetExhausted = false; // set when the exact search was cut short

  const candidates = primes.filter((p) => !p.isEssential);

  // Hot-loop lookup: coveredOnes as a Set per candidate (identity-keyed), so the
  // per-node chart filtering below is O(1) per membership test instead of a
  // linear scan of the (small) coveredOnes array. Semantically identical —
  // coveredOnes never contains duplicates.
  const coveredSets = new Map<PrimeInfo, Set<number>>();
  for (const p of candidates) coveredSets.set(p, new Set(p.coveredOnes));
  const covers = (p: PrimeInfo, m: number): boolean => coveredSets.get(p)?.has(m) === true;

  const search = (chosen: PrimeInfo[], remainingOnes: number[]): void => {
    if (budget <= 0) {
      budgetExhausted = true;
      return;
    }
    budget--;
    if (remainingOnes.length === 0) {
      const solution = [...essential, ...chosen];
      const cost = costOf(solution);
      if (bestCost === null || costWorse(bestCost, cost)) {
        bestCost = cost;
        best = solution;
      }
      return;
    }
    // Pruning: with minterms still uncovered we must add at least one more term,
    // so any partial cover already at >= best.terms can never beat the best.
    const partialTerms = essential.length + chosen.length;
    if (bestCost !== null && partialTerms >= bestCost.terms) return;

    // Branch on the hardest uncovered minterm (fewest covering candidates).
    const chosenSet = new Set(chosen);
    let targetCoverers: PrimeInfo[] | null = null;
    for (const m of remainingOnes) {
      const cs = candidates.filter((p) => covers(p, m) && !chosenSet.has(p));
      if (targetCoverers === null || cs.length < targetCoverers.length) {
        targetCoverers = cs;
      }
      if (targetCoverers.length <= 1) break; // cannot get harder than 1
    }
    const coverers = targetCoverers ?? [];

    // Deterministic ordering: larger coverage first, then fewer literals, then key.
    const remainingSet = new Set(remainingOnes);
    const ordered = coverers.slice().sort((a, b) => {
      const ra = a.coveredOnes.filter((m) => remainingSet.has(m)).length;
      const rb = b.coveredOnes.filter((m) => remainingSet.has(m)).length;
      if (ra !== rb) return rb - ra;
      if (a.literalCount !== b.literalCount) return a.literalCount - b.literalCount;
      return a.key.localeCompare(b.key);
    });

    for (const p of ordered) {
      const nextRemaining = remainingOnes.filter((m) => !covers(p, m));
      search([...chosen, p], nextRemaining);
    }
  };

  // exact: the cover is proven minimal when the search ran to completion (or
  // no search was needed — essentials alone already cover every minterm).
  let exact = true;
  if (remaining.length > 0) {
    search([], remaining);
    exact = !budgetExhausted;
  } else {
    best = [...essential];
    bestCost = costOf(best);
  }

  // Fallback (budget exhausted): greedy completion — should never trigger for ≤ 5 vars.
  if (best === null) {
    exact = false;
    const greedy: PrimeInfo[] = [...essential];
    let left = [...remaining];
    while (left.length > 0) {
      let pick: PrimeInfo | null = null;
      let pickCount = -1;
      for (const p of candidates) {
        if (greedy.includes(p)) continue;
        const c = p.coveredOnes.filter((m) => left.includes(m)).length;
        if (c > pickCount) {
          pickCount = c;
          pick = p;
        }
      }
      if (!pick || pickCount <= 0) break;
      greedy.push(pick);
      left = left.filter((m) => !pick.coveredOnes.includes(m));
    }
    best = greedy;
    bestCost = costOf(greedy);
  }

  // `best` is assigned in the `search` closure, so TS cannot prove it is
  // non-null here even though the fallback above guarantees it — read it once.
  const finalCover: PrimeInfo[] = best ?? [];
  const finalUncovered = [...onesSet].filter(
    (m) => !finalCover.some((p) => p.coveredOnes.includes(m)),
  );

  return {
    primes,
    cover: finalCover,
    uncovered: finalUncovered,
    exact,
  };
}
