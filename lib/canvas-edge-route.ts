import {
  NODE_DEFAULT_SIZES,
  type CanvasEdge,
  type CanvasNode,
  type NodeShape,
} from "@/types/canvas";
import { compareStableIds } from "@/lib/edge-label-layout";

/**
 * Geometry-aware routing for generated edges (16-edge-behavior).
 *
 * An edge that names no handle is drawn between the *first* handle of each
 * node — the top one — so a node fanning out to four others sends four lines
 * out of one point into one point, stacked on each other and crossing whatever
 * lies between. This picks the side each end should leave from, then spreads
 * the ends sharing a side into lanes so parallel edges stay apart.
 *
 * Pure and DOM-free, so `scripts/verify-canvas.ts` exercises it with plain
 * objects. The side strings are the values of React Flow's `Position`.
 */

/** Distance between two attachment points on the same node side. */
const LANE_STEP = 22;

/** Keeps lanes off the rounded corners of a shape. */
const SIDE_INSET = 14;

/** Distance between the shared right-angle corridors of a fan-out. */
const TRUNK_STEP = 26;

/**
 * Diagrams read left to right, so a target that is off to the side and well
 * below still connects side-to-side rather than dropping out of the bottom.
 */
const HORIZONTAL_BIAS = 1.6;

export type EdgeSide = "top" | "right" | "bottom" | "left";

export interface EdgeEndpoint {
  x: number;
  y: number;
  side: EdgeSide;
}

export interface EdgeRoute {
  source: EdgeEndpoint;
  target: EdgeEndpoint;
  /** Where the path turns, moved off the midpoint so trunks do not overlap. */
  centerX: number;
  centerY: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: NodeShape;
}

/** One end of one edge, before its lane on the node side is known. */
interface Endpoint {
  edgeId: string;
  nodeId: string;
  box: Box;
  side: EdgeSide;
  /** Cross-axis position of the far end, so lanes come out in reading order. */
  order: number;
}

export function computeEdgeRoutes(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): Map<string, EdgeRoute> {
  const boxes = new Map(nodes.map((node) => [node.id, toBox(node)] as const));
  const ends = new Map<string, { source: Endpoint; target: Endpoint }>();

  for (const edge of edges) {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);

    // An edge drawn by hand names the handles it was drawn between. That is the
    // author's own choice about where the line attaches, so it is left alone.
    if (!source || !target || edge.sourceHandle || edge.targetHandle) {
      continue;
    }

    const side = facingSide(source, target);

    ends.set(edge.id, {
      source: {
        edgeId: edge.id,
        nodeId: edge.source,
        box: source,
        side,
        order: crossAxis(side, center(target)),
      },
      target: {
        edgeId: edge.id,
        nodeId: edge.target,
        box: target,
        side: opposite(side),
        order: crossAxis(side, center(source)),
      },
    });
  }

  const offsets = laneOffsets(
    [...ends.values()].flatMap((e) => [e.source, e.target]),
  );
  const routes = new Map<string, EdgeRoute>();

  for (const [edgeId, end] of ends) {
    const sourceOffset = offsets.get(end.source) ?? 0;
    const source = endpointOn(end.source, sourceOffset);
    const target = endpointOn(end.target, offsets.get(end.target) ?? 0);
    // The corridor shifts with the source lane: without it every line of a
    // fan-out turns at the same coordinate and they pile back up halfway across.
    const trunk = (sourceOffset / LANE_STEP) * TRUNK_STEP;
    const alongY = isVertical(end.source.side);

    routes.set(edgeId, {
      source,
      target,
      centerX: (source.x + target.x) / 2 + (alongY ? 0 : trunk),
      centerY: (source.y + target.y) / 2 + (alongY ? trunk : 0),
    });
  }

  return routes;
}

/**
 * Every end landing on the same side of the same node, spread evenly around
 * that side's midpoint and ordered by where its far end sits — so lines running
 * to nodes stacked in a column leave in the order they arrive. Incoming and
 * outgoing ends share one set of lanes; they share the side.
 */
function laneOffsets(endpoints: readonly Endpoint[]): Map<Endpoint, number> {
  const groups = new Map<string, Endpoint[]>();

  for (const endpoint of endpoints) {
    const key = `${endpoint.nodeId}|${endpoint.side}`;
    const group = groups.get(key);

    if (group) {
      group.push(endpoint);
    } else {
      groups.set(key, [endpoint]);
    }
  }

  const offsets = new Map<Endpoint, number>();

  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (a, b) => a.order - b.order || compareStableIds(a.edgeId, b.edgeId),
    );
    const { box, side } = ordered[0];
    const span = Math.max(
      0,
      (isVertical(side) ? box.width : box.height) - SIDE_INSET * 2,
    );
    const step = Math.min(LANE_STEP, span / ordered.length);

    ordered.forEach((endpoint, index) => {
      offsets.set(endpoint, (index - (ordered.length - 1) / 2) * step);
    });
  }

  return offsets;
}

/** Which box side a routed endpoint came out of. */
export function nearestNodeSide(
  node: CanvasNode,
  point: { x: number; y: number },
): EdgeSide {
  const box = toBox(node);
  const distances: Record<EdgeSide, number> = {
    left: Math.abs(point.x - box.x),
    right: Math.abs(point.x - (box.x + box.width)),
    top: Math.abs(point.y - box.y),
    bottom: Math.abs(point.y - (box.y + box.height)),
  };

  return (Object.keys(distances) as EdgeSide[]).reduce((closest, side) =>
    distances[side] < distances[closest] ? side : closest,
  );
}

function endpointOn({ box, side }: Endpoint, offset: number): EdgeEndpoint {
  const middle = center(box);

  switch (side) {
    case "left":
      return {
        x: middle.x - horizontalRadiusAt(box, offset),
        y: middle.y + offset,
        side,
      };
    case "right":
      return {
        x: middle.x + horizontalRadiusAt(box, offset),
        y: middle.y + offset,
        side,
      };
    case "top":
      return {
        x: middle.x + offset,
        y: middle.y - verticalRadiusAt(box, offset),
        side,
      };
    case "bottom":
      return {
        x: middle.x + offset,
        y: middle.y + verticalRadiusAt(box, offset),
        side,
      };
  }
}

function horizontalRadiusAt(box: Box, offset: number): number {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const distance = Math.min(Math.abs(offset), halfHeight);

  switch (box.shape) {
    case "rectangle":
      return halfWidth;
    case "diamond":
      return halfWidth * (1 - distance / halfHeight);
    case "circle":
      return halfWidth * ellipseFactor(distance, halfHeight);
    case "pill": {
      const radius = Math.min(halfWidth, halfHeight);
      const cornerDistance = Math.max(0, distance - (halfHeight - radius));

      return halfWidth - radius + circleRadiusAt(radius, cornerDistance);
    }
    case "hexagon":
      return halfWidth - box.width * 0.2 * (distance / halfHeight);
    case "cylinder": {
      const radiusY = Math.min(box.height * 0.16, halfHeight);
      const capDistance = Math.max(0, distance - (halfHeight - radiusY));

      return halfWidth * ellipseFactor(capDistance, radiusY);
    }
  }
}

function verticalRadiusAt(box: Box, offset: number): number {
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const distance = Math.min(Math.abs(offset), halfWidth);

  switch (box.shape) {
    case "rectangle":
      return halfHeight;
    case "diamond":
      return halfHeight * (1 - distance / halfWidth);
    case "circle":
      return halfHeight * ellipseFactor(distance, halfWidth);
    case "pill": {
      const radius = Math.min(halfWidth, halfHeight);
      const cornerDistance = Math.max(0, distance - (halfWidth - radius));

      return halfHeight - radius + circleRadiusAt(radius, cornerDistance);
    }
    case "hexagon": {
      const notch = box.width * 0.2;

      return distance <= halfWidth - notch
        ? halfHeight
        : halfHeight * ((halfWidth - distance) / notch);
    }
    case "cylinder": {
      const radiusY = Math.min(box.height * 0.16, halfHeight);

      return (
        halfHeight - radiusY + radiusY * ellipseFactor(distance, halfWidth)
      );
    }
  }
}

function ellipseFactor(distance: number, radius: number): number {
  if (radius === 0) {
    return 0;
  }

  return Math.sqrt(Math.max(0, 1 - (distance / radius) ** 2));
}

function circleRadiusAt(radius: number, distance: number): number {
  return radius * ellipseFactor(distance, radius);
}

function facingSide(from: Box, to: Box): EdgeSide {
  const dx = center(to).x - center(from).x;
  const dy = center(to).y - center(from).y;

  if (Math.abs(dx) * HORIZONTAL_BIAS >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }

  return dy >= 0 ? "bottom" : "top";
}

/** The axis lanes run along for a given side. */
function crossAxis(side: EdgeSide, point: { x: number; y: number }): number {
  return isVertical(side) ? point.x : point.y;
}

function opposite(side: EdgeSide): EdgeSide {
  switch (side) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

function isVertical(side: EdgeSide): boolean {
  return side === "top" || side === "bottom";
}

function center(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** React Flow leaves `width`/`height` unset until it has measured the node. */
function toBox(node: CanvasNode): Box {
  const fallback =
    NODE_DEFAULT_SIZES[node.data.shape] ?? NODE_DEFAULT_SIZES.rectangle;

  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? node.measured?.width ?? fallback.width,
    height: node.height ?? node.measured?.height ?? fallback.height,
    shape: node.data.shape,
  };
}
