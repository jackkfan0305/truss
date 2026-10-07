import assert from "node:assert/strict";

import {
  handleAgentGraphImportPost,
  type AgentGraphImportDependencies,
} from "../lib/agent-graph-import-server";
import { materializeAgentGraph, type AgentGraph } from "../lib/agent-graph";
import { CanvasVersionConflictError } from "../lib/canvas-snapshot";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { canvasFingerprint, canvasToAgentGraph } from "../lib/agent-graph";

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
  return new Request("http://localhost/api/diagrams/diagram-1/agent-launch-import", {
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
  getFlowWriteCount: () => number;
  getFlowWrites: () => readonly string[];
  getPersistenceCount: () => number;
} {
  let flowWriteCount = 0;
  const flowWrites: string[] = [];
  let persistenceCount = 0;

  return {
    dependencies: {
      authorizeDiagram: async () => ({
        ok: true,
        userId: "user-owner",
      }),
      mutateCanvas: async (_diagramId, callback) => {
        const flow = {
          get nodes() {
            return canvas.nodes;
          },
          get edges() {
            return canvas.edges;
          },
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

        const writesBefore = flowWriteCount;
        await callback(flow);
        if (flowWriteCount > writesBefore) {
          persistenceCount += 1;
        }
      },
      ...overrides,
    },
    getFlowWriteCount: () => flowWriteCount,
    getFlowWrites: () => flowWrites,
    getPersistenceCount: () => persistenceCount,
  };
}

/** A protected endpoint must not reveal parse behavior or consume a body. */
async function checkAuthorizationPrecedesBodyRead(): Promise<void> {
  for (const status of [401, 403]) {
    const protectedRequest = request({ launchId: "not-a-uuid", graph: null });
    const { dependencies, getPersistenceCount } = createDependencies(
      { nodes: [], edges: [] },
      {
        authorizeDiagram: async () => ({
          ok: false,
          response: Response.json({ error: "Denied" }, { status }),
        }),
      },
    );

    const response = await handleAgentGraphImportPost(
      protectedRequest,
      "diagram-1",
      dependencies,
    );

    assert.equal(response.status, status);
    assert.equal(protectedRequest.bodyUsed, false, `${status} returns before reading JSON`);
    assert.equal(getPersistenceCount(), 0);
  }
}

/** The endpoint is an all-or-nothing graph boundary, including its opaque ID. */
async function checkMalformedRequestsAreRejectedSafely(): Promise<void> {
  const { dependencies, getPersistenceCount } = createDependencies({
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
    const response = await handleAgentGraphImportPost(request(body), "diagram-1", dependencies);
    assert.equal(response.status, 400);
    const responseBody = await response.json();
    assert.deepEqual(responseBody, { error: "Invalid graph import request" });
    assert.doesNotMatch(JSON.stringify(responseBody), /7a4b4d2e|Never expose/);
  }

  assert.equal(getPersistenceCount(), 0);
}

/** A new room receives the full canonical snapshot in one flow transaction. */
async function checkEmptyCanvasImportsAndPersistsCanonicalSnapshot(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  const { dependencies, getFlowWriteCount, getFlowWrites, getPersistenceCount } =
    createDependencies(canvas);

  const response = await handleAgentGraphImportPost(
    request({ launchId, graph }),
    "diagram-1",
    dependencies,
  );

  const expected = materializeAgentGraph(graph);
  assert.equal(response.status, 200);
  assert.deepEqual(canvas, expected, "the entire requested graph reaches the empty canvas");
  assert.equal(getFlowWriteCount(), 2, "one node write and one edge write in that one transaction");
  assert.deepEqual(getFlowWrites(), [
    "node:client",
    "node:orders-api",
    "edge:client-to-orders",
  ]);
  assert.equal(getPersistenceCount(), 1, "the flow writes trigger one persistence");
}

/** A replay of an import that already landed writes nothing and still answers 200. */
async function checkExactReplayWritesNothing(): Promise<void> {
  const canvas = materializeAgentGraph(graph);
  const { dependencies, getFlowWriteCount, getPersistenceCount } = createDependencies(canvas);

  const response = await handleAgentGraphImportPost(request({ launchId, graph }), "diagram-1", dependencies);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { imported: false });
  assert.equal(getFlowWriteCount(), 0);
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
    "diagram-1",
    replay.dependencies,
  );
  assert.equal(replayResponse.status, 200, "canonical snapshots compare independent of storage ordering");
  assert.equal(replay.getPersistenceCount(), 0, "an exact replay writes nothing");

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
    "diagram-1",
    conflict.dependencies,
  );
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(await conflictResponse.json(), { error: "Canvas already contains a different graph" });
  assert.equal(conflict.getPersistenceCount(), 0);
  assert.equal(divergent.nodes[0].data.label, "Human edit", "a divergent room is never overwritten");
}

/** Duplicate IDs in the stored snapshot are corrupt, not an idempotent replay. */
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
      "diagram-1",
      duplicate.dependencies,
    );

    assert.equal(response.status, 409, "duplicate live IDs are never accepted as an exact replay");
    assert.equal(duplicate.getPersistenceCount(), 0);
  }
}

/** An interrupted import resumes by adding only what is missing. */
async function checkPartialResumeAddsOnlyMissingItems(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [materializeAgentGraph(graph).nodes[0]], edges: [] };
  const { dependencies, getFlowWrites, getPersistenceCount } = createDependencies(canvas);

  const response = await handleAgentGraphImportPost(request({ launchId, graph }), "diagram-1", dependencies);

  assert.equal(response.status, 200);
  assert.deepEqual(getFlowWrites(), ["node:orders-api", "edge:client-to-orders"]);
  assert.equal(getPersistenceCount(), 1);
}

/** A version conflict on mutate is answered with 409. */
async function checkVersionConflictIs409(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  const { dependencies } = createDependencies(canvas, {
    mutateCanvas: async () => {
      throw new CanvasVersionConflictError("diagram-1");
    },
  });

  const response = await handleAgentGraphImportPost(request({ launchId, graph }), "diagram-1", dependencies);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "The canvas changed since it was read" });
}

const nestedGraph = (extra: object = {}) => ({
  version: 2,
  nodes: [
    { id: "vpc", kind: "boundary", catalogId: "boundary-vpc", label: "VPC" },
    { id: "a", kind: "aws-service", catalogId: "aws-ec2", label: "A", parentId: "vpc" },
    { id: "b", kind: "aws-service", catalogId: "aws-s3", label: "B", parentId: "vpc", ...extra },
  ],
  edges: [{ id: "a-to-b", source: "a", target: "b", label: "Writes" }],
});

async function checkNestedImportCommitsAndReturnsExactGeometry(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  const { dependencies } = createDependencies(canvas);
  const response = await handleAgentGraphImportPost(
    request({ launchId, graph: nestedGraph() }), "diagram-1", dependencies, 2,
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.imported, true);
  assert.equal(body.fingerprint, canvasFingerprint(canvas));
  assert.deepEqual(body.graph, canvasToAgentGraph(canvas, 2).graph);
  assert.equal(body.graph.nodes.find((node: { id: string }) => node.id === "a").parentId, "vpc");
  assert.equal(body.spatial.edges[0].layout.points.length >= 2, true);
}

async function checkNestedImportCollisionIs422AndPersistsNothing(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  const { dependencies, getFlowWriteCount } = createDependencies(canvas);
  const graph = nestedGraph({ x: 24, y: 64 });
  graph.nodes[0] = { ...graph.nodes[0], x: 0, y: 0 } as never;
  graph.nodes[1] = { ...graph.nodes[1], x: 24, y: 64 } as never;
  const response = await handleAgentGraphImportPost(
    request({ launchId, graph }), "diagram-1", dependencies, 2,
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, "invalidGeometry");
  assert.ok(body.issues.some((issue: { itemIds: string[] }) => issue.itemIds.includes("a") && issue.itemIds.includes("b")));
  assert.equal(getFlowWriteCount(), 0);
  assert.deepEqual(canvas.nodes, []);
}

async function checkV2GraphWithoutVersionIsRefused(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [], edges: [] };
  const { dependencies, getFlowWriteCount } = createDependencies(canvas);
  const response = await handleAgentGraphImportPost(
    request({ launchId, graph: nestedGraph() }), "diagram-1", dependencies,
  );
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "unsupportedGraphVersion");
  assert.equal(body.requiredVersion, 2);
  assert.equal(getFlowWriteCount(), 0);
}

async function main(): Promise<void> {
  await checkAuthorizationPrecedesBodyRead();
  await checkMalformedRequestsAreRejectedSafely();
  await checkEmptyCanvasImportsAndPersistsCanonicalSnapshot();
  await checkExactReplayWritesNothing();
  await checkSemanticReplayAndDivergentConflict();
  await checkDuplicateLiveFlowIdsConflict();
  await checkPartialResumeAddsOnlyMissingItems();
  await checkVersionConflictIs409();
  await checkNestedImportCommitsAndReturnsExactGeometry();
  await checkNestedImportCollisionIs422AndPersistsNothing();
  await checkV2GraphWithoutVersionIsRefused();

  console.log("✅ Agent graph import endpoint verified");
}

void main();
