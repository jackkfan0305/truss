import { parseDiagramEdgeLayout } from "@/lib/diagram-route";

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
  CANVAS_BOUNDARY_TYPE,
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

/**
 * The stable prefix for a diagram's snapshots. Each write adds a random
 * suffix, so a pointer never names a file that a later write overwrote.
 */
export function canvasBlobPath(diagramId: string): string {
  return `canvas/${diagramId}.json`;
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

  const { id, position, width, height, parentId, data } = value;

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
  const kind = nodeData.kind;
  const catalogId = nodeData.catalogId;

  // Determine node type: boundary nodes use CANVAS_BOUNDARY_TYPE
  const isBoundary = kind === "boundary";
  const nodeType = isBoundary ? CANVAS_BOUNDARY_TYPE : CANVAS_NODE_TYPE;

  return {
    id,
    // Rebuilt field by field rather than spread: an unknown key from a stored
    // blob would otherwise flow straight into React Flow's node store.
    type: nodeType,
    position: { x: position.x, y: position.y },
    ...(isFiniteNumber(width) ? { width } : {}),
    ...(isFiniteNumber(height) ? { height } : {}),
    ...(typeof parentId === "string" && parentId ? { parentId } : {}),
    data: {
      label: typeof nodeData.label === "string" ? nodeData.label : "",
      // An unknown colour or shape degrades to the default instead of failing
      // the whole snapshot — one retired palette key must not cost the diagram.
      color: isNodeColor(color) ? color : DEFAULT_NODE_COLOR,
      shape: isNodeShape(shape) ? shape : DEFAULT_NODE_SHAPE,
      ...(kind && (kind === "generic" || kind === "aws-service" || kind === "boundary") ? { kind } : {}),
      ...(typeof catalogId === "string" && catalogId ? { catalogId } : {}),
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
  const layout = parseDiagramEdgeLayout(edgeData.layout);

  return {
    id,
    type: CANVAS_EDGE_TYPE,
    source,
    target,
    ...(typeof sourceHandle === "string" ? { sourceHandle } : {}),
    ...(typeof targetHandle === "string" ? { targetHandle } : {}),
    data: {
      label: typeof edgeData.label === "string" ? edgeData.label : "",
      ...(layout ? { layout } : {}),
    },
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

/** A write carried a version the stored canvas has already moved past. */
export class CanvasVersionConflictError extends Error {
  constructor(diagramId: string) {
    super(`Canvas for ${diagramId} changed since it was read`);
    this.name = "CanvasVersionConflictError";
  }
}

/** A non-negative integer, from JSON or from a query string. */
export function parseCanvasVersion(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  return typeof value === "string" && /^\d+$/.test(value)
    ? parseCanvasVersion(Number(value))
    : null;
}

/** The PUT body: the version the client read, plus the snapshot to store. */
export function parseCanvasWrite(
  body: unknown,
): { version: number; snapshot: CanvasSnapshot } | null {
  if (!isRecord(body)) {
    return null;
  }

  const version = parseCanvasVersion(body.version);
  const snapshot = parseCanvasSnapshot(body.canvas);

  return version === null || !snapshot ? null : { version, snapshot };
}

/**
 * The snapshot exactly as it would be stored. React Flow adds `measured`,
 * `selected` and `dragging` to nodes it renders; comparing raw state would
 * treat opening an editor as an edit.
 */
export function canonicalCanvasPayload(snapshot: CanvasSnapshot): string {
  return serializeCanvasSnapshot(parseCanvasSnapshot(snapshot) ?? snapshot);
}
