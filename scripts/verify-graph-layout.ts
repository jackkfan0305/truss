import assert from "node:assert/strict";

import { applyLayout, chooseHandles, layoutGraph } from "../lib/graph-layout";
import {
  FAN_STEP,
  LAYOUT_GRID,
  MIN_NODE_GAP,
  edgeTurnX,
  fanOffset,
  fanSlotIndex,
  laneOrder,
  edgeSplitX,
  toBox,
  buildEdgeRoute,
  parallelLaneY,
  orthogonalPath,
  type Box,
} from "../lib/canvas-geometry";
import {
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  NODE_DEFAULT_SIZES,
  EDGE_LABEL_CLEARANCE,
  TRUNK_MIN,
  LANE_STEP,
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

/**
 * The claim `edgeTurnX` rests on: an edge that skips ranks turns in a corridor
 * no node occupies.
 *
 * `getSmoothStepPath` would otherwise turn at the midpoint between the two
 * endpoints, which for a multi-rank span sits inside an intervening rank — the
 * vertical run drawn down a column of nodes, the label pill on top of one. The
 * fixture is a four-rank chain plus a `a → d` edge that jumps all three.
 */
function checkLongEdgeTurnsInACorridorNoNodeOccupies(): void {
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
  const edges = [
    makeEdge("a-b", "a", "b"),
    makeEdge("b-c", "b", "c"),
    makeEdge("c-d", "c", "d"),
    makeEdge("a-d", "a", "d", "skips the middle"),
  ];

  const laidOut = layoutGraph(nodes, edges);
  const boxes = new Map(laidOut.map((node) => [node.id, toBox(node)]));
  const a = boxes.get("a")!;
  const d = boxes.get("d")!;

  // The handle coordinates React Flow hands the renderer: right face of the
  // source, left face of the target.
  const turn = edgeTurnX(a.x + a.width, d.x);

  assert.ok(
    turn !== undefined,
    "an edge spanning three ranks turns at the corridor, not at its midpoint",
  );

  const midpoint = (a.x + a.width + d.x) / 2;
  assert.ok(
    turn! < midpoint,
    `the turn at ${turn} is short of the ${midpoint} midpoint the default would use`,
  );

  for (const [id, box] of boxes) {
    assert.ok(
      turn! <= box.x || turn! >= box.x + box.width,
      `the turn at ${turn} is clear of ${id}, which spans x ${box.x}..${box.x + box.width}`,
    );
  }
}

/** A same-rank edge has no corridor to aim for, so it keeps the midpoint. */
function checkSameRankEdgeKeepsTheMidpointTurn(): void {
  assert.equal(
    edgeTurnX(500, 500),
    undefined,
    "an edge running up or down its own column falls back to the default turn",
  );
}

/** A back-edge turns into the corridor on its own side, not past the target. */
function checkBackEdgeTurnsBackwards(): void {
  const forward = edgeTurnX(0, 1000);
  const backward = edgeTurnX(1000, 0);

  assert.ok(forward !== undefined && forward > 0, "a forward edge turns to the right of its source");
  assert.ok(
    backward !== undefined && backward < 1000,
    "a back-edge turns to the left of its source",
  );
  assert.equal(
    1000 - backward!,
    forward!,
    "both directions turn the same distance out from the source",
  );
}

/**
 * The fan that keeps several edges off one handle's single pixel.
 *
 * Two claims worth pinning: the slots stay inside the face however many edges
 * crowd onto it, and they come out in the order the lines leave so the fan does
 * not cross itself the moment it clears the node.
 */
function checkFanSpreadsEdgesWithoutLeavingTheFace(): void {
  assert.equal(fanOffset(0, 1, 80), 0, "a lone edge stays on its handle");

  // Room to spare: neighbours get the full label-height step, centred on the
  // handle rather than growing off one side of it.
  const roomy = [0, 1, 2].map((index) => fanOffset(index, 3, 200));
  assert.deepEqual(
    roomy,
    [-FAN_STEP, 0, FAN_STEP],
    "three edges on a tall face sit a label-height apart, centred on the handle",
  );

  // The measured worst case on a real diagram: five edges on an 80-unit face.
  // 4 * FAN_STEP is 96, which does not fit, so the fan gives the room up
  // evenly instead of hanging the outer two off the node's corners.
  const crowded = [0, 1, 2, 3, 4].map((index) => fanOffset(index, 5, 80));
  const faceHalf = 80 / 2;

  for (const offset of crowded) {
    assert.ok(
      Math.abs(offset) < faceHalf,
      `a crowded fan stays on the face: ${offset} is inside ±${faceHalf}`,
    );
  }
  assert.ok(
    crowded[1]! - crowded[0]! < FAN_STEP,
    "and gets there by shrinking the step, not by clipping slots",
  );
  // `+ 0` normalises the `-0` that negating the middle slot produces: equal to
  // `0` under `===` but not under `deepStrictEqual`, the same trap `assertOnGrid`
  // documents above.
  assert.deepEqual(
    crowded.map((offset) => -offset + 0).reverse(),
    crowded.map((offset) => offset + 0),
    "a fan is symmetric about its handle",
  );

  // Slot order is fixed, not geometric. Sorting by where each edge's far end
  // sits reads better at rest, but the comparator is then recomputed from live
  // positions: dragging one node past another flips it and two edges swap
  // slots in a single jump of twice FAN_STEP, labels and all. A stable order
  // lets the lines cross instead of snapping.
  const members = ["c-edge", "a-edge", "b-edge"];

  assert.deepEqual(
    members.map((id) => fanSlotIndex(members, id)),
    [2, 0, 1],
    "slots follow edge id, not the order the edges arrive in",
  );
  assert.deepEqual(
    ["b-edge", "c-edge", "a-edge"].map((id) => fanSlotIndex(members, id)),
    [1, 2, 0],
    "and do not depend on how the member list happens to be ordered",
  );

  assert.equal(
    fanSlotIndex(members, "not-here"),
    0,
    "an edge missing from its own group falls back to the handle's centre slot",
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
  checkLongEdgeTurnsInACorridorNoNodeOccupies();
  checkSameRankEdgeKeepsTheMidpointTurn();
  checkBackEdgeTurnsBackwards();
  checkFanSpreadsEdgesWithoutLeavingTheFace();
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
  console.log(
    "✅ Graph layout: no overlaps, grid-aligned, deterministic, acyclic rank order, handle geometry, corridor turns, handle fan-out, lane ordering, split column positioning, orthogonal edge routes with parallel bows, edge deduplication, defect-2 fixes verified",
  );
}

try {
  main();
} catch (error) {
  console.error("❌ Graph layout verification failed");
  console.error(error);
  process.exitCode = 1;
}
