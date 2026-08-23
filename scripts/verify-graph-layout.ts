import assert from "node:assert/strict";

import { applyLayout, chooseHandles, handleAnchor, layoutGraph } from "../lib/graph-layout";
import {
  LAYOUT_GRID,
  MIN_NODE_GAP,
  RANK_GAP,
  laneOrder,
  edgeSplitX,
  toBox,
  buildEdgeRoute,
  parallelLaneY,
  orthogonalPath,
  type Box,
  type RoutePoint,
  type EdgeRoute,
} from "../lib/canvas-geometry";
import {
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  NODE_DEFAULT_SIZES,
  EDGE_LABEL_CLEARANCE,
  TRUNK_MIN,
  LANE_STEP,
  LABEL_GAP,
  LAYOUT_WIDTH_BUDGET,
  PARALLEL_STEP,
  type CanvasEdge,
  type CanvasNode,
  type NodeShape,
} from "../types/canvas";

/**
 * Checks the deterministic-layout pass that replaces model-guessed positions
 * and default-handle edges (24-graph-layout). Everything here is pure, so it
 * runs against hand-built node/edge fixtures with no room, model or browser.
 */

function makeNode(
  id: string,
  position: { x: number; y: number } = { x: 0, y: 0 },
  shape: NodeShape = "rectangle",
): CanvasNode {
  const size = NODE_DEFAULT_SIZES[shape];

  return {
    id,
    type: CANVAS_NODE_TYPE,
    position,
    width: size.width,
    height: size.height,
    data: { label: id, color: DEFAULT_NODE_COLOR, shape },
  };
}

function makeEdge(id: string, source: string, target: string, label = ""): CanvasEdge {
  return {
    id,
    type: CANVAS_EDGE_TYPE,
    source,
    target,
    data: { label },
  };
}

/** Same inflated-overlap check `lib/design-plan.ts` uses for placed nodes. */
function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width + MIN_NODE_GAP &&
    a.x + a.width + MIN_NODE_GAP > b.x &&
    a.y < b.y + b.height + MIN_NODE_GAP &&
    a.y + a.height + MIN_NODE_GAP > b.y
  );
}

function assertNoOverlaps(nodes: readonly CanvasNode[], context: string): void {
  const boxes = nodes.map(toBox);

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(
        !boxesOverlap(boxes[i]!, boxes[j]!),
        `${context}: ${nodes[i]!.id} and ${nodes[j]!.id} overlap once inflated by MIN_NODE_GAP`,
      );
    }
  }
}

/**
 * `Number.isInteger(value / LAYOUT_GRID)` rather than `value % LAYOUT_GRID ===
 * 0`: the layout centres every diagram on the origin, so half its coordinates
 * are negative, and `-200 % 20` is `-0` — equal to `0` under `===` but not
 * under `assert.equal`. The division says what is actually meant.
 */
function assertOnGrid(nodes: readonly CanvasNode[], context: string): void {
  for (const node of nodes) {
    assert.ok(
      Number.isInteger(node.position.x / LAYOUT_GRID),
      `${context}: ${node.id}.x is grid-aligned`
    );
    assert.ok(
      Number.isInteger(node.position.y / LAYOUT_GRID),
      `${context}: ${node.id}.y is grid-aligned`
    );
  }
}

/** A branching DAG: same-rank siblings (B, C) and a converging node (D). */
function buildBranchingGraph() {
  const nodes = [
    makeNode("a"),
    makeNode("b"),
    makeNode("c"),
    makeNode("d"),
    makeNode("isolated"),
  ];
  const edges = [
    makeEdge("a-b", "a", "b"),
    makeEdge("a-c", "a", "c"),
    makeEdge("b-d", "b", "d", "syncs"),
    makeEdge("c-d", "c", "d"),
  ];

  return { nodes, edges };
}

function checkLayoutClearsOverlapsAndSnapsToGrid(): void {
  const { nodes, edges } = buildBranchingGraph();
  const laidOut = layoutGraph(nodes, edges);

  assert.equal(laidOut.length, nodes.length, "every node survives layout");
  assertNoOverlaps(laidOut, "branching graph");
  assertOnGrid(laidOut, "branching graph");
}

/** For an acyclic graph, every edge should run forward: target strictly right of source. */
function checkAcyclicEdgesRunLeftToRight(): void {
  const { nodes, edges } = buildBranchingGraph();
  const laidOut = layoutGraph(nodes, edges);
  const byId = new Map(laidOut.map((node) => [node.id, node]));

  for (const edge of edges) {
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;

    assert.ok(
      target.position.x > source.position.x,
      `${edge.id}: target rank (${target.position.x}) is right of source rank (${source.position.x})`,
    );
  }
}

function checkLayoutIsDeterministic(): void {
  const { nodes, edges } = buildBranchingGraph();

  const first = layoutGraph(nodes, edges);
  const second = layoutGraph(nodes, edges);

  assert.deepEqual(first, second, "laying out the same graph twice is byte-identical");

  const firstApplied = applyLayout(nodes, edges);
  const secondApplied = applyLayout(nodes, edges);

  assert.deepEqual(firstApplied, secondApplied, "applyLayout is deterministic too");
}

/** Never mutates the caller's arrays or the node/edge objects inside them. */
function checkLayoutDoesNotMutateInputs(): void {
  const { nodes, edges } = buildBranchingGraph();
  const snapshotPositions = nodes.map((node) => ({ ...node.position }));

  layoutGraph(nodes, edges);

  nodes.forEach((node, index) => {
    assert.deepEqual(node.position, snapshotPositions[index], `${node.id} input position untouched`);
  });
}

/** Direct geometry tests: `chooseHandles` reads the gap, not raw centre distance. */
function checkChooseHandlesFollowsTheFlowDirection(): void {
  const base: Box = { x: 0, y: 0, width: 100, height: 50 };

  assert.deepEqual(
    chooseHandles(base, { ...base, x: 300 }),
    { sourceHandle: "right", targetHandle: "left" },
    "a target in a further rank connects right-to-left",
  );
  assert.deepEqual(
    chooseHandles(base, { ...base, x: -300 }),
    { sourceHandle: "left", targetHandle: "right" },
    "a back-edge to an earlier rank connects left-to-right",
  );
  assert.deepEqual(
    chooseHandles(base, { ...base, y: 300 }),
    { sourceHandle: "bottom", targetHandle: "top" },
    "same rank, target below: bottom-to-top",
  );
  assert.deepEqual(
    chooseHandles(base, { ...base, y: -300 }),
    { sourceHandle: "top", targetHandle: "bottom" },
    "same rank, target above: top-to-bottom",
  );

  // A one-rank hop whose target sits only a little way up is still a
  // horizontal edge: it advances the flow, and the layout runs left to right.
  // Letting the vertical offset win on a tie is what used to send this out
  // through the source's top and read as a diagonal fighting the layout.
  assert.deepEqual(
    chooseHandles(base, { x: 300, y: -180, width: 100, height: 50 }),
    { sourceHandle: "right", targetHandle: "left" },
    "a one-rank hop to a node slightly above still leaves from the right",
  );

  // Travelling three times further up than across, with nothing in either
  // column, is the case vertical handles exist for.
  const farAbove: Box = { x: 300, y: -600, width: 100, height: 50 };
  assert.deepEqual(
    chooseHandles(base, farAbove),
    { sourceHandle: "top", targetHandle: "bottom" },
    "a mostly-vertical hop over a clear column leaves from the top",
  );

  // The regression that made this rule horizontal-only in the first place: the
  // same geometry inside a populated rank. A node standing in the source's own
  // column is exactly what a vertical run would be drawn straight through.
  const inSourceColumn: Box = { x: 0, y: -300, width: 100, height: 50 };
  assert.deepEqual(
    chooseHandles(base, farAbove, [base, farAbove, inSourceColumn]),
    { sourceHandle: "right", targetHandle: "bottom" },
    "a node stacked above the source pushes that end back to its side face",
  );

  // Blocking the other end instead moves only that end back.
  const inTargetColumn: Box = { x: 300, y: -300, width: 100, height: 50 };
  assert.deepEqual(
    chooseHandles(base, farAbove, [base, farAbove, inTargetColumn]),
    { sourceHandle: "top", targetHandle: "left" },
    "a node stacked below the target pushes only that end back to its side face",
  );

  // Both blocked is the six-deep rank in a real diagram: unchanged from the
  // horizontal-only rule.
  assert.deepEqual(
    chooseHandles(base, farAbove, [base, farAbove, inSourceColumn, inTargetColumn]),
    { sourceHandle: "right", targetHandle: "left" },
    "both columns blocked falls all the way back to side-to-side",
  );

  // An endpoint never blocks its own edge, even though callers pass the whole
  // canvas without filtering.
  assert.deepEqual(
    chooseHandles(base, farAbove, [base, farAbove]),
    { sourceHandle: "top", targetHandle: "bottom" },
    "the edge's own endpoints are not obstacles to it",
  );

  // A tall node beside a short one: the centres are mostly vertically offset,
  // but the two rectangles still clear each other on x — and they overlap on y,
  // so there is no vertical travel to put on a top or bottom handle. Comparing
  // centre distances rather than edge-to-edge gaps got this one wrong.
  const tall: Box = { x: 0, y: 0, width: 50, height: 400 };
  const shortBeside: Box = { x: 200, y: 350, width: 50, height: 50 };

  assert.deepEqual(
    chooseHandles(tall, shortBeside),
    { sourceHandle: "right", targetHandle: "left" },
    "a tall node beside a short one still reads as horizontal",
  );
  assert.deepEqual(
    chooseHandles(tall, shortBeside, [tall, shortBeside]),
    { sourceHandle: "right", targetHandle: "left" },
    "and stays horizontal when the obstacle list proves both columns are clear",
  );
}

/** `applyLayout` stamps handles that agree with the geometry it just produced. */
function checkApplyLayoutStampsHandlesFromGeometry(): void {
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
  const edges = [makeEdge("a-b", "a", "b"), makeEdge("b-c", "b", "c")];

  const { edges: laidOutEdges } = applyLayout(nodes, edges);

  for (const edge of laidOutEdges) {
    // A straight LR chain places every target strictly to the right of its
    // source, so every edge should read right (leaving) to left (entering).
    assert.equal(edge.sourceHandle, "right", `${edge.id} leaves from the right`);
    assert.equal(edge.targetHandle, "left", `${edge.id} enters from the left`);
  }
}

function checkEmptyGraph(): void {
  assert.deepEqual(layoutGraph([], []), [], "an empty node list lays out to nothing");

  const dangling = makeEdge("ghost-edge", "ghost-a", "ghost-b");
  const { nodes, edges } = applyLayout([], [dangling]);

  assert.deepEqual(nodes, [], "no nodes to place");
  assert.equal(edges[0], dangling, "an edge with no real nodes at all is returned unchanged");
}

function checkDanglingEdgeReferenceIsSkippedNotInvented(): void {
  const nodes = [makeNode("a")];
  const dangling = makeEdge("a-ghost", "a", "ghost");

  const laidOutNodes = layoutGraph(nodes, [dangling]);
  assert.equal(laidOutNodes.length, 1, "dagre never invents a node for the missing endpoint");
  assertOnGrid(laidOutNodes, "dangling edge");

  const { edges } = applyLayout(nodes, [dangling]);
  assert.equal(edges[0], dangling, "an edge with a missing endpoint is returned unchanged, not dropped");
}

function checkSelfLoopIsSkippedInLayoutButKeptOnTheCanvas(): void {
  const nodes = [makeNode("a"), makeNode("b")];
  const edges = [makeEdge("a-loop", "a", "a"), makeEdge("a-b", "a", "b")];

  const laidOut = layoutGraph(nodes, edges);
  assertNoOverlaps(laidOut, "self-loop graph");
  assertOnGrid(laidOut, "self-loop graph");

  const byId = new Map(laidOut.map((node) => [node.id, node]));
  assert.ok(
    byId.get("b")!.position.x > byId.get("a")!.position.x,
    "the real edge still ranks b after a despite the self-loop",
  );

  const { edges: laidOutEdges } = applyLayout(nodes, edges);
  const loop = laidOutEdges.find((edge) => edge.id === "a-loop");
  assert.ok(loop, "the self-loop edge is kept, not dropped");
  assert.equal(loop!.source, "a");
  assert.equal(loop!.target, "a");
}

function checkDisconnectedNodeIsPlacedCleanly(): void {
  const { nodes, edges } = buildBranchingGraph();
  const laidOut = layoutGraph(nodes, edges);
  const isolated = laidOut.find((node) => node.id === "isolated")!;

  assert.ok(isolated, "a node with no edges at all still comes back from layout");
  assertOnGrid([isolated], "disconnected node");
}

/** A labelled edge's pill needs room; an unlabelled edge does not require it. */
function checkLabelledEdgeReservesClearanceBetweenNodes(): void {
  const nodes = [makeNode("a"), makeNode("b")];
  const labelled = [makeEdge("a-b", "a", "b", "creates order")];

  const laidOut = layoutGraph(nodes, labelled);
  const a = toBox(laidOut.find((node) => node.id === "a")!);
  const b = toBox(laidOut.find((node) => node.id === "b")!);
  const gap = b.x - (a.x + a.width);

  assert.ok(
    gap >= EDGE_LABEL_CLEARANCE.width,
    `labelled edge leaves ${gap}px clear, at least the ${EDGE_LABEL_CLEARANCE.width}px the label pill needs`,
  );
}

/**
 * Labelling an edge must not widen the layout.
 *
 * The rank gap already reserves the label pill's width. Declaring the label's
 * size to dagre as well made it reserve that space a second time, *on top of*
 * the gap — which grew the widest graph the compact contract allows past the
 * ±10,000 that contract can represent, quietly making nodes opaque to agents
 * reading the canvas back. Same graph, labels on or off, same geometry.
 */
function checkLabelsDoNotWidenTheLayout(): void {
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
  const bare = [makeEdge("a-b", "a", "b"), makeEdge("b-c", "b", "c")];
  const labelled = [
    makeEdge("a-b", "a", "b", "creates order"),
    makeEdge("b-c", "b", "c", "publishes to"),
  ];

  assert.deepEqual(
    layoutGraph(nodes, labelled).map((node) => node.position),
    layoutGraph(nodes, bare).map((node) => node.position),
    "labelling every edge leaves every node exactly where it was",
  );
}



function checkLaneOrderPutsTheLongestTravelClosestToTheSource(): void {
  // Two edges heading the same way. If the shorter one split first, the
  // longer one's vertical run would cross the shorter one's horizontal run.
  const members = [
    { id: "short", deltaY: 50, targetX: 400 },
    { id: "long", deltaY: 200, targetX: 400 },
  ];

  const order = laneOrder(members);

  assert.equal(order.get("long"), 0, "the furthest-travelling edge splits first");
  assert.equal(order.get("short"), 1, "the shorter one splits further out");

  assert.deepEqual(
    [...laneOrder([...members].reverse()).entries()].sort(),
    [...order.entries()].sort(),
    "the result does not depend on the order the members arrive in",
  );
}

function checkLaneOrderIgnoresDirectionAndBreaksTiesStably(): void {
  // Up and down are symmetric: an up-edge and a down-edge leave the trunk into
  // opposite half-planes and cannot cross, so only the magnitude matters.
  const order = laneOrder([
    { id: "up", deltaY: -200, targetX: 400 },
    { id: "down", deltaY: 200, targetX: 400 },
  ]);

  assert.equal(
    new Set([order.get("up"), order.get("down")]).size,
    2,
    "an exact magnitude tie still yields two distinct lanes",
  );

  const nearer = laneOrder([
    { id: "far", deltaY: 100, targetX: 900 },
    { id: "near", deltaY: 100, targetX: 400 },
  ]);

  assert.equal(nearer.get("near"), 0, "an equal climb breaks on the nearer target");
  assert.equal(nearer.get("far"), 1, "and the further target takes the outer lane");

  const byId = laneOrder([
    { id: "b", deltaY: 100, targetX: 400 },
    { id: "a", deltaY: 100, targetX: 400 },
  ]);

  assert.equal(byId.get("a"), 0, "a total tie falls back to edge id, so it is deterministic");
  assert.equal(byId.get("b"), 1);

  assert.deepEqual(
    laneOrder([
      { id: "a", deltaY: 100, targetX: 400 },
      { id: "b", deltaY: 100, targetX: 400 },
    ]),
    byId,
    "the id tiebreak is independent of arrival order",
  );

  assert.deepEqual(laneOrder([]), new Map(), "an empty bundle has no lanes");
}

function checkSplitColumnStaggersByLaneAndFollowsTheFlow(): void {
  assert.equal(
    edgeSplitX(100, 900, 0),
    100 + TRUNK_MIN,
    "lane 0 splits one trunk length past the anchor",
  );
  assert.equal(
    edgeSplitX(100, 900, 2),
    100 + TRUNK_MIN + 2 * LANE_STEP,
    "each further lane splits one LANE_STEP further out",
  );
  assert.equal(
    edgeSplitX(900, 100, 1),
    900 - (TRUNK_MIN + LANE_STEP),
    "a back-edge staggers backwards, not forwards",
  );
  assert.equal(
    edgeSplitX(100, 100, 0),
    100 + TRUNK_MIN,
    "a target directly above or below still splits forwards rather than at zero",
  );
}

function checkNonParallelRouteIsTrunkThenTurn(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 900, y: 300 },
    lane: 1,
    parallelIndex: 0,
    parallelCount: 1,
  });

  const splitX = 100 + TRUNK_MIN + LANE_STEP;

  assert.deepEqual(
    route.points,
    [
      { x: 100, y: 0 },
      { x: splitX, y: 0 },
      { x: splitX, y: 300 },
      { x: 900, y: 300 },
    ],
    "trunk out, turn at the lane's own column, then straight in",
  );
  assert.deepEqual(
    route.labelPoint,
    { x: splitX, y: 150 },
    "the label rides the middle of the vertical run, which no other lane shares",
  );
}

function checkFlatRouteKeepsItsLabelOffTheNodeFace(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 900, y: 0 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 1,
  });

  assert.deepEqual(
    route.points,
    [
      { x: 100, y: 0 },
      { x: 900, y: 0 },
    ],
    "a straight hop collapses to two points rather than drawing a zero-height turn",
  );
  assert.equal(route.labelPoint.y, 0, "its label stays on the line");
  assert.equal(
    route.labelPoint.x,
    100 + TRUNK_MIN + EDGE_LABEL_CLEARANCE.width / 2,
    "and sits a pill's half-width past the split, so the pill clears the node",
  );
}

function checkParallelGroupBowsToItsOwnLane(): void {
  const shared = {
    source: { x: 100, y: 0 },
    target: { x: 900, y: 0 },
    lane: 0,
  } as const;

  const first = buildEdgeRoute({ ...shared, parallelIndex: 0, parallelCount: 2 });
  const second = buildEdgeRoute({ ...shared, parallelIndex: 1, parallelCount: 2 });

  assert.equal(first.points.length, 6, "a parallel member needs five segments");
  assert.equal(
    Math.abs(first.labelPoint.y - second.labelPoint.y),
    PARALLEL_STEP,
    "and its label is a full PARALLEL_STEP clear of its neighbour's",
  );
  assert.ok(
    Math.abs(first.labelPoint.y - second.labelPoint.y) > EDGE_LABEL_CLEARANCE.height,
    "which is more than a pill height, so the two cannot overlap",
  );
  assert.equal(
    (first.labelPoint.y + second.labelPoint.y) / 2,
    0,
    "the group straddles the line a single edge would have taken",
  );
}

function checkOrthogonalPathRoundsCornersAndDropsCollinearPoints(): void {
  const straight = orthogonalPath([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ]);

  assert.equal(
    straight,
    "M 0,0 L 100,0",
    "three points on one line draw one segment, not two",
  );

  const corner = orthogonalPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    8,
  );

  assert.ok(corner.includes("Q"), "a real corner is rounded, not mitred");
  assert.ok(corner.startsWith("M 0,0"), "the path starts at the source anchor");
  assert.ok(corner.trim().endsWith("100,100"), "and ends at the target anchor");

  const tight = orthogonalPath(
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ],
    8,
  );

  assert.ok(
    !tight.includes("NaN") && !tight.includes("-"),
    "a corner shorter than the radius clamps instead of overshooting backwards",
  );

  assert.equal(
    orthogonalPath([{ x: 5, y: 5 }]),
    "M 5,5",
    "a single point is a degenerate but valid path",
  );
  assert.equal(orthogonalPath([]), "", "no points draw nothing");
}

function checkCloseSpanParallelForwardDoesNotOvershoot(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 280, y: 0 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 2,
  });

  for (const point of route.points) {
    assert.ok(
      point.x >= 100 && point.x <= 280,
      `point x=${point.x} is within [100, 280]`,
    );
  }
  assert.ok(
    route.points.every((p) => p.x >= 100 && p.x <= 280),
    "all points stay between source and target, no overshooting",
  );
}

function checkCloseSpanParallelBackwardDoesNotOvershoot(): void {
  const route = buildEdgeRoute({
    source: { x: 280, y: 0 },
    target: { x: 100, y: 0 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 2,
  });

  for (const point of route.points) {
    assert.ok(
      point.x >= 100 && point.x <= 280,
      `point x=${point.x} is within [100, 280]`,
    );
  }
  assert.ok(
    route.points.every((p) => p.x >= 100 && p.x <= 280),
    "all points stay between target and source, no overshooting",
  );
}

function checkSlopedButUnderThresholdRouteKeepsLabelOnSegment(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 900, y: 20 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 1,
  });

  const end = route.points[route.points.length - 1];
  const start = route.points[route.points.length - 2];

  assert.equal(
    route.labelPoint.y,
    end.y,
    "the label rides the final horizontal, not the source's row",
  );
  assert.ok(
    route.labelPoint.x >= Math.min(start.x, end.x) &&
      route.labelPoint.x <= Math.max(start.x, end.x),
    `the label's x (${route.labelPoint.x}) is on the drawn segment ${start.x}..${end.x}, not beside it`,
  );
}

function checkDedupeDropsIdenticalTriplesOnlyWhenAsked(): void {
  const nodes = [makeNode("a"), makeNode("b")];
  const edges = [
    makeEdge("e1", "a", "b", "OAuth + refresh"),
    makeEdge("e2", "a", "b", "OAuth + refresh"),
    makeEdge("e3", "a", "b", "encrypted tokens"),
    makeEdge("e4", "b", "a", "OAuth + refresh"),
  ];

  assert.equal(
    applyLayout(nodes, edges).edges.length,
    4,
    "the default path never deletes a user's edge",
  );

  assert.deepEqual(
    applyLayout(nodes, edges, { dedupe: true }).edges.map((edge) => edge.id),
    ["e1", "e3", "e4"],
    "only the exact source+target+label repeat goes, and the first occurrence is kept",
  );

  assert.equal(
    applyLayout(nodes, [makeEdge("u1", "a", "b"), makeEdge("u2", "a", "b")], {
      dedupe: true,
    }).edges.length,
    1,
    "two unlabelled edges between the same pair are the same duplicate case",
  );

  // Collision-safety test: space-delimited keys would collide for these two
  // edges, but JSON keying prevents that. Without this guard, a future caller
  // with arbitrary node ids could silently delete a distinct edge.
  const collisionTestNodes = [
    makeNode("foo bar"),
    makeNode("baz"),
    makeNode("foo"),
    makeNode("bar baz"),
  ];
  const collisionTestEdges = [
    makeEdge("edge-1", "foo bar", "baz"),
    makeEdge("edge-2", "foo", "bar baz"),
  ];

  assert.deepEqual(
    applyLayout(collisionTestNodes, collisionTestEdges, { dedupe: true }).edges.map(
      (edge) => edge.id,
    ),
    ["edge-1", "edge-2"],
    "two edges that would collide with space-delimited keys are kept distinct",
  );
}

function checkApplyLayoutStampsLanesOnSideToSideEdgesOnly(): void {
  // One source fanning out to three targets at different heights: a bundle.
  const nodes = [makeNode("hub"), makeNode("near"), makeNode("mid"), makeNode("far")];
  const edges = [
    makeEdge("to-near", "hub", "near", "a"),
    makeEdge("to-mid", "hub", "mid", "b"),
    makeEdge("to-far", "hub", "far", "c"),
  ];

  const laidOut = applyLayout(nodes, edges);
  const boxes = new Map(laidOut.nodes.map((node) => [node.id, toBox(node)]));

  const sideToSide = laidOut.edges.filter(
    (edge) =>
      (edge.sourceHandle === "left" || edge.sourceHandle === "right") &&
      (edge.targetHandle === "left" || edge.targetHandle === "right"),
  );

  assert.ok(sideToSide.length > 1, "the fixture actually produces a bundle");

  for (const edge of sideToSide) {
    assert.equal(typeof edge.data?.lane, "number", `${edge.id} comes back with a lane`);
  }

  const lanes = sideToSide.map((edge) => edge.data!.lane!).sort((a, b) => a - b);

  assert.deepEqual(
    lanes,
    lanes.map((_, index) => index),
    "one bundle's lanes are 0..n-1 with no gaps and no repeats",
  );

  // The lane order is the travel order, measured from the final geometry.
  const travel = (edge: (typeof sideToSide)[number]) => {
    const from = handleAnchor(boxes.get(edge.source)!, edge.sourceHandle!);
    const to = handleAnchor(boxes.get(edge.target)!, edge.targetHandle!);

    return Math.abs(to.y - from.y);
  };

  const ordered = sideToSide
    .slice()
    .sort((a, b) => a.data!.lane! - b.data!.lane!)
    .map(travel);

  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      ordered[index] <= ordered[index - 1],
      "lanes run from the longest vertical travel outwards",
    );
  }

  assert.deepEqual(
    applyLayout(nodes, edges),
    laidOut,
    "lane stamping keeps applyLayout deterministic",
  );
}

function checkVerticalHandleEdgeIsLeftOutOfEveryBundle(): void {
  // Two nodes in the same rank: the connection runs up the column, so both
  // ends take a vertical handle and the lane machinery has no claim on it.
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
  const edges = [makeEdge("down", "a", "b", "x"), makeEdge("across", "a", "c", "y")];

  for (const edge of applyLayout(nodes, edges).edges) {
    const isSideToSide =
      (edge.sourceHandle === "left" || edge.sourceHandle === "right") &&
      (edge.targetHandle === "left" || edge.targetHandle === "right");

    assert.equal(
      "lane" in (edge.data ?? {}),
      isSideToSide,
      `${edge.id}: a lane KEY is present exactly when the route is side to side — ` +
        `absent, not present-and-undefined, which is what a bare undefined check would miss`,
    );
  }
}

function checkWideBundleGetsRoomForItsLabelsAndStaysInBudget(): void {
  // One hub with six targets: six lanes, so six split columns plus a pill.
  const nodes = [makeNode("hub"), ...Array.from({ length: 6 }, (_, i) => makeNode(`t${i}`))];
  const edges = Array.from({ length: 6 }, (_, i) =>
    makeEdge(`e${i}`, "hub", `t${i}`, `label ${i}`),
  );

  const { nodes: laidOut, edges: laidOutEdges } = applyLayout(nodes, edges);
  const boxes = new Map(laidOut.map((node) => [node.id, toBox(node)]));
  const hub = boxes.get("hub")!;
  const target = boxes.get("t0")!;
  const gap = Math.abs(target.x - (hub.x + hub.width));
  const maxLane = Math.max(...laidOutEdges.map((edge) => edge.data?.lane ?? 0));

  assert.ok(
    gap >= TRUNK_MIN + maxLane * LANE_STEP + EDGE_LABEL_CLEARANCE.width / 2,
    `the rank gap (${gap}) holds every split column and the outermost label`,
  );

  const xs = laidOut.flatMap((node) => [
    node.position.x,
    node.position.x + (node.width ?? 0),
  ]);

  assert.ok(
    Math.max(...xs) - Math.min(...xs) <= LAYOUT_WIDTH_BUDGET,
    "and the whole diagram still fits the compact contract's coordinate budget",
  );
}

function checkSingleEdgeBundlesLayOutExactlyAsBefore(): void {
  // Every bundle here has one member, so the computed ranksep must land on the
  // RANK_GAP floor and nothing about this graph may move.
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
  const edges = [makeEdge("ab", "a", "b", "x"), makeEdge("bc", "b", "c", "y")];
  const boxes = applyLayout(nodes, edges)
    .nodes.map((node) => toBox(node))
    .sort((left, right) => left.x - right.x);

  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const gap = boxes[index].x - (previous.x + previous.width);

    // Within one grid unit, not exactly equal: `layoutGraph` snaps every
    // position to `LAYOUT_GRID` after centring the diagram on the origin, so
    // an exact match would be asserting that the snap happens to be a no-op.
    assert.ok(
      Math.abs(gap - RANK_GAP) <= LAYOUT_GRID,
      `a chain keeps the rank gap it has today (got ${gap}, want ${RANK_GAP})`,
    );
  }
}

function checkLongChainStaysInsideTheCoordinateBudget(): void {
  const nodes = Array.from({ length: 40 }, (_, i) => makeNode(`n${i}`));
  const edges = Array.from({ length: 39 }, (_, i) =>
    makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, ""),
  );
  const xs = applyLayout(nodes, edges).nodes.flatMap((node) => [
    node.position.x,
    node.position.x + (node.width ?? 0),
  ]);

  assert.ok(
    Math.max(...xs) <= 10000 && Math.min(...xs) >= -10000,
    "a 40-node chain — the widest the compact contract allows — stays representable",
  );
}

/** Whether two axis-aligned segments cross. Shared endpoints are not crossings. */
function segmentsIntersect(
  a1: RoutePoint,
  a2: RoutePoint,
  b1: RoutePoint,
  b2: RoutePoint,
): boolean {
  const span = (p: number, q: number) => [Math.min(p, q), Math.max(p, q)] as const;
  const [axMin, axMax] = span(a1.x, a2.x);
  const [ayMin, ayMax] = span(a1.y, a2.y);
  const [bxMin, bxMax] = span(b1.x, b2.x);
  const [byMin, byMax] = span(b1.y, b2.y);

  const ixMin = Math.max(axMin, bxMin);
  const ixMax = Math.min(axMax, bxMax);
  const iyMin = Math.max(ayMin, byMin);
  const iyMax = Math.min(ayMax, byMax);

  if (ixMin > ixMax || iyMin > iyMax) {
    return false;
  }

  // A region rather than a point: either a perpendicular crossing with real
  // extent, or two collinear runs lying on top of each other. Both count.
  if (ixMax > ixMin || iyMax > iyMin) {
    return true;
  }

  // A single shared point. Two routes meeting where they are built to meet —
  // the trunk they both leave, the target they both arrive at — is not a
  // crossing. A single point anywhere else is one.
  const at = { x: ixMin, y: iyMin };
  const isEndpointOf = (p: RoutePoint, s1: RoutePoint, s2: RoutePoint) =>
    (p.x === s1.x && p.y === s1.y) || (p.x === s2.x && p.y === s2.y);

  return !(isEndpointOf(at, a1, a2) && isEndpointOf(at, b1, b2));
}

/** Every route in the graph, keyed by edge id, built the way the renderer builds them. */
function routeEveryEdge(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): Map<string, EdgeRoute> {
  const boxes = new Map(nodes.map((node) => [node.id, toBox(node)]));
  const parallelKey = (edge: CanvasEdge) =>
    `${edge.source} ${edge.target} ${edge.sourceHandle} ${edge.targetHandle}`;

  const groups = new Map<string, string[]>();

  for (const edge of edges) {
    const key = parallelKey(edge);

    groups.set(key, [...(groups.get(key) ?? []), edge.id].sort());
  }

  const routes = new Map<string, EdgeRoute>();

  for (const edge of edges) {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);

    if (!edge.sourceHandle || !edge.targetHandle || !source || !target) {
      continue;
    }

    const group = groups.get(parallelKey(edge))!;

    routes.set(
      edge.id,
      buildEdgeRoute({
        source: handleAnchor(source, edge.sourceHandle),
        target: handleAnchor(target, edge.targetHandle),
        lane: edge.data?.lane ?? 0,
        parallelIndex: group.indexOf(edge.id),
        parallelCount: group.length,
      }),
    );
  }

  return routes;
}

function checkNoBundleCrossesItself(): void {
  // A hub fanning out above and below, plus a parallel pair, is the shape the
  // whole design exists for.
  const nodes = [makeNode("hub"), ...Array.from({ length: 5 }, (_, i) => makeNode(`t${i}`))];
  const edges = [
    ...Array.from({ length: 5 }, (_, i) => makeEdge(`e${i}`, "hub", `t${i}`, `label ${i}`)),
    makeEdge("dup", "hub", "t0", "second relationship"),
  ];

  const laidOut = applyLayout(nodes, edges);
  const routes = routeEveryEdge(laidOut.nodes, laidOut.edges);
  const bundles = new Map<string, CanvasEdge[]>();

  for (const edge of laidOut.edges) {
    const key = `${edge.source} ${edge.sourceHandle}`;

    bundles.set(key, [...(bundles.get(key) ?? []), edge]);
  }

  for (const [key, members] of bundles) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = routes.get(members[i].id);
        const right = routes.get(members[j].id);

        if (!left || !right) {
          continue;
        }

        // Two routes are only required to be disjoint where they are actually
        // apart. They share a head by construction — the trunk every member of
        // a bundle leaves along — and they share a tail whenever they converge
        // on one handle, which is the same thing mirrored at the target. Both
        // are structure, not crossings. Everything between them is the part the
        // routing is actually claiming keeps its distance.
        const commonHead = (() => {
          let k = 0;
          while (
            k < left.points.length &&
            k < right.points.length &&
            left.points[k].x === right.points[k].x &&
            left.points[k].y === right.points[k].y
          ) {
            k += 1;
          }
          return k;
        })();

        const commonTail = (() => {
          let k = 0;
          while (
            k < left.points.length - commonHead &&
            k < right.points.length - commonHead &&
            left.points[left.points.length - 1 - k].x ===
              right.points[right.points.length - 1 - k].x &&
            left.points[left.points.length - 1 - k].y ===
              right.points[right.points.length - 1 - k].y
          ) {
            k += 1;
          }
          return k;
        })();

        // Loop bounds exclude the shared trunk (segment 0) and the shared tail
        // (final approach to target). Bundle members always share at least the
        // source anchor (commonHead >= 1), so Math.max(1, commonHead - 1) = 1,
        // which keeps segment 0 out of the comparison. Everything between the
        // divergent middle is where the routing claims to keep distance.
        const startA = Math.max(1, commonHead - 1);
        const endA = left.points.length - 1 - Math.max(0, commonTail - 1);
        const startB = Math.max(1, commonHead - 1);
        const endB = right.points.length - 1 - Math.max(0, commonTail - 1);

        for (let a = startA; a < endA; a += 1) {
          for (let b = startB; b < endB; b += 1) {
            assert.ok(
              !segmentsIntersect(
                left.points[a],
                left.points[a + 1],
                right.points[b],
                right.points[b + 1],
              ),
              `${key}: ${members[i].id} segment ${a} crosses ${members[j].id} segment ${b}`,
            );
          }
        }
      }
    }
  }
}

function checkNoTwoLabelsCollide(): void {
  // Two sources in one rank, each with a parallel pair to the same target:
  // the defect case where edgeSplitX (column from anchor.x) and per-source
  // lane numbering cause lane 0 of one bundle to occupy the same column as
  // lane 0 of the next.
  const nodes = [makeNode("identity"), makeNode("provider"), makeNode("postgres"), makeNode("redis")];
  const edges = [
    makeEdge("i1", "identity", "postgres", "users"),
    makeEdge("i2", "identity", "postgres", "sessions"),
    makeEdge("p1", "provider", "postgres", "OAuth + refresh"),
    makeEdge("p2", "provider", "postgres", "encrypted tokens"),
    makeEdge("p3", "provider", "redis", "token cache"),
  ];

  const laidOut = applyLayout(nodes, edges);
  const routes = routeEveryEdge(laidOut.nodes, laidOut.edges);
  const anchors = [...routes.entries()];

  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const [leftId, left] = anchors[i];
      const [rightId, right] = anchors[j];
      const apart =
        Math.abs(left.labelPoint.x - right.labelPoint.x) >= EDGE_LABEL_CLEARANCE.width ||
        Math.abs(left.labelPoint.y - right.labelPoint.y) >= EDGE_LABEL_CLEARANCE.height;

      assert.ok(apart, `${leftId} and ${rightId} put their label pills on top of each other`);
    }
  }
}

function main() {
  checkLabelsDoNotWidenTheLayout();
  checkLayoutClearsOverlapsAndSnapsToGrid();
  checkAcyclicEdgesRunLeftToRight();
  checkLayoutIsDeterministic();
  checkLayoutDoesNotMutateInputs();
  checkChooseHandlesFollowsTheFlowDirection();
  checkApplyLayoutStampsHandlesFromGeometry();
  checkEmptyGraph();
  checkDanglingEdgeReferenceIsSkippedNotInvented();
  checkSelfLoopIsSkippedInLayoutButKeptOnTheCanvas();
  checkDisconnectedNodeIsPlacedCleanly();
  checkLabelledEdgeReservesClearanceBetweenNodes();
  checkLaneOrderPutsTheLongestTravelClosestToTheSource();
  checkLaneOrderIgnoresDirectionAndBreaksTiesStably();
  checkSplitColumnStaggersByLaneAndFollowsTheFlow();
  checkNonParallelRouteIsTrunkThenTurn();
  checkFlatRouteKeepsItsLabelOffTheNodeFace();
  checkParallelGroupBowsToItsOwnLane();
  checkOrthogonalPathRoundsCornersAndDropsCollinearPoints();
  checkCloseSpanParallelForwardDoesNotOvershoot();
  checkCloseSpanParallelBackwardDoesNotOvershoot();
  checkSlopedButUnderThresholdRouteKeepsLabelOnSegment();
  checkDedupeDropsIdenticalTriplesOnlyWhenAsked();
  checkApplyLayoutStampsLanesOnSideToSideEdgesOnly();
  checkVerticalHandleEdgeIsLeftOutOfEveryBundle();
  checkWideBundleGetsRoomForItsLabelsAndStaysInBudget();
  checkSingleEdgeBundlesLayOutExactlyAsBefore();
  checkLongChainStaysInsideTheCoordinateBudget();
  checkNoBundleCrossesItself();
  checkNoTwoLabelsCollide();
  console.log(
    "✅ Graph layout: no overlaps, grid-aligned, deterministic, acyclic rank order, handle geometry, edge dedupe, lane ordering, non-crossing bundles, label separation, computed rank gaps and edge cases verified",
  );
}

try {
  main();
} catch (error) {
  console.error("❌ Graph layout verification failed");
  console.error(error);
  process.exitCode = 1;
}
