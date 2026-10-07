/**
 * Diagram geometry validation and bounds computation.
 *
 * Derives absolute bounds for all canvas items from nested parent-relative
 * positions, validates containment and collision, and detects layout errors
 * before persistence.
 */

import type { CanvasNode, CanvasEdge, CanvasBounds } from "@/types/canvas";
import { BOUNDARY_PADDING, BOUNDARY_TITLE_HEIGHT } from "@/types/canvas";
import { getAbsoluteBounds, getBoundaryInterior } from "@/lib/canvas-hierarchy";
import { diagramGeometryKey, parseDiagramEdgeLayout, type DiagramEdgeLayout } from "@/lib/diagram-route";

export interface DiagramNodeGeometry {
  id: string;
  parentId: string | null;
  bounds: DiagramBounds;
  interior: DiagramBounds | null; // Non-null only for boundaries
  title: DiagramBounds | null;    // Non-null only for boundaries
  padding: { top: number; right: number; bottom: number; left: number } | null;
}

export interface DiagramGeometryIssue {
  code: 'containment' | 'siblingCollision' | 'titleCollision' | 'routeCollision' | 'labelCollision' | 'invalidRoute' | 'invalidBounds';
  itemIds: string[];
  message: string;
}

export type DiagramBounds = CanvasBounds;

export type DiagramPoint = { x: number; y: number };

/**
 * Error thrown when diagram geometry cannot be resolved before persistence.
 * Contains structured issues that can be reported to the caller.
 */
export class DiagramLayoutError extends Error {
  constructor(
    message: string,
    readonly issues: DiagramGeometryIssue[],
  ) {
    super(message);
    this.name = 'DiagramLayoutError';
  }
}

/**
 * Derives absolute bounds and boundary metadata for all nodes in a snapshot.
 * Returns a map keyed by node ID, with position computed transitively from parents.
 */
export function deriveDiagramGeometry(
  nodes: readonly CanvasNode[],
): Map<string, DiagramNodeGeometry> {
  const result = new Map<string, DiagramNodeGeometry>();

  for (const node of nodes) {
    try {
      const bounds = getAbsoluteBounds(node.id, nodes);
      const isBoundary = node.type === 'canvasBoundary';

      let interior: DiagramBounds | null = null;
      let title: DiagramBounds | null = null;
      let padding: { top: number; right: number; bottom: number; left: number } | null = null;

      if (isBoundary) {
        interior = getBoundaryInterior(node.id, nodes);
        padding = {
          top: BOUNDARY_TITLE_HEIGHT,
          left: BOUNDARY_PADDING,
          right: BOUNDARY_PADDING,
          bottom: BOUNDARY_PADDING,
        };
        title = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: BOUNDARY_TITLE_HEIGHT,
        };
      }

      result.set(node.id, {
        id: node.id,
        parentId: node.parentId ?? null,
        bounds,
        interior,
        title,
        padding,
      });
    } catch {
      // Errors from getAbsoluteBounds will be caught during validation
      result.set(node.id, {
        id: node.id,
        parentId: node.parentId ?? null,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        interior: null,
        title: null,
        padding: null,
      });
    }
  }

  return result;
}

/**
 * Validates that a snapshot's geometry is valid for layout.
 * Returns a list of issues found; empty list means the geometry is valid.
 */
export function validateDiagramGeometry(snapshot: {
  nodes: readonly CanvasNode[];
  edges?: readonly CanvasEdge[];
}): DiagramGeometryIssue[] {
  const issues: DiagramGeometryIssue[] = [];
  const geometry = deriveDiagramGeometry(snapshot.nodes);

  // Check for invalid bounds
  for (const [nodeId, geom] of geometry) {
    if (!Number.isFinite(geom.bounds.x) || !Number.isFinite(geom.bounds.y) ||
        !Number.isFinite(geom.bounds.width) || !Number.isFinite(geom.bounds.height) ||
        geom.bounds.width <= 0 || geom.bounds.height <= 0) {
      issues.push({
        code: 'invalidBounds',
        itemIds: [nodeId],
        message: `Node ${nodeId} has invalid bounds`,
      });
    }
  }

  // Check containment: children must be within parent interior
  for (const node of snapshot.nodes) {
    if (!node.parentId) continue;

    const nodeGeom = geometry.get(node.id);
    const parentGeom = geometry.get(node.parentId);

    if (!nodeGeom || !parentGeom) continue;

    // Only boundaries can be parents and have an interior
    if (parentGeom.interior === null) {
      issues.push({
        code: 'containment',
        itemIds: [node.id, node.parentId],
        message: `Parent ${node.parentId} of ${node.id} is not a boundary`,
      });
      continue;
    }

    const interior = parentGeom.interior;
    const nodeRight = nodeGeom.bounds.x + nodeGeom.bounds.width;
    const nodeBtm = nodeGeom.bounds.y + nodeGeom.bounds.height;
    const interiorRight = interior.x + interior.width;
    const interiorBtm = interior.y + interior.height;

    if (nodeGeom.bounds.x < interior.x || nodeGeom.bounds.y < interior.y ||
        nodeRight > interiorRight || nodeBtm > interiorBtm) {
      issues.push({
        code: 'containment',
        itemIds: [node.id, node.parentId],
        message: `Node ${node.id} exceeds interior bounds of parent ${node.parentId}`,
      });
    }
  }

  // Check sibling collisions (nodes with same parent cannot overlap)
  const childrenByParent = new Map<string | null, CanvasNode[]>();
  for (const node of snapshot.nodes) {
    const parentId = node.parentId ?? null;
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, []);
    }
    childrenByParent.get(parentId)!.push(node);
  }

  for (const [, siblings] of childrenByParent) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i];
        const b = siblings[j];
        const aGeom = geometry.get(a.id);
        const bGeom = geometry.get(b.id);

        if (!aGeom || !bGeom) continue;

        // Check for overlap
        const aRight = aGeom.bounds.x + aGeom.bounds.width;
        const aBtm = aGeom.bounds.y + aGeom.bounds.height;
        const bRight = bGeom.bounds.x + bGeom.bounds.width;
        const bBtm = bGeom.bounds.y + bGeom.bounds.height;

        const overlaps =
          !(aRight <= bGeom.bounds.x || bRight <= aGeom.bounds.x ||
            aBtm <= bGeom.bounds.y || bBtm <= aGeom.bounds.y);

        if (overlaps) {
          issues.push({
            code: 'siblingCollision',
            itemIds: [a.id, b.id],
            message: `Siblings ${a.id} and ${b.id} overlap`,
          });
        }
      }
    }
  }

  issues.push(...validateRoutes(snapshot, geometry));
  return issues;
}

/** A route end may sit this far from its block: the arrowhead stops short of it. */
const ENDPOINT_TOLERANCE = 10;

const intersects = (a: DiagramBounds, b: DiagramBounds): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Distance from a point to a rectangle; zero inside it. */
function distanceToBounds(point: DiagramPoint, bounds: DiagramBounds): number {
  const dx = Math.max(bounds.x - point.x, 0, point.x - (bounds.x + bounds.width));
  const dy = Math.max(bounds.y - point.y, 0, point.y - (bounds.y + bounds.height));
  return Math.hypot(dx, dy);
}

function segmentBounds(p: DiagramPoint, q: DiagramPoint): DiagramBounds {
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) };
}

/** Does an axis-aligned segment pass through the open interior of a rectangle? */
function segmentCrosses(p: DiagramPoint, q: DiagramPoint, rect: DiagramBounds): boolean {
  const box = segmentBounds(p, q);
  return box.x + box.width > rect.x && box.x < rect.x + rect.width
    && box.y + box.height > rect.y && box.y < rect.y + rect.height;
}

function ancestorIds(node: CanvasNode, byId: ReadonlyMap<string, CanvasNode>): Set<string> {
  const found = new Set<string>();
  for (let parent = node.parentId ? byId.get(node.parentId) : undefined; parent && !found.has(parent.id);
    parent = parent.parentId ? byId.get(parent.parentId) : undefined) found.add(parent.id);
  return found;
}

/**
 * Checks every saved route and label against the final geometry. A route may
 * cross the outline of a boundary that contains one of its ends; unrelated
 * boundaries and every title rectangle are obstacles.
 */
function validateRoutes(
  snapshot: { nodes: readonly CanvasNode[]; edges?: readonly CanvasEdge[] },
  geometry: ReadonlyMap<string, DiagramNodeGeometry>,
): DiagramGeometryIssue[] {
  const issues: DiagramGeometryIssue[] = [];
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const key = diagramGeometryKey(snapshot.nodes);
  const labels: Array<{ edgeId: string; bounds: DiagramBounds }> = [];

  for (const edge of snapshot.edges ?? []) {
    const raw: unknown = edge.data?.layout;
    if (raw === undefined) continue;
    const layout: DiagramEdgeLayout | null = parseDiagramEdgeLayout(raw);
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const sourceBounds = geometry.get(edge.source)?.bounds;
    const targetBounds = geometry.get(edge.target)?.bounds;
    const invalid = (why: string) => issues.push({
      code: "invalidRoute", itemIds: [edge.id], message: `Route of ${edge.id} ${why}`,
    });
    if (!layout || !source || !target || !sourceBounds || !targetBounds) { invalid("is malformed or names a missing block"); continue; }
    if (layout.geometryKey !== key) { invalid("is stale against the final geometry"); continue; }

    const points = layout.points;
    if (points.some((point, i) => i > 0 && point.x !== points[i - 1].x && point.y !== points[i - 1].y)) {
      invalid("has a segment that is not horizontal or vertical");
      continue;
    }
    if (distanceToBounds(points[0], sourceBounds) > 1
      || distanceToBounds(points[points.length - 1], targetBounds) > ENDPOINT_TOLERANCE) {
      invalid("does not start and end at its blocks");
      continue;
    }

    // Boundaries holding an end are crossed on purpose, as are an end's own contents.
    const allowed = new Set([edge.source, edge.target, ...ancestorIds(source, byId), ...ancestorIds(target, byId)]);
    for (const node of snapshot.nodes) {
      const nodeGeometry = geometry.get(node.id);
      if (!nodeGeometry) continue;
      const inside = [...ancestorIds(node, byId)].some((id) => id === edge.source || id === edge.target);
      const hit = (rect: DiagramBounds) => points.some((point, i) => i > 0 && segmentCrosses(points[i - 1], point, rect));
      if (nodeGeometry.title && hit(nodeGeometry.title) && !inside) {
        issues.push({ code: "titleCollision", itemIds: [edge.id, node.id], message: `Route of ${edge.id} crosses the title of ${node.id}` });
      } else if (!allowed.has(node.id) && !inside && hit(nodeGeometry.bounds)) {
        issues.push({ code: "routeCollision", itemIds: [edge.id, node.id], message: `Route of ${edge.id} crosses ${node.id}` });
      }
    }

    if (layout.label) {
      labels.push({ edgeId: edge.id, bounds: {
        x: layout.label.x - layout.label.width / 2, y: layout.label.y - layout.label.height / 2,
        width: layout.label.width, height: layout.label.height,
      } });
    }
  }

  for (const [i, label] of labels.entries()) {
    for (const node of snapshot.nodes) {
      const nodeGeometry = geometry.get(node.id);
      if (!nodeGeometry) continue;
      const rect = nodeGeometry.title ?? (node.type === "canvasBoundary" ? null : nodeGeometry.bounds);
      if (rect && intersects(label.bounds, rect)) {
        issues.push({ code: "labelCollision", itemIds: [label.edgeId, node.id], message: `Label of ${label.edgeId} overlaps ${node.id}` });
      }
    }
    for (const other of labels.slice(i + 1)) {
      if (intersects(label.bounds, other.bounds)) {
        issues.push({ code: "labelCollision", itemIds: [label.edgeId, other.edgeId], message: `Labels of ${label.edgeId} and ${other.edgeId} overlap` });
      }
    }
  }

  return issues;
}
