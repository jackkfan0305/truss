import assert from "node:assert/strict";

import { drawNodesThenEdges, planCanvasReplay, type CanvasAddTarget } from "../lib/canvas-replay";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { AI_CURSOR_ARRIVAL_PAD_MS, AI_CURSOR_SWEEP_MS, getBuildStepMs } from "../types/tasks";
import { CANVAS_EDGE_TYPE, CANVAS_NODE_TYPE, type CanvasEdge, type CanvasNode } from "../types/canvas";

function node(id: string, x = 0, label = id): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y: 0 },
    data: { label, color: "neutral", shape: "rectangle" },
  } as CanvasNode;
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, type: CANVAS_EDGE_TYPE, source, target, data: { label: "" } } as CanvasEdge;
}

function checkPlanSplitsAdditionsFromTheRest() {
  const current: CanvasSnapshot = {
    nodes: [node("keep"), node("gone"), node("moved")],
    edges: [edge("keep-to-gone", "keep", "gone")],
  };
  const remote: CanvasSnapshot = {
    nodes: [node("keep", 0, "Renamed"), node("moved", 400), node("new", 280)],
    edges: [edge("keep-to-new", "keep", "new")],
  };

  const plan = planCanvasReplay(current, remote);

  assert.deepEqual(plan.base.nodes.map((n) => [n.id, n.data.label, n.position.x]), [
    ["keep", "Renamed", 0],
    ["moved", "moved", 400],
  ], "updates and removals land at once, in the remote's form");
  assert.deepEqual(plan.base.edges, [], "an edge to a removed node goes with it");
  assert.deepEqual(plan.addedNodes.map((n) => n.id), ["new"]);
  assert.deepEqual(plan.addedEdges.map((e) => e.id), ["keep-to-new"]);
}

function checkAnExistingEdgeRetargetedToANewNodeWaitsForIt() {
  const plan = planCanvasReplay(
    { nodes: [node("a"), node("b")], edges: [edge("e", "a", "b")] },
    { nodes: [node("a"), node("b"), node("c")], edges: [edge("e", "a", "c")] },
  );

  assert.deepEqual(plan.base.edges, []);
  assert.deepEqual(plan.addedEdges.map((e) => e.id), ["e"], "it is redrawn once its target exists");
}

async function checkNodesThenEdgesWithTheCursorFirst() {
  const plan = planCanvasReplay(
    { nodes: [node("client")], edges: [] },
    { nodes: [node("client"), node("orders", 280)], edges: [edge("client-to-orders", "client", "orders")] },
  );
  const events: string[] = [];
  const target: CanvasAddTarget = {
    addNodes: (nodes) => events.push(...nodes.map((n) => `node:${n.id}`)),
    addEdges: (edges) => events.push(...edges.map((e) => `edge:${e.id}`)),
  };

  await drawNodesThenEdges(plan, target, {
    moveCursor: (cursor) => events.push(`cursor:${cursor.x},${cursor.y}`),
    clearCursor: () => events.push("clear"),
    sleep: async (ms) => {
      events.push(`delay:${ms}`);
    },
  });

  const arrive = `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`;
  const step = `delay:${getBuildStepMs(2)}`;
  assert.deepEqual(events, [
    "cursor:280,0", arrive, "node:orders", step,
    "cursor:280,0", arrive, "edge:client-to-orders", step,
    "clear",
  ], "the cursor reaches each item before it lands, and leaves at the end");
}

async function checkTheCursorClearsWhenAStepThrows() {
  const plan = planCanvasReplay({ nodes: [], edges: [] }, { nodes: [node("a")], edges: [] });
  let cleared = false;

  await assert.rejects(
    drawNodesThenEdges(
      plan,
      { addNodes: () => { throw new Error("unmounted"); }, addEdges: () => undefined },
      { moveCursor: () => undefined, clearCursor: () => { cleared = true; }, sleep: async () => undefined },
    ),
  );
  assert.equal(cleared, true);
}

void (async () => {
  checkPlanSplitsAdditionsFromTheRest();
  checkAnExistingEdgeRetargetedToANewNodeWaitsForIt();
  await checkNodesThenEdgesWithTheCursorFirst();
  await checkTheCursorClearsWhenAStepThrows();
  console.log("✅ canvas replay verified");
})();
