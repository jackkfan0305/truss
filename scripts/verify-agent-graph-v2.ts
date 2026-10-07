import assert from "node:assert/strict";
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
