import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { nearestNodeSide, type EdgeSide } from "@/lib/canvas-edge-route";
import { diagramGeometryKey, type DiagramEdgeLayout, type DiagramPoint } from "@/lib/diagram-route";
import { CANVAS_EDGE_MARKER, type CanvasNode, type CanvasEdge } from "@/types/canvas";
import {
  assembleDiagramElkRoute, buildDiagramElkGraph, diagramLayoutSizes, flattenDiagramElkGraph,
  DEFAULT_ROOT_PADDING, type DiagramEdgeSides, type DiagramLayoutSize, type DiagramRootPadding,
} from "@/lib/diagram-elk-graph";
import { DiagramLayoutError, validateDiagramGeometry } from "@/lib/diagram-geometry";

/**
 * The arrowhead is centred on the path's last point, so half of it lands under
 * the block. Stopping short by its half-width draws the whole head in the open.
 */
const ARROW_CLEARANCE = (CANVAS_EDGE_MARKER.width ?? 16) / 2;

/** Drops repeated points and the middle of any three that run in one line. */
function simplify(points: DiagramPoint[]): DiagramPoint[] {
  const result: DiagramPoint[] = [];

  for (const point of points) {
    const last = result[result.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const previous = result[result.length - 2];
    if (previous && last
      && ((previous.x === last.x && last.x === point.x) || (previous.y === last.y && last.y === point.y))) {
      result.pop();
    }
    result.push(point);
  }

  return result;
}

/** Backs the arriving end off its block so the whole arrowhead is visible. */
function clearArrowhead(points: DiagramPoint[]): DiagramPoint[] {
  const end = points[points.length - 1];
  const previous = points[points.length - 2];
  const run = Math.hypot(end.x - previous.x, end.y - previous.y);
  if (run <= ARROW_CLEARANCE) return points;
  const scale = (run - ARROW_CLEARANCE) / run;

  return [...points.slice(0, -1), {
    x: Math.round(previous.x + (end.x - previous.x) * scale),
    y: Math.round(previous.y + (end.y - previous.y) * scale),
  }];
}

/** Which block side each end of each edge came out of, from a routed graph. */
function chooseSides(
  laidOut: ElkNode,
  snapshot: CanvasSnapshot,
  sizes: ReadonlyMap<string, DiagramLayoutSize>,
): Map<string, DiagramEdgeSides> {
  const { nodes, edges } = flattenDiagramElkGraph(laidOut);
  const sideAt = (nodeId: string, point: DiagramPoint): EdgeSide => {
    const found = nodes.get(nodeId)!;
    const size = sizes.get(nodeId) ?? { width: 0, height: 0 };
    return nearestNodeSide(
      { position: found.origin, ...size, data: { shape: "rectangle" } } as CanvasNode,
      point,
    );
  };

  return new Map(snapshot.edges.map((edge) => {
    const found = edges.get(edge.id);
    if (!found) throw new Error("Diagram layout did not route every connection");
    const points = assembleDiagramElkRoute(found.edge, found.origin);
    return [edge.id, {
      source: sideAt(edge.source, points[0]),
      target: sideAt(edge.target, points[points.length - 1]),
    }];
  }));
}

export interface DiagramLayoutOptions {
  /** Space kept clear around the content; a boundary re-layout passes its own padding. */
  padding?: DiagramRootPadding;
}

/**
 * Only server-side generation imports ELK. The canvas reads the saved geometry.
 *
 * Nested snapshots lay out as one compound graph: boundaries are ELK compounds
 * and every position is saved relative to its parent, every route in canvas
 * coordinates.
 *
 * Laid out twice on purpose. ELK left to itself meets a block wherever the
 * routing found room, which is never one of the four points the block offers on
 * hover. The first pass decides which side each end belongs on; the second
 * pins those sides to the handles themselves as fixed ports, so ELK routes
 * around its obstacles knowing where every line has to land.
 */
export async function layoutDiagram(
  snapshot: CanvasSnapshot,
  options: DiagramLayoutOptions = {},
): Promise<CanvasSnapshot> {
  if (!snapshot.nodes.length) return { nodes: [], edges: [] };
  const ids = new Set(snapshot.nodes.map((node) => node.id));
  let rootId = "diagram-root";
  while (ids.has(rootId)) rootId += "-root";
  const padding = options.padding ?? DEFAULT_ROOT_PADDING;
  const sizes = diagramLayoutSizes(snapshot);
  const elk = new ELK();
  const firstPass = await elk.layout(buildDiagramElkGraph(rootId, snapshot, sizes, null, padding));
  const laidOut = await elk.layout(
    buildDiagramElkGraph(rootId, snapshot, sizes, chooseSides(firstPass, snapshot, sizes), padding),
  );

  const flat = flattenDiagramElkGraph(laidOut);
  const nodes = snapshot.nodes.map((node): CanvasNode => {
    const positioned = flat.nodes.get(node.id)?.node;
    if (!positioned || positioned.x === undefined || positioned.y === undefined) throw new DiagramLayoutError("Diagram layout did not position every block", [{
      code: "invalidBounds", itemIds: [node.id], message: `Layout did not position ${node.id}`,
    }]);
    return { ...node, position: { x: Math.round(positioned.x), y: Math.round(positioned.y) }, width: positioned.width, height: positioned.height };
  });
  const geometryKey = diagramGeometryKey(nodes);
  const edges = snapshot.edges.map((edge): CanvasEdge => {
    const routed = flat.edges.get(edge.id);
    if (!routed) throw new Error("Diagram layout did not route every connection");
    const label = routed.edge.labels?.[0];
    const points = clearArrowhead(simplify(
      assembleDiagramElkRoute(routed.edge, routed.origin).map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) })),
    ));
    const layout: DiagramEdgeLayout = {
      version: 1,
      points,
      label: label && label.x !== undefined && label.y !== undefined && label.width !== undefined && label.height !== undefined
        ? { x: routed.origin.x + label.x + label.width / 2, y: routed.origin.y + label.y + label.height / 2, width: label.width, height: label.height } : null,
      geometryKey, source: edge.source, target: edge.target, text: edge.data?.label ?? "",
    };
    return { ...edge, data: { ...edge.data, label: edge.data?.label ?? "", layout } };
  });
  const output = { nodes, edges };
  const issues = validateDiagramGeometry(output).filter((issue) => issue.code !== "routeCollision" && issue.code !== "labelCollision");
  if (issues.length) throw new DiagramLayoutError("Diagram layout produced invalid geometry", issues);
  return output;
}
