import { z } from "zod";

import { MAX_PROJECT_NAME_LENGTH } from "@/lib/project-requests";
import { MAX_CHAT_CONTENT_LENGTH } from "@/types/tasks";

export const AGENT_LAUNCH_VERSION = 1 as const;
export const AGENT_LAUNCH_PATH = "/agent/new";
export const AGENT_LAUNCH_QUERY_KEY = "launch";
export const AGENT_LAUNCH_STORAGE_PREFIX = "truss:agent-launch:v1:";
export const MAX_AGENT_LAUNCH_FRAGMENT_LENGTH = 16_384;

const AGENT_LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface AgentLaunchPayloadV1 {
  version: typeof AGENT_LAUNCH_VERSION;
  launchId: string;
  title: string;
  description: string;
}

export type AgentLaunchStage =
  | "captured"
  | "creating-project"
  | "project-created"
  | "sending-prompt"
  | "prompt-sent"
  | "starting-run"
  | "run-started"
  | "failed";

export interface AgentLaunchRecord extends AgentLaunchPayloadV1 {
  stage: AgentLaunchStage;
  projectId?: string;
  promptMessageId?: string;
  error?: string;
}

const agentLaunchPayloadSchema = z.object({
  version: z.literal(AGENT_LAUNCH_VERSION),
  launchId: z.string().regex(AGENT_LAUNCH_ID_PATTERN),
  title: z.string().trim().min(1).max(MAX_PROJECT_NAME_LENGTH),
  description: z.string().trim().min(1).max(MAX_CHAT_CONTENT_LENGTH),
});

const agentLaunchStageSchema = z.enum([
  "captured",
  "creating-project",
  "project-created",
  "sending-prompt",
  "prompt-sent",
  "starting-run",
  "run-started",
  "failed",
]);

const agentLaunchRecordSchema = agentLaunchPayloadSchema.extend({
  stage: agentLaunchStageSchema,
  projectId: z.string().optional(),
  promptMessageId: z.string().optional(),
  error: z.string().optional(),
});

const agentLaunchTransitions: Record<
  AgentLaunchStage,
  readonly AgentLaunchStage[]
> = {
  captured: ["creating-project", "failed"],
  "creating-project": ["creating-project", "project-created", "failed"],
  "project-created": ["sending-prompt", "failed"],
  "sending-prompt": ["prompt-sent", "failed"],
  "prompt-sent": ["starting-run", "failed"],
  "starting-run": ["run-started", "failed"],
  "run-started": [],
  failed: ["creating-project", "sending-prompt", "starting-run", "failed"],
};

function decodeBase64Url(value: string): string | null {
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
  return { ...payload, stage: "captured" };
}

export function agentLaunchStorageKey(launchId: string): string {
  return `${AGENT_LAUNCH_STORAGE_PREFIX}${launchId}`;
}

export function withAgentLaunchStage(
  record: AgentLaunchRecord,
  stage: AgentLaunchStage,
  fields?: Pick<AgentLaunchRecord, "projectId" | "promptMessageId" | "error">,
): AgentLaunchRecord {
  if (!agentLaunchTransitions[record.stage].includes(stage)) {
    throw new Error(`Cannot transition agent launch from ${record.stage} to ${stage}`);
  }

  return { ...record, ...fields, stage };
}
