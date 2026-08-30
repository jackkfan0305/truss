import {
  toBox,
  buildEdgeRoute,
  handleAnchor,
  isSideToSideRoute,
  type EdgeRoute,
} from "@/lib/canvas-geometry";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";
import { EDGE_LABEL_CLEARANCE } from "@/types/canvas";

/**
 * Where every edge is actually drawn and where its label pill centres.
 *
 * This lived in `scripts/verify-graph-layout.ts` while the verifier was the
 * only thing that needed to know where a route runs. `findLabelCollisions`
 * below needs the same answer, and a second copy of routing this delicate
 * would drift from the renderer the first time either changed, so it owns
 * the one copy here.
 *
 * Two rules mirror `components/canvas/canvas-edge.tsx` on purpose:
 *
 * - Edges on a top or bottom handle are skipped entirely, the same gate the
 *   renderer's `isSideToSide` applies. Those keep React Flow's own
 *   `getSmoothStepPath` and label point, so building a lane route for one
 *   here would describe geometry nobody actually draws.
 * - A parallel group is ordered by lane ascending, not by id, matching
 *   `readLaneSlots`: `buildEdgeRoute` pairs the member whose lane splits
 *   closest to the source with the row farthest from it, and an id sort has
 *   no relationship to which member that is.
 */
export function routeEveryEdge(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): Map<string, EdgeRoute> {
  const boxes = new Map(nodes.map((node) => [node.id, toBox(node)]));
  const parallelKey = (edge: CanvasEdge) =>
    `${edge.source} ${edge.target} ${edge.sourceHandle} ${edge.targetHandle}`;

  const routable = edges.filter(
    (edge): edge is CanvasEdge & { sourceHandle: string; targetHandle: string } =>
      !!edge.sourceHandle &&
      !!edge.targetHandle &&
      isSideToSideRoute(edge.sourceHandle, edge.targetHandle),
  );

  const groups = new Map<string, CanvasEdge[]>();

  for (const edge of routable) {
    const key = parallelKey(edge);

    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }

  const ordered = new Map(
    [...groups.entries()].map(([key, members]) => [
      key,
      [...members].sort(
        (a, b) =>
          (a.data?.lane ?? 0) - (b.data?.lane ?? 0) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    ]),
  );

  const routes = new Map<string, EdgeRoute>();

  for (const edge of routable) {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);

    if (!source || !target) {
      continue;
    }

    const group = ordered.get(parallelKey(edge))!;

    routes.set(
      edge.id,
      buildEdgeRoute({
        source: handleAnchor(source, edge.sourceHandle),
        target: handleAnchor(target, edge.targetHandle),
        lane: edge.data?.lane ?? 0,
        parallelIndex: group.findIndex((member) => member.id === edge.id),
        parallelCount: group.length,
      }),
    );
  }

  return routes;
}

export interface LabelCollision {
  /** The edge whose label pill overlaps something. */
  edgeId: string;
  /** What it overlaps: another edge's label, or a node's box. */
  with: { kind: "label"; edgeId: string } | { kind: "node"; nodeId: string };
  /** Human-readable, for assertion messages and logs. */
  describe: string;
}

/**
 * Detects when edge-label pills overlap with each other or with node boxes.
 *
 * Calls `routeEveryEdge` to determine where each label pill centres. A label
 * pill occupies a box of size `EDGE_LABEL_CLEARANCE` centred on the route's
 * `labelPoint`. Labels are checked against all nodes and against each other
 * using axis-aligned rectangle intersection (touching edges do not count as
 * overlapping).
 *
 * KNOWN LIMITATION: `routeEveryEdge` only builds routes for side-to-side edges
 * (left/right handles), because edges on top/bottom handles keep React Flow's
 * own `getSmoothStepPath` label point, which this module does not compute. So
 * labels on those edges are NOT checked.
 *
 * Edges with no label (empty or missing `data.label`) are skipped because they
 * render no pill. Deterministic output order: edges and nodes are iterated in
 * the order given, never over a Map or Set.
 */
export function findLabelCollisions(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): LabelCollision[] {
  const routes = routeEveryEdge(nodes, edges);
  const collisions: LabelCollision[] = [];

  // Collect only labelled edges that have routes
  const labelledEdges = edges.filter(
    (edge): edge is CanvasEdge & { id: string } => {
      const label = edge.data?.label ?? "";
      return !!routes.has(edge.id) && label.trim().length > 0;
    }
  );

  // Check label vs label collisions (unordered pairs, emit each once)
  for (let i = 0; i < labelledEdges.length; i += 1) {
    for (let j = i + 1; j < labelledEdges.length; j += 1) {
      const edgeA = labelledEdges[i];
      const edgeB = labelledEdges[j];
      const routeA = routes.get(edgeA.id)!;
      const routeB = routes.get(edgeB.id)!;

      const boxA = {
        x: routeA.labelPoint.x - EDGE_LABEL_CLEARANCE.width / 2,
        y: routeA.labelPoint.y - EDGE_LABEL_CLEARANCE.height / 2,
        width: EDGE_LABEL_CLEARANCE.width,
        height: EDGE_LABEL_CLEARANCE.height,
      };

      const boxB = {
        x: routeB.labelPoint.x - EDGE_LABEL_CLEARANCE.width / 2,
        y: routeB.labelPoint.y - EDGE_LABEL_CLEARANCE.height / 2,
        width: EDGE_LABEL_CLEARANCE.width,
        height: EDGE_LABEL_CLEARANCE.height,
      };

      if (
        boxA.x < boxB.x + boxB.width &&
        boxA.x + boxA.width > boxB.x &&
        boxA.y < boxB.y + boxB.height &&
        boxA.y + boxA.height > boxB.y
      ) {
        collisions.push({
          edgeId: edgeA.id,
          with: { kind: "label", edgeId: edgeB.id },
          describe: `${edgeA.id} label at (${routeA.labelPoint.x}, ${routeA.labelPoint.y}) overlaps ${edgeB.id} label at (${routeB.labelPoint.x}, ${routeB.labelPoint.y})`,
        });
      }
    }
  }

  // Check label vs node collisions
  for (const edge of labelledEdges) {
    const route = routes.get(edge.id)!;
    const labelBox = {
      x: route.labelPoint.x - EDGE_LABEL_CLEARANCE.width / 2,
      y: route.labelPoint.y - EDGE_LABEL_CLEARANCE.height / 2,
      width: EDGE_LABEL_CLEARANCE.width,
      height: EDGE_LABEL_CLEARANCE.height,
    };

    for (const node of nodes) {
      const nodeBox = toBox(node);

      if (
        labelBox.x < nodeBox.x + nodeBox.width &&
        labelBox.x + labelBox.width > nodeBox.x &&
        labelBox.y < nodeBox.y + nodeBox.height &&
        labelBox.y + labelBox.height > nodeBox.y
      ) {
        collisions.push({
          edgeId: edge.id,
          with: { kind: "node", nodeId: node.id },
          describe: `${edge.id} label at (${route.labelPoint.x}, ${route.labelPoint.y}) overlaps ${node.id} at (${nodeBox.x}, ${nodeBox.y}, ${nodeBox.width}x${nodeBox.height})`,
        });
      }
    }
  }

  return collisions;
}
