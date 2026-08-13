import { z } from "zod";

import { agentGraphSchema, type AgentGraph } from "@/lib/agent-graph";
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/project-requests";

export const AGENT_LAUNCH_VERSION = 1 as const;
export const AGENT_LAUNCH_PATH = "/agent/new";
export const AGENT_LAUNCH_QUERY_KEY = "launch";
export const AGENT_LAUNCH_STORAGE_PREFIX = "truss.agent-launch.graph.v1:";
export const MAX_AGENT_LAUNCH_FRAGMENT_LENGTH = 16_384;

const AGENT_LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const agentLaunchTitleSchema = z.string().min(1).max(MAX_PROJECT_NAME_LENGTH).refine(
  (value) => value === value.trim(),
  { message: "Title must already be trimmed." },
);

export interface AgentLaunchPayloadV1 {
  version: typeof AGENT_LAUNCH_VERSION;
  launchId: string;
  title: string;
  graph: AgentGraph;
}

export type AgentLaunchStage =
  | "captured"
  | "creating-project"
  | "project-created"
  | "importing-graph"
  | "graph-imported"
  | "failed";

export interface AgentLaunchRecord extends AgentLaunchPayloadV1 {
  stage: AgentLaunchStage;
  projectId?: string;
  error?: string;
}

const agentLaunchPayloadSchema = z.strictObject({
  version: z.literal(AGENT_LAUNCH_VERSION),
  launchId: z.string().regex(AGENT_LAUNCH_ID_PATTERN),
  title: agentLaunchTitleSchema,
  graph: agentGraphSchema,
});

const agentLaunchStageSchema = z.enum([
  "captured",
  "creating-project",
  "project-created",
  "importing-graph",
  "graph-imported",
  "failed",
]);

const agentLaunchRecordSchema = z.strictObject({
  version: z.literal(AGENT_LAUNCH_VERSION),
  launchId: z.string().regex(AGENT_LAUNCH_ID_PATTERN),
  title: agentLaunchTitleSchema,
  graph: agentGraphSchema,
  stage: agentLaunchStageSchema,
  projectId: z.string().optional(),
  error: z.string().optional(),
});

const agentLaunchTransitions: Record<
  AgentLaunchStage,
  readonly AgentLaunchStage[]
> = {
  captured: ["creating-project", "failed"],
  "creating-project": ["project-created", "failed"],
  "project-created": ["importing-graph", "failed"],
  "importing-graph": ["graph-imported", "failed"],
  "graph-imported": [],
  failed: ["creating-project", "importing-graph", "failed"],
};

function decodeBase64Url(value: string): string | null {
  if (!BASE64URL_PATTERN.test(value)) {
    return null;
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseAgentLaunchPayload(raw: unknown): AgentLaunchPayloadV1 | null {
  const parsed = agentLaunchPayloadSchema.safeParse(raw);

  return parsed.success ? { ...parsed.data } : null;
}

function copyAgentGraph(graph: AgentGraph): AgentGraph {
  return {
    version: graph.version,
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

export function isAgentLaunchId(value: unknown): value is string {
  return typeof value === "string" && AGENT_LAUNCH_ID_PATTERN.test(value);
}

export function parseAgentLaunchFragment(hash: string): AgentLaunchPayloadV1 | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;

  if (!fragment || fragment.length > MAX_AGENT_LAUNCH_FRAGMENT_LENGTH) {
    return null;
  }

  const decoded = decodeBase64Url(fragment);

  if (decoded === null) {
    return null;
  }

  try {
    return parseAgentLaunchPayload(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export function parseAgentLaunchRecord(raw: string | null): AgentLaunchRecord | null {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = agentLaunchRecordSchema.safeParse(JSON.parse(raw));

    return parsed.success ? { ...parsed.data } : null;
  } catch {
    return null;
  }
}

export function createAgentLaunchRecord(
  payload: AgentLaunchPayloadV1,
): AgentLaunchRecord {
  const parsed = agentLaunchPayloadSchema.parse(payload);

  return { ...parsed, graph: copyAgentGraph(parsed.graph), stage: "captured" };
}

export function agentLaunchStorageKey(launchId: string): string {
  return `${AGENT_LAUNCH_STORAGE_PREFIX}${launchId}`;
}

export function withAgentLaunchStage(
  record: AgentLaunchRecord,
  stage: AgentLaunchStage,
  fields?: Pick<AgentLaunchRecord, "projectId" | "error">,
): AgentLaunchRecord {
  if (!agentLaunchTransitions[record.stage].includes(stage)) {
    throw new Error(`Cannot transition agent launch from ${record.stage} to ${stage}`);
  }

  return { ...record, ...fields, graph: copyAgentGraph(record.graph), stage };
}
