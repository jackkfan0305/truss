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
