#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  applyDiagramEdit,
  createDiagram,
  getDiagram,
  listDiagrams,
  login,
  deleteDiagram,
} from "./core.mjs";

// Loose on purpose: the wire-level authority is `validateGraph` inside
// core.mjs, which rejects anything outside the compact graph contract with a
// specific reason. This schema exists to shape tool-call arguments for the
// calling model, not to duplicate that contract's exact bounds.
const nodeShape = z.object({
  id: z.string(),
  label: z.string(),
  shape: z.enum(["rectangle", "diamond", "circle", "pill", "cylinder", "hexagon"]),
  color: z.enum(["neutral", "blue", "purple", "orange", "red", "pink", "green", "teal"]),
  x: z.number().int().optional().describe("Omit both coordinates for new nodes so Truss arranges them. Preserve coordinates returned for existing nodes when editing."),
  y: z.number().int().optional().describe("Supply only together with x; omit both for automatic layout."),
});

const edgeShape = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string(),
});

const graphShape = z.object({
  version: z.literal(1),
  nodes: z.array(nodeShape),
  edges: z.array(edgeShape),
});

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
      "Returns the signed-in user's diagram projects as { id, name } pairs. Use this to resolve which diagram a create/edit/delete request means — match by name (exact match wins, else a unique substring match, else ask). Authenticates automatically (opening one browser tab) if no credential is cached yet.",
    inputSchema: { baseUrl: baseUrlShape },
  },
  async ({ baseUrl }) => textResult(await listDiagrams(baseUrl)),
);

server.registerTool(
  "truss_get_diagram",
  {
    title: "Read one Truss diagram's graph",
    description:
      "Fetches one diagram's current compact graph plus a fingerprint for optimistic-concurrency edits. `opaqueNodeIds` lists canvas items the compact contract cannot express — never assign one of those ids to a node in an edit. Pass the returned `fingerprint` straight into truss_apply_diagram_edit; never invent one.",
    inputSchema: {
      baseUrl: baseUrlShape,
      projectId: z.string().describe("A project id returned by truss_list_diagrams."),
    },
  },
  async ({ baseUrl, projectId }) => textResult(await getDiagram(baseUrl, projectId)),
);

server.registerTool(
  "truss_apply_diagram_edit",
  {
    title: "Apply a full graph to an existing Truss diagram",
    description:
      "Updates a diagram using the complete desiredGraph. Start with truss_get_diagram, preserve IDs and coordinates for existing nodes, and omit coordinates for new nodes. Never reuse an opaqueNodeIds value. Pass the fingerprint returned by that read. If the graph changed, read it again and reapply your changes before submitting. Remove only items the user asked to remove. Server edits cannot be reversed with browser undo.",
    inputSchema: {
      baseUrl: baseUrlShape,
      projectId: z.string().describe("A project id returned by truss_list_diagrams."),
      fingerprint: z.string().describe("The fingerprint truss_get_diagram returned for this project."),
      desiredGraph: graphShape,
    },
  },
  async ({ baseUrl, projectId, fingerprint, desiredGraph }) =>
    textResult(await applyDiagramEdit(baseUrl, projectId, fingerprint, desiredGraph)),
);

server.registerTool(
  "truss_create_diagram",
  {
    title: "Create a new Truss diagram",
    description:
      "Creates a new project and draws `graph` into it in one call, returning its editor URL. Start with an understandable overview, normally 4-8 blocks, adding detail when requested. Use short block names and concise relationship labels. Omit node coordinates so Truss arranges the diagram. Use stable lowercase kebab-case ids, cylinders for durable stores, diamonds for decisions, and circles for people or external actors. Do not include secrets in labels.",
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
      "Deletes a diagram owned by the linked user and reports success after deletion completes. Use truss_list_diagrams to resolve the exact project requested by the user. Only call when the user has authorized deleting that diagram; ask for clarification if the target is ambiguous. Uses the cached credential without a browser confirmation.",
    inputSchema: {
      baseUrl: baseUrlShape,
      projectId: z.string().describe("A project id returned by truss_list_diagrams."),
    },
  },
  async ({ baseUrl, projectId }) => textResult(await deleteDiagram(baseUrl, projectId)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
