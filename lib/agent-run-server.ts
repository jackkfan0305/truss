import { idempotencyKeys } from "@trigger.dev/sdk";

import type { OrchestrateRequest } from "@/lib/orchestrate-requests";
import {
  AI_CHAT_FEED_ID,
  parseAiChatMessage,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks";

interface AiChatFeedReadEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  data: unknown;
}

interface AgentTriggerPayload {
  prompt: string;
  promptMessageId: string;
  roomId: string;
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
}

export interface VerifiedAgentRunDependencies {
  readFeedMessages: (params: {
    roomId: string;
    feedId: string;
  }) => Promise<{ data: AiChatFeedReadEntry[] }>;
  /** Atomically consumes one durable request slot after the prompt is trusted. */
  consumeRequestSlot: (userId: string) => Promise<boolean>;
  trigger: (
    payload: AgentTriggerPayload,
    options: {
      idempotencyKey: Awaited<ReturnType<typeof idempotencyKeys.create>>;
    },
  ) => Promise<{ id: string }>;
}

export type AgentRunStartResult =
  | { status: "started"; runId: string }
  | { status: "unverified" }
  | { status: "rate_limited" };

/**
 * Promotes a browser-supplied prompt ID into trusted worker metadata only after
 * the authenticated server proves that exact human message in the authorized
 * room. Invalid anchors return `null` without reaching Trigger.dev.
 */
export async function startVerifiedAgentRun(
  request: OrchestrateRequest,
  authenticatedUserId: string,
  dependencies: VerifiedAgentRunDependencies,
): Promise<AgentRunStartResult> {
  const { data } = await dependencies.readFeedMessages({
    roomId: request.roomId,
    feedId: AI_CHAT_FEED_ID,
  });
  const entry = data.find((message) => message.id === request.promptMessageId);
  const promptMessage = entry ? parseAiChatMessage(entry.data) : null;

  if (
    !promptMessage ||
    promptMessage.role !== "user" ||
    promptMessage.senderId !== authenticatedUserId ||
    promptMessage.content !== request.prompt
  ) {
    return { status: "unverified" };
  }

  if (!(await dependencies.consumeRequestSlot(authenticatedUserId))) {
    return { status: "rate_limited" };
  }

  // The prompt row is the durable unit of user intent. A browser retry or a
  // concurrent replay receives the original Trigger handle instead of spending
  // another model run or applying the same canvas mutation twice.
  const idempotencyKey = await idempotencyKeys.create(
    [
      "orchestrator",
      authenticatedUserId,
      request.roomId,
      request.promptMessageId,
    ],
    { scope: "global" },
  );

  const handle = await dependencies.trigger(
    {
      prompt: request.prompt,
      promptMessageId: request.promptMessageId,
      roomId: request.roomId,
      modelId: request.modelId,
      thinkingLevel: request.thinkingLevel,
    },
    { idempotencyKey },
  );

  return { status: "started", runId: handle.id };
}
