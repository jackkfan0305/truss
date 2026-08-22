import type { XYPosition } from "@xyflow/react";

import {
  NODE_DEFAULT_SIZES,
  type CanvasNode,
  type NodeSize,
} from "@/types/canvas";

/**
 * The geometry primitives every layout consumer shares.
 *
 * These lived in `lib/design-plan.ts` while it was the only thing placing
 * nodes. `lib/graph-layout.ts` now owns placement and `design-plan` calls into
 * it, so leaving them there made the two modules import each other — a real
 * cycle, not a stylistic one: whichever loaded second saw an uninitialised
 * `MIN_NODE_GAP` and threw at module scope. Owning them here breaks it at the
 * root, so both sides can use plain static imports.
 *
 * Pure and DOM-free, like both of its consumers.
 */

/** Positions snap to this, matching the canvas `Background` dot grid. */
export const LAYOUT_GRID = 20;

/** The clear space every generated node keeps from its neighbours, in flow units. */
export const MIN_NODE_GAP = 40;

export interface Box extends NodeSize, XYPosition {}

/**
 * A node's occupied rectangle.
 *
 * The layout and everything reasoning about spacing resolve a node's size the
 * same way — through here — so nothing ends up reasoning about dimensions the
 * canvas does not actually give the node.
 */
export function toBox(node: CanvasNode): Box {
  const fallback = NODE_DEFAULT_SIZES[node.data.shape] ?? NODE_DEFAULT_SIZES.rectangle;

  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? fallback.width,
    height: node.height ?? fallback.height,
  };
}
