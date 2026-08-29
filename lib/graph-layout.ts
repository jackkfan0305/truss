import dagre from "@dagrejs/dagre";
import type { EdgeLabel, GraphLabel, NodeLabel } from "@dagrejs/dagre";
import type { XYPosition } from "@xyflow/react";

import {
  LAYOUT_GRID,
  MIN_NODE_GAP,
  RANK_GAP,
  laneOrder,
  toBox,
  type Box,
  type LaneMember,
} from "@/lib/canvas-geometry";
import {
  TRUNK_MIN,
  LANE_STEP,
  LABEL_GAP,
  LAYOUT_WIDTH_BUDGET,
  EDGE_LABEL_CLEARANCE,
} from "@/types/canvas";
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

/**
 * The rank gap this graph's widest bundle needs, clamped to what the compact
 * agent graph contract can represent.
 *
 * A wide bundle and a long chain never co-occur — a chain stacks nothing, so
 * its bundles have one member each and it lands on the `RANK_GAP` floor — so
 * the clamp only bites on graphs that are genuinely both. Rather than guess a
 * ceiling, it is computed from the rank count this layout actually produced.
 *
 * When the clamp does bite the lanes compress evenly, which is the same
 * give-up-evenly behaviour the old face fan had for a crowded node face:
 * squeezed still reads, overshot reads as labels anchored to thin air.
 */
function computedRankSep(
  maxLane: number,
  placed: readonly CanvasNode[],
  rankX: ReadonlyMap<string, number>
): number {
  const needed = Math.max(
    RANK_GAP,
    TRUNK_MIN + maxLane * LANE_STEP + EDGE_LABEL_CLEARANCE.width / 2 + LABEL_GAP
  );

  // Nodes in one rank share an x centre, so counting distinct centres counts
  // ranks, and the widest node in each is what that rank costs in width.
  //
  // `rankX` is dagre's own pre-snap centre for each node, not a value
  // reconstructed from `box.x + box.width / 2`: that reconstruction only
  // recovers the true centre when every node in the rank shares one width,
  // since snapping `center.x - width/2` and adding `width/2` back rounds
  // differently for a different width. A rank mixing shapes would otherwise
  // count as several narrower columns, summing their widths instead of
  // taking the widest, and under-provisioning the gap.
  const columns = new Map<number, number>();

  for (const node of placed) {
    const box = toBox(node);
    const center = rankX.get(node.id);

    if (center === undefined) {
      continue;
    }

    columns.set(center, Math.max(columns.get(center) ?? 0, box.width));
  }

  // A single-rank graph has no rank gap to size.
  if (columns.size < 2) {
    return needed;
  }

  const nodeWidth = [...columns.values()].reduce((total, width) => total + width, 0);
  const affordable = (LAYOUT_WIDTH_BUDGET - nodeWidth) / (columns.size - 1);

  return Math.max(MIN_NODE_GAP, Math.min(needed, affordable));
}

/** The four handle ids `canvas-node.tsx` renders, named once instead of
 * scattered as string literals through the geometry below. */
export const HANDLE_ID = {
  top: "top",
  right: "right",
  bottom: "bottom",
  left: "left",
} as const;

/** What `layoutGraphWithRanks` hands back: the placed nodes, and the rank
 * identity `assignLanes` and `computedRankSep` need to group by. */
interface LayoutGraphResult {
  nodes: CanvasNode[];
  /**
   * Each node's rank centre, keyed by id, exactly as dagre computed it —
   * before the position snap.
   *
   * `position.x` is `snap(center.x - origin.x - box.width / 2)`, so recovering
   * the centre by adding `box.width / 2` back only cancels the subtraction
   * exactly when nothing rounded in between. It does: `snap` rounds to the
   * nearest `LAYOUT_GRID`, and *how* a given `center.x` rounds depends on
   * `box.width`, so two nodes genuinely sharing one rank but not one width
   * reconstruct to two slightly different values. Keeping the exact
   * pre-snap number sidesteps the rounding rather than compensating for it.
   */
  rankX: Map<string, number>;
}

/**
 * Lays out a graph left-to-right with dagre. Never mutates `nodes`.
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
function layoutGraphWithRanks(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  ranksep: number = RANK_GAP
): LayoutGraphResult {
  if (nodes.length === 0) {
    return { nodes: [], rankX: new Map() };
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const boxes = new Map(nodes.map((node) => [node.id, toBox(node)]));

  // multigraph: true because every `setEdge` call below passes `edge.id` as
  // a name (graphlib throws "Cannot set a named edge when isMultigraph =
  // false" otherwise) — not because dagre needs to rank more than one edge
  // per (source, target) pair. It doesn't: no label size is declared on the
  // edge (see the comment below), so a second edge between a pair dagre has
  // already seen reserves no rank space a first one didn't, and ranking both
  // is what throws "Not possible to find intersection inside of the
  // rectangle" once a third source also targets the same node. The guard
  // below keeps dagre to one edge per pair for exactly that reason.
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({
    multigraph: true,
  });

  graph.setGraph({
    rankdir: "LR",
    nodesep: RANK_ROW_GAP,
    ranksep,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const box = boxes.get(node.id)!;

    graph.setNode(node.id, { width: box.width, height: box.height });
  }

  // Dagre only needs one edge per (source, target) pair to rank the two
  // nodes; a second, third, etc. edge between the same pair asks it to find
  // rank space for a label it was never told the size of (see the comment
  // above `graph.setEdge` below), and once a third source also targets the
  // node the second pair shares, dagre throws trying to route two edges
  // through the same rectangle. This only changes what dagre sees for
  // ranking — the caller's edge list, and every edge in it, comes back
  // whole; `applyLayout`'s own dedupe (a real deletion) is a separate,
  // opt-in step.
  const rankedPairs = new Set<string>();

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

    // JSON-encoded rather than delimited: node ids are arbitrary
    // human-authored strings on a hand-drawn canvas, not the delimiter-free
    // agent-graph id pattern, so a delimited join could let one node's id
    // colliding with another's produce a false duplicate.
    const pairKey = JSON.stringify([edge.source, edge.target]);

    if (rankedPairs.has(pairKey)) {
      continue;
    }

    rankedPairs.add(pairKey);

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

  const laidOutNodes = nodes.map((node, index) => {
    const box = boxes.get(node.id)!;
    const center = centers[index];

    const position: XYPosition = {
      x: snap(center.x - origin.x - box.width / 2),
      y: snap(center.y - origin.y - box.height / 2),
    };

    return { ...node, position };
  });

  const rankX = new Map(nodes.map((node, index) => [node.id, centers[index].x - origin.x]));

  return { nodes: laidOutNodes, rankX };
}

/**
 * Lays out a graph left-to-right with dagre and returns new node objects with
 * `position` set from the result. Never mutates `nodes`.
 *
 * The public entry point for callers that only need positions — everything
 * `applyLayout` needs beyond that (dagre's exact, pre-snap rank centre for
 * each node) comes from `layoutGraphWithRanks` instead.
 */
export function layoutGraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  ranksep: number = RANK_GAP
): CanvasNode[] {
  return layoutGraphWithRanks(nodes, edges, ranksep).nodes;
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
 * The point on a box where a handle sits.
 *
 * React Flow gives the renderer these as `sourceX`/`sourceY`, but the layout
 * has to compute them itself: lanes are assigned before anything is measured
 * on screen, from the rectangles dagre produced.
 */
export function handleAnchor(box: Box, handle: string): XYPosition {
  switch (handle) {
    case HANDLE_ID.left:
      return { x: box.x, y: box.y + box.height / 2 };
    case HANDLE_ID.right:
      return { x: box.x + box.width, y: box.y + box.height / 2 };
    case HANDLE_ID.top:
      return { x: box.x + box.width / 2, y: box.y };
    default:
      return { x: box.x + box.width / 2, y: box.y + box.height };
  }
}

/**
 * A route leaving one vertical face and entering the other — the only kind
 * lanes apply to, and the same gate `canvas-edge.tsx`'s `isSideToSide` and
 * `scripts/verify-graph-layout.ts`'s `routeEveryEdge` use to decide whether an
 * edge is drawn through `buildEdgeRoute` at all.
 */
export function isSideToSideRoute(sourceHandle: string, targetHandle: string): boolean {
  const isSide = (handle: string) =>
    handle === HANDLE_ID.left || handle === HANDLE_ID.right;

  return isSide(sourceHandle) && isSide(targetHandle);
}

/** Every edge that has both endpoints, with its handles chosen from the given geometry. */
function wireEdges(
  placed: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): { edge: CanvasEdge; source: Box; target: Box }[] {
  const boxes = new Map(placed.map((node) => [node.id, toBox(node)]));
  // Built once so `chooseHandles` can skip an edge's own endpoints by identity.
  const allBoxes = [...boxes.values()];

  return edges.flatMap((edge) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);

    if (!source || !target) {
      return [];
    }

    const { sourceHandle, targetHandle } = chooseHandles(source, target, allBoxes);

    return [{ edge: { ...edge, sourceHandle, targetHandle }, source, target }];
  });
}

/**
 * Groups the side-to-side edges by the handle they leave from and assigns each
 * one its lane, returning the result keyed by edge id.
 *
 * Edges on a top or bottom handle are left out entirely. A lane is a claim
 * about the node-free band between two ranks, and an edge leaving a vertical
 * face is not crossing that band — its anchor x there is its node's own centre
 * line, not the edge of its rank.
 */
function assignLanes(
  wired: readonly { edge: CanvasEdge; source: Box; target: Box }[],
  rankX: ReadonlyMap<string, number>
): Map<string, number> {
  const bundles = new Map<string, LaneMember[]>();

  for (const { edge, source, target } of wired) {
    if (!isSideToSideRoute(edge.sourceHandle!, edge.targetHandle!)) {
      continue;
    }

    const from = handleAnchor(source, edge.sourceHandle!);
    const to = handleAnchor(target, edge.targetHandle!);

    // Key by rank and handle, not by source node id. This ensures all edges
    // leaving the same rank on the same handle share a continuous lane space,
    // preventing lane 0 of one source from occupying the same column as lane 0
    // of another source in the same rank.
    //
    // `rankX` is dagre's exact pre-snap centre (see `LayoutGraphResult`), not
    // `source.x + source.width / 2` reconstructed from the snapped box: that
    // reconstruction only recovers the true centre when every node in the
    // rank shares one width, so a rank mixing shapes (a cylinder database
    // beside a rectangle service) used to compute two different keys for one
    // rank and restart both bundles at lane 0.
    const key = `${rankX.get(edge.source)} ${edge.sourceHandle}`;

    bundles.set(key, [
      ...(bundles.get(key) ?? []),
      { id: edge.id, deltaY: to.y - from.y, targetX: to.x },
    ]);
  }

  const lanes = new Map<string, number>();

  // Iterating the map is safe for determinism: its insertion order follows
  // `wired`, which follows the caller's edge array.
  for (const members of bundles.values()) {
    for (const [id, lane] of laneOrder(members)) {
      lanes.set(id, lane);
    }
  }

  return lanes;
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

  // Pass 1 exists only to learn the shape: how many ranks, and how wide the
  // widest bundle is. Both need handles, handles need positions, and positions
  // need a rank gap — so the first gap is the floor and the second is derived.
  const probe = layoutGraphWithRanks(nodes, sourceEdges);
  const probeLanes = assignLanes(wireEdges(probe.nodes, sourceEdges), probe.rankX);
  let maxLane = Math.max(0, ...probeLanes.values());

  let laidOut: LayoutGraphResult;
  let wired: ReturnType<typeof wireEdges>;
  let lanes: Map<string, number>;

  // Lays out with the ranksep `maxLane` calls for, then repeats if that
  // widened the bundle further: a larger ranksep can turn more edges
  // side-to-side, raising `maxLane` again. This always terminates because
  // `maxLane` only ever rises here, and it's bounded above by the bundle's
  // own edge count.
  do {
    laidOut = layoutGraphWithRanks(nodes, sourceEdges, computedRankSep(maxLane, probe.nodes, probe.rankX));
    wired = wireEdges(laidOut.nodes, sourceEdges);
    lanes = assignLanes(wired, laidOut.rankX);

    const newMaxLane = Math.max(0, ...lanes.values());

    if (newMaxLane <= maxLane) {
      break;
    }

    maxLane = newMaxLane;
  } while (true);

  const laidOutNodes = laidOut.nodes;
  const wiredById = new Map(wired.map((entry) => [entry.edge.id, entry.edge]));

  const laidOutEdges = sourceEdges.map((edge) => {
    const routed = wiredById.get(edge.id);

    if (!routed) {
      return edge;
    }

    const lane = lanes.get(edge.id);

    return lane === undefined
      ? routed
      : { ...routed, data: { ...(routed.data ?? { label: "" }), lane } };
  });

  return { nodes: laidOutNodes, edges: laidOutEdges };
}

function snap(value: number): number {
  return Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
}
