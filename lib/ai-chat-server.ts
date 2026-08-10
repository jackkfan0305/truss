import { createAiChatMessageId } from "@/lib/ai-chat";
import { getLiveblocks } from "@/lib/liveblocks";
import { AI_CHAT_FEED_ID, type AiChatMessage } from "@/types/tasks";

/** The narrow server-side Liveblocks surface required for a chat-message upsert. */
export interface AiChatFeedClient {
  updateFeedMessage: (params: {
    roomId: string;
    feedId: string;
    messageId: string;
    data: AiChatMessage;
  }) => Promise<unknown>;
  createFeedMessage: (params: {
    roomId: string;
    feedId: string;
    id: string;
    data: AiChatMessage;
  }) => Promise<unknown>;
  createFeed: (params: { roomId: string; feedId: string }) => Promise<unknown>;
}

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
  await upsertAiChatMessageWithClient(
    getLiveblocks(),
    roomId,
    messageId,
    message
  );
}

/**
 * The recovery policy behind the server upsert. Its narrow client dependency
 * makes 404 and deterministic-ID race handling verifiable without a room.
 */
export async function upsertAiChatMessageWithClient(
  client: AiChatFeedClient,
  roomId: string,
  messageId: string,
  message: AiChatMessage
): Promise<void> {
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
