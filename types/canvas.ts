import type { Edge, Node } from "@xyflow/react";

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
 * Declared as a `type`, not an `interface`: React Flow constrains node data to
 * `Record<string, unknown>`, and only type aliases get the implicit index
 * signature that satisfies it.
 */
export type CanvasNodeData = {
  label: string;
  color: NodeColor;
  shape: NodeShape;
};

export const CANVAS_NODE_TYPE = "canvasNode";
export const CANVAS_EDGE_TYPE = "canvasEdge";

export type CanvasNode = Node<CanvasNodeData, typeof CANVAS_NODE_TYPE>;
export type CanvasEdge = Edge<Record<string, unknown>, typeof CANVAS_EDGE_TYPE>;
