import assert from "node:assert/strict";

import {
  MAX_AGENT_GRAPH_EDGES,
  MAX_AGENT_GRAPH_NODES,
  canonicalCanvasSnapshotsEqual,
  materializeAgentGraph,
  parseAgentGraph,
} from "../lib/agent-graph";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_DEFAULT_SIZES,
  NODE_COLORS,
  NODE_SHAPES,
} from "../types/canvas";

const graph = {
  version: 1,
  nodes: [
    {
      id: "client",
      label: "Client",
      shape: "circle",
      color: "blue",
      x: 0,
      y: 10,
    },
    {
      id: "orders-api",
      label: "Orders API",
      shape: "rectangle",
      color: "teal",
      x: 280,
      y: 10,
    },
  ],
  edges: [
    { id: "client-to-orders", source: "client", target: "orders-api", label: "HTTPS" },
  ],
} as const;

const parsed = parseAgentGraph(graph);
assert.deepEqual(parsed, graph, "accepts a complete compact graph");
assert.equal(MAX_AGENT_GRAPH_NODES, 40);
assert.equal(MAX_AGENT_GRAPH_EDGES, 60);

for (const shape of NODE_SHAPES) {
  const candidate = parseAgentGraph({
    ...graph,
    nodes: [{ ...graph.nodes[0], shape }],
    edges: [],
  });
  assert.ok(candidate, `accepts ${shape}`);

  const snapshot = materializeAgentGraph(candidate);
  assert.deepEqual(snapshot.nodes[0], {
    id: "client",
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 10 },
    ...NODE_DEFAULT_SIZES[shape],
    data: { label: "Client", shape, color: "blue" },
  });
}

for (const color of Object.keys(NODE_COLORS)) {
  assert.ok(
    parseAgentGraph({
      ...graph,
      nodes: [{ ...graph.nodes[0], color }],
      edges: [],
    }),
    `accepts ${color}`,
  );
}

const snapshot = materializeAgentGraph(parsed!);
assert.deepEqual(snapshot.edges[0], {
  id: "client-to-orders",
  type: CANVAS_EDGE_TYPE,
  source: "client",
  target: "orders-api",
  data: { label: "HTTPS" },
  style: CANVAS_EDGE_STYLE,
  markerEnd: CANVAS_EDGE_MARKER,
});
assert.equal(canonicalCanvasSnapshotsEqual(snapshot, structuredClone(snapshot)), true);
assert.equal(
  canonicalCanvasSnapshotsEqual(
    snapshot,
    { nodes: [...snapshot.nodes].reverse(), edges: [...snapshot.edges].reverse() },
  ),
  true,
  "treats ordering as non-semantic",
);
assert.equal(
  canonicalCanvasSnapshotsEqual(snapshot, {
    ...snapshot,
    nodes: [
      {
        ...snapshot.nodes[0],
        data: { ...snapshot.nodes[0].data, label: "Other" },
      },
    ],
  }),
  false,
);

function rejected(value: unknown, reason: string): void {
  assert.equal(parseAgentGraph(value), null, reason);
}

rejected({ ...graph, extra: true }, "rejects unknown top-level fields");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], extra: true }], edges: [] }, "rejects unknown node fields");
rejected({ ...graph, edges: [{ ...graph.edges[0], extra: true }] }, "rejects unknown edge fields");
rejected({ ...graph, nodes: [] }, "requires at least one node");
rejected(
  { ...graph, nodes: Array.from({ length: MAX_AGENT_GRAPH_NODES + 1 }, (_, index) => ({ ...graph.nodes[0], id: `node-${index}` })), edges: [] },
  "rejects 41 nodes",
);
assert.ok(parseAgentGraph({ ...graph, nodes: Array.from({ length: MAX_AGENT_GRAPH_NODES }, (_, index) => ({ ...graph.nodes[0], id: `node-${index}` })), edges: [] }), "accepts 40 nodes");
const maxNodes = Array.from({ length: MAX_AGENT_GRAPH_NODES }, (_, index) => ({
  ...graph.nodes[0],
  id: `node-${index}`,
}));
const maxEdges = Array.from({ length: MAX_AGENT_GRAPH_EDGES }, (_, index) => ({
  ...graph.edges[0],
  id: `edge-${index}`,
  source: `node-${Math.floor(index / 39)}`,
  target: `node-${index < 39 ? index + 1 : index === 39 ? 0 : index - 38}`,
  label: `${index}`,
}));
assert.ok(parseAgentGraph({ ...graph, nodes: maxNodes, edges: maxEdges }), "accepts 60 edges");
rejected({ ...graph, nodes: maxNodes, edges: [...maxEdges, { ...maxEdges[0], id: "edge-60" }] }, "rejects 61 edges");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], id: "UPPER" }], edges: [] }, "rejects non-kebab node IDs");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], id: "" }], edges: [] }, "rejects empty node IDs");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], id: "x".repeat(49) }], edges: [] }, "rejects overlong node IDs");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], label: " " }], edges: [] }, "rejects blank labels");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], label: "x".repeat(81) }], edges: [] }, "rejects overlong node labels");
assert.ok(parseAgentGraph({ ...graph, nodes: [{ ...graph.nodes[0], label: "x".repeat(80) }], edges: [] }), "accepts 80-character node labels");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], shape: "triangle" }], edges: [] }, "rejects unknown shapes");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], color: "yellow" }], edges: [] }, "rejects unknown colors");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], x: 1.5 }], edges: [] }, "rejects fractional positions");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], y: 10_001 }], edges: [] }, "rejects out-of-range positions");
assert.ok(parseAgentGraph({ ...graph, nodes: [{ ...graph.nodes[0], x: -10_000, y: 10_000 }], edges: [] }), "accepts coordinate bounds");
rejected({ ...graph, nodes: [graph.nodes[0], graph.nodes[0]], edges: [] }, "rejects duplicate node IDs");
rejected({ ...graph, edges: [{ ...graph.edges[0], id: "edge" }, { ...graph.edges[0], id: "edge" }] }, "rejects duplicate edge IDs");
rejected({ ...graph, edges: [{ ...graph.edges[0], id: "other" }, graph.edges[0]] }, "rejects duplicate endpoint pairs");
rejected({ ...graph, edges: [{ ...graph.edges[0], target: "missing" }] }, "rejects dangling endpoints");
rejected({ ...graph, edges: [{ ...graph.edges[0], target: "client" }] }, "rejects self loops");
rejected({ ...graph, edges: [{ ...graph.edges[0], label: "x".repeat(41) }] }, "rejects overlong edge labels");
assert.ok(parseAgentGraph({ ...graph, edges: [{ ...graph.edges[0], label: "x".repeat(40) }] }), "accepts 40-character edge labels");
assert.ok(parseAgentGraph({ ...graph, edges: [{ ...graph.edges[0], label: "" }] }), "accepts empty edge labels");

const accepted = parseAgentGraph(graph)!;
const immutable = materializeAgentGraph(accepted);
immutable.nodes[0].data.label = "Changed";
assert.equal(accepted.nodes[0].label, "Client", "materialization does not share graph data");
const canonicalStroke = CANVAS_EDGE_STYLE.stroke;
immutable.edges[0].style!.stroke = "red";
assert.equal(
  materializeAgentGraph(accepted).edges[0].style?.stroke,
  canonicalStroke,
  "materialization does not share edge constants",
);

console.info("Agent graph contract checks passed");
