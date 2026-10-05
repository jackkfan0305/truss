import { z } from "zod";

import { NODE_COLORS, NODE_SHAPES, type NodeColor } from "@/types/canvas";

/**
 * The compact agent-graph contract. Kept apart from lib/agent-graph.ts, which
 * pulls in node:crypto, so the browser assistant can validate with the exact
 * schemas the server parses.
 */

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

const agentGraphPositionSchema = z
  .number()
  .int()
  .min(MIN_AGENT_GRAPH_POSITION)
  .max(MAX_AGENT_GRAPH_POSITION);

/** Shared by both node schemas so only the coordinates differ between them. */
const agentGraphNodeFields = {
  id: agentGraphIdSchema,
  label: canonicalTrimmedString(1, MAX_AGENT_GRAPH_NODE_LABEL_LENGTH),
  shape: z.enum(NODE_SHAPES),
  color: z.enum(nodeColorValues),
};

export const agentGraphNodeSchema = z.strictObject({
    ...agentGraphNodeFields,
    x: agentGraphPositionSchema,
    y: agentGraphPositionSchema,
});

/**
 * The API boundary's node. A caller may omit both coordinates and let the
 * server lay the block out; half a pair is a mistake, not a request.
 */
const agentGraphInputNodeSchema = z
  .strictObject({
    ...agentGraphNodeFields,
    x: agentGraphPositionSchema.optional(),
    y: agentGraphPositionSchema.optional(),
  })
  .refine((node) => (node.x === undefined) === (node.y === undefined), {
    message: "Supply both coordinates or omit both for automatic layout.",
  });

export const agentGraphEdgeSchema = z.strictObject({
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
function buildAgentGraphSchema<NodeSchema extends z.ZodType<{ id: string }>>(
  minimumNodes: 0 | 1,
  nodeSchema: NodeSchema,
) {
  return z
    .strictObject({
      version: z.literal(1),
      nodes: z.array(nodeSchema).min(minimumNodes).max(MAX_AGENT_GRAPH_NODES),
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
}

export const agentGraphSchema = buildAgentGraphSchema(1, agentGraphNodeSchema);

/**
 * Same contract as `agentGraphSchema` with the one-node floor lifted. A launch
 * must draw something; an *edit* may legitimately empty a canvas, and rejecting
 * that would make "remove the last node" the one edit the skill cannot express.
 */
export const agentGraphEditSchema = buildAgentGraphSchema(0, agentGraphNodeSchema);

export const agentGraphInputSchema = buildAgentGraphSchema(1, agentGraphInputNodeSchema);
export const agentGraphEditInputSchema = buildAgentGraphSchema(0, agentGraphInputNodeSchema);
