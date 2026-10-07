import { createHash } from "node:crypto";

import type { z } from "zod";

import {
  agentGraphEdgeSchema,
  agentGraphEditSchema,
  agentGraphInputSchema,
  agentGraphNodeSchema,
  agentGraphSchema,
  agentGraphInputUnionSchema,
  agentGraphNodeV2Schema,
  agentGraphEditInputUnionSchema,
} from "@/lib/agent-graph-schema";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { sortParentsBeforeChildren } from "@/lib/canvas-hierarchy";
import {
  CANVAS_BOUNDARY_TYPE,
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_DEFAULT_SIZES,
  type CanvasNode,
  type NodeColor,
  type NodeShape,
} from "@/types/canvas";

export {
  agentGraphSchema,
  MAX_AGENT_GRAPH_EDGES,
  MAX_AGENT_GRAPH_NODES,
} from "@/lib/agent-graph-schema";

export type AgentGraphInput = z.infer<typeof agentGraphInputSchema>;

/** API input may omit geometry. Legacy fragment launches stay positioned. */
export function parseAgentGraphInput(
  value: unknown,
  allowEmpty = false,
  requestedVersion: number = 1,
): AgentGraphInput | null {
  const schema = allowEmpty ? agentGraphEditInputUnionSchema : agentGraphInputUnionSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  // Reject v2 graphs when v1 is explicitly requested
  if (requestedVersion === 1 && parsed.data.version === 2) {
    return null;
  }

  return parsed.data as AgentGraphInput;
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
 * Handles both V1 and V2 graphs. V2 graphs may include AWS identity and nesting;
 * V1 graphs remain purely generic. Nodes are ordered so parents appear before
 * children for correct materialization.
 */
export interface MaterializableNode {
  id: string;
  label: string;
  shape?: NodeShape;
  color?: NodeColor;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentId?: string;
  kind?: CanvasNode["data"]["kind"];
  catalogId?: string;
}

export function materializeAgentGraph(
  graph: { version: number; nodes: MaterializableNode[]; edges: AgentGraphView["graph"]["edges"] },
): CanvasSnapshot {
  const isV2 = graph.version === 2;

  // Sort nodes so parents come before children. The sort only supplies the order;
  // the nodes themselves stay the graph's, so their coordinates survive.
  let sortedNodes = graph.nodes;
  if (isV2) {
    try {
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      const order = sortParentsBeforeChildren(graph.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        position: { x: 0, y: 0 },
        data: { label: node.label, shape: "rectangle", color: "neutral" },
      })) as CanvasNode[]);
      sortedNodes = order.map((node) => byId.get(node.id)!);
    } catch {
      // Hierarchy validation owns the error; here the unsorted nodes are kept.
      sortedNodes = graph.nodes;
    }
  }

  const canvasNodes: CanvasNode[] = sortedNodes.map((node) => {
    const isBoundary = isV2 && node.kind === "boundary";
    const nodeType = isBoundary ? CANVAS_BOUNDARY_TYPE : CANVAS_NODE_TYPE;

    // For V2, use provided dimensions; for V1, use shape defaults
    let width = node.width;
    let height = node.height;
    if (!width || !height) {
      if (isBoundary) {
        width = 400;
        height = 240;
      } else if (isV2) {
        width = 180;
        height = 100;
      } else {
        const defaults = NODE_DEFAULT_SIZES[node.shape ?? "rectangle"];
        width = width ?? defaults.width;
        height = height ?? defaults.height;
      }
    }

    return {
      id: node.id,
      type: nodeType,
      position: { x: node.x ?? 0, y: node.y ?? 0 },
      width,
      height,
      data: {
        label: node.label,
        shape: node.shape || "rectangle",
        color: node.color || "neutral",
        ...(node.kind ? { kind: node.kind } : {}),
        ...(node.catalogId ? { catalogId: node.catalogId } : {}),
      },
      ...(isV2 && node.parentId ? { parentId: node.parentId } : {}),
    };
  });

  return {
    nodes: canvasNodes,
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
        node.data.color === other.data.color &&
        (node.parentId ?? "") === (other.parentId ?? "") &&
        (node.data.kind ?? "") === (other.data.kind ?? "") &&
        (node.data.catalogId ?? "") === (other.data.catalogId ?? "")
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
        (edge.sourceHandle ?? "") === (other.sourceHandle ?? "") &&
        (edge.targetHandle ?? "") === (other.targetHandle ?? "") &&
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

export type AgentGraphNodeV2 = z.infer<typeof agentGraphNodeV2Schema>;

export interface AgentGraphView {
  graph: { version: 1; nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
  opaqueNodeIds: string[];
  opaqueEdgeIds: string[];
}

/** The version 2 projection: AWS identity, parent links, dimensions and fractional positions. */
export interface AgentGraphViewV2 {
  graph: { version: 2; nodes: AgentGraphNodeV2[]; edges: AgentGraphEdge[] };
  opaqueNodeIds: string[];
  opaqueEdgeIds: string[];
}

function projectNodeV2(node: CanvasNode): unknown {
  const kind = node.data?.kind ?? "generic";
  return {
    id: node.id,
    kind,
    label: node.data?.label ?? "",
    ...(kind === "generic"
      ? { shape: node.data?.shape, color: node.data?.color }
      : { catalogId: node.data?.catalogId }),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    x: node.position?.x,
    y: node.position?.y,
    width: node.width,
    height: node.height,
  };
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
export function canvasToAgentGraph(snapshot: CanvasSnapshot): AgentGraphView;
export function canvasToAgentGraph(snapshot: CanvasSnapshot, version: 2): AgentGraphViewV2;
export function canvasToAgentGraph(snapshot: CanvasSnapshot, version: 1 | 2): AgentGraphView | AgentGraphViewV2;
export function canvasToAgentGraph(
  snapshot: CanvasSnapshot,
  version: 1 | 2 = 1,
): AgentGraphView | AgentGraphViewV2 {
  const nodes: Array<AgentGraphNode | AgentGraphNodeV2> = [];
  const opaqueNodeIds: string[] = [];

  const seenNodeIds = new Set<string>();

  for (const node of snapshot.nodes) {
    const candidate = version === 2
      ? projectNodeV2(node)
      : {
          id: node.id,
          label: node.data?.label ?? "",
          shape: node.data?.shape,
          color: node.data?.color,
          x: node.position?.x,
          y: node.position?.y,
        };
    const parsed = (version === 2 ? agentGraphNodeV2Schema : agentGraphNodeSchema).safeParse(candidate);

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

  if (version === 2) {
    // A child is only editable if its parent is a readable boundary; opacity flows down.
    for (let changed = true; changed; ) {
      changed = false;
      const readable = new Map(nodes.map((node) => [node.id, node]));
      for (const node of [...nodes]) {
        const parentId = (node as AgentGraphNodeV2).parentId;
        if (parentId !== undefined && (readable.get(parentId) as AgentGraphNodeV2 | undefined)?.kind !== "boundary") {
          nodes.splice(nodes.indexOf(node), 1);
          opaqueNodeIds.push(node.id);
          changed = true;
        }
      }
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

  return version === 2
    ? { graph: { version: 2, nodes: nodes as AgentGraphNodeV2[], edges }, opaqueNodeIds, opaqueEdgeIds }
    : { graph: { version: 1, nodes: nodes as AgentGraphNode[], edges }, opaqueNodeIds, opaqueEdgeIds };
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
      node.parentId ?? "",
      node.data?.kind ?? "",
      node.data?.catalogId ?? "",
    ]);
  const edges = [...snapshot.edges]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => [
      edge.id,
      edge.type,
      edge.source,
      edge.target,
      edge.data?.label ?? "",
      edge.sourceHandle ?? "",
      edge.targetHandle ?? "",
    ]);

  return createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex");
}
