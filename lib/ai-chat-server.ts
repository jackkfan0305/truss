import { createAiChatMessageId } from "@/lib/ai-chat";
import { getLiveblocks } from "@/lib/liveblocks";
import { AI_CHAT_FEED_ID, type AiChatMessage } from "@/types/tasks";

/** Authoritative feed write used by authenticated routes and the AI worker. */
export async function createServerAiChatMessage(
  roomId: string,
  message: AiChatMessage,
  messageId = createAiChatMessageId()
): Promise<string> {
  const client = getLiveblocks();
  const params = {
    roomId,
    feedId: AI_CHAT_FEED_ID,
    data: message,
    id: messageId,
  };

  try {
    await client.createFeedMessage(params);
  } catch {
    await client.createFeed({ roomId, feedId: AI_CHAT_FEED_ID });
    await client.createFeedMessage(params);
  }

  return messageId;
}

/**
 * Updates an assistant's deterministic run message, creating its first
 * snapshot only when the message is missing. A concurrent creator wins by
 * retrying the update, keeping every worker on the same message ID.
 */
export async function upsertServerAiChatMessage(
  roomId: string,
  messageId: string,
  message: AiChatMessage
): Promise<void> {
  const client = getLiveblocks();
  const update = () =>
    client.updateFeedMessage({
      roomId,
      feedId: AI_CHAT_FEED_ID,
      messageId,
      data: message,
    });
  const create = () =>
    client.createFeedMessage({
      roomId,
      feedId: AI_CHAT_FEED_ID,
      id: messageId,
      data: message,
    });

  try {
    await update();
    return;
  } catch (error: unknown) {
    if (!hasStatus(error, 404)) {
      throw error;
    }
  }

  try {
    await create();
    return;
  } catch (error: unknown) {
    if (hasStatus(error, 409)) {
      await update();
      return;
    }

    if (!hasStatus(error, 404)) {
      throw error;
    }
  }

  try {
    await client.createFeed({ roomId, feedId: AI_CHAT_FEED_ID });
  } catch (error: unknown) {
    if (!hasStatus(error, 409)) {
      throw error;
    }
  }

  try {
    await create();
  } catch (error: unknown) {
    if (!hasStatus(error, 409)) {
      throw error;
    }

    await update();
  }
}

function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}
