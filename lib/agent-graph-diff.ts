import type { AgentGraphEdge, AgentGraphNode, AgentGraphView } from "@/lib/agent-graph";

export interface AgentGraphDiff {
  addedNodes: AgentGraphNode[];
  updatedNodes: AgentGraphNode[];
  removedNodeIds: string[];
  addedEdges: AgentGraphEdge[];
  updatedEdges: AgentGraphEdge[];
  removedEdgeIds: string[];
}

function nodesEqual(a: AgentGraphNode, b: AgentGraphNode): boolean {
  return (
    a.label === b.label &&
    a.shape === b.shape &&
    a.color === b.color &&
    a.x === b.x &&
    a.y === b.y
  );
}

function edgesEqual(a: AgentGraphEdge, b: AgentGraphEdge): boolean {
  return a.source === b.source && a.target === b.target && a.label === b.label;
}

/**
 * The delta between what is on the canvas and what the caller wants there.
 *
 * Removal is derived from `live.graph` alone, never from the room. Items the
 * projection could not express are absent from `live.graph`, so they are
 * structurally invisible here and cannot be removed — the invariant is the data
 * shape, not a check that could be forgotten.
 */
export function diffAgentGraph(
  live: AgentGraphView,
  desired: AgentGraphView["graph"],
): AgentGraphDiff {
  const liveNodes = new Map(live.graph.nodes.map((node) => [node.id, node]));
  const desiredNodes = new Map(desired.nodes.map((node) => [node.id, node]));
  const liveEdges = new Map(live.graph.edges.map((edge) => [edge.id, edge]));
  const desiredEdges = new Map(desired.edges.map((edge) => [edge.id, edge]));

  const addedNodes: AgentGraphNode[] = [];
  const updatedNodes: AgentGraphNode[] = [];

  // Iterating the deduped maps rather than the raw arrays. A duplicate ID in
  // `desired` would otherwise emit two entries for one item, and the apply step
  // would call `addNodes` twice for the same ID. The schema forbids duplicates,
  // but that is a guarantee of two *other* functions; this signature accepts any
  // graph, so it defends itself rather than trusting callers to have validated.
  for (const node of desiredNodes.values()) {
    const existing = liveNodes.get(node.id);

    if (!existing) {
      addedNodes.push(node);
    } else if (!nodesEqual(existing, node)) {
      updatedNodes.push(node);
    }
  }

  const addedEdges: AgentGraphEdge[] = [];
  const updatedEdges: AgentGraphEdge[] = [];

  for (const edge of desiredEdges.values()) {
    const existing = liveEdges.get(edge.id);

    if (!existing) {
      addedEdges.push(edge);
    } else if (!edgesEqual(existing, edge)) {
      updatedEdges.push(edge);
    }
  }

  return {
    addedNodes,
    updatedNodes,
    removedNodeIds: live.graph.nodes
      .filter((node) => !desiredNodes.has(node.id))
      .map((node) => node.id),
    addedEdges,
    updatedEdges,
    removedEdgeIds: live.graph.edges
      .filter((edge) => !desiredEdges.has(edge.id))
      .map((edge) => edge.id),
  };
}

/**
 * True when the caller reused an ID belonging to something it could not see.
 *
 * `addNodes` replaces on ID collision, so without this an edit would silently
 * overwrite the very item the removal rule exists to protect.
 */
export function collidesWithOpaque(
  live: AgentGraphView,
  desired: AgentGraphView["graph"],
): boolean {
  const opaqueNodes = new Set(live.opaqueNodeIds);
  const opaqueEdges = new Set(live.opaqueEdgeIds);

  return (
    desired.nodes.some((node) => opaqueNodes.has(node.id)) ||
    desired.edges.some((edge) => opaqueEdges.has(edge.id))
  );
}

export function isDestructive(diff: AgentGraphDiff): boolean {
  return diff.removedNodeIds.length > 0 || diff.removedEdgeIds.length > 0;
}
