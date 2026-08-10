/**
 * Request parsing for the AI orchestration routes. Same shape as
 * lib/project-requests.ts — pure functions over an already-parsed body, so the
 * handlers stay thin and the rules are assertable without a request.
 *
 * Renamed from `lib/design-requests.ts` in 35-orchestrator-backend. The rules did
 * not change: one prompt, one project, one room, and an allowlist on both run
 * settings. Only what the request starts did.
 */

import { z } from "zod";

import { isProjectId, projectIdSchema } from "@/lib/project-id";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  parseAiDesignModelId,
  parseAiThinkingLevel,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks";

const MAX_PROMPT_LENGTH = 2000;
const MAX_PROMPT_MESSAGE_ID_LENGTH = 256;

/** Trigger.dev run IDs are `run_<cuid>`; the cap is slack, not a format check. */
const MAX_RUN_ID_LENGTH = 100;

export interface OrchestrateRequest {
  prompt: string;
  promptMessageId: string;
  projectId: string;
  roomId: string;
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
}

/**
 * The orchestrator's task payload.
 *
 * A `schemaTask` schema rather than the plain interface `design-agent` uses,
 * because this is the one task the API triggers and its payload is the only
 * thing standing between a queue entry and a paid loop. `modelId` and
 * `thinkingLevel` are plain optional strings here and re-validated against the
 * allowlist by the design agent that consumes them — a task payload is not only
 * ever written by the route.
 */
export const orchestratorPayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  promptMessageId: z.string().trim().min(1).max(MAX_PROMPT_MESSAGE_ID_LENGTH),
  roomId: z.string().trim().pipe(projectIdSchema),
  modelId: z.string().trim().max(80).optional(),
  thinkingLevel: z.string().trim().max(40).optional(),
});

export type OrchestratorPayload = z.infer<typeof orchestratorPayloadSchema>;

function readString(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const raw = (body as Record<string, unknown>)[key];

  return typeof raw === "string" ? raw.trim() : null;
}

/** The raw value at `key`, for the allowlist parsers that narrow it themselves. */
function readValue(body: unknown, key: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }

  return (body as Record<string, unknown>)[key];
}

/**
 * Validates an orchestration trigger body. Returns `null` when the caller should
 * answer 400.
 *
 * `roomId` must equal `projectId`: they are one value doing two jobs
 * (lib/room-id.ts), so accepting a mismatch would let an authorized request for
 * one project trigger work aimed at another project's room. Rejecting is the
 * only reading that cannot be wrong.
 *
 * `modelId` and `thinkingLevel` are optional and default, but an unrecognized
 * one is refused — see `parseAiDesignModelId`.
 */
export function parseOrchestrateRequest(
  body: unknown
): OrchestrateRequest | null {
  const prompt = readString(body, "prompt");
  const promptMessageId = readString(body, "promptMessageId");
  const projectId = readString(body, "projectId");
  const roomId = readString(body, "roomId");
  const modelId = parseAiDesignModelId(readValue(body, "modelId"));
  const thinkingLevel = parseAiThinkingLevel(readValue(body, "thinkingLevel"));

  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return null;
  }

  if (!promptMessageId || promptMessageId.length > MAX_PROMPT_MESSAGE_ID_LENGTH) {
    return null;
  }

  if (
    !projectId ||
    !roomId ||
    roomId !== projectId ||
    !isProjectId(projectId)
  ) {
    return null;
  }

  if (modelId === "invalid" || thinkingLevel === "invalid") {
    return null;
  }

  return {
    prompt,
    promptMessageId,
    projectId,
    roomId,
    modelId: modelId ?? DEFAULT_AI_DESIGN_MODEL_ID,
    thinkingLevel: thinkingLevel ?? DEFAULT_AI_THINKING_LEVEL,
  };
}

/**
 * Validates a token request body. Returns the run ID, or `null` for a 400.
 * Existence and ownership are the database's answer, not this function's.
 */
export function parseRunId(body: unknown): string | null {
  const runId = readString(body, "runId");

  if (!runId || runId.length > MAX_RUN_ID_LENGTH) {
    return null;
  }

  return runId;
}
