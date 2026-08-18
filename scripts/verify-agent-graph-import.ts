import assert from "node:assert/strict";

import {
  handleAgentGraphImportPost,
  type AgentGraphImportDependencies,
} from "../lib/agent-graph-import-server";
import { materializeAgentGraph, type AgentGraph } from "../lib/agent-graph";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import {
  AI_CURSOR_ARRIVAL_PAD_MS,
  AI_CURSOR_SWEEP_MS,
  getBuildStepMs,
} from "../types/tasks";
import { AGENT_GRAPH_IMPORT_MAX_DURATION_SECONDS } from "../lib/agent-graph-import-config";

const launchId = "7a4b4d2e-2f28-4f91-8fbc-5622ee2b9451";
const graph: AgentGraph = {
  version: 1,
  nodes: [
    {
      id: "client",
      label: "Client",
      shape: "circle",
      color: "blue",
      x: 0,
      y: 0,
    },
    {
      id: "orders-api",
      label: "Orders API",
      shape: "rectangle",
      color: "teal",
      x: 280,
      y: 0,
    },
  ],
  edges: [
    {
      id: "client-to-orders",
      source: "client",
      target: "orders-api",
      label: "HTTPS",
    },
  ],
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/projects/project-1/agent-launch-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createDependencies(
  canvas: CanvasSnapshot,
  overrides: Partial<AgentGraphImportDependencies> = {},
): {
  dependencies: AgentGraphImportDependencies;
  getMutationCount: () => number;
  getFlowWriteCount: () => number;
  getFlowWrites: () => readonly string[];
  getPersistenceCount: () => number;
  getSavedSnapshots: () => readonly CanvasSnapshot[];
} {
  let mutationCount = 0;
  let flowWriteCount = 0;
  const flowWrites: string[] = [];
  let persistenceCount = 0;
  const savedSnapshots: CanvasSnapshot[] = [];

  return {
    dependencies: {
      authorizeProject: async () => ({
        ok: true,
        role: "owner",
        userId: "user-owner",
        ownerId: "user-owner",
      }),
      mutateFlow: async (_projectId, callback) => {
        mutationCount += 1;
        const flow = {
          nodes: canvas.nodes,
          edges: canvas.edges,
          addNodes: (nodes: typeof canvas.nodes) => {
            flowWriteCount += 1;
            flowWrites.push(...nodes.map((node) => `node:${node.id}`));
            canvas.nodes = [...canvas.nodes, ...nodes];
          },
          addEdges: (edges: typeof canvas.edges) => {
            flowWriteCount += 1;
            flowWrites.push(...edges.map((edge) => `edge:${edge.id}`));
            canvas.edges = [...canvas.edges, ...edges];
          },
          // The import path only ever adds; these satisfy the shared
          // `AgentCanvasFlow` shape and must never be called here.
          updateNode: () => {
            throw new Error("import path must not update nodes");
          },
          updateEdge: () => {
            throw new Error("import path must not update edges");
          },
          removeNodes: () => {
            throw new Error("import path must not remove nodes");
          },
          removeEdges: () => {
            throw new Error("import path must not remove edges");
          },
        };

        await callback(flow);
      },
      saveCanvasSnapshot: async (_projectId, snapshot) => {
        persistenceCount += 1;
        savedSnapshots.push(structuredClone(snapshot));
      },
      setAiPresence: async () => undefined,
      clearAiPresence: async () => undefined,
      sleep: async () => undefined,
      ...overrides,
    },
    getMutationCount: () => mutationCount,
    getFlowWriteCount: () => flowWriteCount,
    getFlowWrites: () => flowWrites,
    getPersistenceCount: () => persistenceCount,
    getSavedSnapshots: () => savedSnapshots,
  };
}

/** A protected endpoint must not reveal parse behavior or consume a body. */
async function checkAuthorizationPrecedesBodyRead(): Promise<void> {
  for (const status of [401, 403]) {
    const protectedRequest = request({ launchId: "not-a-uuid", graph: null });
    const { dependencies, getMutationCount, getPersistenceCount } = createDependencies(
      { nodes: [], edges: [] },
      {
        authorizeProject: async () => ({
          ok: false,
          response: Response.json({ error: "Denied" }, { status }),
        }),
      },
    );

    const response = await handleAgentGraphImportPost(
      protectedRequest,
      "project-1",
      dependencies,
    );

    assert.equal(response.status, status);
    assert.equal(protectedRequest.bodyUsed, false, `${status} returns before reading JSON`);
    assert.equal(getMutationCount(), 0);
    assert.equal(getPersistenceCount(), 0);
  }
}

/** The endpoint is an all-or-nothing graph boundary, including its opaque ID. */
async function checkMalformedRequestsAreRejectedSafely(): Promise<void> {
  const { dependencies, getMutationCount, getPersistenceCount } = createDependencies({
    nodes: [],
    edges: [],
  });

  for (const body of [
    {},
    { launchId: launchId.toUpperCase(), graph },
    {
      launchId,
      graph: {
        ...graph,
        nodes: [{ ...graph.nodes[0], label: "Never expose this graph label", extra: true }],
      },
    },
  ]) {
    const response = await handleAgentGraphImportPost(request(body), "project-1", dependencies);
    assert.equal(response.status, 400);
    const responseBody = await response.json();
    assert.deepEqual(responseBody, { error: "Invalid graph import request" });
    assert.doesNotMatch(JSON.stringify(responseBody), /7a4b4d2e|Never expose/);
  }

  assert.equal(getMutationCount(), 0);
  assert.equal(getPersistenceCount(), 0);
}

/** A new room receives the full canonical snapshot in one flow transaction. */
async function checkEmptyCanvasImportsAndPersistsCanonicalSnapshot(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  const { dependencies, getMutationCount, getFlowWriteCount, getFlowWrites, getPersistenceCount, getSavedSnapshots } =
    createDependencies(canvas);

  const response = await handleAgentGraphImportPost(
    request({ launchId, graph }),
    "project-1",
    dependencies,
  );

  const expected = materializeAgentGraph(graph);
  assert.equal(response.status, 200);
  assert.deepEqual(canvas, expected, "the entire requested graph reaches the empty canvas");
  assert.equal(getMutationCount(), 1, "one mutateFlow transaction imports both nodes and edges");
  assert.equal(getFlowWriteCount(), 3, "each canonical item is added inside that one transaction");
  assert.deepEqual(getFlowWrites(), [
    "node:client",
    "node:orders-api",
    "edge:client-to-orders",
  ]);
  assert.equal(getPersistenceCount(), 1);
  assert.deepEqual(getSavedSnapshots(), [expected], "only canonical materialized fields persist");
}

/** Replays must not duplicate shared canvas data, but must repair failed persistence. */
async function checkExactReplayDoesNotWriteFlowAndRetriesPersistence(): Promise<void> {
  const expected = materializeAgentGraph(graph);
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  let shouldFailPersistence = true;
  let persistenceAttempts = 0;
  const { dependencies, getMutationCount, getFlowWriteCount, getPersistenceCount } = createDependencies(canvas, {
    saveCanvasSnapshot: async () => {
      persistenceAttempts += 1;
      if (shouldFailPersistence) {
        shouldFailPersistence = false;
        throw new Error("persistence unavailable");
      }
    },
  });

  const first = await handleAgentGraphImportPost(request({ launchId, graph }), "project-1", dependencies);
  assert.equal(first.status, 502);
  assert.deepEqual(await first.json(), { error: "Could not save the imported canvas" });
  assert.equal(getMutationCount(), 1, "the first import opens flow once");
  assert.equal(getFlowWriteCount(), 3, "Liveblocks receives the full graph before persistence fails");
  assert.equal(persistenceAttempts, 1);
  assert.equal(getPersistenceCount(), 0, "the injected failed persistence is not counted as success");
  assert.deepEqual(canvas, expected, "failed persistence preserves the imported room for retry");

  const second = await handleAgentGraphImportPost(request({ launchId, graph }), "project-1", dependencies);
  assert.equal(second.status, 200);
  assert.equal(getMutationCount(), 2, "the retry compares the existing graph in one flow operation");
  assert.equal(getFlowWriteCount(), 3, "an exact retry does not duplicate the already-imported graph");
  assert.equal(persistenceAttempts, 2, "an exact retry retries persistence after a prior failure");
  assert.equal(getPersistenceCount(), 0);
}

/** Canvas order is a storage detail, while a changed non-empty canvas is protected. */
async function checkSemanticReplayAndDivergentConflict(): Promise<void> {
  const canonical = materializeAgentGraph(graph);
  const orderedDifferently: CanvasSnapshot = {
    nodes: [...canonical.nodes].reverse(),
    edges: [...canonical.edges].reverse(),
  };
  const replay = createDependencies(orderedDifferently);
  const replayResponse = await handleAgentGraphImportPost(
    request({ launchId, graph }),
    "project-1",
    replay.dependencies,
  );
  assert.equal(replayResponse.status, 200, "canonical snapshots compare independent of storage ordering");
  assert.equal(replay.getMutationCount(), 1);
  assert.equal(replay.getPersistenceCount(), 1);

  const divergent: CanvasSnapshot = {
    ...canonical,
    nodes: [
      { ...canonical.nodes[0], data: { ...canonical.nodes[0].data, label: "Human edit" } },
      canonical.nodes[1],
    ],
  };
  const conflict = createDependencies(divergent);
  const conflictResponse = await handleAgentGraphImportPost(
    request({ launchId, graph }),
    "project-1",
    conflict.dependencies,
  );
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(await conflictResponse.json(), { error: "Canvas already contains a different graph" });
  assert.equal(conflict.getMutationCount(), 1, "a conflict reads through the single flow operation");
  assert.equal(conflict.getPersistenceCount(), 0);
  assert.equal(divergent.nodes[0].data.label, "Human edit", "a divergent room is never overwritten");
}

/** Duplicate IDs in Liveblocks Storage are corrupt, not an idempotent replay. */
async function checkDuplicateLiveFlowIdsConflict(): Promise<void> {
  const canonical = materializeAgentGraph(graph);

  for (const canvas of [
    {
      nodes: [canonical.nodes[0], structuredClone(canonical.nodes[0])],
      edges: [],
    },
    {
      nodes: canonical.nodes,
      edges: [canonical.edges[0], structuredClone(canonical.edges[0])],
    },
  ] satisfies CanvasSnapshot[]) {
    const duplicate = createDependencies(canvas);
    const response = await handleAgentGraphImportPost(
      request({ launchId, graph }),
      "project-1",
      duplicate.dependencies,
    );

    assert.equal(response.status, 409, "duplicate live IDs are never accepted as an exact replay");
    assert.equal(duplicate.getFlowWriteCount(), 0, "corrupt state is never reconciled");
    assert.equal(duplicate.getPersistenceCount(), 0);
  }
}

/** A paced import needs enough route runtime to complete its native drawing loop. */
function checkRouteDurationCoversMaximumNativeImport(): void {
  const maximumItems = 40 + 60;
  const maximumDrawingMilliseconds = maximumItems * (
    AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS + getBuildStepMs(maximumItems)
  );

  assert.equal(AGENT_GRAPH_IMPORT_MAX_DURATION_SECONDS, 120);
  assert.ok(
    AGENT_GRAPH_IMPORT_MAX_DURATION_SECONDS * 1_000 > maximumDrawingMilliseconds,
    "route duration leaves headroom above the maximum native drawing cadence",
  );
}

/** Server-side pacing makes the mounted room observe an intentional drawing sequence. */
async function checkPacedCursorDrawingAndPartialResume(): Promise<void> {
  const canvas: CanvasSnapshot = {
    nodes: [materializeAgentGraph(graph).nodes[0]],
    edges: [],
  };
  const events: string[] = [];
  const { dependencies, getFlowWrites, getMutationCount, getPersistenceCount } =
    createDependencies(canvas, {
      setAiPresence: async (_projectId, presence) => {
        events.push(
          `cursor:${presence.cursor?.x ?? "none"},${presence.cursor?.y ?? "none"}`,
        );
      },
      clearAiPresence: async () => {
        events.push("clear");
      },
      sleep: async (milliseconds) => {
        events.push(`delay:${milliseconds}`);
      },
    });

  const response = await handleAgentGraphImportPost(
    request({ launchId, graph }),
    "project-1",
    dependencies,
  );

  assert.equal(response.status, 200);
  assert.equal(getMutationCount(), 1, "a resumed import uses one mutateFlow transaction");
  assert.deepEqual(getFlowWrites(), [
    "node:orders-api",
    "edge:client-to-orders",
  ], "only canonical items missing from an interrupted import are added");
  assert.deepEqual(events, [
    "cursor:280,0",
    `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`,
    `delay:${getBuildStepMs(2)}`,
    "cursor:280,0",
    `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`,
    `delay:${getBuildStepMs(2)}`,
    "clear",
  ], "each missing item waits for its target cursor before landing, then clears presence");
  assert.equal(getPersistenceCount(), 1);
}

async function main(): Promise<void> {
  await checkAuthorizationPrecedesBodyRead();
  await checkMalformedRequestsAreRejectedSafely();
  await checkEmptyCanvasImportsAndPersistsCanonicalSnapshot();
  await checkExactReplayDoesNotWriteFlowAndRetriesPersistence();
  await checkSemanticReplayAndDivergentConflict();
  await checkDuplicateLiveFlowIdsConflict();
  await checkPacedCursorDrawingAndPartialResume();
  checkRouteDurationCoversMaximumNativeImport();

  console.log("✅ Agent graph import endpoint verified");
}

void main();
