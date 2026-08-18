import assert from "node:assert/strict";

import { canvasFingerprint, materializeAgentGraph } from "../lib/agent-graph";
import {
  handleAgentGraphEditPost,
  type AgentGraphEditDependencies,
} from "../lib/agent-graph-edit-server";
import type { AgentCanvasFlow } from "../lib/agent-canvas-write";
import type { CanvasEdge, CanvasNode } from "../types/canvas";

function n(id: string, label = "Node", x = 0, y = 0) {
  return { id, label, shape: "rectangle" as const, color: "neutral" as const, x, y };
}

function makeFlow(nodes: CanvasNode[], edges: CanvasEdge[]) {
  const state = { nodes: [...nodes], edges: [...edges] };
  const flow: AgentCanvasFlow = {
    get nodes() {
      return state.nodes;
    },
    get edges() {
      return state.edges;
    },
    addNodes: (added) => {
      state.nodes = [...state.nodes, ...added];
    },
    addEdges: (added) => {
      state.edges = [...state.edges, ...added];
    },
    updateNode: (id, partial) => {
      state.nodes = state.nodes.map((node) =>
        node.id === id ? ({ ...node, ...partial } as CanvasNode) : node,
      );
    },
    updateEdge: (id, partial) => {
      state.edges = state.edges.map((edge) =>
        edge.id === id ? ({ ...edge, ...partial } as CanvasEdge) : edge,
      );
    },
    removeNodes: (ids) => {
      state.nodes = state.nodes.filter((node) => !ids.includes(node.id));
    },
    removeEdges: (ids) => {
      state.edges = state.edges.filter((edge) => !ids.includes(edge.id));
    },
  };

  return { flow, state };
}

function deps(
  flow: AgentCanvasFlow,
  saved: { snapshot?: unknown },
): AgentGraphEditDependencies {
  return {
    authorizeProject: async () => ({
      ok: true as const,
      role: "owner" as const,
      userId: "u1",
      ownerId: "u1",
    }),
    mutateFlow: async (
      _projectId: string,
      callback: (f: AgentCanvasFlow) => void | Promise<void>,
    ) => {
      await callback(flow);
    },
    saveCanvasSnapshot: async (_projectId: string, snapshot: unknown) => {
      saved.snapshot = snapshot;
    },
    setAiPresence: async () => {},
    clearAiPresence: async () => {},
    sleep: async () => {},
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function checkMatchingFingerprintAppliesTheDelta(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web"), n("db", "DB", 280, 0)], edges: [] },
    }),
    "p1",
    deps(flow, saved),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.nodes.map((node) => node.id).sort(), ["db", "web"]);
  assert.ok(saved.snapshot, "the applied snapshot is persisted");
}

async function checkStaleFingerprintMutatesNothing(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: "0".repeat(64),
      graph: { version: 1, nodes: [n("web"), n("db")], edges: [] },
    }),
    "p1",
    deps(flow, saved),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(
    state.nodes.map((node) => node.id),
    ["web"],
    "no flow mutation happens on a stale fingerprint",
  );
  assert.equal(saved.snapshot, undefined, "no persistence happens on a stale fingerprint");
}

async function checkRemovalOfASeenNodeIsApplied(): Promise<void> {
  const start = materializeAgentGraph({
    version: 1,
    nodes: [n("web"), n("db", "DB", 280, 0)],
    edges: [],
  });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web")], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.nodes.map((node) => node.id), ["web"]);
}

async function checkRemovalOfASeenEdgeLeavesItsNodesIntact(): Promise<void> {
  const start = materializeAgentGraph({
    version: 1,
    nodes: [n("web"), n("db", "DB", 280, 0)],
    edges: [{ id: "web-to-db", source: "web", target: "db", label: "" }],
  });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web"), n("db", "DB", 280, 0)], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.edges, [], "the edge is removed");
  assert.deepEqual(
    state.nodes.map((node) => node.id).sort(),
    ["db", "web"],
    "both nodes survive the edge-only removal",
  );
}

async function checkLabelOnlyUpdateLeavesPositionAlone(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web", "Web", 40, 60)], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web", "Web Server", 40, 60)], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].data.label, "Web Server");
  assert.deepEqual(
    state.nodes[0].position,
    { x: 40, y: 60 },
    "position is untouched by a label-only update",
  );
}

async function checkPositionOnlyUpdateLeavesLabelAlone(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web", "Web", 40, 60)], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web", "Web", 500, 320)], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.equal(state.nodes.length, 1);
  assert.deepEqual(state.nodes[0].position, { x: 500, y: 320 });
  assert.equal(state.nodes[0].data.label, "Web", "label is untouched by a position-only update");
}

async function checkEmptyDesiredGraphEmptiesTheCanvas(): Promise<void> {
  const start = materializeAgentGraph({
    version: 1,
    nodes: [n("web"), n("db", "DB", 280, 0)],
    edges: [{ id: "web-to-db", source: "web", target: "db", label: "" }],
  });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [], edges: [] },
    }),
    "p1",
    deps(flow, saved),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.nodes, []);
  assert.deepEqual(state.edges, []);
  assert.ok(saved.snapshot, "the emptied canvas is persisted");
}

async function checkUnseenNodeSurvivesAnEdit(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "Legacy_NODE",
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow, state } = makeFlow([...live.nodes], []);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("web")], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.ok(
    state.nodes.some((node) => node.id === "Legacy_NODE"),
    "a node the agent never saw must survive an edit",
  );
}

// The opaque node's ID is chosen to be a *valid* compact ID that the projection
// still rejects for another reason — an over-long label — so the desired graph
// can legitimately name it and the collision check is what stops the write.
async function checkReusingAnOpaqueIdIsRefusedAndNothingMutates(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "legacy-node",
    data: { label: "x".repeat(81), shape: "rectangle" as const, color: "neutral" as const },
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow, state } = makeFlow([...live.nodes], []);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("web"), n("legacy-node", "Hijacked", 500, 0)], edges: [] },
    }),
    "p1",
    deps(flow, saved),
  );

  assert.equal(response.status, 409);
  assert.equal(
    state.nodes.find((node) => node.id === "legacy-node")?.data.label,
    "x".repeat(81),
    "an opaque node must not be overwritten by an ID collision",
  );
  assert.equal(saved.snapshot, undefined);
}

async function checkNonCollidingIdAlongsideOpaqueNodeStillSucceeds(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "legacy-node",
    data: { label: "y".repeat(81), shape: "rectangle" as const, color: "neutral" as const },
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow, state } = makeFlow([...live.nodes], []);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("web"), n("cache", "Cache", 500, 0)], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.equal(state.nodes.length, 3);
}

async function checkMalformedBodyIs400(): Promise<void> {
  const { flow } = makeFlow([], []);
  const response = await handleAgentGraphEditPost(
    request({ fingerprint: "abc" }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 400);
}

async function checkMutateFlowFailureIs502(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow } = makeFlow([...start.nodes], [...start.edges]);
  const dependencies: AgentGraphEditDependencies = {
    ...deps(flow, {}),
    mutateFlow: async () => {
      throw new Error("Liveblocks write failed");
    },
  };

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web"), n("db")], edges: [] },
    }),
    "p1",
    dependencies,
  );

  assert.equal(response.status, 502);
}

async function checkPersistenceFailureAfterApplyIs502(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);
  const dependencies: AgentGraphEditDependencies = {
    ...deps(flow, {}),
    saveCanvasSnapshot: async () => {
      throw new Error("Blob upload failed");
    },
  };

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web"), n("db")], edges: [] },
    }),
    "p1",
    dependencies,
  );

  assert.equal(response.status, 502);
  assert.deepEqual(
    state.nodes.map((node) => node.id).sort(),
    ["db", "web"],
    "the flow write already landed even though persistence failed",
  );
}

/**
 * Removing a node must take every edge anchored to it, opaque ones included.
 *
 * `removeNodes` is a per-ID map delete that does not cascade, and the diff can
 * only name edges the agent could see. Without the sweep in `applyDiff`, this
 * opaque self-loop would outlive its own node, pointing at an ID that no longer
 * exists — and since opaque items are invisible to every future diff, nothing
 * could ever remove it. Permanent corruption, and it renders as a working edit.
 */
async function checkRemovingANodeTakesItsOpaqueEdges(): Promise<void> {
  const start = materializeAgentGraph({
    version: 1,
    nodes: [n("web"), n("db", "DB", 280, 0)],
    edges: [],
  });
  // Self-loops are rejected by the compact schema, so this edge is opaque.
  const selfLoop = {
    id: "web-self-loop",
    type: "canvasEdge",
    source: "web",
    target: "web",
    data: { label: "retry" },
  } as CanvasEdge;
  const live = { nodes: [...start.nodes], edges: [selfLoop] };
  const { flow, state } = makeFlow([...live.nodes], [...live.edges]);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("db", "DB", 280, 0)], edges: [] },
    }),
    "p1",
    deps(flow, saved),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.nodes.map((node) => node.id), ["db"]);
  assert.deepEqual(
    state.edges.map((edge) => edge.id),
    [],
    "an opaque edge anchored to a removed node must go with it",
  );
}

/**
 * The persisted snapshot is the post-mutation room, not the requested graph.
 *
 * Persisting the request would erase every opaque item from the saved snapshot
 * while they still exist in the room — invisible until the next restore silently
 * dropped them.
 */
async function checkPersistedSnapshotKeepsOpaqueItems(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "Legacy_NODE",
    data: { label: "hand made", shape: "rectangle" as const, color: "neutral" as const },
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow } = makeFlow([...live.nodes], []);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("web"), n("cache", "Cache", 500, 0)], edges: [] },
    }),
    "p1",
    deps(flow, saved),
  );

  assert.equal(response.status, 200);

  const snapshot = saved.snapshot as { nodes: CanvasNode[] } | undefined;

  assert.ok(snapshot, "a successful apply persists");
  assert.deepEqual(
    snapshot.nodes.map((node) => node.id).sort(),
    ["Legacy_NODE", "cache", "web"],
    "the persisted snapshot is the live room, opaque items included",
  );
}

/** A denied caller never reaches body parsing, so it cannot probe validation. */
async function checkAuthorizationPrecedesBodyParsing(): Promise<void> {
  const { flow, state } = makeFlow([], []);
  let bodyWasRead = false;

  const probe = new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint: "0".repeat(64), graph: { version: 1, nodes: [], edges: [] } }),
  });
  const guarded = new Proxy(probe, {
    get(target, property, receiver) {
      if (property === "json" || property === "text") {
        bodyWasRead = true;
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const response = await handleAgentGraphEditPost(guarded, "p1", {
    ...deps(flow, {}),
    authorizeProject: async () => ({
      ok: false as const,
      response: new Response("Forbidden", { status: 403 }),
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(bodyWasRead, false, "the body must not be read before authorization");
  assert.deepEqual(state.nodes, []);
}

async function main(): Promise<void> {
  await checkMatchingFingerprintAppliesTheDelta();
  await checkRemovingANodeTakesItsOpaqueEdges();
  await checkPersistedSnapshotKeepsOpaqueItems();
  await checkAuthorizationPrecedesBodyParsing();
  await checkStaleFingerprintMutatesNothing();
  await checkRemovalOfASeenNodeIsApplied();
  await checkRemovalOfASeenEdgeLeavesItsNodesIntact();
  await checkLabelOnlyUpdateLeavesPositionAlone();
  await checkPositionOnlyUpdateLeavesLabelAlone();
  await checkEmptyDesiredGraphEmptiesTheCanvas();
  await checkUnseenNodeSurvivesAnEdit();
  await checkReusingAnOpaqueIdIsRefusedAndNothingMutates();
  await checkNonCollidingIdAlongsideOpaqueNodeStillSucceeds();
  await checkMalformedBodyIs400();
  await checkMutateFlowFailureIs502();
  await checkPersistenceFailureAfterApplyIs502();

  console.log("verify-agent-graph-edit: ok");
}

void main();
