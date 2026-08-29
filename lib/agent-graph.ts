import { createHash } from "node:crypto";

import { z } from "zod";

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { applyLayout } from "@/lib/graph-layout";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_COLORS,
  NODE_DEFAULT_SIZES,
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
  type NodeColor,
} from "@/types/canvas";

export const MAX_AGENT_GRAPH_NODES = 40;
export const MAX_AGENT_GRAPH_EDGES = 60;

const AGENT_GRAPH_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_AGENT_GRAPH_ID_LENGTH = 48;
const MAX_AGENT_GRAPH_NODE_LABEL_LENGTH = 80;
const MAX_AGENT_GRAPH_EDGE_LABEL_LENGTH = 40;
const MIN_AGENT_GRAPH_POSITION = -10_000;
const MAX_AGENT_GRAPH_POSITION = 10_000;

const agentGraphIdSchema = z
  .string()
  .min(1)
  .max(MAX_AGENT_GRAPH_ID_LENGTH)
  .regex(AGENT_GRAPH_ID_PATTERN);

function canonicalTrimmedString(minimumLength: number, maximumLength: number) {
  return z.string().min(minimumLength).max(maximumLength).refine(
    (value) => value === value.trim(),
    { message: "Value must already be trimmed." },
  );
}

const nodeColorValues = Object.keys(NODE_COLORS) as [NodeColor, ...NodeColor[]];

const agentGraphNodeSchema = z.strictObject({
    id: agentGraphIdSchema,
    label: canonicalTrimmedString(1, MAX_AGENT_GRAPH_NODE_LABEL_LENGTH),
    shape: z.enum(NODE_SHAPES),
    color: z.enum(nodeColorValues),
    // The app lays out every graph itself (`materializeAgentGraph`), so these
    // are optional going forward. Kept validated when present — with the same
    // int/range rule as before — so an older agent that still sends them
    // cannot start failing; the values are simply ignored once parsed.
    x: z.number().int().min(MIN_AGENT_GRAPH_POSITION).max(MAX_AGENT_GRAPH_POSITION).optional(),
    y: z.number().int().min(MIN_AGENT_GRAPH_POSITION).max(MAX_AGENT_GRAPH_POSITION).optional(),
});

const agentGraphEdgeSchema = z.strictObject({
    id: agentGraphIdSchema,
    source: agentGraphIdSchema,
    target: agentGraphIdSchema,
    label: canonicalTrimmedString(0, MAX_AGENT_GRAPH_EDGE_LABEL_LENGTH),
});

/**
 * The node minimum is the one difference between a launch and an edit: a
 * launch must draw something onto a blank canvas, but an edit may legitimately
 * empty one. Factored out so both schemas share every other rule verbatim.
 */
function buildAgentGraphSchema(minimumNodes: 0 | 1) {
  return z
    .strictObject({
      version: z.literal(1),
      nodes: z.array(agentGraphNodeSchema).min(minimumNodes).max(MAX_AGENT_GRAPH_NODES),
      edges: z.array(agentGraphEdgeSchema).max(MAX_AGENT_GRAPH_EDGES),
    })
    .superRefine((graph, context) => {
      const nodeIds = new Set<string>();

      for (const [index, node] of graph.nodes.entries()) {
        if (nodeIds.has(node.id)) {
          context.addIssue({
            code: "custom",
            message: "Node IDs must be unique.",
            path: ["nodes", index, "id"],
          });
        }
        nodeIds.add(node.id);
      }

      const edgeIds = new Set<string>();
      // Keyed on source+target+label, not just source+target: two edges
      // between the same pair are two distinct relationships as long as their
      // labels differ, and rejecting that outright is what made
      // `dedupeEdges` (lib/graph-layout.ts) unreachable and left an agent no
      // way to express a request edge and a response edge between one pair.
      // An exact repeat of all three fields is still rejected here rather
      // than left for `dedupeEdges` to quietly drop: `parseAgentGraph` is
      // documented as strict, all-or-nothing, "no malformed field or entry is
      // repaired" — silently discarding one of two edges an agent explicitly
      // asked for would break that promise, and a validation error the agent
      // can see and correct is better than a diagram missing an edge it
      // thinks it drew. `dedupeEdges` still runs on every materialize call —
      // it stays live for content that reaches it by some path other than
      // this schema (a future direct caller, e.g.), it just never fires for
      // agent-authored graphs, which all pass through here first.
      const endpointTriples = new Set<string>();

      for (const [index, edge] of graph.edges.entries()) {
        if (edgeIds.has(edge.id)) {
          context.addIssue({
            code: "custom",
            message: "Edge IDs must be unique.",
            path: ["edges", index, "id"],
          });
        }
        edgeIds.add(edge.id);

        if (edge.source === edge.target) {
          context.addIssue({
            code: "custom",
            message: "Edges cannot be self-loops.",
            path: ["edges", index, "target"],
          });
        }

        if (!nodeIds.has(edge.source)) {
          context.addIssue({
            code: "custom",
            message: "Edge source must name a graph node.",
            path: ["edges", index, "source"],
          });
        }

        if (!nodeIds.has(edge.target)) {
          context.addIssue({
            code: "custom",
            message: "Edge target must name a graph node.",
            path: ["edges", index, "target"],
          });
        }

        // JSON-encoded rather than delimited: source/target stay space-free
        // under `agentGraphIdSchema`, but the label is arbitrary text, and a
        // delimited join would let a label containing the delimiter collide
        // with a different source/target/label combination.
        const triple = JSON.stringify([edge.source, edge.target, edge.label]);
        if (endpointTriples.has(triple)) {
          context.addIssue({
            code: "custom",
            message: "Edges cannot repeat an earlier edge's source, target and label.",
            path: ["edges", index],
          });
        }
        endpointTriples.add(triple);
      }
    });
}

export const agentGraphSchema = buildAgentGraphSchema(1);

/**
 * Same contract as `agentGraphSchema` with the one-node floor lifted. A launch
 * must draw something; an *edit* may legitimately empty a canvas, and rejecting
 * that would make "remove the last node" the one edit the skill cannot express.
 */
const agentGraphEditSchema = buildAgentGraphSchema(0);

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
 *
 * The app owns placement, not the agent: every node is run through
 * `applyLayout` before this returns, so `node.x`/`node.y` are used only as an
 * arbitrary pre-layout placeholder (defaulting to the origin when absent, as
 * they now normally are) and are otherwise discarded, and every edge comes
 * back with `sourceHandle`/`targetHandle` stamped from the laid-out geometry.
 */
export function materializeAgentGraph(graph: AgentGraphView["graph"]): CanvasSnapshot {
  const nodes: CanvasNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: CANVAS_NODE_TYPE,
    position: { x: node.x ?? 0, y: node.y ?? 0 },
    ...NODE_DEFAULT_SIZES[node.shape],
    data: { label: node.label, shape: node.shape, color: node.color },
  }));
  const edges: CanvasEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    type: CANVAS_EDGE_TYPE,
    source: edge.source,
    target: edge.target,
    data: { label: edge.label },
    style: { ...CANVAS_EDGE_STYLE },
    markerEnd: { ...CANVAS_EDGE_MARKER },
  }));

  // Generated content: a model that emits the same relationship twice should
  // not cost the diagram two overlapping lines and two stacked labels.
  return applyLayout(nodes, edges, { dedupe: true });
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
export function projectCanvasToAgentGraph(snapshot: CanvasSnapshot): AgentGraphView {
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

    // A duplicate ID is opaque rather than a second entry. The live room cannot
    // produce one — Liveblocks keys nodes by ID — but this function is typed for
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
  // Keyed on source+target+label, matching `buildAgentGraphSchema`'s own
  // triple: two edges sharing a pair but differing in label are two distinct
  // relationships, not a collision, so only an exact triple repeat makes a
  // later edge opaque. JSON-encoded rather than delimited for the same reason
  // as the schema's key — the label is arbitrary text, not constrained to be
  // delimiter-free the way an ID is.
  const seenTriples = new Set<string>();

  for (const edge of snapshot.edges) {
    const label = edge.data?.label ?? "";
    const parsed = agentGraphEdgeSchema.safeParse({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label,
    });
    const triple = JSON.stringify([edge.source, edge.target, label]);

    if (
      !parsed.success ||
      !representableNodeIds.has(edge.source) ||
      !representableNodeIds.has(edge.target) ||
      edge.source === edge.target ||
      seenEdgeIds.has(edge.id) ||
      seenTriples.has(triple)
    ) {
      opaqueEdgeIds.push(edge.id);
      continue;
    }

    seenEdgeIds.add(parsed.data.id);
    seenTriples.add(triple);
    edges.push(parsed.data);
  }

  return { graph: { version: 1, nodes, edges }, opaqueNodeIds, opaqueEdgeIds };
}

/**
 * A stable hash of the whole live room, opaque items included.
 *
 * Optimistic concurrency for edits: the read hands this out, the apply hands it
 * back, and the server recomputes it under the same `mutateFlow` callback that
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
