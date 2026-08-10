/**
 * The canvas persistence contract (21-canvas-autosave).
 *
 * Vercel Blob holds the canvas JSON, Prisma holds only the URL — see the storage
 * model in `context/architecture-context.md`. This module is the boundary
 * between the two: it defines what a stored snapshot may contain and refuses
 * anything else, so a malformed or hostile body never reaches Blob storage and a
 * corrupted blob never reaches a canvas.
 *
 * Free of React and Prisma imports on purpose, so `scripts/verify-canvas.ts` can
 * exercise it directly.
 */

import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  DEFAULT_NODE_SHAPE,
  NODE_COLORS,
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
  type NodeColor,
  type NodeShape,
} from "@/types/canvas";

export interface CanvasSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * A ceiling on a single snapshot, not a product limit — the body is
 * authenticated but still user-controlled, and each save is a paid write to
 * Blob storage. Far above any diagram a person builds by hand; if AI generation
 * ever approaches it, raise it deliberately rather than removing the guard.
 */
export const MAX_SNAPSHOT_NODES = 2000;
export const MAX_SNAPSHOT_EDGES = 4000;

/** Snapshots are keyed by project, so a save overwrites its own predecessor. */
export function canvasBlobPath(projectId: string): string {
  return `canvas/${projectId}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects `NaN` and `Infinity` as well as non-numbers — both break layout. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseNode(value: unknown): CanvasNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, position, width, height, data } = value;

  if (typeof id !== "string" || !id) {
    return null;
  }

  if (
    !isRecord(position) ||
    !isFiniteNumber(position.x) ||
    !isFiniteNumber(position.y)
  ) {
    return null;
  }

  const nodeData = isRecord(data) ? data : {};
  const color = nodeData.color;
  const shape = nodeData.shape;

  return {
    id,
    // Rebuilt field by field rather than spread: an unknown key from a stored
    // blob would otherwise flow straight into React Flow's node store.
    type: CANVAS_NODE_TYPE,
    position: { x: position.x, y: position.y },
    ...(isFiniteNumber(width) ? { width } : {}),
    ...(isFiniteNumber(height) ? { height } : {}),
    data: {
      label: typeof nodeData.label === "string" ? nodeData.label : "",
      // An unknown colour or shape degrades to the default instead of failing
      // the whole snapshot — one retired palette key must not cost the diagram.
      color: isNodeColor(color) ? color : DEFAULT_NODE_COLOR,
      shape: isNodeShape(shape) ? shape : DEFAULT_NODE_SHAPE,
    },
  };
}

function isNodeColor(value: unknown): value is NodeColor {
  return typeof value === "string" && value in NODE_COLORS;
}

function isNodeShape(value: unknown): value is NodeShape {
  return NODE_SHAPES.includes(value as NodeShape);
}

function parseEdge(value: unknown, nodeIds: ReadonlySet<string>): CanvasEdge | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, source, target, sourceHandle, targetHandle, data } = value;

  if (typeof id !== "string" || !id) {
    return null;
  }

  if (typeof source !== "string" || typeof target !== "string") {
    return null;
  }

  // An edge to a node that is not in the snapshot renders as nothing and keeps
  // a dangling reference alive across every future save.
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    return null;
  }

  const edgeData = isRecord(data) ? data : {};

  return {
    id,
    type: CANVAS_EDGE_TYPE,
    source,
    target,
    ...(typeof sourceHandle === "string" ? { sourceHandle } : {}),
    ...(typeof targetHandle === "string" ? { targetHandle } : {}),
    data: { label: typeof edgeData.label === "string" ? edgeData.label : "" },
    // Reapplied from the constants rather than trusted from the blob: they are
    // the same for every edge, so storing them would only create a way for a
    // stored value to drift from the palette or to carry arbitrary CSS.
    style: CANVAS_EDGE_STYLE,
    markerEnd: CANVAS_EDGE_MARKER,
  };
}

/**
 * Validates a snapshot from an untrusted source — a request body on the way in,
 * or stored blob JSON on the way out. Returns `null` when the shape is wrong.
 *
 * Individual malformed *entries* are dropped rather than failing the whole
 * snapshot: a single bad node should not make an otherwise good diagram
 * unloadable. A body that is not a snapshot at all is still rejected outright.
 */
export function parseCanvasSnapshot(value: unknown): CanvasSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return null;
  }

  if (
    value.nodes.length > MAX_SNAPSHOT_NODES ||
    value.edges.length > MAX_SNAPSHOT_EDGES
  ) {
    return null;
  }

  const nodes: CanvasNode[] = [];
  const seenNodeIds = new Set<string>();

  for (const candidate of value.nodes) {
    const node = parseNode(candidate);

    // Duplicate IDs would render one node and make the other uneditable.
    if (node && !seenNodeIds.has(node.id)) {
      seenNodeIds.add(node.id);
      nodes.push(node);
    }
  }

  const edges: CanvasEdge[] = [];
  const seenEdgeIds = new Set<string>();

  for (const candidate of value.edges) {
    const edge = parseEdge(candidate, seenNodeIds);

    if (edge && !seenEdgeIds.has(edge.id)) {
      seenEdgeIds.add(edge.id);
      edges.push(edge);
    }
  }

  return { nodes, edges };
}

/**
 * What actually gets written to Blob storage. Round-tripped through the same
 * parser as a read, so a save can never store something a load would reject.
 */
export function serializeCanvasSnapshot(snapshot: CanvasSnapshot): string {
  return JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges });
}
