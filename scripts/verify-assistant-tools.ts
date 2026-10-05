import assert from "node:assert/strict";

import {
  AssistantStopError,
  createAssistantActions,
  type AssistantFetch,
} from "../lib/assistant-tools";

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
    assert.deepEqual(result, { graph, opaqueNodeIds: [], fingerprint: "f1" });
    assert.equal(calls[0].input, "/api/diagrams/a%20b/agent-graph");
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

    assert.deepEqual(result, { diagramId: "checkout-flow-bbbbbb", url: "/editor/checkout-flow-bbbbbb" });
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

  console.log("verify-assistant-tools: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
