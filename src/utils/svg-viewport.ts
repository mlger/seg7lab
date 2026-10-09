/**
 * Viewport transform: maps between client pixels and the SVG viewBox
 * coordinate space (uniform scale + letterbox centering, matching
 * preserveAspectRatio="xMidYMid meet"). Every place that converts screen
 * positions to graph positions — fit, zoom anchoring, wheel zoom, pointer
 * dragging, band wayfinding — MUST go through this one helper so the five
 * former copies of the math cannot drift apart.
 *
 * Moved here from src/logic/circuitNetlist.ts during the clean-architecture
 * refactor: it is DOM-coupled (SVGSVGElement + getBoundingClientRect) and the
 * logic layer is contractually DOM-free. Same math, same signature.
 */

/** Viewport transform between client pixels and the SVG viewBox space. */
export interface ViewportTransform {
  /** viewBox-units per CSS pixel before zoom (the meet scale). */
  vbScale: number;
  /** 1 / vbScale — CSS pixels per viewBox unit (the `k` used for pan). */
  k: number;
  /** Letterbox offsets in CSS pixels (centering bars on each axis). */
  offX: number;
  offY: number;
  /** Client point → viewBox point (before pan/zoom are applied). */
  toViewBox: (clientX: number, clientY: number) => { x: number; y: number };
}

export function getViewportTransform(
  el: SVGSVGElement,
  circuit: { width: number; height: number },
): ViewportTransform | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return null;
  const vbScale = Math.min(circuit.width / rect.width, circuit.height / rect.height);
  const offX = (rect.width - circuit.width / vbScale) / 2;
  const offY = (rect.height - circuit.height / vbScale) / 2;
  return {
    vbScale,
    k: 1 / vbScale,
    offX,
    offY,
    toViewBox: (clientX: number, clientY: number) => ({
      x: (clientX - rect.left - offX) * vbScale,
      y: (clientY - rect.top - offY) * vbScale,
    }),
  };
}
