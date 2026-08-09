import type { DesignRequest } from "@/lib/design-requests";
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

interface DesignAgentTriggerPayload {
  prompt: string;
  promptMessageId: string;
  roomId: string;
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
}

export interface VerifiedDesignRunDependencies {
  readFeedMessages: (params: {
    roomId: string;
    feedId: string;
  }) => Promise<{ data: AiChatFeedReadEntry[] }>;
  trigger: (
    payload: DesignAgentTriggerPayload,
  ) => Promise<{ id: string }>;
}

/**
 * Promotes a browser-supplied prompt ID into trusted worker metadata only after
 * the authenticated server proves that exact human message in the authorized
 * room. Invalid anchors return `null` without reaching Trigger.dev.
 */
export async function startVerifiedDesignRun(
  request: DesignRequest,
  authenticatedUserId: string,
  dependencies: VerifiedDesignRunDependencies,
): Promise<string | null> {
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
    return null;
  }

  const handle = await dependencies.trigger({
    prompt: request.prompt,
    promptMessageId: request.promptMessageId,
    roomId: request.roomId,
    modelId: request.modelId,
    thinkingLevel: request.thinkingLevel,
  });

  return handle.id;
}
