import assert from "node:assert/strict";

import { applyLayout, chooseHandles, layoutGraph } from "../lib/graph-layout";
import { LAYOUT_GRID, MIN_NODE_GAP, toBox, type Box } from "../lib/canvas-geometry";
import {
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  NODE_DEFAULT_SIZES,
  EDGE_LABEL_CLEARANCE,
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
function checkChooseHandlesPicksTheDominantAxis(): void {
  const base: Box = { x: 0, y: 0, width: 100, height: 50 };

  assert.deepEqual(
    chooseHandles(base, { ...base, x: 300 }),
    { sourceHandle: "right", targetHandle: "left" },
    "target far to the right connects right-to-left",
  );
  assert.deepEqual(
    chooseHandles(base, { ...base, x: -300 }),
    { sourceHandle: "left", targetHandle: "right" },
    "target far to the left connects left-to-right",
  );
  assert.deepEqual(
    chooseHandles(base, { ...base, y: 300 }),
    { sourceHandle: "bottom", targetHandle: "top" },
    "target far below connects bottom-to-top",
  );
  assert.deepEqual(
    chooseHandles(base, { ...base, y: -300 }),
    { sourceHandle: "top", targetHandle: "bottom" },
    "target far above connects top-to-bottom",
  );

  // A tall node beside a short one: centres are mostly vertically offset, but
  // the clear space between the rectangles is almost entirely horizontal.
  const tall: Box = { x: 0, y: 0, width: 50, height: 400 };
  const shortBeside: Box = { x: 200, y: 350, width: 50, height: 50 };

  assert.deepEqual(
    chooseHandles(tall, shortBeside),
    { sourceHandle: "right", targetHandle: "left" },
    "a tall node beside a short one still reads as horizontal",
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

function main() {
  checkLabelsDoNotWidenTheLayout();
  checkLayoutClearsOverlapsAndSnapsToGrid();
  checkAcyclicEdgesRunLeftToRight();
  checkLayoutIsDeterministic();
  checkLayoutDoesNotMutateInputs();
  checkChooseHandlesPicksTheDominantAxis();
  checkApplyLayoutStampsHandlesFromGeometry();
  checkEmptyGraph();
  checkDanglingEdgeReferenceIsSkippedNotInvented();
  checkSelfLoopIsSkippedInLayoutButKeptOnTheCanvas();
  checkDisconnectedNodeIsPlacedCleanly();
  checkLabelledEdgeReservesClearanceBetweenNodes();
  console.log(
    "✅ Graph layout: no overlaps, grid-aligned, deterministic, acyclic rank order, handle geometry and edge cases verified",
  );
}

try {
  main();
} catch (error) {
  console.error("❌ Graph layout verification failed");
  console.error(error);
  process.exitCode = 1;
}
