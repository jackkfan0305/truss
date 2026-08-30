import assert from "node:assert/strict";

import {
  MAX_AGENT_GRAPH_EDGES,
  MAX_AGENT_GRAPH_NODES,
  canonicalCanvasSnapshotsEqual,
  materializeAgentGraph,
  parseAgentGraph,
  projectCanvasToAgentGraph,
} from "../lib/agent-graph";
import { LAYOUT_GRID, MIN_NODE_GAP } from "../lib/canvas-geometry";
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
  const { position, ...rest } = snapshot.nodes[0];

  // Position is not asserted against the agent's raw (0, 10): the app now
  // lays every graph out itself, so an isolated single node's coordinates are
  // whatever `applyLayout` places it at, not whatever the agent sent.
  assert.deepEqual(rest, {
    id: "client",
    type: CANVAS_NODE_TYPE,
    ...NODE_DEFAULT_SIZES[shape],
    data: { label: "Client", shape, color: "blue" },
  });
  assert.ok(
    Number.isInteger(position.x / LAYOUT_GRID),
    `${shape} lands on the layout grid`,
  );
  assert.ok(
    Number.isInteger(position.y / LAYOUT_GRID),
    `${shape} lands on the layout grid`,
  );
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
// `sourceHandle`/`targetHandle` and `data.label` are asserted separately.
// `sourceHandle`/`targetHandle` are checked against the laid-out geometry
// (24-graph-layout), so they are folded into the expected object from the actual
// result rather than hard-coded. `data.lane` is a layout output (varies by
// geometry), and `data.label` is authored content.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured to drop `data`
const { data, ...edgeWithoutData } = snapshot.edges[0];
assert.deepEqual(edgeWithoutData, {
  id: "client-to-orders",
  type: CANVAS_EDGE_TYPE,
  source: "client",
  target: "orders-api",
  sourceHandle: snapshot.edges[0].sourceHandle,
  targetHandle: snapshot.edges[0].targetHandle,
  style: CANVAS_EDGE_STYLE,
  markerEnd: CANVAS_EDGE_MARKER,
});
assert.equal(
  snapshot.edges[0].data?.label,
  "HTTPS",
  "the edge's authored label survives materialization",
);
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
rejected({ ...graph, nodes: [{ ...graph.nodes[0], label: " Client " }], edges: [] }, "rejects padded node labels rather than normalizing them");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], label: "x".repeat(81) }], edges: [] }, "rejects overlong node labels");
assert.ok(parseAgentGraph({ ...graph, nodes: [{ ...graph.nodes[0], label: "x".repeat(80) }], edges: [] }), "accepts 80-character node labels");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], shape: "triangle" }], edges: [] }, "rejects unknown shapes");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], color: "yellow" }], edges: [] }, "rejects unknown colors");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], x: 1.5 }], edges: [] }, "rejects fractional positions");
rejected({ ...graph, nodes: [{ ...graph.nodes[0], y: 10_001 }], edges: [] }, "rejects out-of-range positions");
assert.ok(parseAgentGraph({ ...graph, nodes: [{ ...graph.nodes[0], x: -10_000, y: 10_000 }], edges: [] }), "accepts coordinate bounds");
rejected({ ...graph, nodes: [graph.nodes[0], graph.nodes[0]], edges: [] }, "rejects duplicate node IDs");
rejected({ ...graph, edges: [{ ...graph.edges[0], id: "edge" }, { ...graph.edges[0], id: "edge" }] }, "rejects duplicate edge IDs");
rejected(
  { ...graph, edges: [{ ...graph.edges[0], id: "other" }, graph.edges[0]] },
  "rejects an edge repeating an earlier edge's source, target and label",
);
assert.ok(
  parseAgentGraph({
    ...graph,
    edges: [
      graph.edges[0],
      { ...graph.edges[0], id: "client-to-orders-2", label: "gRPC" },
    ],
  }),
  "accepts two edges sharing a source and target when their labels differ — two relationships, not a collision",
);
rejected({ ...graph, edges: [{ ...graph.edges[0], target: "missing" }] }, "rejects dangling endpoints");
rejected({ ...graph, edges: [{ ...graph.edges[0], target: "client" }] }, "rejects self loops");
rejected({ ...graph, edges: [{ ...graph.edges[0], label: "x".repeat(41) }] }, "rejects overlong edge labels");
rejected({ ...graph, edges: [{ ...graph.edges[0], label: " HTTPS " }] }, "rejects padded edge labels rather than normalizing them");
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

// --- layout ownership (24-graph-layout wired into the compact contract) ---

const graphWithoutPositions = {
  version: 1 as const,
  nodes: [
    { id: "client", label: "Client", shape: "circle" as const, color: "blue" as const },
    { id: "orders-api", label: "Orders API", shape: "rectangle" as const, color: "teal" as const },
  ],
  edges: [
    { id: "client-to-orders", source: "client", target: "orders-api", label: "HTTPS" },
  ],
};

const parsedWithoutPositions = parseAgentGraph(graphWithoutPositions);
assert.ok(parsedWithoutPositions, "a graph with no x/y at all parses");

const materializedWithoutPositions = materializeAgentGraph(parsedWithoutPositions!);
const materializedWithPositions = materializeAgentGraph(parsed!);

assert.deepEqual(
  materializedWithoutPositions.nodes.map((node) => node.position),
  materializedWithPositions.nodes.map((node) => node.position),
  "the app's layout ignores any agent-supplied x/y and lands the same graph in the same place either way",
);

// Divided rather than `%`: the layout centres every diagram on the origin, so
// coordinates are routinely negative, and `-200 % 20` is `-0` — which
// `assert.equal` does not consider equal to `0`.
for (const node of materializedWithoutPositions.nodes) {
  assert.ok(
    Number.isInteger(node.position.x / LAYOUT_GRID),
    `${node.id}.x is grid-aligned`,
  );
  assert.ok(
    Number.isInteger(node.position.y / LAYOUT_GRID),
    `${node.id}.y is grid-aligned`,
  );
}

function boxOf(node: (typeof materializedWithoutPositions)["nodes"][number]) {
  return { x: node.position.x, y: node.position.y, width: node.width!, height: node.height! };
}

const [clientBox, ordersBox] = materializedWithoutPositions.nodes.map(boxOf);
assert.ok(
  clientBox.x + clientBox.width + MIN_NODE_GAP <= ordersBox.x ||
    ordersBox.x + ordersBox.width + MIN_NODE_GAP <= clientBox.x ||
    clientBox.y + clientBox.height + MIN_NODE_GAP <= ordersBox.y ||
    ordersBox.y + ordersBox.height + MIN_NODE_GAP <= clientBox.y,
  "materialized nodes do not overlap once inflated by the node gap",
);

const [materializedEdge] = materializedWithoutPositions.edges;
assert.ok(materializedEdge.sourceHandle, "every materialized edge carries a sourceHandle");
assert.ok(materializedEdge.targetHandle, "every materialized edge carries a targetHandle");
assert.equal(
  materializedEdge.sourceHandle,
  "right",
  "orders-api is laid out to the right of client, so the edge leaves from the right",
);
assert.equal(materializedEdge.targetHandle, "left", "and enters orders-api from the left");

/**
 * The widest graph the contract allows must still be *representable* by the
 * contract after layout.
 *
 * A 40-node chain — the node ceiling — in the widest shape the palette has,
 * with a label on every hop, is the widest thing the contract can describe.
 * `agentGraphNodeSchema` only admits coordinates within ±10,000, and
 * `projectCanvasToAgentGraph` reports anything outside that range as opaque:
 * invisible to an agent reading the canvas back, and enough to make
 * `collidesWithOpaque` reject its next edit with a 409. The layout centres the
 * diagram on the origin precisely so both halves of the range are spent, and
 * this is the assertion that keeps it honest.
 */
const chainGraph = {
  version: 1 as const,
  nodes: Array.from({ length: MAX_AGENT_GRAPH_NODES }, (_, index) => ({
    id: `n-${index}`,
    label: `Node ${index}`,
    // The diamond is the widest default node size, and every edge is labelled:
    // labels used to add their own width on top of the rank gap, which pushed a
    // chain this long past the representable range.
    shape: "diamond" as const,
    color: "blue" as const,
  })),
  edges: Array.from({ length: MAX_AGENT_GRAPH_NODES - 1 }, (_, index) => ({
    id: `e-${index}`,
    source: `n-${index}`,
    target: `n-${index + 1}`,
    label: "publishes to",
  })),
};

const chainSnapshot = materializeAgentGraph(chainGraph);

assert.equal(
  projectCanvasToAgentGraph(chainSnapshot).opaqueNodeIds.length,
  0,
  "the widest graph the contract allows still projects back through the contract with nothing opaque",
);

/**
 * The diagram from the user's original bug report: four edges between one
 * source/target pair. Before the schema and dagre fixes, this was rejected
 * outright (`Source/target edge pairs must be unique.`) and, even past that,
 * crashed `layoutGraph` ("Not possible to find intersection inside of the
 * rectangle") — dagre ranked one edge per pair, but every duplicate still
 * asked it to find rank space for a target three or more sources reached.
 * Both must now pass end to end, whatever the drawn geometry looks like — a
 * closed dagre crash and an open schema are Parts 1 and 2 of this fix; Part 3
 * (routing 3+ parallel edges without crossings) is tracked separately and its
 * limits are documented in `checkParallelGroupSweepHasNoCrossings` in
 * `scripts/verify-graph-layout.ts`, not here.
 */
const fourParallelEdgesGraph = {
  version: 1 as const,
  nodes: [
    { id: "identity", label: "Identity & Sessions", shape: "rectangle" as const, color: "blue" as const },
    { id: "postgres", label: "PostgreSQL", shape: "cylinder" as const, color: "teal" as const },
  ],
  edges: [
    { id: "e0", source: "identity", target: "postgres", label: "reads users" },
    { id: "e1", source: "identity", target: "postgres", label: "reads sessions" },
    { id: "e2", source: "identity", target: "postgres", label: "writes audit log" },
    { id: "e3", source: "identity", target: "postgres", label: "reads refresh tokens" },
  ],
};

const parsedFourParallelEdges = parseAgentGraph(fourParallelEdgesGraph);
assert.ok(parsedFourParallelEdges, "four parallel edges between one pair now parse");

assert.doesNotThrow(
  () => materializeAgentGraph(parsedFourParallelEdges!),
  "four parallel edges between one pair now lay out without dagre throwing",
);

const fourParallelEdgesSnapshot = materializeAgentGraph(parsedFourParallelEdges!);
assert.equal(
  fourParallelEdgesSnapshot.edges.length,
  4,
  "all four edges come back, not deduplicated — they carry four different labels",
);

console.info("Agent graph contract checks passed");
