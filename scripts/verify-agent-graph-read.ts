import assert from "node:assert/strict";

import {
  canvasFingerprint,
  parseAgentGraphAllowingEmpty,
  projectCanvasToAgentGraph,
} from "../lib/agent-graph";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_DEFAULT_SIZES,
} from "../types/canvas";
import type { CanvasEdge, CanvasNode } from "../types/canvas";

function node(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    ...NODE_DEFAULT_SIZES.rectangle,
    data: { label: "Node", shape: "rectangle", color: "neutral" },
    ...overrides,
  } as CanvasNode;
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return {
    id,
    type: CANVAS_EDGE_TYPE,
    source,
    target,
    data: { label: "" },
    style: { ...CANVAS_EDGE_STYLE },
    markerEnd: { ...CANVAS_EDGE_MARKER },
  } as CanvasEdge;
}

// Representable nodes land in the graph.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web"), node("api", { position: { x: 280, y: 0 } })],
    edges: [edge("web-to-api", "web", "api")],
  });

  assert.equal(view.graph.nodes.length, 2);
  assert.equal(view.graph.edges.length, 1);
  assert.deepEqual(view.opaqueNodeIds, []);
  assert.deepEqual(view.opaqueEdgeIds, []);
  assert.equal(view.graph.nodes[0].id, "web");
  assert.equal(view.graph.nodes[1].x, 280);
}

// A non-conforming ID is opaque, never dropped and never representable.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web"), node("Xk_92NOT-kebab")],
    edges: [],
  });

  assert.deepEqual(view.graph.nodes.map((n) => n.id), ["web"]);
  assert.deepEqual(view.opaqueNodeIds, ["Xk_92NOT-kebab"]);
}

// An over-long label is opaque.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web", { data: { label: "x".repeat(81), shape: "rectangle", color: "neutral" } })],
    edges: [],
  });

  assert.deepEqual(view.graph.nodes, []);
  assert.deepEqual(view.opaqueNodeIds, ["web"]);
}

// A non-integer position is opaque.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web", { position: { x: 10.5, y: 0 } })],
    edges: [],
  });

  assert.deepEqual(view.opaqueNodeIds, ["web"]);
}

// An edge whose endpoint is opaque is itself opaque.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web"), node("BAD_ID")],
    edges: [edge("web-to-bad", "web", "BAD_ID")],
  });

  assert.deepEqual(view.graph.edges, []);
  assert.deepEqual(view.opaqueEdgeIds, ["web-to-bad"]);
}

// Fingerprints are order-independent and change with content.
{
  const a = { nodes: [node("web"), node("api")], edges: [] };
  const b = { nodes: [node("api"), node("web")], edges: [] };
  const c = { nodes: [node("web"), node("api", { position: { x: 1, y: 0 } })], edges: [] };

  assert.equal(canvasFingerprint(a), canvasFingerprint(b));
  assert.notEqual(canvasFingerprint(a), canvasFingerprint(c));
}

// Fingerprints cover opaque items too — an invisible change must still invalidate.
{
  const a = { nodes: [node("web"), node("BAD_ID")], edges: [] };
  const b = {
    nodes: [node("web"), node("BAD_ID", { data: { label: "moved", shape: "rectangle", color: "neutral" } })],
    edges: [],
  };

  assert.notEqual(canvasFingerprint(a), canvasFingerprint(b));
}

// An empty graph parses here but not through the strict launch schema.
{
  assert.deepEqual(parseAgentGraphAllowingEmpty({ version: 1, nodes: [], edges: [] }), {
    version: 1,
    nodes: [],
    edges: [],
  });
  assert.equal(parseAgentGraphAllowingEmpty({ version: 1, nodes: [], edges: [], extra: 1 }), null);
}

console.log("verify-agent-graph-read: ok");
