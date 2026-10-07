import { z } from "zod";

import { NODE_COLORS, NODE_SHAPES, type NodeColor } from "@/types/canvas";
import { getAwsCatalogEntry } from "@/lib/aws-catalog";

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

// Version 2 graph schemas with AWS service and boundary support
const coordinateV2 = z.number().finite().min(-10_000).max(10_000);
const dimensionV2 = z.number().finite().positive().max(1_000_000);

const genericV2Fields = {
  kind: z.literal("generic"),
  shape: z.enum(NODE_SHAPES),
  color: z.enum(nodeColorValues),
};

const serviceV2Fields = {
  kind: z.literal("aws-service"),
  catalogId: z.string(),
};

const boundaryV2Fields = {
  kind: z.literal("boundary"),
  catalogId: z.string(),
};

const baseV2 = {
  id: agentGraphIdSchema,
  label: canonicalTrimmedString(1, MAX_AGENT_GRAPH_NODE_LABEL_LENGTH),
  parentId: agentGraphIdSchema.optional(),
  x: coordinateV2.optional(),
  y: coordinateV2.optional(),
  width: dimensionV2.optional(),
  height: dimensionV2.optional(),
};

export const agentGraphNodeV2Schema = z
  .discriminatedUnion("kind", [
    z.strictObject({ ...baseV2, ...genericV2Fields }),
    z.strictObject({ ...baseV2, ...serviceV2Fields }),
    z.strictObject({ ...baseV2, ...boundaryV2Fields }),
  ])
  .superRefine((node, context) => {
    if ((node.x === undefined) !== (node.y === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["x"],
        message: "Supply both coordinates or omit both.",
      });
    }
    if ((node.width === undefined) !== (node.height === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Supply both dimensions or omit both.",
      });
    }
    if (node.kind !== "generic") {
      const expected = node.kind === "boundary" ? "boundary" : "service";
      if (getAwsCatalogEntry(node.catalogId)?.kind !== expected) {
        context.addIssue({
          code: "custom",
          path: ["catalogId"],
          message: "Catalog ID must match the node kind.",
        });
      }
    }
  });

/**
 * Build version 2 graph schema with hierarchy and topology validation.
 * V2 schemas always include parentId for hierarchy support.
 */
/** The two fields the hierarchy checks read from a v2 node. */
interface HierarchyNode {
  id: string;
  parentId?: string;
  kind?: string;
}

function buildAgentGraphV2Schema(minimumNodes: 0 | 1) {
  return z
    .strictObject({
      version: z.literal(2),
      nodes: z.array(agentGraphNodeV2Schema).min(minimumNodes).max(MAX_AGENT_GRAPH_NODES),
      edges: z.array(agentGraphEdgeSchema).max(MAX_AGENT_GRAPH_EDGES),
    })
    .superRefine((graph, context) => {
      const nodeIds = new Set<string>();
      const byId = new Map<string, HierarchyNode>(graph.nodes.map((node) => [node.id, node]));

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

      // Validate hierarchy
      for (const [index, node] of graph.nodes.entries()) {
        const nodeAny: HierarchyNode = node;
        if (nodeAny.parentId) {
          const parent = byId.get(nodeAny.parentId);
          if (!parent) {
            context.addIssue({
              code: "custom",
              path: ["nodes", index, "parentId"],
              message: "Parent node must exist in the graph.",
            });
            continue;
          }
          if (parent.kind !== "boundary") {
            context.addIssue({
              code: "custom",
              path: ["nodes", index, "parentId"],
              message: "Parent must be a boundary node.",
            });
            continue;
          }

          // Check for cycles
          const visited = new Set([node.id]);
          let nextId: string | undefined = nodeAny.parentId;
          while (nextId) {
            if (visited.has(nextId)) {
              context.addIssue({
                code: "custom",
                path: ["nodes", index, "parentId"],
                message: "Containment cannot contain a cycle.",
              });
              break;
            }
            visited.add(nextId);
            nextId = byId.get(nextId)?.parentId;
          }
        }
      }

      // Validate edges (shared with v1)
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

export const agentGraphV2Schema = buildAgentGraphV2Schema(1);
export const agentGraphV2EditSchema = buildAgentGraphV2Schema(0);

/** Union schemas accepting both v1 and v2 for mixed-version APIs. */
export const agentGraphInputUnionSchema = z.union([agentGraphInputSchema, agentGraphV2Schema]);
export const agentGraphEditInputUnionSchema = z.union([agentGraphEditInputSchema, agentGraphV2EditSchema]);

/**
 * The model-visible v1/v2 graph schema. Loose on purpose: refinements do not
 * survive the JSON schema a model sees, and loose objects pass unknown keys
 * through so the strict schemas above, run at execution, reject them by name.
 */
export const agentGraphModelSchema = z.union([
  z.looseObject({
    version: z.literal(1),
    nodes: z.array(
      z.looseObject({
        id: z.string().describe("Unique lowercase kebab-case id, at most 48 characters."),
        label: z.string().describe("Short label, at most 80 characters, no surrounding spaces."),
        shape: z.enum(NODE_SHAPES),
        color: z.enum(nodeColorValues),
        x: z.number().int().optional().describe("Omit x and y for new blocks so Truss lays them out. Keep the values you read for existing blocks."),
        y: z.number().int().optional().describe("Supply only together with x."),
      }),
    ),
    edges: z.array(agentGraphEdgeModelSchema()),
  }),
  z.looseObject({
    version: z.literal(2),
    nodes: z.array(
      z.looseObject({
        id: z.string().describe("Unique lowercase kebab-case id, at most 48 characters."),
        kind: z.enum(["generic", "aws-service", "boundary"]),
        label: z.string().describe("Short label, at most 80 characters, no surrounding spaces."),
        catalogId: z.string().optional().describe("Required for aws-service and boundary nodes; an id from get_aws_catalog. Never send it for generic nodes."),
        shape: z.enum(NODE_SHAPES).optional().describe("Generic nodes only."),
        color: z.enum(nodeColorValues).optional().describe("Generic nodes only."),
        parentId: z.string().optional().describe("The id of the boundary that visually holds this node."),
        x: z.number().optional().describe("Top-left, relative to the parent (the canvas for roots). Omit x and y for new nodes."),
        y: z.number().optional().describe("Supply only together with x."),
        width: z.number().optional().describe("Omit unless resizing; supply only together with height."),
        height: z.number().optional().describe("Supply only together with width."),
      }),
    ),
    edges: z.array(agentGraphEdgeModelSchema()),
  }),
]);

function agentGraphEdgeModelSchema() {
  return z.looseObject({
    id: z.string().describe("Unique lowercase kebab-case id."),
    source: z.string(),
    target: z.string(),
    label: z.string().describe("At most 40 characters. Empty string for no label."),
  });
}
