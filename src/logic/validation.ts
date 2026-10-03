/**
 * Shared validation primitives for stored/imported blobs.
 *
 * ONLY the shape checks live here — the E-code error REPORTING (which code to
 * emit, what message to append, whether to bail out) stays with each caller,
 * because the E-2xx (project.ts) and E-27x (presets.ts) families are part of
 * their public contracts. Callers validate a value, then decide how to report.
 *
 * Import DAG position: below font.ts (isSegmentName), above presets.ts /
 * project.ts. Pure — no React, no store, no DOM, no I/O.
 */
import type { FontGlyphData, SegmentOutput } from '@/types/simulator';
import { isSegmentName } from './font';

// Single home for the segment-name guard so callers don't have to reach into
// font.ts (which owns the glyph chart) just to check one character.
export { isSegmentName };

/** A segment output cell value: 0, 1 or don't-care 'X'. */
export function isSegmentOutput(v: unknown): v is SegmentOutput {
  return v === 0 || v === 1 || v === 'X';
}

/**
 * Validate one glyph entry of a font/glyph list: an object with
 * `char` (1–4 characters) and `segments` (a string whose characters are all
 * segment names A–G / DP; '' = blank glyph is allowed).
 *
 * Returns the validated glyph or null — callers map null to their own E-code
 * (E-265 in project.ts font files, E-278 in presets.ts preset files, silent
 * skip in the lenient project customFont field).
 */
export function parseGlyphEntry(raw: unknown): FontGlyphData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const char = (raw as Record<string, unknown>).char;
  const segments = (raw as Record<string, unknown>).segments;
  if (
    typeof char === 'string' && char.length > 0 && char.length <= 4
    && typeof segments === 'string' && [...segments].every(isSegmentName)
  ) {
    return { char, segments };
  }
  return null;
}
