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
