#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  applyDiagramEdit,
  createDiagram,
  getAwsCatalog,
  getDiagram,
  listDiagrams,
  login,
  deleteDiagram,
} from "./core.mjs";

// Shapes the tool-call arguments for the calling model and rejects unknown
// keys at the transport. The wire-level authority is `validateGraph` inside
// core.mjs, which checks the exact contract with a specific reason. Catalog IDs
// are not enumerated here: truss_get_aws_catalog is the one source.
const shapeShape = z.enum(["rectangle", "diamond", "circle", "pill", "cylinder", "hexagon"]);
const colorShape = z.enum(["neutral", "blue", "purple", "orange", "red", "pink", "green", "teal"]);

const nodeShapeV1 = z.strictObject({
  id: z.string(),
  label: z.string(),
  shape: shapeShape,
  color: colorShape,
  x: z.number().int().optional().describe("Omit both coordinates for new nodes so Truss arranges them. Preserve coordinates returned for existing nodes when editing."),
  y: z.number().int().optional().describe("Supply only together with x; omit both for automatic layout."),
});

const nodeShapeV2 = z.strictObject({
  id: z.string(),
  kind: z.enum(["generic", "aws-service", "boundary"]),
  label: z.string(),
  catalogId: z.string().optional().describe("Required for aws-service and boundary nodes, taken from truss_get_aws_catalog. Never send it for generic nodes."),
  shape: shapeShape.optional().describe("Generic nodes only."),
  color: colorShape.optional().describe("Generic nodes only."),
  parentId: z.string().optional().describe("The boundary that visually holds this node."),
  x: z.number().optional().describe("Top-left, relative to the parent (the canvas for roots). Omit x and y for new nodes."),
  y: z.number().optional().describe("Supply only together with x."),
  width: z.number().optional().describe("Omit unless resizing; supply only together with height."),
  height: z.number().optional().describe("Supply only together with width."),
});

const edgeShape = z.strictObject({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string(),
});

const graphShape = z.union([
  z.strictObject({ version: z.literal(1), nodes: z.array(nodeShapeV1), edges: z.array(edgeShape) }),
  z.strictObject({ version: z.literal(2), nodes: z.array(nodeShapeV2), edges: z.array(edgeShape) }),
]);

const baseUrlShape = z
  .string()
  .optional()
  .describe(
    "The Truss origin to talk to, e.g. http://localhost:3000. Omit unless the user gave one — falls back to TRUSS_APP_URL, then http://localhost:3000.",
  );

const server = new McpServer({ name: "truss-diagram", version: "1.0.0" });

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

server.registerTool(
  "truss_login",
  {
    title: "Link this agent to Truss",
    description:
      "Mint and cache an agent token for a Truss origin by opening its sign-in page once. Every other tool call already does this automatically the first time it needs a credential — call this directly only when the user explicitly asks to sign in or re-link, or after a token was revoked. Opens exactly one browser tab; tell the user that before calling it.",
    inputSchema: { baseUrl: baseUrlShape },
  },
  async ({ baseUrl }) => textResult(await login(baseUrl)),
);

server.registerTool(
  "truss_list_diagrams",
  {
    title: "List the user's Truss diagrams",
    description:
      "Returns the signed-in user's diagram diagrams as { id, name } pairs. Use this to resolve which diagram a create/edit/delete request means — match by name (exact match wins, else a unique substring match, else ask). Authenticates automatically (opening one browser tab) if no credential is cached yet.",
    inputSchema: { baseUrl: baseUrlShape },
  },
  async ({ baseUrl }) => textResult(await listDiagrams(baseUrl)),
);

server.registerTool(
  "truss_get_aws_catalog",
  {
    title: "Read the AWS service and boundary catalog",
    description:
      "Returns every AWS service and boundary the canvas supports: id, name, description, aliases, category and kind. Use the ids as `catalogId` in version 2 graphs and the descriptions to choose between similar services. Public metadata: needs no sign-in and opens no browser tab.",
    inputSchema: { baseUrl: baseUrlShape },
  },
  async ({ baseUrl }) => textResult(await getAwsCatalog(baseUrl)),
);

server.registerTool(
  "truss_get_diagram",
  {
    title: "Read one Truss diagram's graph",
    description:
      "Fetches one diagram's current version 2 graph, its `spatial` geometry and a fingerprint for optimistic-concurrency edits. `spatial` is read-only: never echo bounds or routes into a graph write. `opaqueNodeIds` lists canvas items the compact contract cannot express; treat their bounds as obstacles and never assign one of those ids to a node in an edit. Pass the returned `fingerprint` straight into truss_apply_diagram_edit; never invent one.",
    inputSchema: {
      baseUrl: baseUrlShape,
      diagramId: z.string().describe("A diagram id returned by truss_list_diagrams."),
    },
  },
  async ({ baseUrl, diagramId }) => textResult(await getDiagram(baseUrl, diagramId)),
);

server.registerTool(
  "truss_apply_diagram_edit",
  {
    title: "Apply a full graph to an existing Truss diagram",
    description:
      "Updates a diagram using the complete desiredGraph (use version 2 for AWS services and boundaries). Start with truss_get_diagram, preserve IDs, parent IDs and coordinates for existing nodes, and omit coordinates for new nodes. A successful call returns the committed graph, spatial geometry and new fingerprint; use them for the next edit. Removing a boundary removes its readable descendants, so confirm every affected label first. Never reuse an opaqueNodeIds value. Pass the fingerprint returned by that read. If the graph changed, read it again and reapply your changes before submitting. Remove only items the user asked to remove. Server edits cannot be reversed with browser undo.",
    inputSchema: {
      baseUrl: baseUrlShape,
      diagramId: z.string().describe("A diagram id returned by truss_list_diagrams."),
      fingerprint: z.string().describe("The fingerprint truss_get_diagram returned for this diagram."),
      desiredGraph: graphShape,
    },
  },
  async ({ baseUrl, diagramId, fingerprint, desiredGraph }) =>
    textResult(await applyDiagramEdit(baseUrl, diagramId, fingerprint, desiredGraph)),
);

server.registerTool(
  "truss_create_diagram",
  {
    title: "Create a new Truss diagram",
    description:
      "Creates a new diagram and draws `graph` into it in one call, returning its editor URL. Start with an understandable overview, normally 4-8 blocks, adding detail when requested. Use short block names and concise relationship labels. Omit node coordinates so Truss arranges the diagram. Use graph version 2 with catalog ids from truss_get_aws_catalog for AWS services and nested boundaries. Use stable lowercase kebab-case ids, cylinders for durable stores, diamonds for decisions, and circles for people or external actors. Do not include secrets in labels.",
    inputSchema: {
      baseUrl: baseUrlShape,
      title: z.string().describe("The diagram's title, 1-120 trimmed characters."),
      graph: graphShape,
    },
  },
  async ({ baseUrl, title, graph }) => textResult(await createDiagram(baseUrl, title, graph)),
);

server.registerTool(
  "truss_delete_diagram",
  {
    title: "Delete a Truss diagram",
    description:
      "Deletes a diagram owned by the linked user and reports success after deletion completes. Use truss_list_diagrams to resolve the exact diagram requested by the user. Only call when the user has authorized deleting that diagram; ask for clarification if the target is ambiguous. Uses the cached credential without a browser confirmation.",
    inputSchema: {
      baseUrl: baseUrlShape,
      diagramId: z.string().describe("A diagram id returned by truss_list_diagrams."),
    },
  },
  async ({ baseUrl, diagramId }) => textResult(await deleteDiagram(baseUrl, diagramId)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
