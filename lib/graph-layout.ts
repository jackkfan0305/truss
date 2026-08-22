import dagre from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";
import type { XYPosition } from "@xyflow/react";

import { LAYOUT_GRID, MIN_NODE_GAP, toBox, type Box } from "@/lib/canvas-geometry";
import {
  EDGE_LABEL_CLEARANCE,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";

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
 * Twice `MIN_NODE_GAP` so a column of nodes reads as separate rows rather
 * than a dense stack that only just clears the overlap check.
 */
const RANK_ROW_GAP = MIN_NODE_GAP * 2;

/**
 * Gap between ranks (along the LR flow), and the space an edge label's pill has
 * to sit in at the midpoint. Dagre treats `ranksep` as the literal edge-to-edge
 * distance between one rank's nodes and the next's, so `MIN_NODE_GAP +
 * EDGE_LABEL_CLEARANCE.width` clears the pill with the node gap left over; a
 * bare `MIN_NODE_GAP` would draw it across whichever node is closer.
 *
 * Every rank gap gets this, labelled or not, and that uniformity is deliberate.
 * The alternative — declaring each labelled edge's label size to dagre and
 * letting it size the gap per edge — reserves the label's width *on top of*
 * `ranksep` rather than inside it, so a 40-node chain (the compact contract's
 * own node ceiling) with a label on every hop grew to ±11,000. That is outside
 * the ±10,000 the contract can represent, and a node outside it projects as
 * opaque: see `boundingCenter` below for what that costs. A fixed gap keeps the
 * widest graph the contract allows inside the range the contract can express,
 * whatever share of its edges carry labels.
 */
const RANK_GAP = MIN_NODE_GAP + EDGE_LABEL_CLEARANCE.width;

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
 * Picks the handle pair for an edge from its endpoints' final rectangles.
 *
 * Horizontal separation wins outright rather than competing with the vertical
 * offset. The layout is left-to-right, so two rectangles that clear each other
 * on x are in different ranks, and the edge between them advances the flow —
 * it belongs on the right and left faces however far apart the two ranks sit
 * vertically. Weighing the two gaps against each other instead sends a
 * one-rank hop out through the top of its source the moment its target happens
 * to sit a couple of rows up, which reads as a diagonal fighting the layout.
 *
 * Vertical handles are for the case that actually calls for them: two nodes in
 * the same rank, overlapping on x, where the connection genuinely runs up or
 * down the column.
 */
export function chooseHandles(
  source: Box,
  target: Box
): { sourceHandle: string; targetHandle: string } {
  // A forward hop: the target's left edge clears the source's right one.
  if (target.x >= source.x + source.width) {
    return { sourceHandle: HANDLE_ID.right, targetHandle: HANDLE_ID.left };
  }

  // A back-edge, the same test mirrored.
  if (source.x >= target.x + target.width) {
    return { sourceHandle: HANDLE_ID.left, targetHandle: HANDLE_ID.right };
  }

  // Same rank: the rectangles overlap on x, so the connection really does run
  // up or down the column.
  const sourceCenterY = source.y + source.height / 2;
  const targetCenterY = target.y + target.height / 2;

  return targetCenterY >= sourceCenterY
    ? { sourceHandle: HANDLE_ID.bottom, targetHandle: HANDLE_ID.top }
    : { sourceHandle: HANDLE_ID.top, targetHandle: HANDLE_ID.bottom };
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
  edges: readonly CanvasEdge[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const laidOutNodes = layoutGraph(nodes, edges);
  const boxes = new Map(laidOutNodes.map((node) => [node.id, toBox(node)]));

  const laidOutEdges = edges.map((edge) => {
    const sourceBox = boxes.get(edge.source);
    const targetBox = boxes.get(edge.target);

    if (!sourceBox || !targetBox) {
      return edge;
    }

    const { sourceHandle, targetHandle } = chooseHandles(sourceBox, targetBox);

    return { ...edge, sourceHandle, targetHandle };
  });

  return { nodes: laidOutNodes, edges: laidOutEdges };
}

function snap(value: number): number {
  return Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
}
