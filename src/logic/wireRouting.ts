/**
 * Pure orthogonal (Manhattan) wire routing for the logic-circuit canvas.
 *
 * Every wire is three right-angle segments — horizontal, vertical, horizontal:
 *
 *      sx,sy ─────┐
 *                 │   ← vertical corridor at `laneX`
 *                 └──────── ex,ey
 *
 * The corridor x is offset per wire (lane) so that wires converging on the
 * same gate nest instead of overlapping into a single ambiguous line.
 *
 * Pure: no DOM, no React. Consumed by the circuit canvas; covered by
 * scripts/verify-logic.ts section 10.
 */

/** Source box: a gate/rail the wire leaves from (its right edge is the tap). */
export interface RouteSource {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Target box: a gate/rail the wire enters (pins are spread down its left edge). */
export interface RouteTarget {
  x: number;
  y: number;
  h: number;
  /** Number of input pins on the target — pins are evenly distributed. */
  operandCount: number;
}

/** Horizontal gap between successive lanes, in graph units. */
export const WIRE_LANE_GAP = 9;
/** Distance from the target's left edge to the first (lane 0) corridor. */
export const WIRE_LANE_OFFSET = 18;
/** Minimum corridor length — keeps a wire from collapsing onto its source. */
export const WIRE_MIN_RUN = 6;

/** Tap point on the source's right edge (vertical centre). */
export function wireStart(from: RouteSource): { x: number; y: number } {
  return { x: from.x + from.w, y: from.y + from.h / 2 };
}

/** Entry point of pin `pin` on the target's left edge. */
export function wireEnd(to: RouteTarget, pin: number): { x: number; y: number } {
  const count = to.operandCount > 0 ? to.operandCount : 1;
  return { x: to.x, y: to.y + ((pin + 1) * to.h) / (count + 1) };
}

/**
 * X of the vertical corridor for a given lane. Never left of the source tap
 * (plus a minimum run), so the wire always travels forwards.
 */
export function wireLaneX(from: RouteSource, to: RouteTarget, lane: number): number {
  const desired = to.x - WIRE_LANE_OFFSET - lane * WIRE_LANE_GAP;
  return Math.max(wireStart(from).x + WIRE_MIN_RUN, desired);
}

/**
 * Orthogonal path for one wire. Emits only M/H/V commands — never C/S/Q/A —
 * so the rendered wire has sharp right angles and no curves. When source and
 * target already share a y (a NOT rail lining up with its gate, say) the
 * vertical run is dropped entirely rather than emitted at zero length.
 */
export function orthogonalWirePath(
  from: RouteSource,
  to: RouteTarget,
  pin: number,
  lane: number,
): string {
  const s = wireStart(from);
  const e = wireEnd(to, pin);
  if (s.y === e.y) return `M ${round(s.x)},${round(s.y)} H ${round(e.x)}`;
  const laneX = wireLaneX(from, to, lane);
  return `M ${round(s.x)},${round(s.y)} H ${round(laneX)} V ${round(e.y)} H ${round(e.x)}`;
}

/** Keep the emitted path compact and stable for tests/snapshots. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministic lane per wire: 0, 1, 2 … in wire order, independently per
 * target node, so wires into the same gate fan out into nested corridors.
 */
export function assignWireLanes(wires: { id: string; toId: string }[]): Map<string, number> {
  const seen = new Map<string, number>();
  const lanes = new Map<string, number>();
  for (const w of wires) {
    const next = seen.get(w.toId) ?? 0;
    lanes.set(w.id, next);
    seen.set(w.toId, next + 1);
  }
  return lanes;
}

/**
 * How many wires leave each node. A count > 1 means the net is shared and the
 * canvas should draw a junction dot at that tap point.
 */
export function fanOutCounts(wires: { fromId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of wires) counts.set(w.fromId, (counts.get(w.fromId) ?? 0) + 1);
  return counts;
}
