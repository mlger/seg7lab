/**
 * Derived-state hooks: memoized computation of all analytical views
 * from the store's truth table.
 */
'use client';

import { useMemo } from 'react';
import { useSimulator, resolveTablePreset, activeFontGlyphs } from '@/lib/store';
import { computeEngines } from '@/logic/engine';
import { matchesTablePreset } from '@/logic/presets';
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

/**
 * Whether the truth table no longer equals the applied preset's table
 * (drives the "modified" indicator). No preset applied → never modified.
 */
export function usePresetModified(): boolean {
  const table = useSimulator((s) => s.truthTable);
  const behavior = useSimulator((s) => s.invalidBehavior);
  const fontStart = useSimulator((s) => s.fontStart);
  const tableStartCode = useSimulator((s) => s.tableStartCode);
  const customFont = useSimulator((s) => s.customFont);
  const activeFontId = useSimulator((s) => s.activeFontId);
  const appliedPresetId = useSimulator((s) => s.appliedPresetId);
  const library = useSimulator((s) => s.presetLibrary);
  return useMemo(() => {
    const preset = resolveTablePreset(appliedPresetId, library);
    if (!preset) return false;
    const effective = {
      ...preset,
      options: {
        ...preset.options,
        fontStart: preset.options?.fontStart ?? fontStart,
        tableStartCode: preset.options?.tableStartCode ?? tableStartCode,
      },
    };
    return !matchesTablePreset(table, effective, behavior, activeFontGlyphs(customFont, activeFontId));
  }, [table, behavior, fontStart, tableStartCode, customFont, activeFontId, appliedPresetId, library]);
}

/** Info about the applied table preset for headers/toolbars. */
export function useAppliedTablePreset(): { id: string | null; name: string | null; modified: boolean } {
  const id = useSimulator((s) => s.appliedPresetId);
  const name = useSimulator((s) => s.appliedPresetName);
  const modified = usePresetModified();
  return { id, name, modified };
}
