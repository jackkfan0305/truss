import { createHash } from "node:crypto";

import type {
  OrchestrateRequest,
  OrchestratorPayload,
} from "@/lib/orchestrate-requests";
import {
  AI_CHAT_FEED_ID,
  parseAiChatMessage,
} from "@/types/tasks";

interface AiChatFeedReadEntry {
  id: string;
  createdAt: number;
  updatedAt: number;
  data: unknown;
}

export interface VerifiedAgentRunDependencies {
  readFeedMessages: (params: {
    roomId: string;
    feedId: string;
  }) => Promise<{ data: AiChatFeedReadEntry[] }>;
  /** Atomically consumes one durable request slot after the prompt is trusted. */
  consumeRequestSlot: (userId: string) => Promise<boolean>;
}

export type AgentRunStartResult =
  | { status: "started"; runId: string; payload: OrchestratorPayload }
  | { status: "unverified" }
  | { status: "rate_limited" };

/**
 * Promotes a browser-supplied prompt ID into a trusted run payload only after
 * the authenticated server proves that exact human message in the authorized
 * room. Invalid anchors never reach the model.
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

  return {
    status: "started",
    runId: agentRunId(authenticatedUserId, request.roomId, request.promptMessageId),
    payload: {
      prompt: request.prompt,
      promptMessageId: request.promptMessageId,
      roomId: request.roomId,
      modelId: request.modelId,
      thinkingLevel: request.thinkingLevel,
    },
  };
}

/**
 * The prompt row is the durable unit of user intent, so its run ID is derived
 * from it. A browser retry or a concurrent replay lands on the same ID, and the
 * `TaskRun` unique constraint refuses the second run instead of spending another
 * model call or applying the same canvas mutation twice.
 */
export function agentRunId(
  userId: string,
  roomId: string,
  promptMessageId: string,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["orchestrator", userId, roomId, promptMessageId]))
    .digest("hex");

  return `run_${digest.slice(0, 32)}`;
}
