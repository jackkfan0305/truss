import { tool } from "ai";
import { z } from "zod";

import {
  agentGraphEditInputUnionSchema,
  agentGraphInputUnionSchema,
  agentGraphModelSchema,
} from "@/lib/agent-graph-schema";
import type { AwsCatalogResponse } from "@/lib/aws-catalog";
import { buildRoomId, createRoomIdSuffix } from "@/lib/room-id";

const NOTE_GUIDELINE =
  "Add a note only when the diagram cannot show something important, such as a key design decision or a caveat. Keep it short and plain: one or two sentences a person can read at a glance. Never connect notes.";

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

export type AssistantGraph = z.infer<typeof agentGraphModelSchema>;

/** Recoverable failures keep the server's code and item IDs so the model can revise. */
type ErrorResult = {
  error: string;
  code?: string;
  issues?: unknown;
  itemIds?: unknown;
  boundaryId?: unknown;
  requiredVersion?: unknown;
};

/** What a successful read or write returns: the exact committed graph view. */
export interface AssistantGraphView {
  graph: unknown;
  opaqueNodeIds: string[];
  opaqueEdgeIds?: string[];
  spatial?: unknown;
  fingerprint: string;
}

export interface AssistantActions {
  listDiagrams(): Promise<{ diagrams: { id: string; name: string }[] } | ErrorResult>;
  getAwsCatalog(): Promise<AwsCatalogResponse | ErrorResult>;
  getDiagram(input: {
    diagramId: string;
    signal?: AbortSignal;
  }): Promise<AssistantGraphView | ErrorResult>;
  applyDiagramEdit(input: {
    diagramId: string;
    fingerprint: string;
    graph: AssistantGraph;
  }): Promise<(Partial<AssistantGraphView> & { applied: true; url: string }) | { conflict: string } | ErrorResult>;
  createDiagram(input: {
    title: string;
    graph: AssistantGraph;
  }): Promise<(Partial<AssistantGraphView> & { diagramId: string; url: string }) | (ErrorResult & { url?: string })>;
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
  if (typeof body?.error === "string") return body.error;
  return typeof body?.message === "string" ? body.message : "Truss rejected the request.";
}

function failure(body: CallResult["body"]): ErrorResult {
  const result: ErrorResult = { error: reason(body) };
  if (typeof body?.code === "string") result.code = body.code;
  for (const key of ["issues", "itemIds", "boundaryId", "requiredVersion"] as const) {
    if (body?.[key] !== undefined) result[key] = body[key];
  }
  return result;
}

/** Version 2 graphs use the negotiated endpoints; version 1 graphs keep the original ones. */
function versionQuery(graph: { version: number }): string {
  return graph.version === 2 ? "?version=2" : "";
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

    async getAwsCatalog() {
      const result = await call("/api/agent/catalog", { method: "GET" });
      if (result.status !== 200 || !result.body) return failure(result.body);
      return result.body as unknown as AwsCatalogResponse;
    },

    async getDiagram({ diagramId, signal }) {
      const result = await call(diagramPath(diagramId, "agent-graph?version=2"), { signal });
      if (result.status !== 200 || typeof result.body?.fingerprint !== "string") {
        return failure(result.body);
      }
      return {
        ...result.body,
        graph: result.body.graph,
        opaqueNodeIds: Array.isArray(result.body.opaqueNodeIds)
          ? (result.body.opaqueNodeIds as string[])
          : [],
        fingerprint: result.body.fingerprint,
      };
    },

    async applyDiagramEdit({ diagramId, fingerprint, graph }) {
      const invalid = graphIssues(agentGraphEditInputUnionSchema, graph);
      if (invalid) return { error: invalid };
      const result = await call(
        diagramPath(diagramId, `agent-graph-edit${versionQuery(graph)}`),
        jsonPost({ fingerprint, graph }),
      );
      if (result.status === 200) return { ...result.body, applied: true, url: editorUrl(diagramId) };
      // A 409 with a code is a refused contract, not a stale read.
      if (result.status === 409 && !result.body?.code) {
        return {
          conflict: `${reason(result.body)}. Read the diagram again with get_diagram, reapply your change to the current graph, and submit its new fingerprint.`,
        };
      }
      return failure(result.body);
    },

    async createDiagram({ title, graph }) {
      const invalid = graphIssues(agentGraphInputUnionSchema, graph);
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
        diagramPath(diagramId, `agent-launch-import${versionQuery(graph)}`),
        jsonPost({ launchId: createLaunchId(), graph }),
      );
      if (imported.status !== 200) {
        return { ...failure(imported.body), error: `The diagram was created at ${url} but Truss rejected the graph: ${reason(imported.body)}`, url };
      }
      return { ...imported.body, diagramId, url };
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
    get_aws_catalog: tool({
      description:
        "Read the AWS catalog: every service and boundary id with its description, aliases and category. Use it to pick catalogId values for graph version 2.",
      inputSchema: z.object({}),
      execute: () => actions.getAwsCatalog(),
    }),
    get_diagram: tool({
      description:
        "Read one diagram's version 2 graph, spatial geometry, opaque item ids and fingerprint. Call this before editing, and again after a conflict.",
      inputSchema: z.object({ diagramId: z.string() }),
      execute: (input) => actions.getDiagram(input),
    }),
    apply_diagram_edit: tool({
      description:
        "Replace a diagram's graph with the full desired graph. Pass the fingerprint from the get_diagram call you edited from. Omit x and y for new blocks. " + NOTE_GUIDELINE,
      inputSchema: z.object({ diagramId: z.string(), fingerprint: z.string(), graph: agentGraphModelSchema }),
      execute: (input) => actions.applyDiagramEdit(input),
    }),
    create_diagram: tool({
      description:
        "Create a new diagram with a title and a graph. Start with an overview of four to eight blocks and omit all coordinates. " + NOTE_GUIDELINE,
      inputSchema: z.object({ title: z.string().min(1).max(MAX_TITLE_LENGTH), graph: agentGraphModelSchema }),
      execute: (input) => actions.createDiagram(input),
    }),
  };
}
