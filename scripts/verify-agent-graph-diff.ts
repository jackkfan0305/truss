import assert from "node:assert/strict";

import {
  collidesWithOpaque,
  diffAgentGraph,
  isDestructive,
} from "../lib/agent-graph-diff";
import type { AgentGraphView } from "../lib/agent-graph";

function n(id: string, label = "Node", x = 0, y = 0) {
  return { id, label, shape: "rectangle" as const, color: "neutral" as const, x, y };
}

function e(id: string, source: string, target: string, label = "") {
  return { id, source, target, label };
}

function view(
  nodes: ReturnType<typeof n>[],
  edges: ReturnType<typeof e>[] = [],
  opaqueNodeIds: string[] = [],
  opaqueEdgeIds: string[] = [],
): AgentGraphView {
  return { graph: { version: 1, nodes, edges }, opaqueNodeIds, opaqueEdgeIds };
}

// Adds.
{
  const diff = diffAgentGraph(view([n("web")]), { version: 1, nodes: [n("web"), n("db")], edges: [] });

  assert.deepEqual(diff.addedNodes.map((node) => node.id), ["db"]);
  assert.deepEqual(diff.updatedNodes, []);
  assert.deepEqual(diff.removedNodeIds, []);
}

// Updates: label, shape, color and position all count.
{
  const diff = diffAgentGraph(view([n("web", "Web")]), {
    version: 1,
    nodes: [n("web", "Web App")],
    edges: [],
  });

  assert.deepEqual(diff.updatedNodes.map((node) => node.label), ["Web App"]);
  assert.deepEqual(diff.addedNodes, []);
}

{
  const diff = diffAgentGraph(view([n("web", "Web", 0, 0)]), {
    version: 1,
    nodes: [n("web", "Web", 400, 0)],
    edges: [],
  });

  assert.deepEqual(diff.updatedNodes.map((node) => node.x), [400]);
}

// Identical input produces an empty diff.
{
  const diff = diffAgentGraph(view([n("web")]), { version: 1, nodes: [n("web")], edges: [] });

  assert.deepEqual(diff, {
    addedNodes: [],
    updatedNodes: [],
    removedNodeIds: [],
    addedEdges: [],
    updatedEdges: [],
    removedEdgeIds: [],
  });
}

// Removal of a node the agent saw.
{
  const diff = diffAgentGraph(view([n("web"), n("db")]), { version: 1, nodes: [n("web")], edges: [] });

  assert.deepEqual(diff.removedNodeIds, ["db"]);
  assert.equal(isDestructive(diff), true);
}

// THE INVARIANT: a node the agent never saw is never removed.
{
  const diff = diffAgentGraph(
    view([n("web")], [], ["legacy-Node_ID"]),
    { version: 1, nodes: [n("web")], edges: [] },
  );

  assert.deepEqual(diff.removedNodeIds, []);
  assert.equal(isDestructive(diff), false);
}

// Edges: add, update label, remove.
{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [e("web-to-db", "web", "db", "reads")]),
    { version: 1, nodes: [n("web"), n("db")], edges: [e("web-to-db", "web", "db", "writes")] },
  );

  assert.deepEqual(diff.updatedEdges.map((edge) => edge.label), ["writes"]);
}

{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [e("web-to-db", "web", "db")]),
    { version: 1, nodes: [n("web"), n("db")], edges: [] },
  );

  assert.deepEqual(diff.removedEdgeIds, ["web-to-db"]);
  assert.equal(isDestructive(diff), true);
}

// An opaque edge is never removed.
{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [], [], ["hand-drawn-EDGE"]),
    { version: 1, nodes: [n("web"), n("db")], edges: [] },
  );

  assert.deepEqual(diff.removedEdgeIds, []);
}

// An ID that collides with an opaque item is refused outright.
{
  const live = view([n("web")], [], ["Legacy"]);

  assert.equal(collidesWithOpaque(live, { version: 1, nodes: [n("web")], edges: [] }), false);
  assert.equal(
    collidesWithOpaque(live, { version: 1, nodes: [n("web"), n("Legacy")], edges: [] }),
    true,
  );
}

// Emptying a canvas is expressible.
{
  const diff = diffAgentGraph(view([n("web")]), { version: 1, nodes: [], edges: [] });

  assert.deepEqual(diff.removedNodeIds, ["web"]);
}

// --- Extra cases beyond the plan ---

// An edge whose endpoints changed but whose ID stayed the same counts as an
// update, not an add/remove pair — the diff is keyed on ID, and source/target
// are ordinary fields like label.
{
  const diff = diffAgentGraph(
    view([n("web"), n("db"), n("cache")], [e("link", "web", "db")]),
    { version: 1, nodes: [n("web"), n("db"), n("cache")], edges: [e("link", "web", "cache")] },
  );

  assert.deepEqual(diff.updatedEdges.map((edge) => [edge.id, edge.source, edge.target]), [
    ["link", "web", "cache"],
  ]);
  assert.deepEqual(diff.addedEdges, []);
  assert.deepEqual(diff.removedEdgeIds, []);
}

// A desired graph can reference a node being removed in the same diff — the
// diff is a pure delta description, not a plan the diff engine itself
// validates for internal consistency. (Such a graph would fail the strict
// AgentGraph schema's referential-integrity check before ever reaching here;
// the diff engine still must not crash or silently drop the dangling edge.)
{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [e("web-to-db", "web", "db")]),
    { version: 1, nodes: [n("web")], edges: [e("web-to-db", "web", "db")] },
  );

  assert.deepEqual(diff.removedNodeIds, ["db"]);
  // The edge is unchanged by ID/fields, so it is neither added nor updated —
  // it is left untouched by the diff itself, even though its target node is
  // being removed. Reconciliation order (nodes-then-edges) is the apply
  // layer's concern, not the diff's.
  assert.deepEqual(diff.updatedEdges, []);
  assert.deepEqual(diff.addedEdges, []);
  assert.deepEqual(diff.removedEdgeIds, []);
}

// A node that moved AND was relabelled in one edit produces a single update
// carrying both new fields, not two separate changes.
{
  const diff = diffAgentGraph(view([n("web", "Web", 0, 0)]), {
    version: 1,
    nodes: [n("web", "Web App", 400, 250)],
    edges: [],
  });

  assert.deepEqual(diff.updatedNodes, [n("web", "Web App", 400, 250)]);
  assert.deepEqual(diff.addedNodes, []);
  assert.deepEqual(diff.removedNodeIds, []);
}

// Empty live graph with a non-empty desired graph: everything is an add.
{
  const diff = diffAgentGraph(view([]), {
    version: 1,
    nodes: [n("web"), n("db")],
    edges: [e("web-to-db", "web", "db")],
  });

  assert.deepEqual(diff.addedNodes.map((node) => node.id), ["web", "db"]);
  assert.deepEqual(diff.addedEdges.map((edge) => edge.id), ["web-to-db"]);
  assert.deepEqual(diff.removedNodeIds, []);
  assert.deepEqual(diff.removedEdgeIds, []);
  assert.equal(isDestructive(diff), false);
}

// A duplicate ID in `desired` emits ONE entry, not two. The schema rejects
// duplicates upstream, but this function accepts any graph by its signature and
// must not hand the apply step two adds for a single ID.
{
  const diff = diffAgentGraph(view([n("web")]), {
    version: 1,
    nodes: [n("web"), n("db", "First", 100, 0), n("db", "Second", 200, 0)],
    edges: [],
  });

  assert.deepEqual(diff.addedNodes.map((node) => node.id), ["db"]);
  assert.equal(diff.addedNodes.length, 1);
  assert.equal(diff.addedNodes[0].label, "Second", "last duplicate wins");
}

{
  const diff = diffAgentGraph(view([n("web"), n("db")]), {
    version: 1,
    nodes: [n("web"), n("db")],
    edges: [e("dup", "web", "db", "one"), e("dup", "db", "web", "two")],
  });

  assert.equal(diff.addedEdges.length, 1);
  assert.deepEqual(diff.addedEdges.map((edge) => edge.id), ["dup"]);
}

// Both empty: no-op diff, not destructive.
{
  const diff = diffAgentGraph(view([]), { version: 1, nodes: [], edges: [] });

  assert.deepEqual(diff, {
    addedNodes: [],
    updatedNodes: [],
    removedNodeIds: [],
    addedEdges: [],
    updatedEdges: [],
    removedEdgeIds: [],
  });
  assert.equal(isDestructive(diff), false);
}

console.log("verify-agent-graph-diff: ok");
