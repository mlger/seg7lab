/**
 * Top-level engine: derives every analytical view (K-maps, prime implicants,
 * minimal SOP/POS covers, canonical forms, statistics) from the truth table.
 * Pure functions — safe to memoize on the truth-table identity.
 */
import {
  SEGMENT_NAMES,
  type CoverForm,
  type InputWidth,
  type ProjectData,
  type SegmentEngine,
  type SegmentName,
  type Term,
  type TruthTable,
} from '@/types/simulator';
import { segmentSets } from './truthTable';
import { minimize } from './minimizer';
import { buildKMap, coverToGroups } from './kmap';
import {
  implicantToSopTerm,
  implicantToPosTerm,
  mintermToTerm,
  maxtermToTerm,
  termStats,
} from './expressions';

export function computeSegmentEngine(
  table: TruthTable,
  segment: SegmentName,
  overrides: Partial<Record<CoverForm, { added?: string[]; excluded?: string[] }>>,
): SegmentEngine {
  const { ones, zeros, dontCares } = segmentSets(table, segment);
  const numVars = table.inputBits;

  const sop = minimize(ones, dontCares, numVars);
  const pos = minimize(zeros, dontCares, numVars);

  const kmap = buildKMap(table.inputBits, (m) => {
    const row = table.rows[m];
    return row ? row.outputs[segment] : 0;
  });

  const sopOverrides = overrides.sop ?? {};
  const posOverrides = overrides.pos ?? {};
  const sopGroups = coverToGroups(sop, kmap, 'sop', sopOverrides);
  const posGroups = coverToGroups(pos, kmap, 'pos', posOverrides);

  // Active expressions respect user cover exclusions and additions.
  const selected = (result: MinimizeResult, form: CoverForm): PrimeInfo[] => {
    const added = new Set(overrides[form]?.added ?? []);
    const excluded = new Set(overrides[form]?.excluded ?? []);
    return result.primes.filter(
      (p) => ((result.cover.includes(p) && !excluded.has(p.key)) || added.has(p.key)),
    );
  };
  const activeSopPrimes = selected(sop, 'sop');
  const activePosPrimes = selected(pos, 'pos');
  const activeSopTerms: Term[] = activeSopPrimes.map((p) => implicantToSopTerm(p, numVars));
  const activePosTerms: Term[] = activePosPrimes.map((p) => implicantToPosTerm(p, numVars));

  const sopCovered = new Set(activeSopPrimes.flatMap((p) => p.coveredOnes));
  const posCovered = new Set(activePosPrimes.flatMap((p) => p.coveredOnes));

  return {
    segment,
    ones,
    zeros,
    dontCares,
    sop,
    pos,
    sopGroups,
    posGroups,
    kmap,
    activeSopTerms,
    activePosTerms,
    uncoveredSop: ones.filter((m) => !sopCovered.has(m)),
    uncoveredPos: zeros.filter((m) => !posCovered.has(m)),
    stats: {
      canonicalSop: termStats(ones.map((m) => mintermToTerm(m, numVars))),
      canonicalPos: termStats(zeros.map((m) => maxtermToTerm(m, numVars))),
      simplifiedSop: termStats(activeSopTerms),
      simplifiedPos: termStats(activePosTerms),
    },
  };
}

export type SegmentEngineMap = Record<SegmentName, SegmentEngine>;

export function computeEngines(
  truthTable: TruthTable,
  coverExcluded: ProjectData['coverExcluded'],
  coverAdded: ProjectData['coverAdded'],
): SegmentEngineMap {
  const result = {} as SegmentEngineMap;
  for (const seg of SEGMENT_NAMES) {
    const merged: Partial<Record<CoverForm, { added?: string[]; excluded?: string[] }>> = {};
    for (const form of ['sop', 'pos'] as const) {
      const excluded = coverExcluded[seg]?.[form] ?? [];
      const added = coverAdded[seg]?.[form] ?? [];
      if (excluded.length || added.length) merged[form] = { added, excluded };
    }
    result[seg] = computeSegmentEngine(truthTable, seg, merged);
  }
  return result;
}

/** Input width -> number of rows. */
export function rowCount(bits: InputWidth): number {
  return 1 << bits;
}
