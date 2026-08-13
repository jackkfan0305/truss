import { z } from "zod";

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_COLORS,
  NODE_DEFAULT_SIZES,
  NODE_SHAPES,
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
    x: z.number().int().min(MIN_AGENT_GRAPH_POSITION).max(MAX_AGENT_GRAPH_POSITION),
    y: z.number().int().min(MIN_AGENT_GRAPH_POSITION).max(MAX_AGENT_GRAPH_POSITION),
});

const agentGraphEdgeSchema = z.strictObject({
    id: agentGraphIdSchema,
    source: agentGraphIdSchema,
    target: agentGraphIdSchema,
    label: canonicalTrimmedString(0, MAX_AGENT_GRAPH_EDGE_LABEL_LENGTH),
});

export const agentGraphSchema = z
  .strictObject({
    version: z.literal(1),
    nodes: z.array(agentGraphNodeSchema).min(1).max(MAX_AGENT_GRAPH_NODES),
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
    const endpointPairs = new Set<string>();

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

      const pair = `${edge.source}\u0000${edge.target}`;
      if (endpointPairs.has(pair)) {
        context.addIssue({
          code: "custom",
          message: "Source/target edge pairs must be unique.",
          path: ["edges", index],
        });
      }
      endpointPairs.add(pair);
    }
  });

export type AgentGraph = z.infer<typeof agentGraphSchema>;

/**
 * Strictly accepts the compact caller graph. Unlike stored canvas snapshots,
 * launches are all-or-nothing: no malformed field or entry is repaired.
 */
export function parseAgentGraph(value: unknown): AgentGraph | null {
  const parsed = agentGraphSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/** Materializes compact graph values into the one canonical canvas snapshot. */
export function materializeAgentGraph(graph: AgentGraph): CanvasSnapshot {
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
