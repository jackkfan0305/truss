import { createHash } from "node:crypto";

import type { z } from "zod";

import {
  agentGraphEdgeSchema,
  agentGraphEditInputSchema,
  agentGraphEditSchema,
  agentGraphInputSchema,
  agentGraphNodeSchema,
  agentGraphSchema,
} from "@/lib/agent-graph-schema";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_DEFAULT_SIZES,
} from "@/types/canvas";

export {
  agentGraphSchema,
  MAX_AGENT_GRAPH_EDGES,
  MAX_AGENT_GRAPH_NODES,
} from "@/lib/agent-graph-schema";

export type AgentGraphInput = z.infer<typeof agentGraphInputSchema>;

/** API input may omit geometry. Legacy fragment launches stay positioned. */
export function parseAgentGraphInput(value: unknown, allowEmpty = false): AgentGraphInput | null {
  const parsed = (allowEmpty ? agentGraphEditInputSchema : agentGraphInputSchema).safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type AgentGraph = z.infer<typeof agentGraphSchema>;

/**
 * Strictly accepts the compact caller graph. Unlike stored canvas snapshots,
 * launches are all-or-nothing: no malformed field or entry is repaired.
 */
export function parseAgentGraph(value: unknown): AgentGraph | null {
  const parsed = agentGraphSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * Materializes compact graph values into the one canonical canvas snapshot.
 *
 * Takes `AgentGraphView["graph"]` rather than the stricter `AgentGraph` — the
 * body only reads fields both share, and the edit path legitimately produces a
 * zero-node graph that `AgentGraph` alone would not type.
 */
export function materializeAgentGraph(graph: AgentGraphView["graph"]): CanvasSnapshot {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      type: CANVAS_NODE_TYPE,
      position: { x: node.x, y: node.y },
      ...NODE_DEFAULT_SIZES[node.shape],
      data: { label: node.label, shape: node.shape, color: node.color },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      type: CANVAS_EDGE_TYPE,
      source: edge.source,
      target: edge.target,
      data: { label: edge.label },
      style: { ...CANVAS_EDGE_STYLE },
      markerEnd: { ...CANVAS_EDGE_MARKER },
    })),
  };
}

/**
 * Compares the fields a compact graph materializes. This deliberately ignores
 * non-canonical React Flow fields so a storage wrapper cannot defeat replay
 * detection by adding presentation-only metadata.
 */
export function canonicalCanvasSnapshotsEqual(
  a: CanvasSnapshot,
  b: CanvasSnapshot,
): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) {
    return false;
  }

  const leftNodes = [...a.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const rightNodes = [...b.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const leftEdges = [...a.edges].sort((left, right) => left.id.localeCompare(right.id));
  const rightEdges = [...b.edges].sort((left, right) => left.id.localeCompare(right.id));

  return (
    leftNodes.every((node, index) => {
      const other = rightNodes[index];

      return (
        node.id === other.id &&
        node.type === other.type &&
        node.position.x === other.position.x &&
        node.position.y === other.position.y &&
        node.width === other.width &&
        node.height === other.height &&
        node.data.label === other.data.label &&
        node.data.shape === other.data.shape &&
        node.data.color === other.data.color
      );
    }) &&
    leftEdges.every((edge, index) => {
      const other = rightEdges[index];

      return (
        edge.id === other.id &&
        edge.type === other.type &&
        edge.source === other.source &&
        edge.target === other.target &&
        (edge.data?.label ?? "") === (other.data?.label ?? "") &&
        edge.style?.stroke === other.style?.stroke &&
        edge.style?.strokeWidth === other.style?.strokeWidth &&
        edge.style?.strokeLinecap === other.style?.strokeLinecap &&
        JSON.stringify(edge.markerEnd) === JSON.stringify(other.markerEnd)
      );
    })
  );
}

export type AgentGraphNode = AgentGraph["nodes"][number];
export type AgentGraphEdge = AgentGraph["edges"][number];

export interface AgentGraphView {
  graph: { version: 1; nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
  opaqueNodeIds: string[];
  opaqueEdgeIds: string[];
}

/**
 * Same contract as `parseAgentGraph` with the one-node floor lifted — the edit
 * path, not the launch path.
 */
export function parseAgentGraphAllowingEmpty(
  value: unknown,
): AgentGraphView["graph"] | null {
  const parsed = agentGraphEditSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * The compact view of a live canvas, plus the IDs it could not express.
 *
 * Human-authored nodes carry arbitrary IDs, long labels and hand-dragged
 * fractional positions — none of which fit the compact contract. They are
 * reported as opaque rather than dropped, because a caller that cannot see an
 * item must never be able to delete it.
 */
export function canvasToAgentGraph(snapshot: CanvasSnapshot): AgentGraphView {
  const nodes: AgentGraphNode[] = [];
  const opaqueNodeIds: string[] = [];

  const seenNodeIds = new Set<string>();

  for (const node of snapshot.nodes) {
    const candidate = {
      id: node.id,
      label: node.data?.label ?? "",
      shape: node.data?.shape,
      color: node.data?.color,
      x: node.position?.x,
      y: node.position?.y,
    };
    const parsed = agentGraphNodeSchema.safeParse(candidate);

    // A duplicate ID is opaque rather than a second entry. The stored snapshot
    // cannot produce one because IDs are keys, but this function is typed for
    // any snapshot, and a duplicate would survive into `graph.nodes`, where the
    // diff's `new Map(...)` would silently collapse the two into one and drop a
    // physically distinct node from its removal basis.
    if (parsed.success && !seenNodeIds.has(parsed.data.id)) {
      seenNodeIds.add(parsed.data.id);
      nodes.push(parsed.data);
    } else {
      opaqueNodeIds.push(node.id);
    }
  }

  const representableNodeIds = new Set(nodes.map((node) => node.id));
  const edges: AgentGraphEdge[] = [];
  const opaqueEdgeIds: string[] = [];
  const seenEdgeIds = new Set<string>();
  const seenPairs = new Set<string>();

  for (const edge of snapshot.edges) {
    const parsed = agentGraphEdgeSchema.safeParse({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.data?.label ?? "",
    });
    // NUL-joined, matching the schema's own pair key above: unambiguous by
    // construction rather than by relying on the ID pattern excluding spaces.
    const pair = `${edge.source}\u0000${edge.target}`;

    if (
      !parsed.success ||
      !representableNodeIds.has(edge.source) ||
      !representableNodeIds.has(edge.target) ||
      edge.source === edge.target ||
      seenEdgeIds.has(edge.id) ||
      seenPairs.has(pair)
    ) {
      opaqueEdgeIds.push(edge.id);
      continue;
    }

    seenEdgeIds.add(parsed.data.id);
    seenPairs.add(pair);
    edges.push(parsed.data);
  }

  return { graph: { version: 1, nodes, edges }, opaqueNodeIds, opaqueEdgeIds };
}

/**
 * A stable hash of the whole live room, opaque items included.
 *
 * Optimistic concurrency for edits: the read hands this out, the apply hands it
 * back, and the server recomputes it under the same `mutateCanvas` callback that
 * performs the write. Covering opaque items matters — a collaborator editing a
 * node the agent cannot see still invalidates the basis the agent reasoned from.
 */
export function canvasFingerprint(snapshot: CanvasSnapshot): string {
  const nodes = [...snapshot.nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => [
      node.id,
      node.type,
      node.position?.x,
      node.position?.y,
      node.width,
      node.height,
      node.data?.label,
      node.data?.shape,
      node.data?.color,
    ]);
  const edges = [...snapshot.edges]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => [edge.id, edge.type, edge.source, edge.target, edge.data?.label ?? ""]);

  return createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex");
}
