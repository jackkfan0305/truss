/**
 * Diagram spatial context projection for agent reads and writes.
 *
 * Exposes canvas geometry, coordinate conventions, and bounds metadata
 * so agents can understand where items are placed and why layout decisions
 * were made.
 */

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { DiagramEdgeLayout } from "@/lib/diagram-route";
import { getDiagramEdgeLayout, diagramGeometryKey } from "@/lib/diagram-route";
import { deriveDiagramGeometry, type DiagramLayoutError, type DiagramNodeGeometry } from "@/lib/diagram-geometry";

export interface DiagramSpatialContext {
  coordinateSpace: "canvas";
  units: "canvas-units";
  nodePositions: "parent-relative";
  routePositions: "canvas-absolute";
  nodes: Array<
    DiagramNodeGeometry & { kind: string; position: { x: number; y: number }; editable: boolean }
  >;
  edges: Array<{
    id: string;
    editable: boolean;
    layout: DiagramEdgeLayout | null;
  }>;
}

/**
 * Build spatial context from a snapshot for agent projection.
 * Includes geometry for opaque items with editable: false.
 */
export function buildDiagramSpatialContext(
  snapshot: CanvasSnapshot,
  opaqueNodeIds: ReadonlySet<string>,
  opaqueEdgeIds: ReadonlySet<string>,
): DiagramSpatialContext {
  const geometry = deriveDiagramGeometry(snapshot.nodes);
  const geometryKey = diagramGeometryKey(snapshot.nodes);

  const nodes = snapshot.nodes.map((node) => {
    const geom = geometry.get(node.id);
    return {
      id: node.id,
      kind: node.data.kind ?? "generic",
      parentId: node.parentId ?? null,
      bounds: geom?.bounds ?? { x: 0, y: 0, width: 0, height: 0 },
      interior: geom?.interior ?? null,
      title: geom?.title ?? null,
      padding: geom?.padding ?? null,
      position: node.position,
      editable: !opaqueNodeIds.has(node.id),
    };
  });

  const edges = snapshot.edges.map((edge) => {
    const layout = getDiagramEdgeLayout(edge, snapshot.nodes, geometryKey);
    return {
      id: edge.id,
      editable: !opaqueEdgeIds.has(edge.id),
      layout,
    };
  });

  return {
    coordinateSpace: "canvas",
    units: "canvas-units",
    nodePositions: "parent-relative",
    routePositions: "canvas-absolute",
    nodes,
    edges,
  };
}

/** The recoverable 422 for a write whose layout cannot fit; nothing was saved. */
export function invalidGeometryResponse(error: DiagramLayoutError): Response {
  return Response.json({
    error: "Could not resolve diagram layout",
    code: "invalidGeometry",
    issues: error.issues,
    retry: "Remove coordinates and retry after a fresh read",
  }, { status: 422 });
}
