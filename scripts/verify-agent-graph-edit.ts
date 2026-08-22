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

/**
 * The app owns layout now, so the only thing that keeps a node's position
 * stable across an edit is the layout itself producing the same answer twice
 * — which it does whenever the graph's structure (ids, edges, shapes) is
 * unchanged. This is no longer a claim about the agent's x/y being honoured.
 */
async function checkLabelOnlyUpdateLeavesPositionAlone(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web", "Web")], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web", "Web Server")], edges: [] },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].data.label, "Web Server");
  assert.deepEqual(
    state.nodes[0].position,
    start.nodes[0].position,
    "position is untouched by a label-only update, because layout of the same graph shape is deterministic",
  );
}

/**
 * THE REGRESSION THIS TASK EXISTS TO PREVENT.
 *
 * The agent re-sends "web" with the exact x/y it already has on the live
 * canvas — the case the old diff (comparing agent-supplied x/y against the
 * live canvas's x/y) would call unchanged and never move. But the edit also
 * adds an upstream node feeding into "web", so the whole graph must re-lay
 * out and "web" has to shift right into rank 1. The fix diffs against the
 * *laid-out* desired graph, not the raw request, so this must still produce a
 * position update despite the identical x/y the agent sent.
 */
async function checkUnchangedCoordinatesStillMoveWhenLayoutWantsThemElsewhere(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web", "Web")], edges: [] });
  const startPosition = start.nodes[0].position;
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: {
        version: 1,
        nodes: [
          n("web", "Web", startPosition.x, startPosition.y),
          n("upstream", "Upstream"),
        ],
        edges: [{ id: "upstream-to-web", source: "upstream", target: "web", label: "" }],
      },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  const web = state.nodes.find((node) => node.id === "web")!;
  assert.notDeepEqual(
    web.position,
    startPosition,
    "layout still relocates a node even though the agent re-sent its old coordinates unchanged",
  );
}

/**
 * `edgesEqual` in `lib/agent-graph-diff.ts` only compares source/target/label,
 * so an edge whose endpoints moved but whose fields are otherwise identical
 * never shows up in `diff.updatedEdges` — yet its handles can be stale once
 * its nodes relocate. `applyDiff` has to catch this itself.
 */
async function checkEdgeHandlesAreRefreshedWhenEndpointsMove(): Promise<void> {
  const start = materializeAgentGraph({
    version: 1,
    nodes: [n("web"), n("db")],
    edges: [{ id: "web-to-db", source: "web", target: "db", label: "" }],
  });
  const originalEdge = start.edges[0];
  assert.ok(originalEdge.sourceHandle, "the initial layout stamps a sourceHandle");
  assert.ok(originalEdge.targetHandle, "the initial layout stamps a targetHandle");

  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  // Adding an upstream predecessor to "web" reranks the whole graph: "db" ends
  // up two ranks over instead of one, which is enough to shift where the edge
  // between "web" and "db" needs to leave from and land on relative to the
  // node in between — a case dagre is free to route differently than the
  // original two-node chain.
  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: {
        version: 1,
        nodes: [n("web"), n("db"), n("upstream")],
        edges: [
          { id: "web-to-db", source: "web", target: "db", label: "" },
          { id: "upstream-to-web", source: "upstream", target: "web", label: "" },
        ],
      },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(response.status, 200);
  const edge = state.edges.find((candidate) => candidate.id === "web-to-db")!;
  assert.equal(edge.sourceHandle, "right", "still a straight left-to-right chain, so still right-to-left");
  assert.equal(edge.targetHandle, "left");

  // Now shrink back to just "web" -> "db": "db" moves back to rank 1, which is
  // the regression case — same two edge endpoints, same handle pairing this
  // graph shape always produces, but only correct if it was actually
  // recomputed rather than left over from the three-node layout above.
  const secondFingerprint = canvasFingerprint({ nodes: [...flow.nodes], edges: [...flow.edges] });
  const secondResponse = await handleAgentGraphEditPost(
    request({
      fingerprint: secondFingerprint,
      graph: {
        version: 1,
        nodes: [n("web"), n("db")],
        edges: [{ id: "web-to-db", source: "web", target: "db", label: "" }],
      },
    }),
    "p1",
    deps(flow, {}),
  );

  assert.equal(secondResponse.status, 200);
  const finalEdge = state.edges.find((candidate) => candidate.id === "web-to-db")!;
  assert.deepEqual(
    { sourceHandle: finalEdge.sourceHandle, targetHandle: finalEdge.targetHandle },
    { sourceHandle: originalEdge.sourceHandle, targetHandle: originalEdge.targetHandle },
    "handles are refreshed back to what the two-node layout calls for, not left stale from the three-node layout",
  );
  assert.deepEqual(
    state.nodes.find((node) => node.id === "db")!.position,
    start.nodes.find((node) => node.id === "db")!.position,
    "db's position is also refreshed back to the original two-node layout",
  );
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
  await checkUnchangedCoordinatesStillMoveWhenLayoutWantsThemElsewhere();
  await checkEdgeHandlesAreRefreshedWhenEndpointsMove();
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
