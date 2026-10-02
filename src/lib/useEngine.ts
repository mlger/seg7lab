/**
 * Derived-state hooks: memoized computation of all analytical views
 * from the store's truth table.
 */
'use client';

import { useMemo } from 'react';
import { useSimulator } from '@/lib/store';
import { computeEngines } from '@/logic/engine';
import { matchesPreset } from '@/logic/truthTable';
import { isSegmentLit } from '@/logic/decoder';
import { toBits } from '@/utils/binary';
import type { SegmentEngineMap, SegmentName, SegmentOutput } from '@/types/simulator';

export function useEngines(): SegmentEngineMap {
  const truthTable = useSimulator((s) => s.truthTable);
  const coverExcluded = useSimulator((s) => s.coverExcluded);
  const coverAdded = useSimulator((s) => s.coverAdded);
  return useMemo(
    () => computeEngines(truthTable, coverExcluded, coverAdded),
    [truthTable, coverExcluded, coverAdded],
  );
}

/** Current-input derived values (bits, decimal, hex, lit segments). */
export function useCurrentInput() {
  const input = useSimulator((s) => s.currentInput);
  const bits = useSimulator((s) => s.inputBits);
  const table = useSimulator((s) => s.truthTable);
  const settings = useSimulator((s) => s.displaySettings);
  const displayMode = useSimulator((s) => s.displayMode);

  return useMemo(() => {
    const row = table.rows[input];
    const outputs = row ? row.outputs : null;
    const bitValues = toBits(input, bits);
    const litSegments: Record<SegmentName, boolean> = {} as Record<SegmentName, boolean>;
    const undefinedSegments: Record<SegmentName, boolean> = {} as Record<SegmentName, boolean>;
    if (outputs) {
      for (const seg of Object.keys(outputs) as SegmentName[]) {
        const v: SegmentOutput = outputs[seg];
        litSegments[seg] = isSegmentLit(v, settings);
        undefinedSegments[seg] = v === 'X';
      }
    }
    return {
      input,
      bits,
      bitValues,
      binary: bitValues.join(''),
      decimal: input,
      hex: input.toString(16).toUpperCase(),
      outputs,
      litSegments,
      undefinedSegments,
      displayMode,
    };
  }, [input, bits, table, settings, displayMode]);
}

/** Whether the truth table still equals its preset (for the "modified" indicator). */
export function usePresetModified(): boolean {
  const table = useSimulator((s) => s.truthTable);
  const mode = useSimulator((s) => s.displayMode);
  const behavior = useSimulator((s) => s.invalidBehavior);
  return useMemo(
    () => !matchesPreset(table, mode, behavior),
    [table, mode, behavior],
  );
}
