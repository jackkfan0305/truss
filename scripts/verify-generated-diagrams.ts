import assert from "node:assert/strict";

import { parseAgentGraph, parseAgentGraphInput } from "../lib/agent-graph";
import { resolveAgentGraphLayout } from "../lib/agent-graph-layout";
import { layoutDesignPlan } from "../lib/layout-design-plan";
import { parseDesignPlan } from "../lib/design-plan";
import { SYSTEM_PROMPT } from "../lib/design-prompt";
import { ORCHESTRATOR_SYSTEM_PROMPT } from "../lib/orchestrator-prompt";

const graph = {
  version: 1,
  nodes: [
    { id: "customer", label: "Customer", shape: "rectangle", color: "neutral" },
    { id: "checkout", label: "Checkout", shape: "rectangle", color: "neutral" },
    { id: "orders", label: "Orders", shape: "cylinder", color: "teal" },
  ],
  edges: [
    { id: "buy", source: "customer", target: "checkout", label: "Place order" },
    { id: "save", source: "checkout", target: "orders", label: "Save order" },
  ],
};

async function main(): Promise<void> {
  assert.equal(parseAgentGraph(graph), null, "legacy launch still requires positions");
  const input = parseAgentGraphInput(graph);
  assert.ok(input, "API accepts a complete graph without coordinate guesses");
  assert.equal(parseAgentGraphInput({ ...graph, nodes: [{ ...graph.nodes[0], x: 10 }] }), null);
  assert.equal(parseAgentGraphInput({ ...graph, nodes: [{ ...graph.nodes[0], x: null, y: null }] }), null);
  assert.equal(parseAgentGraphInput({ ...graph, extra: true }), null);
  const snapshot = await resolveAgentGraphLayout(input);
  const positions = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
  assert.ok(positions.get("customer")!.x < positions.get("checkout")!.x);
  assert.ok(positions.get("checkout")!.x < positions.get("orders")!.x);
  assert.deepEqual(await resolveAgentGraphLayout(input), snapshot, "import replays resolve identically");

  const existing = {
    nodes: snapshot.nodes.map((node) => ({ ...node, position: { x: node.position.x + 500, y: node.position.y + 250 } })),
    edges: snapshot.edges,
  };
  const edited = parseAgentGraphInput({
    ...graph,
    nodes: [...graph.nodes.map((node) => node.id === "checkout" ? { ...node, label: "Pay" } : node),
      { id: "receipt", label: "Receipt", shape: "rectangle", color: "neutral" }],
    edges: [...graph.edges, { id: "notify", source: "orders", target: "receipt", label: "" }],
  });
  assert.ok(edited);
  const extended = await resolveAgentGraphLayout(edited, existing);
  for (const node of existing.nodes) {
    const after = extended.nodes.find((item) => item.id === node.id)!;
    assert.deepEqual(after.position, node.position, "a small edit preserves manual placement");
    assert.equal(after.width, node.width);
    assert.equal(after.height, node.height);
  }
  const receipt = extended.nodes.find((node) => node.id === "receipt")!;
  assert.ok(receipt.position.x >= Math.max(...existing.nodes.map((node) => node.position.x + node.width!)));

  const context = { nodes: [], edges: [] };
  const raw = {
    summary: "Explain checkout",
    actions: [
      ...graph.nodes.map((node) => ({ type: "addNode", ...node, x: 0, y: 0, width: 0, height: 0 })),
      ...graph.edges.map((edge) => ({ type: "addEdge", ...edge })),
    ],
  };
  const plan = await layoutDesignPlan(parseDesignPlan(raw, context), context);
  const nodes = plan.actions.flatMap((action) => action.type === "addNode" ? [action.node] : []);
  const edges = plan.actions.flatMap((action) => action.type === "addEdge" ? [action.edge] : []);
  assert.equal(nodes.length, 3);
  assert.ok(nodes[0].position.x < nodes[1].position.x && nodes[1].position.x < nodes[2].position.x);
  assert.ok(edges.every((edge) => edge.data?.layout), "worker writes the layout routes, not model geometry");
  assert.ok(nodes.every((node) => node.width! >= 160 && node.height! >= 56));

  const rename = parseDesignPlan({ actions: [{ type: "updateNodeData", id: existing.nodes[0].id, label: "Buyer" }] }, existing);
  assert.deepEqual(await layoutDesignPlan(rename, existing), rename, "label-only AI edit keeps all existing geometry");
  assert.match(SYSTEM_PROMPT, /overview/i);
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /overview/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /three-box sketch is rarely|do the arithmetic/);
  process.stdout.write("Generated diagram verification passed.\n");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
