import { getAwsCatalogEntry } from "@/lib/aws-catalog";
import {
  NODE_DEFAULT_SIZES,
  NODE_SHAPES,
  type NodeShape,
  type NodeSize,
} from "@/types/canvas";

/**
 * The shape-panel → canvas drag contract (12-shape-panel).
 *
 * A custom MIME type rather than `text/plain`: it keeps unrelated drags (text
 * selections, files, links) from being read as a shape, and it lets `dragover`
 * decide whether to accept the drop by inspecting `dataTransfer.types` alone —
 * the payload itself is unreadable until `drop`.
 */
export const SHAPE_DRAG_MIME = "application/x-truss-shape";

export interface ShapeDragPayload extends NodeSize {
  shape: NodeShape;
}

export function buildShapeDragPayload(shape: NodeShape): ShapeDragPayload {
  return { shape, ...NODE_DEFAULT_SIZES[shape] };
}

/**
 * Anything can put anything on a `DataTransfer`, including another tab or an
 * older build of this app, so the payload is parsed as untrusted input and a
 * bad one is dropped rather than turned into a malformed node.
 */
export function parseShapeDragPayload(raw: string): ShapeDragPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { shape, width, height } = parsed as Record<string, unknown>;

  if (!isNodeShape(shape) || !isPositiveSize(width) || !isPositiveSize(height)) {
    return null;
  }

  return { shape, width, height };
}

function isNodeShape(value: unknown): value is NodeShape {
  return NODE_SHAPES.includes(value as NodeShape);
}

function isPositiveSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Node IDs are `{shape}-{timestamp}-{counter}-{uuid}`. The timestamp and
 * counter protect repeated drops in one tab; UUID entropy protects concurrent
 * collaborators whose tab-local counters and clocks happen to match.
 */
let nodeIdCounter = 0;

export function createNodeId(shape: NodeShape): string {
  nodeIdCounter += 1;

  return `${shape}-${Date.now().toString(36)}-${nodeIdCounter.toString(36)}-${crypto.randomUUID()}`;
}

/**
 * The AWS picker → canvas drag contract. The payload names a catalog entry and
 * nothing else: size, icon and label all come from the local catalog on drop.
 */
export const AWS_DRAG_MIME = "application/x-truss-aws";

export interface AwsDragPayload {
  catalogId: string;
}

export function buildAwsDragPayload(catalogId: string): AwsDragPayload {
  return { catalogId };
}

/** Untrusted like the shape payload; any extra field or unknown ID is rejected. */
export function parseAwsDragPayload(raw: string): AwsDragPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const keys = Object.keys(parsed);
  const { catalogId } = parsed as Record<string, unknown>;

  if (keys.length !== 1 || typeof catalogId !== "string" || !getAwsCatalogEntry(catalogId)) {
    return null;
  }

  return { catalogId };
}
