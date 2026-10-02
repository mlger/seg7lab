/**
 * Shared K-map group color system.
 *
 * Single source of truth for the group overlay palette so the on-screen
 * Karnaugh map, the custom-character grid and the PDF exporter can never
 * drift apart. Ambers/emeralds/roses — no indigo/blue (project rule).
 */

/** Overlay color per K-map group index (wraps for >8 groups). */
export const GROUP_PALETTE: readonly string[] = [
  '#f59e0b', '#10b981', '#f43f5e', '#a855f7',
  '#fb923c', '#14b8a6', '#eab308', '#ec4899',
] as const;

export function groupColor(index: number): string {
  return GROUP_PALETTE[index % GROUP_PALETTE.length];
}

/** '#rrggbb' → 'rgba(r,g,b,a)' (defensive: invalid hex maps to signal red). */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,45,45,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** '#rrggbb' → [r,g,b] each 0..1 (PDF writer expects normalized channels). */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 0.18, 0.18];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
