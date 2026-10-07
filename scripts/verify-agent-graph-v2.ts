import assert from "node:assert/strict";
import { canvasFingerprint, canvasToAgentGraph, materializeAgentGraph, canonicalCanvasSnapshotsEqual } from "../lib/agent-graph";
import { agentGraphV2Schema, agentGraphV2EditSchema } from "../lib/agent-graph-schema";

// Test basic v2 acceptance
const graph = {
  version: 2,
  nodes: [
    { id: "uploads", kind: "aws-service", catalogId: "aws-s3", label: "Uploads", parentId: "vpc" },
    { id: "vpc", kind: "boundary", catalogId: "boundary-vpc", label: "Production" },
  ],
  edges: [],
};

const parsed = agentGraphV2Schema.safeParse(graph);
assert.ok(parsed.success, "Valid v2 graph should parse");

// Test invalid parent reference
const invalidParent = {
  ...graph,
  nodes: [{ ...graph.nodes[0], parentId: "missing" }, graph.nodes[1]],
};
const parentFail = agentGraphV2Schema.safeParse(invalidParent);
assert.ok(!parentFail.success, "Missing parent should fail");

// Test self-parent cycle
const selfCycle = {
  ...graph,
  nodes: [{ ...graph.nodes[0], parentId: "uploads" }, graph.nodes[1]],
};
const cycleFail = agentGraphV2Schema.safeParse(selfCycle);
assert.ok(!cycleFail.success, "Self-cycle should fail");

// Test wrong catalog kind (aws service with boundary catalog)
const wrongKind = {
  ...graph,
  nodes: [{ ...graph.nodes[0], catalogId: "boundary-vpc" }, graph.nodes[1]],
};
const kindFail = agentGraphV2Schema.safeParse(wrongKind);
assert.ok(!kindFail.success, "Wrong catalog kind should fail");

// Test unknown catalog ID
const unknownCatalog = {
  ...graph,
  nodes: [{ ...graph.nodes[0], catalogId: "aws-made-up" }, graph.nodes[1]],
};
const catalogFail = agentGraphV2Schema.safeParse(unknownCatalog);
assert.ok(!catalogFail.success, "Unknown catalog ID should fail");

// Test fractional coordinates accepted
const fractional = {
  ...graph,
  nodes: graph.nodes.map((node) => ({ ...node, x: 1.25, y: -2.5 })),
};
const fractionalParsed = agentGraphV2Schema.safeParse(fractional);
assert.ok(fractionalParsed.success, "Fractional coordinates should be accepted");

// Test half coordinate pair rejected
const halfCoords = {
  ...graph,
  nodes: [{ ...graph.nodes[0], x: 1 }, graph.nodes[1]],
};
const halfFail = agentGraphV2Schema.safeParse(halfCoords);
assert.ok(!halfFail.success, "Half coordinate pair should fail");

// Test half dimension pair rejected
const halfDims = {
  ...graph,
  nodes: [{ ...graph.nodes[0], width: 100 }, graph.nodes[1]],
};
const dimFail = agentGraphV2Schema.safeParse(halfDims);
assert.ok(!dimFail.success, "Half dimension pair should fail");

// Test edit schema allows 0 nodes
const empty = {
  version: 2,
  nodes: [],
  edges: [],
};
const editParsed = agentGraphV2EditSchema.safeParse(empty);
assert.ok(editParsed.success, "Edit schema should allow empty graph");

console.log("✓ All v2 graph schema tests passed");

// Sticky notes in the v2 graph.
{
  const api = { id: "api", kind: "generic", shape: "rectangle", color: "neutral", label: "API" };
  const todo = { id: "todo", kind: "note", label: "Add retries  \n", color: "pink" };
  const withNote = { version: 2, nodes: [api, todo], edges: [] as Array<{ id: string; source: string; target: string; label: string }> };
  assert.ok(agentGraphV2Schema.safeParse(withNote).success, "note validates, untrimmed text allowed");
  const connected = agentGraphV2Schema.safeParse({ ...withNote, edges: [{ id: "e", source: "api", target: "todo", label: "" }] });
  assert.ok(!connected.success && connected.error.issues.some((issue) => issue.message === "Notes cannot be connected."));
  assert.ok(!agentGraphV2Schema.safeParse({ ...withNote, nodes: [{ ...api, parentId: "todo" }, todo] }).success, "note as parent rejected");
  assert.ok(!agentGraphV2Schema.safeParse({ ...withNote, nodes: [api, { ...todo, parentId: "api" }] }).success, "parentId on a note rejected");
  assert.ok(!agentGraphV2Schema.safeParse({ ...withNote, nodes: [api, { ...todo, color: "teal" }] }).success, "node colour on a note rejected");

  const materialized = materializeAgentGraph(withNote as never);
  const noteNode = materialized.nodes.find((node) => node.id === "todo")!;
  assert.equal(noteNode.type, "canvasNote");
  assert.equal(noteNode.data.noteColor, "pink");
  assert.equal(noteNode.width, 200);
  const projected = canvasToAgentGraph(materialized, 2).graph.nodes.find((node) => node.id === "todo");
  assert.deepEqual(projected, { id: "todo", kind: "note", label: "Add retries  \n", color: "pink", x: 0, y: 0, width: 200, height: 200 });

  const recoloured = { ...materialized, nodes: materialized.nodes.map((node) => node.id === "todo" ? { ...node, data: { ...node.data, noteColor: "green" as const } } : node) };
  assert.notEqual(canvasFingerprint(materialized), canvasFingerprint(recoloured));
  assert.ok(!canonicalCanvasSnapshotsEqual(materialized, recoloured));
  console.log("verify-agent-graph-v2 notes: ok");
}

// A v2 edit's width/height on an existing node survives layout resolution.
void (async () => {
  const { resolveAgentGraphLayout } = await import("../lib/agent-graph-layout");
  const base = { id: "a", kind: "generic" as const, shape: "rectangle" as const, color: "neutral" as const, label: "A", x: 0, y: 0 };
  const first = await resolveAgentGraphLayout({ version: 2, nodes: [base], edges: [] });
  const resized = await resolveAgentGraphLayout({ version: 2, nodes: [{ ...base, width: 333, height: 222 }], edges: [] }, first);
  const out = resized.nodes.find((node) => node.id === "a")!;
  assert.equal(out.width, 333);
  assert.equal(out.height, 222);
  console.log("verify-agent-graph-v2 resize: ok");
})();

// Code diagrams
const codeGraph = {
  version: 2,
  nodes: [
    { id: "checkout", kind: "code", catalogId: "code-entry", label: "POST /checkout", signature: "checkout(req)",
      source: { path: "app/api/checkout/route.ts", line: 12, url: "https://github.com/o/r/blob/abc/app/api/checkout/route.ts#L12" } },
    { id: "inventory", kind: "boundary", catalogId: "code-class", label: "Inventory" },
    { id: "reserve", kind: "code", catalogId: "code-method", label: "reserve", signature: "reserve(sku, qty)", parentId: "inventory" },
    { id: "order", kind: "code", catalogId: "code-type", label: "Order", rows: ["id: string", "items: OrderItem[]"] },
    { id: "status", kind: "code", catalogId: "code-enum", label: "OrderStatus", rows: ["pending", "paid"] },
  ],
  edges: [
    { id: "e1", source: "checkout", target: "reserve", label: "", kind: "calls" },
    { id: "e2", source: "reserve", target: "order", label: "", kind: "uses" },
    { id: "e3", source: "order", target: "status", label: "" },
  ],
};
assert.ok(agentGraphV2Schema.safeParse(codeGraph).success, "code graph parses");

const issuePaths = (value: unknown) => {
  const result = agentGraphV2Schema.safeParse(value);
  assert.ok(!result.success, "expected rejection");
  return result.error.issues.map((issue) => issue.path.join("."));
};
const withNode = (index: number, patch: object) => ({
  ...codeGraph, nodes: codeGraph.nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)),
});

assert.ok(issuePaths(withNode(0, { catalogId: "code-made-up" })).includes("nodes.0.catalogId"));
assert.ok(issuePaths(withNode(0, { catalogId: "code-class" })).includes("nodes.0.catalogId"), "boundary id on a code block");
assert.ok(issuePaths(withNode(1, { catalogId: "code-function" })).includes("nodes.1.catalogId"), "block id on a boundary");
assert.ok(issuePaths(withNode(0, { kind: "aws-service", catalogId: "aws-s3" })).length > 0, "signature on an aws-service");
assert.ok(issuePaths({ ...codeGraph, nodes: [...codeGraph.nodes, { id: "g", kind: "generic", label: "G", shape: "rectangle", color: "blue", rows: ["x"] }] }).length > 0, "rows on generic");
assert.ok(issuePaths(withNode(0, { source: { path: "a.ts", url: "javascript:alert(1)" } })).includes("nodes.0.source.url"));
assert.ok(issuePaths(withNode(0, { source: { path: "a.ts", line: 0 } })).includes("nodes.0.source.line"));
assert.ok(issuePaths(withNode(0, { source: { path: "x".repeat(201) } })).includes("nodes.0.source.path"));
assert.ok(issuePaths(withNode(0, { signature: "x".repeat(121) })).includes("nodes.0.signature"));
assert.ok(issuePaths(withNode(0, { signature: "a(\nb)" })).includes("nodes.0.signature"), "multi-line signature");
assert.ok(issuePaths(withNode(3, { rows: Array.from({ length: 13 }, (_, i) => `f${i}`) })).includes("nodes.3.rows"));
assert.ok(issuePaths(withNode(3, { rows: ["x".repeat(61)] })).includes("nodes.3.rows.0"));
assert.ok(issuePaths(withNode(3, { rows: ["padded "] })).includes("nodes.3.rows.0"));
assert.ok(issuePaths(withNode(2, { parentId: undefined })).includes("nodes.2.parentId"), "method at root");
assert.ok(
  issuePaths({ ...codeGraph, nodes: [...codeGraph.nodes, { id: "mod", kind: "boundary", catalogId: "code-module", label: "mod" }].map((n) => (n.id === "reserve" ? { ...n, parentId: "mod" } : n)) })
    .includes("nodes.2.parentId"),
  "method in a module",
);
assert.ok(issuePaths({ ...codeGraph, edges: [{ ...codeGraph.edges[0], kind: "imports" }] }).includes("edges.0.kind"));
assert.ok(issuePaths({ ...codeGraph, edges: [{ ...codeGraph.edges[0], weight: 1 }] }).length > 0, "unknown edge key");

// Mixed families on one canvas: an AWS service inside a code module is fine.
assert.ok(agentGraphV2Schema.safeParse({
  version: 2,
  nodes: [{ id: "mod", kind: "boundary", catalogId: "code-module", label: "worker" }, { id: "q", kind: "aws-service", catalogId: "aws-sqs", label: "Jobs", parentId: "mod" }],
  edges: [],
}).success);

// Limits: 80 nodes and 120 edges for v2; v1 stays at 40.
const many = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `f${i}`, kind: "code", catalogId: "code-function", label: `f${i}` }));
const pairs = (count: number) => {
  const out: Array<{ id: string; source: string; target: string; label: string }> = [];
  for (const step of [1, 2]) {
    for (let i = 0; i + step < 80; i += 1) out.push({ id: `e${step}-${i}`, source: `f${i}`, target: `f${i + step}`, label: "" });
  }
  return out.slice(0, count);
};
assert.ok(agentGraphV2Schema.safeParse({ version: 2, nodes: many(80), edges: [] }).success);
assert.ok(!agentGraphV2Schema.safeParse({ version: 2, nodes: many(81), edges: [] }).success);
assert.ok(agentGraphV2Schema.safeParse({ version: 2, nodes: many(80), edges: pairs(120) }).success);
assert.ok(!agentGraphV2Schema.safeParse({ version: 2, nodes: many(80), edges: [...pairs(120), { id: "extra", source: "f0", target: "f3", label: "" }] }).success);
console.log("verify-agent-graph-v2 code contract: ok");
