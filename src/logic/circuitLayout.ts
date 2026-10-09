/**
 * Layered (level-based) layout for gate networks of ARBITRARY depth.
 *
 * The two-level builder in circuitNetlist.ts hardcodes its column x's because
 * a two-level network always has exactly the same shape: rails, NOT rails,
 * term gates, one combining gate, output. Multi-level (factored) networks have
 * a variable number of stages, so they need a real layout engine instead.
 *
 * Algorithm (deterministic, single evaluation, no iteration to convergence):
 *   1. level(n) = 1 + max(level of operands); sources are 0  (longest path)
 *   2. each level becomes a column, x derived from the widest node in it
 *   3. within a column, nodes are ordered by the mean y of their operands
 *      (barycenter) so wires flow top-to-bottom instead of crossing wildly
 *   4. vertical placement is a single downward packing pass with a gap, which
 *      guarantees no two nodes in a column overlap
 *
 * Pure: no React, no DOM. Covered by scripts/verify-logic.ts section 12.
 */
import type { CNode } from './circuitNetlist';

export interface LayoutOptions {
  /** Left margin before the first column. */
  marginX?: number;
  /** Top margin before the first node of every column. */
  marginY?: number;
  /** Horizontal gap between columns. */
  columnGap?: number;
  /** Vertical gap between nodes in a column. */
  rowGap?: number;
  /** Minimum canvas width/height, matching the two-level builder's floor. */
  minWidth?: number;
  minHeight?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  marginX: 56,
  marginY: 48,
  columnGap: 76,
  rowGap: 36,
  minWidth: 920,
  minHeight: 360,
};

/** Longest-path level of every node (sources are level 0). */
export function computeNodeLevels(nodes: CNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const levels = new Map<string, number>();
  const visiting = new Set<string>();

  const visit = (node: CNode): number => {
    const cached = levels.get(node.id);
    if (cached !== undefined) return cached;
    // Defensive: a malformed netlist must not hang the UI.
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    let max = -1;
    for (const id of node.operandIds) {
      const op = byId.get(id);
      if (op) max = Math.max(max, visit(op));
    }
    visiting.delete(node.id);
    const level = node.operandIds.length === 0 ? 0 : max + 1;
    levels.set(node.id, level);
    return level;
  };

  for (const n of nodes) visit(n);
  return levels;
}

/**
 * Assign x/y/w/h to every node in place. Nodes are grouped into columns by
 * level; within a column they are ordered by the barycenter of their operands
 * and packed top-to-bottom.
 *
 * Returns the canvas size the layout needs.
 */
export function layoutLayered(nodes: CNode[], options?: LayoutOptions): { width: number; height: number } {
  const o = { ...DEFAULTS, ...options };
  if (nodes.length === 0) return { width: o.minWidth, height: o.minHeight };

  const levels = computeNodeLevels(nodes);
  const maxLevel = Math.max(...levels.values());

  // Group into columns, preserving input order for determinism.
  const columns: CNode[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of nodes) columns[levels.get(n.id) ?? 0].push(n);

  /* Stamp each node with its layer so the canvas can draw layer bands. */
  for (const n of nodes) n.layer = levels.get(n.id) ?? 0;

  // Barycenter ordering: order each column by where its operands sit in the
  // previous column. Column 0 keeps its natural order.
  const orderIndex = new Map<string, number>();
  columns.forEach((col, ci) => {
    if (ci > 0) {
      const key = (n: CNode): number => {
        const positions = n.operandIds
          .map((id) => orderIndex.get(id))
          .filter((v): v is number => v !== undefined);
        if (positions.length === 0) return Number.MAX_SAFE_INTEGER;
        return positions.reduce((a, b) => a + b, 0) / positions.length;
      };
      // Stable sort: ties keep the original order.
      col.sort((a, b) => key(a) - key(b) || nodes.indexOf(a) - nodes.indexOf(b));
    }
    col.forEach((n, i) => orderIndex.set(n.id, i));
  });

  // Column x from the widest node in each column, so wide gates never collide.
  const colWidth = columns.map((col) => Math.max(...col.map((n) => n.w)));
  const colX: number[] = [];
  let x = o.marginX;
  for (let c = 0; c < columns.length; c++) {
    colX[c] = x;
    x += colWidth[c] + o.columnGap;
  }

  // Vertical packing: a single downward pass guarantees no overlap.
  columns.forEach((col, ci) => {
    let cursor = o.marginY;
    for (const n of col) {
      n.x = colX[ci];
      n.y = Math.max(cursor, o.marginY);
      cursor = n.y + n.h + o.rowGap;
    }
  });

  const maxX = Math.max(...nodes.map((n) => n.x + n.w)) + 40;
  const maxY = Math.max(...nodes.map((n) => n.y + n.h)) + 40;
  return {
    width: Math.max(o.minWidth, maxX),
    height: Math.max(o.minHeight, maxY),
  };
}
