import type { XYPosition } from "@xyflow/react";

import { createServerAiChatMessage } from "@/lib/ai-chat-server";
import { getLiveblocks } from "@/lib/liveblocks";
import {
  AI_STATUS_FEED_ID,
  AI_USER_ID,
  AI_USER_NAME,
  MAX_CHAT_CONTENT_LENGTH,
  type AiStatusMessage,
} from "@/types/tasks";

/**
 * The AI's visible side of a background run (23-design-agent-logic): its
 * presence in the room and the status feed everyone reads.
 *
 * Both go through the same Liveblocks room the humans are in — presence via the
 * node SDK's connection-less `setPresence`, status via the room-scoped
 * `ai-status-feed`. No parallel realtime system, per the scope limits.
 *
 * Node-only: it holds the Liveblocks secret.
 */

/** `--accent-ai`. Raw hex for the same reason cursor colours are: it travels as data. */
const AI_COLOR = "#6457f9";

/**
 * Presence expires on its own, which is what makes it safe: a task that is
 * killed mid-run leaves a ghost avatar for at most this long rather than
 * forever. Comfortably longer than a design run, which the task caps at three
 * minutes.
 *
 * ponytail: no heartbeat. If `maxDuration` ever passes this, refresh presence
 * between steps instead of raising the TTL to the 3599s maximum.
 */
const PRESENCE_TTL_SECONDS = 300;

/** The floor the API allows — used to retire presence rather than extend it. */
const PRESENCE_CLEAR_TTL_SECONDS = 2;

/**
 * Puts the AI in the room as a collaborator: an avatar in the stack, a cursor
 * on the canvas, and the thinking flag the cursor badge reads.
 *
 * Failing to announce presence must not fail a generation that is otherwise
 * fine, so this logs and continues rather than throwing — the canvas write is
 * the work, this is the commentary.
 */
export async function setAiPresence(
  roomId: string,
  presence: { cursor: XYPosition | null; isThinking: boolean }
): Promise<void> {
  await announce("presence", roomId, () =>
    getLiveblocks().setPresence(roomId, {
      userId: AI_USER_ID,
      data: { cursor: presence.cursor, isThinking: presence.isThinking },
      userInfo: { name: AI_USER_NAME, avatar: "", color: AI_COLOR },
      ttl: PRESENCE_TTL_SECONDS,
    })
  );
}

/**
 * Retires the AI from the room. There is no delete-presence call, so the
 * cleared state is written with the shortest TTL the API accepts and expires
 * itself moments later.
 */
export async function clearAiPresence(roomId: string): Promise<void> {
  await announce("presence", roomId, () =>
    getLiveblocks().setPresence(roomId, {
      userId: AI_USER_ID,
      data: { cursor: null, isThinking: false },
      userInfo: { name: AI_USER_NAME, avatar: "", color: AI_COLOR },
      ttl: PRESENCE_CLEAR_TTL_SECONDS,
    })
  );
}

/**
 * Publishes one line to the room's shared status feed, so progress is visible
 * to every participant rather than only to whoever started the run.
 *
 * The feed is created on demand: `createFeedMessage` is the common path and
 * costs one request, and the create only happens on a room whose feed does not
 * exist yet — which is once per project, ever.
 */
export async function publishAiStatus(
  roomId: string,
  message: AiStatusMessage
): Promise<void> {
  await announce("status", roomId, async () => {
    const client = getLiveblocks();
    const params = {
      roomId,
      feedId: AI_STATUS_FEED_ID,
      data: message,
    };

    try {
      await client.createFeedMessage(params);
    } catch {
      await client.createFeed({ roomId, feedId: AI_STATUS_FEED_ID });
      await client.createFeedMessage(params);
    }
  });
}

/** Durable assistant response, authored by the worker rather than a browser. */
export async function publishAiChatSummary(
  roomId: string,
  runId: string,
  text: string
): Promise<void> {
  const content = text.trim().slice(0, MAX_CHAT_CONTENT_LENGTH);

  await announce("chat", roomId, async () => {
    await createServerAiChatMessage(
      roomId,
      {
        role: "assistant",
        senderId: AI_USER_ID,
        senderName: AI_USER_NAME,
        content: content || "Canvas updated.",
        sentAt: Date.now(),
      },
      `chat-${runId}`
    );
  });
}

/**
 * Announcements are cosmetic: a room that cannot be told about a run is not a
 * reason to abandon the run. Errors are logged with their room rather than
 * swallowed, so a feed that is failing for everyone is still visible in the
 * task logs.
 */
async function announce(
  what: string,
  roomId: string,
  publish: () => Promise<void>
): Promise<void> {
  try {
    await publish();
  } catch (error: unknown) {
    console.error(`AI ${what} update failed for room ${roomId}`, error);
  }
}
