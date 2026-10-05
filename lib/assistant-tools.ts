import { tool } from "ai";
import { z } from "zod";

import { agentGraphEditInputSchema, agentGraphInputSchema } from "@/lib/agent-graph-schema";
import { buildRoomId, createRoomIdSuffix } from "@/lib/room-id";
import { NODE_COLORS, NODE_SHAPES, type NodeColor } from "@/types/canvas";

/**
 * The browser assistant's diagram tools. Each one calls the same endpoint the
 * terminal agent's MCP uses, with the signed-in session cookie, so the server
 * stays the only place a graph is laid out and written. Graphs are checked
 * against the server's own schemas first, so a bad graph makes no request.
 */

export type AssistantFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Ends the turn instead of going back to the model. */
export class AssistantStopError extends Error {}

const SIGN_IN_AGAIN = "Sign in again to edit this diagram.";
const MAX_CREATE_ATTEMPTS = 3;
const MAX_TITLE_LENGTH = 120;

const nodeColorValues = Object.keys(NODE_COLORS) as [NodeColor, ...NodeColor[]];

// Loose on purpose, like the MCP's schema: refinements do not survive the
// JSON schema the model sees. The actions validate against the real contract.
const graphSchema = z.object({
  version: z.literal(1),
  nodes: z.array(
    z.object({
      id: z.string().describe("Unique lowercase kebab-case id, at most 48 characters."),
      label: z.string().describe("Short label, at most 80 characters, no surrounding spaces."),
      shape: z.enum(NODE_SHAPES),
      color: z.enum(nodeColorValues),
      x: z.number().int().optional().describe("Omit x and y for new blocks so Truss lays them out. Keep the values you read for existing blocks."),
      y: z.number().int().optional().describe("Supply only together with x."),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().describe("Unique lowercase kebab-case id."),
      source: z.string(),
      target: z.string(),
      label: z.string().describe("At most 40 characters. Empty string for no label."),
    }),
  ),
});

export type AssistantGraph = z.infer<typeof graphSchema>;

type ErrorResult = { error: string };

export interface AssistantActions {
  listDiagrams(): Promise<{ diagrams: { id: string; name: string }[] } | ErrorResult>;
  getDiagram(input: {
    diagramId: string;
    signal?: AbortSignal;
  }): Promise<{ graph: unknown; opaqueNodeIds: string[]; fingerprint: string } | ErrorResult>;
  applyDiagramEdit(input: {
    diagramId: string;
    fingerprint: string;
    graph: AssistantGraph;
  }): Promise<{ applied: true; url: string } | { conflict: string } | ErrorResult>;
  createDiagram(input: {
    title: string;
    graph: AssistantGraph;
  }): Promise<{ diagramId: string; url: string } | (ErrorResult & { url?: string })>;
}

interface CallResult {
  status: number;
  body: Record<string, unknown> | null;
}

function editorUrl(diagramId: string): string {
  return `/editor/${diagramId}`;
}

function diagramPath(diagramId: string, suffix: string): string {
  return `/api/diagrams/${encodeURIComponent(diagramId)}/${suffix}`;
}

function reason(body: CallResult["body"]): string {
  return typeof body?.error === "string" ? body.error : "Truss rejected the request.";
}

const MAX_LISTED_ISSUES = 10;

/** The schema's issues with their paths, so the model can fix its graph. */
function graphIssues(schema: z.ZodType, graph: unknown): string | null {
  const parsed = schema.safeParse(graph);
  if (parsed.success) return null;
  const issues = parsed.error.issues
    .slice(0, MAX_LISTED_ISSUES)
    .map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`);
  return `The graph is invalid. Fix it and try again. ${issues.join("; ")}`;
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function createAssistantActions(
  deps: {
    fetch?: AssistantFetch;
    createSuffix?: () => string;
    createLaunchId?: () => string;
  } = {},
): AssistantActions {
  const fetchImpl: AssistantFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const createSuffix = deps.createSuffix ?? (() => createRoomIdSuffix());
  const createLaunchId = deps.createLaunchId ?? (() => crypto.randomUUID());

  async function call(input: string, init?: RequestInit): Promise<CallResult> {
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch {
      throw new AssistantStopError("Truss could not be reached. Check your connection and try again.");
    }
    const body = (await response.json().catch(() => null)) as CallResult["body"];
    if (response.status === 401 || response.status === 403) {
      throw new AssistantStopError(SIGN_IN_AGAIN);
    }
    if (response.status >= 500) {
      throw new AssistantStopError("Truss could not finish that request. Try again.");
    }
    return { status: response.status, body };
  }

  return {
    async listDiagrams() {
      const result = await call("/api/diagrams");
      if (result.status !== 200) return { error: reason(result.body) };
      const diagrams = Array.isArray(result.body?.diagrams) ? result.body.diagrams : [];
      return {
        diagrams: diagrams
          .filter(
            (diagram): diagram is { id: string; name: string } =>
              typeof diagram?.id === "string" && typeof diagram?.name === "string",
          )
          .map(({ id, name }) => ({ id, name })),
      };
    },

    async getDiagram({ diagramId, signal }) {
      const result = await call(diagramPath(diagramId, "agent-graph"), { signal });
      if (result.status !== 200 || typeof result.body?.fingerprint !== "string") {
        return { error: reason(result.body) };
      }
      return {
        graph: result.body.graph,
        opaqueNodeIds: Array.isArray(result.body.opaqueNodeIds)
          ? (result.body.opaqueNodeIds as string[])
          : [],
        fingerprint: result.body.fingerprint,
      };
    },

    async applyDiagramEdit({ diagramId, fingerprint, graph }) {
      const invalid = graphIssues(agentGraphEditInputSchema, graph);
      if (invalid) return { error: invalid };
      const result = await call(
        diagramPath(diagramId, "agent-graph-edit"),
        jsonPost({ fingerprint, graph }),
      );
      if (result.status === 200) return { applied: true, url: editorUrl(diagramId) };
      if (result.status === 409) {
        return {
          conflict: `${reason(result.body)}. Read the diagram again with get_diagram, reapply your change to the current graph, and submit its new fingerprint.`,
        };
      }
      return { error: reason(result.body) };
    },

    async createDiagram({ title, graph }) {
      const invalid = graphIssues(agentGraphInputSchema, graph);
      if (invalid) return { error: invalid };
      let diagramId = "";
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS && !diagramId; attempt += 1) {
        const candidate = buildRoomId(title, createSuffix());
        if (!candidate) {
          return { error: "That title has no letters or digits a diagram ID can use. Pick another title." };
        }
        const created = await call("/api/diagrams", jsonPost({ id: candidate, name: title }));
        if (created.status === 201) diagramId = candidate;
        // 409 means the suffix collided; anything else is final.
        else if (created.status !== 409) return { error: reason(created.body) };
      }
      if (!diagramId) return { error: "Could not find a free diagram ID. Try again." };

      const url = editorUrl(diagramId);
      const imported = await call(
        diagramPath(diagramId, "agent-launch-import"),
        jsonPost({ launchId: createLaunchId(), graph }),
      );
      if (imported.status !== 200) {
        return { error: `The diagram was created at ${url} but Truss rejected the graph: ${reason(imported.body)}`, url };
      }
      return { diagramId, url };
    },
  };
}

export function createAssistantTools(actions: AssistantActions) {
  return {
    list_diagrams: tool({
      description: "List the signed-in user's diagrams (id and name).",
      inputSchema: z.object({}),
      execute: () => actions.listDiagrams(),
    }),
    get_diagram: tool({
      description:
        "Read one diagram's graph and fingerprint. Call this before editing, and again after a conflict.",
      inputSchema: z.object({ diagramId: z.string() }),
      execute: (input) => actions.getDiagram(input),
    }),
    apply_diagram_edit: tool({
      description:
        "Replace a diagram's graph with the full desired graph. Pass the fingerprint from the get_diagram call you edited from. Omit x and y for new blocks.",
      inputSchema: z.object({ diagramId: z.string(), fingerprint: z.string(), graph: graphSchema }),
      execute: (input) => actions.applyDiagramEdit(input),
    }),
    create_diagram: tool({
      description:
        "Create a new diagram with a title and a graph. Start with an overview of four to eight blocks and omit all coordinates.",
      inputSchema: z.object({ title: z.string().min(1).max(MAX_TITLE_LENGTH), graph: graphSchema }),
      execute: (input) => actions.createDiagram(input),
    }),
  };
}
