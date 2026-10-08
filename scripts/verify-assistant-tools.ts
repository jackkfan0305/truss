import assert from "node:assert/strict";

import {
  AssistantStopError,
  createAssistantActions,
  createAssistantTools,
  type AssistantFetch,
} from "../lib/assistant-tools";
import { canvasFingerprint, canvasToAgentGraph, materializeAgentGraph } from "../lib/agent-graph";
import { CATALOG_ENTRIES } from "../lib/catalog";
import { buildDiagramSpatialContext } from "../lib/diagram-spatial-context";
import { nestedSnapshot } from "./testing/aws-diagram-fixtures";

interface Call {
  input: string;
  method: string;
  body: unknown;
}

function stubFetch(responses: Array<[number, unknown]>): { fetch: AssistantFetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  return {
    calls,
    fetch: async (input, init) => {
      calls.push({
        input,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const next = queue.shift();
      assert.ok(next, `unexpected request to ${input}`);
      return new Response(JSON.stringify(next[1]), { status: next[0] });
    },
  };
}

const graph = {
  version: 1 as const,
  nodes: [{ id: "web", label: "Web", shape: "rectangle" as const, color: "blue" as const }],
  edges: [],
};

async function main() {
  // list
  {
    const { fetch, calls } = stubFetch([[200, { diagrams: [{ id: "a-1", name: "A", ownerId: "u" }] }]]);
    const result = await createAssistantActions({ fetch }).listDiagrams();
    assert.deepEqual(result, { diagrams: [{ id: "a-1", name: "A" }] });
    assert.equal(calls[0].input, "/api/diagrams");
  }

  // get
  {
    const { fetch, calls } = stubFetch([[200, { graph, opaqueNodeIds: [], opaqueEdgeIds: [], fingerprint: "f1" }]]);
    const result = await createAssistantActions({ fetch }).getDiagram({ diagramId: "a b" });
    assert.deepEqual(result, { graph, opaqueNodeIds: [], opaqueEdgeIds: [], fingerprint: "f1" });
    assert.equal(calls[0].input, "/api/diagrams/a%20b/agent-graph?version=2");
  }

  // edit: success, review focus 3 conflict, and validation rejection go back to the model
  {
    const { fetch, calls } = stubFetch([
      [200, { applied: true }],
      [409, { error: "The canvas changed since it was read" }],
      [400, { error: "Invalid graph edit request" }],
    ]);
    const actions = createAssistantActions({ fetch });
    assert.deepEqual(await actions.applyDiagramEdit({ diagramId: "a-1", fingerprint: "f1", graph }), {
      applied: true,
      url: "/editor/a-1",
    });
    assert.equal(calls[0].input, "/api/diagrams/a-1/agent-graph-edit");
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(calls[0].body, { fingerprint: "f1", graph });

    const conflict = await actions.applyDiagramEdit({ diagramId: "a-1", fingerprint: "old", graph });
    assert.ok("conflict" in conflict && /get_diagram/.test(conflict.conflict));

    const rejected = await actions.applyDiagramEdit({ diagramId: "a-1", fingerprint: "f1", graph });
    assert.deepEqual(rejected, { error: "Invalid graph edit request" });
  }

  // Auth, server and network failures end the turn.
  for (const status of [401, 403, 502]) {
    const { fetch } = stubFetch([[status, { error: "x" }]]);
    await assert.rejects(
      createAssistantActions({ fetch }).getDiagram({ diagramId: "a-1" }),
      AssistantStopError,
    );
  }
  {
    const actions = createAssistantActions({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await assert.rejects(actions.listDiagrams(), AssistantStopError);
  }
  {
    const { fetch } = stubFetch([[401, { error: "Unauthorized" }]]);
    await assert.rejects(
      createAssistantActions({ fetch }).listDiagrams(),
      (error) => error instanceof AssistantStopError && error.message === "Sign in again to edit this diagram.",
    );
  }

  // create: retries a taken ID, then imports with a fresh launch ID
  {
    const suffixes = ["aaaaaa", "bbbbbb"];
    const { fetch, calls } = stubFetch([
      [409, { error: "Diagram ID already exists" }],
      [201, { diagram: { id: "checkout-flow-bbbbbb" } }],
      [200, { imported: true }],
    ]);
    const result = await createAssistantActions({
      fetch,
      createSuffix: () => suffixes.shift() ?? "zzzzzz",
      createLaunchId: () => "00000000-0000-4000-8000-000000000000",
    }).createDiagram({ title: "Checkout flow", graph });

    assert.deepEqual(result, { imported: true, diagramId: "checkout-flow-bbbbbb", url: "/editor/checkout-flow-bbbbbb" });
    assert.deepEqual(calls[0].body, { id: "checkout-flow-aaaaaa", name: "Checkout flow" });
    assert.deepEqual(calls[1].body, { id: "checkout-flow-bbbbbb", name: "Checkout flow" });
    assert.equal(calls[2].input, "/api/diagrams/checkout-flow-bbbbbb/agent-launch-import");
    assert.deepEqual(calls[2].body, { launchId: "00000000-0000-4000-8000-000000000000", graph });
  }

  // Review focus 4: an unusable title never reaches the API.
  {
    const { fetch, calls } = stubFetch([]);
    const result = await createAssistantActions({ fetch }).createDiagram({ title: "!!!", graph });
    assert.ok("error" in result);
    assert.equal(calls.length, 0);
  }

  // A rejected import reports the diagram that now exists.
  {
    const { fetch } = stubFetch([
      [201, { diagram: { id: "x-cccccc" } }],
      [400, { error: "Invalid graph import request" }],
    ]);
    const result = await createAssistantActions({ fetch, createSuffix: () => "cccccc" }).createDiagram({
      title: "X",
      graph,
    });
    assert.ok("error" in result && result.url === "/editor/x-cccccc");
  }

  // An invalid graph is rejected with its paths before any request, so no empty diagram is left behind.
  {
    const { fetch, calls } = stubFetch([]);
    const badGraph = { ...graph, nodes: [{ ...graph.nodes[0], id: "Web App" }] };
    const result = await createAssistantActions({ fetch }).createDiagram({ title: "Checkout", graph: badGraph });
    assert.ok("error" in result && result.error.includes("nodes.0.id"), JSON.stringify(result));
    assert.equal(calls.length, 0);
  }
  {
    const { fetch, calls } = stubFetch([]);
    const badGraph = { ...graph, edges: [{ id: "web-to-api", source: "web", target: "api", label: "" }] };
    const result = await createAssistantActions({ fetch }).applyDiagramEdit({
      diagramId: "a-1",
      fingerprint: "f1",
      graph: badGraph,
    });
    assert.ok("error" in result && result.error.includes("edges.0.target"), JSON.stringify(result));
    assert.equal(calls.length, 0);
  }

  // catalog
  {
    const response = { catalogVersion: 1, entries: CATALOG_ENTRIES };
    const { fetch, calls } = stubFetch([[200, response]]);
    assert.deepEqual(await createAssistantActions({ fetch }).getCatalog(), response);
    assert.equal(calls[0].input, "/api/agent/catalog");
    assert.equal(calls[0].method, "GET");
  }

  await checkNested();

  console.log("verify-assistant-tools: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/** A real committed view: the same builders the server handlers use. */
function committedView(snapshot = nestedSnapshot()) {
  const view = canvasToAgentGraph(snapshot, 2);
  return {
    ...view,
    spatial: buildDiagramSpatialContext(snapshot, new Set(view.opaqueNodeIds), new Set(view.opaqueEdgeIds)),
    fingerprint: canvasFingerprint(snapshot),
  };
}

const nestedGraph = {
  version: 2 as const,
  nodes: [
    { id: "vpc", kind: "boundary" as const, catalogId: "boundary-vpc", label: "VPC" },
    { id: "subnet", kind: "boundary" as const, catalogId: "boundary-subnet", label: "Subnet", parentId: "vpc" },
    { id: "worker", kind: "aws-service" as const, catalogId: "aws-eks", label: "Worker", parentId: "subnet" },
    { id: "queue", kind: "aws-service" as const, catalogId: "aws-s3", label: "Uploads", parentId: "vpc" },
  ],
  edges: [{ id: "worker-to-queue", source: "worker", target: "queue", label: "Writes" }],
};

async function checkNested() {
  const committed = { ...committedView(), opaqueNodeIds: ["Opaque_Item"] };

  // create preserves the committed view and uses the negotiated import endpoint
  {
    const { fetch, calls } = stubFetch([
      [201, { diagram: { id: "aws-bbbbbb" } }],
      [200, { imported: true, ...committed }],
    ]);
    const result = await createAssistantActions({ fetch, createSuffix: () => "bbbbbb" }).createDiagram({
      title: "AWS",
      graph: nestedGraph,
    });
    assert.deepEqual(result, { ...committed, imported: true, diagramId: "aws-bbbbbb", url: "/editor/aws-bbbbbb" });
    assert.equal(calls[1].input, "/api/diagrams/aws-bbbbbb/agent-launch-import?version=2");
    assert.deepEqual((calls[1].body as { graph: unknown }).graph, nestedGraph);
  }

  // stale 409, then a fresh read and a revised edit with the new fingerprint that keeps a concurrent node
  {
    const concurrent = nestedSnapshot();
    concurrent.nodes.push({ ...concurrent.nodes[4], id: "added-elsewhere" });
    const fresh = committedView(concurrent);
    const revised = { ...fresh.graph, nodes: [...fresh.graph.nodes, nestedGraph.nodes[3]] };
    const after = committedView(concurrent);
    const { fetch, calls } = stubFetch([
      [409, { error: "The canvas changed since it was read" }],
      [200, fresh],
      [200, { applied: true, ...after }],
    ]);
    const actions = createAssistantActions({ fetch });
    const stale = await actions.applyDiagramEdit({
      diagramId: "aws-1", fingerprint: "a".repeat(64), graph: committedView().graph,
    });
    assert.ok("conflict" in stale && /get_diagram/.test(stale.conflict));
    const read = await actions.getDiagram({ diagramId: "aws-1" });
    assert.ok("fingerprint" in read);
    const applied = await actions.applyDiagramEdit({
      diagramId: "aws-1", fingerprint: read.fingerprint, graph: revised as never,
    });
    assert.deepEqual(applied, { applied: true, ...after, url: "/editor/aws-1" });
    const body = calls[2].body as { fingerprint: string; graph: { nodes: { id: string }[] } };
    assert.equal(body.fingerprint, fresh.fingerprint);
    assert.ok(body.graph.nodes.some((node) => node.id === "added-elsewhere"));
    assert.equal(calls[2].input, "/api/diagrams/aws-1/agent-graph-edit?version=2");
  }

  // recoverable geometry rejection keeps its code and item IDs
  {
    const rejection = {
      error: "Generated items overlap",
      code: "invalidGeometry",
      issues: [{ code: "siblingCollision", itemIds: ["worker", "queue"] }],
    };
    const { fetch } = stubFetch([[422, { ...rejection, retry: "ignored" }]]);
    const result = await createAssistantActions({ fetch }).applyDiagramEdit({
      diagramId: "aws-1", fingerprint: "a".repeat(64), graph: nestedGraph,
    });
    assert.deepEqual(result, rejection);
  }

  // an unsupported-version refusal is not mistaken for a stale read
  {
    const { fetch } = stubFetch([[409, { code: "unsupportedGraphVersion", requiredVersion: 2, message: "Upgrade" }]]);
    const result = await createAssistantActions({ fetch }).applyDiagramEdit({
      diagramId: "aws-1", fingerprint: "a".repeat(64), graph: nestedGraph,
    });
    assert.deepEqual(result, { error: "Upgrade", code: "unsupportedGraphVersion", requiredVersion: 2 });
  }

  // unknown catalog IDs and unknown keys never reach the network
  {
    const { fetch, calls } = stubFetch([]);
    const actions = createAssistantActions({ fetch });
    const unknown = { ...nestedGraph, nodes: [{ ...nestedGraph.nodes[0], catalogId: "aws-made-up" }] };
    const result = await actions.createDiagram({ title: "AWS", graph: unknown });
    assert.ok("error" in result && result.error.includes("catalogId"), JSON.stringify(result));
    const extra = { ...nestedGraph, nodes: [{ ...nestedGraph.nodes[0], iconUrl: "https://x/y.svg" }] };
    const forged = await actions.applyDiagramEdit({
      diagramId: "aws-1", fingerprint: "a".repeat(64), graph: extra as never,
    });
    assert.ok("error" in forged);
    assert.equal(calls.length, 0);
  }

  // a read code graph goes back through an edit with only a label changed, keeping every code field
  {
    const codeGraph = {
      version: 2 as const,
      nodes: [
        { id: "checkout", kind: "code" as const, catalogId: "code-entry", label: "checkout", signature: "checkout(req)",
          source: { path: "app/route.ts", line: 12, url: "https://github.com/o/r/blob/abc/app/route.ts#L12" } },
        { id: "inventory", kind: "boundary" as const, catalogId: "code-class", label: "Inventory" },
        { id: "reserve", kind: "code" as const, catalogId: "code-method", label: "reserve", parentId: "inventory" },
        { id: "order", kind: "code" as const, catalogId: "code-type", label: "Order", rows: ["id: string"] },
      ],
      edges: [
        { id: "a", source: "checkout", target: "reserve", label: "", kind: "calls" as const },
        { id: "b", source: "reserve", target: "order", label: "", kind: "uses" as const },
      ],
    };
    const read = canvasToAgentGraph(materializeAgentGraph(codeGraph), 2).graph;
    const renamed = { ...read, nodes: read.nodes.map((n) => (n.id === "order" ? { ...n, label: "Purchase" } : n)) };
    const { fetch, calls } = stubFetch([[200, { applied: true }]]);
    const result = await createAssistantActions({ fetch }).applyDiagramEdit({ diagramId: "c-1", fingerprint: "a".repeat(64), graph: renamed });
    assert.ok("applied" in result, JSON.stringify(result));
    const posted = (calls[0].body as { graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } }).graph;
    assert.equal(posted.nodes.find((n) => n.id === "checkout")!.signature, "checkout(req)");
    assert.deepEqual(posted.nodes.find((n) => n.id === "checkout")!.source, codeGraph.nodes[0].source);
    assert.deepEqual(posted.nodes.find((n) => n.id === "order")!.rows, ["id: string"]);
    assert.equal(posted.edges.find((e) => e.id === "b")!.kind, "uses");

    // a hostile source URL never reaches the network
    const none = stubFetch([]);
    const hostile = { ...codeGraph, nodes: [{ ...codeGraph.nodes[0], source: { path: "a.ts", url: "javascript:x" } }, ...codeGraph.nodes.slice(1)] };
    const refused = await createAssistantActions({ fetch: none.fetch }).applyDiagramEdit({ diagramId: "c-1", fingerprint: "a".repeat(64), graph: hostile });
    assert.ok("error" in refused && refused.error.includes("source.url"), JSON.stringify(refused));
    assert.equal(none.calls.length, 0);
  }

  // the model-visible schema accepts nested input and lets unknown keys through to strict validation
  {
    const tools = createAssistantTools(createAssistantActions({ fetch: stubFetch([]).fetch }));
    const schema = tools.create_diagram.inputSchema as unknown as {
      safeParse(value: unknown): { success: boolean; data?: { graph: { nodes: object[] } } };
    };
    assert.ok(schema.safeParse({ title: "AWS", graph: nestedGraph }).success);
    const loose = schema.safeParse({
      title: "AWS",
      graph: { ...nestedGraph, nodes: [{ ...nestedGraph.nodes[0], iconUrl: "x" }] },
    });
    assert.ok(loose.success && "iconUrl" in loose.data!.graph.nodes[0]);
    assert.ok("get_catalog" in tools);
    assert.equal("get_aws_catalog" in tools, false);
  }
}
