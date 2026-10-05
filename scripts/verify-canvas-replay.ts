import assert from "node:assert/strict";

import { planCanvasEdits, playCanvasEdits, type CanvasEditTarget } from "../lib/canvas-replay";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { AI_CURSOR_ARRIVAL_PAD_MS, AI_CURSOR_SWEEP_MS, AI_EDIT_HOLD_MS } from "../types/tasks";
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

/** Applies edits to a plain snapshot, the way the canvas applies them to flow state. */
function snapshotTarget(snapshot: CanvasSnapshot): CanvasEditTarget {
  return {
    setNodes: (update) => { snapshot.nodes = update(snapshot.nodes); },
    setEdges: (update) => { snapshot.edges = update(snapshot.edges); },
  };
}

const noDelays = { showAgent: () => undefined, clearAgent: () => undefined, sleep: async () => undefined };

function checkEveryChangeIsItsOwnEditInOrder() {
  const current: CanvasSnapshot = {
    nodes: [node("keep"), node("gone"), node("same", 50)],
    edges: [edge("keep-to-gone", "keep", "gone"), edge("keep-to-same", "keep", "same")],
  };
  const remote: CanvasSnapshot = {
    // `selected` and `measured` are flow state, not a change the agent made.
    nodes: [node("keep", 0, "Renamed"), { ...node("same", 50), selected: true } as CanvasNode, node("new", 280)],
    edges: [edge("keep-to-same", "keep", "same"), edge("keep-to-new", "keep", "new")],
  };

  const edits = planCanvasEdits(current, remote);

  assert.deepEqual(
    edits.map((e) => `${e.removes ? "remove" : "put"}:${e.kind}:${e.id}`),
    ["remove:edge:keep-to-gone", "remove:node:gone", "put:node:keep", "put:node:new", "put:edge:keep-to-new"],
    "removals, then nodes, then edges; unchanged items are not edits",
  );
}

async function checkPlayingTheEditsLandsOnTheRemote() {
  const current: CanvasSnapshot = {
    nodes: [node("a"), node("b"), node("c")],
    edges: [edge("e", "a", "b"), edge("f", "b", "c")],
  };
  const remote: CanvasSnapshot = {
    nodes: [node("a", 0, "A"), node("b"), node("d", 400)],
    edges: [edge("e", "a", "d")],
  };
  const flow = structuredClone(current);

  await playCanvasEdits(planCanvasEdits(current, remote), snapshotTarget(flow), noDelays);

  const ids = (s: CanvasSnapshot) => [s.nodes.map((n) => [n.id, n.data.label]), s.edges.map((e) => [e.id, e.target])];
  assert.deepEqual(ids(flow), ids(remote));
}

async function checkTheCursorArrivesThenTheEditHoldsFor200ms() {
  const events: string[] = [];
  const current: CanvasSnapshot = { nodes: [node("client"), node("old", 90)], edges: [] };
  const remote: CanvasSnapshot = {
    nodes: [node("client"), node("orders", 280)],
    edges: [edge("client-to-orders", "client", "orders")],
  };
  const flow = structuredClone(current);
  const target = snapshotTarget(flow);

  await playCanvasEdits(planCanvasEdits(current, remote), {
    setNodes: (update) => { target.setNodes(update); events.push(`nodes:${flow.nodes.map((n) => n.id)}`); },
    setEdges: (update) => { target.setEdges(update); events.push(`edges:${flow.edges.map((e) => e.id)}`); },
  }, {
    showAgent: (cursor, editing) => events.push(`agent:${cursor.x}:${editing ? editing.id : "-"}`),
    clearAgent: () => events.push("clear"),
    sleep: async (ms) => { events.push(`delay:${ms}`); },
  });

  const arrive = `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`;
  const hold = `delay:${AI_EDIT_HOLD_MS}`;
  assert.equal(AI_EDIT_HOLD_MS, 200);
  assert.deepEqual(events, [
    // A removal is lit while it is still there, then goes.
    "agent:90:-", arrive, "agent:90:old", hold, "nodes:client",
    "agent:280:-", arrive, "agent:280:orders", "nodes:client,orders", hold,
    "agent:280:-", arrive, "agent:280:client-to-orders", "edges:client-to-orders", hold,
    "clear",
  ]);
}

async function checkTheAgentClearsWhenAnEditThrows() {
  const edits = planCanvasEdits({ nodes: [], edges: [] }, { nodes: [node("a")], edges: [] });
  let cleared = false;

  await assert.rejects(
    playCanvasEdits(
      edits,
      { setNodes: () => { throw new Error("unmounted"); }, setEdges: () => undefined },
      { ...noDelays, clearAgent: () => { cleared = true; } },
    ),
  );
  assert.equal(cleared, true);
}

void (async () => {
  checkEveryChangeIsItsOwnEditInOrder();
  await checkPlayingTheEditsLandsOnTheRemote();
  await checkTheCursorArrivesThenTheEditHoldsFor200ms();
  await checkTheAgentClearsWhenAnEditThrows();
  console.log("✅ canvas replay verified");
})();
