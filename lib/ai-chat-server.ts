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
 * Statuses that mean "asking again differently will not help".
 *
 * A bad key or a revoked one is not a missing message, and walking the whole
 * recovery ladder against it would spend four round trips per flush arriving at
 * the same refusal. `429` is here for the opposite reason: retrying a rate limit
 * immediately is the one response guaranteed to make it worse.
 */
const UNRECOVERABLE_STATUSES = [401, 403, 429] as const;

/**
 * The recovery policy behind the server upsert.
 *
 * **Liveblocks does not distinguish "missing" from "already exists".** Measured
 * against the live v2 API on this project's key:
 *
 * | request                          | returns                        |
 * | -------------------------------- | ------------------------------ |
 * | PATCH a message that is missing  | `500 Internal Room Error`      |
 * | POST a message ID that exists    | `500 Internal Room Error`      |
 * | POST into a feed that is missing | `500 Internal Room Error`      |
 * | POST a feed that exists          | `409` (the one honest answer)  |
 * | PATCH a message that exists      | `200`                          |
 * | PATCH in a room that is missing  | `404 ROOM_NOT_FOUND`           |
 *
 * So this ladder cannot branch on a status: three different recoverable states
 * arrive as the same opaque 500, and an earlier version of this function keyed
 * on `404`/`409` and therefore rethrew on the *first* write of every run — the
 * assistant row was never created and the whole turn went unrecorded.
 *
 * Each rung is attempted in turn and its failure remembered rather than thrown;
 * only a run out of rungs throws, carrying the first real error so the caller
 * logs something diagnosable. The order is what encodes the intent — update the
 * row, else create it, else create the feed it belongs in, else lose the create
 * race and update after all — and every rung is idempotent, so an attempt that
 * was not needed costs a round trip and changes nothing.
 *
 * The steady state is unaffected: a row that exists is written by rung one, and
 * only the first write of a run pays for the rest.
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
  const createFeed = () => client.createFeed({ roomId, feedId: AI_CHAT_FEED_ID });

  // `createFeed` is a precondition for the create that follows it, not an
  // outcome: a 409 there means the feed was already there, which is exactly
  // what the next rung needs. Its result is deliberately not returned.
  const rungs = [update, create, createFeed, create, update];
  let firstError: unknown;

  for (const [index, attempt] of rungs.entries()) {
    try {
      await attempt();

      if (attempt !== createFeed) {
        return;
      }
    } catch (error: unknown) {
      if (isUnrecoverable(error)) {
        throw error;
      }

      firstError ??= error;

      // Nothing left to try; report the first failure rather than the last,
      // because the later ones are consequences of it.
      if (index === rungs.length - 1) {
        throw firstError;
      }
    }
  }
}

function isUnrecoverable(error: unknown): boolean {
  return UNRECOVERABLE_STATUSES.some((status) => hasStatus(error, status));
}

function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}
