import dagre from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";
import type { XYPosition } from "@xyflow/react";

import {
  LAYOUT_GRID,
  MIN_NODE_GAP,
  RANK_GAP,
  toBox,
  type Box,
} from "@/lib/canvas-geometry";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * Deterministic diagram layout.
 *
 * A model or an agent hands back diagram content — nodes and edges — but not
 * where anything belongs on the canvas or which side an edge should leave
 * from. Left alone, that produces two specific failures: nodes land at
 * whatever coordinates were guessed (often all the same one), and every edge
 * arrives with no `sourceHandle`/`targetHandle`, so React Flow falls back to
 * the first handle in DOM order — Top (`components/canvas/canvas-node.tsx`) —
 * and every connection leaves the top of its source and enters the top of its
 * target no matter where the target actually sits. That is the spaghetti this
 * module exists to prevent.
 *
 * `applyLayout` is the entry point callers use: it runs a left-to-right
 * layered layout with dagre, then derives a handle pair for every edge from
 * where dagre actually placed its two endpoints. Pure and DOM-free, like
 * `lib/design-plan.ts`, so `scripts/verify-graph-layout.ts` can exercise it
 * without a room, a model or a browser.
 */

/**
 * Gap between nodes stacked in the same rank (perpendicular to the LR flow).
 * Three times `MIN_NODE_GAP` so a column of nodes reads as separate rows rather
 * than a dense stack that only just clears the overlap check, and so the
 * horizontal runs of the edges threading between them stay distinguishable
 * from the node borders they pass.
 *
 * Unbounded in the way `RANK_GAP` is not: the widest graph the compact contract
 * allows is a chain, which stacks nothing, and 40 nodes stacked in a single
 * rank still only spans ±3,940.
 */
const RANK_ROW_GAP = MIN_NODE_GAP * 3;

/** The four handle ids `canvas-node.tsx` renders, named once instead of
 * scattered as string literals through the geometry below. */
export const HANDLE_ID = {
  top: "top",
  right: "right",
  bottom: "bottom",
  left: "left",
} as const;

/**
 * Lays out a graph left-to-right with dagre and returns new node objects with
 * `position` set from the result. Never mutates `nodes`.
 *
 * Dagre reports each node's `x`/`y` as its CENTRE, but React Flow's
 * `node.position` is the TOP-LEFT corner — every position here is the centre
 * dagre gave us, shifted back by half the node's own size, then snapped to
 * `LAYOUT_GRID`.
 *
 * Determinism follows from iterating `nodes` and `edges` in the order the
 * caller gave them: dagre's layout is a pure function of graph construction
 * order, so building the graph in a fixed order (never `Object.keys` or `Set`
 * iteration over something rebuilt per call) is all determinism requires.
 */
export function layoutGraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): CanvasNode[] {
  if (nodes.length === 0) {
    return [];
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const boxes = new Map(nodes.map((node) => [node.id, toBox(node)]));

  // multigraph: true — two nodes can be joined by more than one edge (e.g. a
  // request edge and a response edge), and each needs its own rank-space
  // reservation rather than silently overwriting the other's.
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
  });

  graph.setGraph({
    rankdir: "LR",
    nodesep: RANK_ROW_GAP,
    ranksep: RANK_GAP,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const box = boxes.get(node.id)!;

    graph.setNode(node.id, { width: box.width, height: box.height });
  }

  for (const edge of edges) {
    // Self-loops have no route `getSmoothStepPath` can draw and dagre ranks
    // them poorly; dangling references would otherwise make dagre invent a
    // node for the missing endpoint. Both are dropped from the layout graph,
    // never from the caller's edge list — that is `applyLayout`'s job.
    if (edge.source === edge.target) {
      continue;
    }

    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }

    // No label size is declared on the edge: `RANK_GAP` already reserves the
    // pill's width in every rank gap, and telling dagre about it as well makes
    // it reserve the space twice. See `RANK_GAP`.
    graph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  dagre.layout(graph);

  const centers = nodes.map((node) => {
    const box = boxes.get(node.id)!;
    const laidOut = graph.node(node.id);

    // Dagre always assigns x/y to every real node once `layout` returns; the
    // box centre fallback only guards against a future dagre version that
    // stops doing so, so a defect there degrades instead of crashing.
    return {
      x: laidOut.x ?? box.x + box.width / 2,
      y: laidOut.y ?? box.y + box.height / 2,
    };
  });

  const origin = boundingCenter(centers);

  return nodes.map((node, index) => {
    const box = boxes.get(node.id)!;
    const center = centers[index];

    const position: XYPosition = {
      x: snap(center.x - origin.x - box.width / 2),
      y: snap(center.y - origin.y - box.height / 2),
    };

    return { ...node, position };
  });
}

/**
 * The centre of the laid-out bounding box, subtracted from every node so the
 * diagram straddles the origin instead of growing right and down from it.
 *
 * Not cosmetic. The compact agent graph contract (`lib/agent-graph.ts`) only
 * represents coordinates in ±10,000, and a node outside that range projects as
 * *opaque*: invisible to an agent reading the canvas back, and enough to make
 * `collidesWithOpaque` reject its next edit. Dagre lays out from roughly zero
 * rightward, so a long chain — well within the 40 nodes the same contract
 * allows — would run past 10,000 and take itself out of the agent's view.
 * Centring spends the negative half of the range and doubles the width the
 * contract can carry, which clears the widest graph it permits.
 */
function boundingCenter(centers: readonly XYPosition[]): XYPosition {
  const xs = centers.map((center) => center.x);
  const ys = centers.map((center) => center.y);

  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/**
 * Picks the handle pair for an edge from its endpoints' final rectangles, and
 * from the rectangles of everything else on the canvas.
 *
 * Three cases, in order.
 *
 * **Same rank.** The two rectangles overlap on x, so the connection genuinely
 * runs up or down the column: bottom to top, or top to bottom.
 *
 * **A rank-advancing edge travelling further vertically than horizontally.**
 * Here a side handle sends the line straight out of the face and then on a long
 * climb, when what the edge actually does is go up or down. Each end
 * independently takes the vertical face it is heading for — but *only* if its
 * own column is clear that way, which is what `obstacles` is for. In a rank
 * stacked six deep, leaving the bottom of the top node means drawing straight
 * through the five below it, which is worse than the side handle it replaced.
 * A blocked end falls back to its side face on its own, so a mixed pair like
 * top-to-left is a normal outcome, not a defect.
 *
 * **Everything else.** Side faces. The layout is left-to-right, so two
 * rectangles that clear each other on x are in different ranks and the edge
 * between them advances the flow. Letting a merely-larger vertical offset win
 * sends a one-rank hop out through the top of its source the moment its target
 * sits a couple of rows up, which reads as a diagonal fighting the layout —
 * hence the vertical case above needs to beat the horizontal gap outright, not
 * just tie with it.
 *
 * `obstacles` may contain `source` and `target` themselves; both are skipped by
 * identity, so callers can pass the whole canvas without filtering. Omitting it
 * disables the vertical case for rank-advancing edges and restores the pure
 * two-rectangle behaviour.
 */
export function chooseHandles(
  source: Box,
  target: Box,
  obstacles: readonly Box[] = []
): { sourceHandle: string; targetHandle: string } {
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterY = target.y + target.height / 2;

  // A forward hop: the target's left edge clears the source's right one.
  const isForward = target.x >= source.x + source.width;
  // A back-edge, the same test mirrored.
  const isBackward = source.x >= target.x + target.width;

  if (!isForward && !isBackward) {
    return targetCenterY >= sourceCenterY
      ? { sourceHandle: HANDLE_ID.bottom, targetHandle: HANDLE_ID.top }
      : { sourceHandle: HANDLE_ID.top, targetHandle: HANDLE_ID.bottom };
  }

  const sideHandles = isForward
    ? { sourceHandle: HANDLE_ID.right, targetHandle: HANDLE_ID.left }
    : { sourceHandle: HANDLE_ID.left, targetHandle: HANDLE_ID.right };

  const gapX = isForward
    ? target.x - (source.x + source.width)
    : source.x - (target.x + target.width);

  // Both gaps are edge-to-edge, so they are the same kind of measurement and
  // can be compared directly. Centre-to-centre distance cannot: a tall node
  // beside a short one has centres far apart on y while the two rectangles
  // still overlap, and an edge between them has no vertical travel to make.
  const isDownward = target.y >= source.y + source.height;
  const isUpward = source.y >= target.y + target.height;

  if (!isDownward && !isUpward) {
    return sideHandles;
  }

  const gapY = isDownward
    ? target.y - (source.y + source.height)
    : source.y - (target.y + target.height);

  if (gapY <= gapX) {
    return sideHandles;
  }

  // Each end's vertical run: out of the face it would leave by, as far as the
  // other end's centre line, which is where the route turns to cross the gap.
  const sourceIsClear = isColumnClear(
    source,
    isDownward ? source.y + source.height : source.y,
    targetCenterY,
    obstacles,
    target
  );
  const targetIsClear = isColumnClear(
    target,
    isDownward ? target.y : target.y + target.height,
    sourceCenterY,
    obstacles,
    source
  );

  return {
    sourceHandle: sourceIsClear
      ? isDownward
        ? HANDLE_ID.bottom
        : HANDLE_ID.top
      : sideHandles.sourceHandle,
    targetHandle: targetIsClear
      ? isDownward
        ? HANDLE_ID.top
        : HANDLE_ID.bottom
      : sideHandles.targetHandle,
  };
}

/**
 * Whether `box` can send a vertical run from `fromY` to `toY` without crossing
 * another node.
 *
 * "Its column" is any rectangle overlapping `box` on x — which is the same test
 * `chooseHandles` uses to recognise a shared rank, so this is asking whether
 * anything in `box`'s own rank stands in the way. `box` and `other` are the
 * edge's own endpoints and are skipped by identity.
 */
function isColumnClear(
  box: Box,
  fromY: number,
  toY: number,
  obstacles: readonly Box[],
  other: Box
): boolean {
  const top = Math.min(fromY, toY);
  const bottom = Math.max(fromY, toY);

  return !obstacles.some((obstacle) => {
    if (obstacle === box || obstacle === other) {
      return false;
    }

    return (
      obstacle.x < box.x + box.width &&
      obstacle.x + obstacle.width > box.x &&
      obstacle.y < bottom &&
      obstacle.y + obstacle.height > top
    );
  });
}

export interface ApplyLayoutOptions {
  /**
   * Drop edges that repeat an earlier edge's `source`, `target` and label.
   *
   * Off by default, and deliberately so: dropping an edge is a real deletion,
   * and on a shared canvas losing a user's connection is not recoverable. Only
   * the generated paths — where a model has just emitted the same relationship
   * twice — turn it on.
   */
  dedupe?: boolean;
}

/**
 * Removes edges repeating an earlier `source + target + label`, keeping the
 * first occurrence.
 *
 * Two edges differing only in label are genuinely two relationships and both
 * survive. Direction is part of the key, so a request and its response are not
 * collapsed into one.
 */
function dedupeEdges(edges: readonly CanvasEdge[]): CanvasEdge[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    // JSON rather than a delimited string: node ids are only space-free
    // because the agent graph contract happens to validate them that way
    // (`AGENT_GRAPH_ID_PATTERN`), and human-authored nodes carry arbitrary
    // ids. A delimited key lets `"foo bar" + "baz"` collide with
    // `"foo" + "bar baz"`, and a collision here silently deletes a real
    // edge. Encoding the three fields as a structure makes that impossible
    // regardless of what a future caller passes in.
    const key = JSON.stringify([edge.source, edge.target, edge.data?.label ?? ""]);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

/**
 * Runs `layoutGraph`, then stamps every edge with the handle pair its final
 * geometry calls for. The one function callers need.
 *
 * An edge whose source or target is missing from `nodes` is returned
 * unchanged rather than dropped: on a shared canvas, routing a user's edge
 * badly is recoverable, deleting it is not.
 */
export function applyLayout(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: ApplyLayoutOptions = {}
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const sourceEdges = options.dedupe ? dedupeEdges(edges) : edges;
  const laidOutNodes = layoutGraph(nodes, sourceEdges);
  const boxes = new Map(laidOutNodes.map((node) => [node.id, toBox(node)]));
  // Built once so `chooseHandles` can skip an edge's own endpoints by identity.
  const allBoxes = [...boxes.values()];

  const laidOutEdges = sourceEdges.map((edge) => {
    const sourceBox = boxes.get(edge.source);
    const targetBox = boxes.get(edge.target);

    if (!sourceBox || !targetBox) {
      return edge;
    }

    const { sourceHandle, targetHandle } = chooseHandles(
      sourceBox,
      targetBox,
      allBoxes
    );

    return { ...edge, sourceHandle, targetHandle };
  });

  return { nodes: laidOutNodes, edges: laidOutEdges };
}

function snap(value: number): number {
  return Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
}
