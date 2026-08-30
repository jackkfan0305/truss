import type { XYPosition } from "@xyflow/react";

import { getLiveblocks } from "@/lib/liveblocks";
import { AI_USER_ID, AI_USER_NAME } from "@/types/tasks";

/**
 * The agent's visible side of a canvas write: its presence in the room, so a
 * mounted editor sees a cursor travel to each node before the node lands.
 *
 * It goes through the same Liveblocks room the humans are in, via the node
 * SDK's connection-less `setPresence`. No parallel realtime system, per the
 * scope limits.
 *
 * Node-only: it holds the Liveblocks secret.
 */

/** `--accent-ai`. Raw hex for the same reason cursor colours are: it travels as data. */
const AI_COLOR = "#6457f9";

/**
 * Presence expires on its own, which is what makes it safe: a write that is
 * killed mid-draw leaves a ghost avatar for at most this long rather than
 * forever. Comfortably longer than a paced draw.
 *
 * ponytail: no heartbeat. If a draw ever runs longer than this, refresh
 * presence between steps instead of raising the TTL to the 3599s maximum.
 */
const PRESENCE_TTL_SECONDS = 300;

/** The floor the API allows — used to retire presence rather than extend it. */
const PRESENCE_CLEAR_TTL_SECONDS = 2;

/**
 * Puts the agent in the room as a collaborator: an avatar in the stack and a
 * cursor on the canvas.
 *
 * Failing to announce presence must not fail a write that is otherwise fine, so
 * this logs and continues rather than throwing — the canvas write is the work,
 * this is the commentary.
 */
export async function setAiPresence(
  roomId: string,
  presence: { cursor: XYPosition | null }
): Promise<void> {
  await announce(roomId, () =>
    getLiveblocks().setPresence(roomId, {
      userId: AI_USER_ID,
      data: { cursor: presence.cursor },
      userInfo: { name: AI_USER_NAME, avatar: "", color: AI_COLOR },
      ttl: PRESENCE_TTL_SECONDS,
    })
  );
}

/**
 * Retires the agent from the room. There is no delete-presence call, so the
 * cleared state is written with the shortest TTL the API accepts and expires
 * itself moments later.
 */
export async function clearAiPresence(roomId: string): Promise<void> {
  await announce(roomId, () =>
    getLiveblocks().setPresence(roomId, {
      userId: AI_USER_ID,
      data: { cursor: null },
      userInfo: { name: AI_USER_NAME, avatar: "", color: AI_COLOR },
      ttl: PRESENCE_CLEAR_TTL_SECONDS,
    })
  );
}

/**
 * Presence is cosmetic: a room that cannot be told about a write is not a
 * reason to abandon the write. Errors are logged with their room rather than
 * swallowed, so a room that is failing for everyone is still visible in the
 * server logs.
 */
async function announce(
  roomId: string,
  publish: () => Promise<void>
): Promise<void> {
  try {
    await publish();
  } catch (error: unknown) {
    console.error(`AI presence update failed for room ${roomId}`, error);
  }
}
