/**
 * Request parsing for the AI design routes. Same shape as
 * lib/project-requests.ts — pure functions over an already-parsed body, so the
 * handlers stay thin and the rules are assertable without a request.
 */

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

export interface DesignRequest {
  prompt: string;
  promptMessageId: string;
  projectId: string;
  roomId: string;
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
}

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
 * Validates a design trigger body. Returns `null` when the caller should answer
 * 400.
 *
 * `roomId` must equal `projectId`: they are one value doing two jobs
 * (lib/room-id.ts), so accepting a mismatch would let an authorized request for
 * one project trigger generation aimed at another project's room. Rejecting is
 * the only reading that cannot be wrong.
 *
 * `modelId` and `thinkingLevel` are optional and default, but an unrecognized
 * one is refused — see `parseAiDesignModelId`.
 */
export function parseDesignRequest(body: unknown): DesignRequest | null {
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

  if (!projectId || !roomId || roomId !== projectId) {
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
