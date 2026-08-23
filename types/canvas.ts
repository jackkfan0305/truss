import { MarkerType, type Edge, type EdgeMarker, type Node } from "@xyflow/react";
import type { CSSProperties } from "react";

/**
 * Shared canvas schema (11-base-canvas).
 *
 * The same node/edge shape has to serve user-created content, imported starter
 * templates and AI-generated updates — see the canvas invariant in
 * `context/architecture-context.md`. Nothing renders these yet; custom node and
 * edge components arrive in a later spec.
 */

/** The 8 node color pairs from `context/ui-context.md`. */
export const NODE_COLORS = {
  neutral: { fill: "#1F1F1F", text: "#EDEDED" },
  blue: { fill: "#10233D", text: "#52A8FF" },
  purple: { fill: "#2E1938", text: "#BF7AF0" },
  orange: { fill: "#331B00", text: "#FF990A" },
  red: { fill: "#3C1618", text: "#FF6166" },
  pink: { fill: "#3A1726", text: "#F75F8F" },
  green: { fill: "#0F2E18", text: "#62C073" },
  teal: { fill: "#062822", text: "#0AC7B4" },
} as const;

/**
 * Nodes store the palette *key*, not the hex value, so a palette edit reaches
 * every existing node instead of stranding old ones on retired colors.
 */
export type NodeColor = keyof typeof NODE_COLORS;

export const DEFAULT_NODE_COLOR: NodeColor = "neutral";

/** The 6 node shapes from `context/ui-context.md`. */
export const NODE_SHAPES = [
  "rectangle",
  "diamond",
  "circle",
  "pill",
  "cylinder",
  "hexagon",
] as const;

export type NodeShape = (typeof NODE_SHAPES)[number];

export const DEFAULT_NODE_SHAPE: NodeShape = "rectangle";

export interface NodeSize {
  width: number;
  height: number;
}

/**
 * The size a freshly dropped node gets, per shape (12-shape-panel).
 *
 * Tuned for a centred label rather than for the icon: rectangles and pills run
 * wide because names read on one line, circles stay square, and diamonds are
 * oversized because their usable area is only the middle half of the box.
 */
export const NODE_DEFAULT_SIZES: Record<NodeShape, NodeSize> = {
  rectangle: { width: 180, height: 80 },
  diamond: { width: 200, height: 130 },
  circle: { width: 130, height: 130 },
  pill: { width: 180, height: 56 },
  cylinder: { width: 160, height: 100 },
  hexagon: { width: 180, height: 96 },
};

/**
 * The floor a node can be resized to (14-node-editing). One value for every
 * shape: below roughly this, a centred label has nowhere left to sit.
 */
export const NODE_MIN_SIZE: NodeSize = { width: 72, height: 48 };

/**
 * The room an edge label needs at the midpoint of its edge, in flow units.
 *
 * `CanvasEdgeRenderer` centres the label pill on the path midpoint, so it sits
 * *between* the two nodes rather than beside them — two nodes placed only a node
 * gap apart get their label drawn across one of them. Measured from the pill's
 * own styling (`text-xs`, `px-2 py-0.5`, 1px border) at a few words of label;
 * the width is a budget, not a ceiling, which is why the prompt also asks the
 * model to keep edge labels short.
 */
export const EDGE_LABEL_CLEARANCE: NodeSize = { width: 160, height: 24 };

/**
 * The clear space a label pill keeps on every side. One `MIN_NODE_GAP`'s worth,
 * so a pill in a corridor is as far from what it sits between as a node is.
 */
export const LABEL_GAP = 40;

/**
 * The shared stub every edge in a bundle draws before the first one peels off.
 * Short on purpose: it is the cue that the lines share an origin, not a
 * corridor of its own.
 */
export const TRUNK_MIN = 40;

/**
 * The x distance between one lane's split column and the next.
 *
 * A full pill width plus a gap, because two lanes can carry labels at nearly
 * the same y: lane order is by vertical travel, so targets 100 and 90 units
 * away put their label anchors five units apart vertically and exactly one
 * `LANE_STEP` apart horizontally. Anything narrower than a pill overlaps them.
 */
export const LANE_STEP = EDGE_LABEL_CLEARANCE.width + LABEL_GAP;

/**
 * The y distance between the mid-lanes of one parallel group — the mirror of
 * `LANE_STEP`. A parallel group stacks its labels vertically at roughly one x,
 * so the separation it needs is a pill height plus a gap.
 *
 * Written as a literal 40 rather than `MIN_NODE_GAP`, which lives in
 * `lib/canvas-geometry.ts` — that module imports *from* here, and importing
 * back would recreate the exact cycle its header comment describes.
 */
export const PARALLEL_STEP = EDGE_LABEL_CLEARANCE.height + 40;

/** Corner rounding for every route this app draws, orthogonal or smoothstep. */
export const CORNER_RADIUS = 8;

/**
 * The total diagram width the compact agent graph contract can carry.
 *
 * `lib/agent-graph.ts` represents coordinates only within plus or minus
 * 10,000, and a node outside that range projects as *opaque* — invisible to an
 * agent reading the canvas back. `boundingCenter` centres the diagram on the
 * origin, so the usable span is both halves less the margin a node's own width
 * needs at each end.
 */
export const LAYOUT_WIDTH_BUDGET = 18920;

/**
 * How far from a handle a dropped connection still snaps to it, in flow units
 * (16-edge-behavior). React Flow's `connectionRadius` default is 20, which is
 * roughly "release on the dot" — a connection dropped on the *body* of a target
 * node found nothing and was discarded.
 *
 * The bar this has to clear is the distance from a node's centre to its nearest
 * side handle, so that releasing anywhere inside any node connects to it. The
 * worst case among the default sizes is the diamond and the circle at 65
 * (`height / 2`); the headroom above that covers a node resized taller and the
 * near-miss release just outside a node's border.
 *
 * `scripts/verify-canvas.ts` asserts this against every default size, since the
 * number is only correct relative to `NODE_DEFAULT_SIZES`.
 */
export const CONNECTION_SNAP_RADIUS = 90;

/**
 * How long a programmatic viewport move takes, in ms (17-canvas-ergonomics).
 * Shared by the control bar and the keyboard shortcuts so a zoom lands the same
 * way whichever one triggered it — long enough to read as movement, short
 * enough to survive a held key.
 */
export const VIEWPORT_TRANSITION_MS = 200;

/**
 * How far the canvas may zoom out. React Flow's default floor (0.5) cuts off
 * well before a large diagram fits on screen, so `fitView` on a wide graph
 * stops short with nodes still outside the viewport.
 */
export const MIN_ZOOM = 0.05;

/**
 * Declared as a `type`, not an `interface`: React Flow constrains node data to
 * `Record<string, unknown>`, and only type aliases get the implicit index
 * signature that satisfies it.
 */
export type CanvasNodeData = {
  label: string;
  color: NodeColor;
  shape: NodeShape;
};

/** Same reason as `CanvasNodeData`: a `type` gets the index signature React
 * Flow's `Edge<…>` constraint needs; an `interface` does not. */
export type CanvasEdgeData = {
  label: string;
  /**
   * The edge's slot among the edges leaving the same node by the same handle
   * (24-graph-layout). Decides which column it turns at, so it decides where
   * its label sits.
   *
   * Stamped by `applyLayout` from the laid-out geometry and persisted, rather
   * than recomputed per render. A geometric comparator is recomputed from live
   * positions, so dragging one node past another would flip it and two edges
   * would swap columns in a single jump of `LANE_STEP` — labels and all.
   * Absent on a hand-drawn edge that never went through layout; the renderer
   * falls back to an id sort for those.
   */
  lane?: number;
};

export const CANVAS_NODE_TYPE = "canvasNode";
export const CANVAS_EDGE_TYPE = "canvasEdge";

export type CanvasNode = Node<CanvasNodeData, typeof CANVAS_NODE_TYPE>;
export type CanvasEdge = Edge<CanvasEdgeData, typeof CANVAS_EDGE_TYPE>;

/**
 * The edge look from `context/ui-context.md` (16-edge-behavior): a thin, light
 * stroke with rounded ends. Applied twice on purpose — as `defaultEdgeOptions`
 * so a new connection carries it into Storage, and as the renderer's fallback so
 * an AI- or template-authored edge that arrives without a `style` still matches.
 *
 * The colour is a `var()` rather than the hex, so it travels into Storage as a
 * reference and a palette edit reaches edges that already exist.
 */
export const CANVAS_EDGE_STYLE: CSSProperties = {
  stroke: "var(--canvas-edge)",
  strokeWidth: 1.5,
  strokeLinecap: "round",
};

export const CANVAS_EDGE_MARKER: EdgeMarker = {
  type: MarkerType.ArrowClosed,
  width: 16,
  height: 16,
  color: "var(--canvas-edge)",
};
