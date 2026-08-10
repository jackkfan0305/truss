"use client";

import { useMemo } from "react";
import { useFeedMessages, useOthersMapped } from "@liveblocks/react";

import { selectLatestAiStatus } from "@/lib/ai-status";
import { AI_STATUS_FEED_ID, type AiStatusMessage } from "@/types/tasks";

/**
 * The room's shared AI activity state (24-ai-presence-state).
 *
 * Two Liveblocks signals rather than one, because they answer different
 * questions and fail differently:
 *
 * - **The feed** (`ai-status-feed`) carries *what* the AI is doing. It is
 *   durable, so it survives a reload and everyone in the room reads the same
 *   line — but a message stays on it forever.
 * - **Presence** carries *whether* a run is still live. It expires on its own
 *   (`lib/ai-activity.ts` writes a TTL), which is exactly what the feed cannot
 *   do: a task killed mid-run leaves a `processing` message behind, and driving
 *   the composer off that would disable it for the whole room permanently.
 *
 * So the feed is read for text and presence for liveness. No parallel realtime
 * state, and no staleness timer to maintain.
 */
export interface AiStatus {
  /** The most recent valid message on the feed, or `null` if there is none. */
  message: AiStatusMessage | null;
  /** True while any participant in the room has a generation in flight. */
  isGenerating: boolean;
}

export function useAiStatus(): AiStatus {
  // Non-suspense, like `useCollaborators`: the sidebar sits outside the canvas'
  // suspense boundary, and "no status yet" is the correct thing to render while
  // this loads. A room whose feed has never been written resolves to an error
  // here, which is the same nothing — the task creates the feed on first
  // publish, so an empty result and a missing feed mean the same thing.
  const { messages } = useFeedMessages(AI_STATUS_FEED_ID);

  // `useOthersMapped` rather than `useOthers`: this re-renders only when
  // someone's thinking flag flips, not on every cursor move in the room.
  const thinking = useOthersMapped((other) => other.presence.isThinking);

  // Validated, not trusted: a feed message is written by a background task and
  // read by every client, so an entry this build cannot parse renders as
  // nothing rather than as a broken status line.
  const message = useMemo(() => selectLatestAiStatus(messages), [messages]);

  return {
    message,
    isGenerating: thinking.some(([, isThinking]) => isThinking),
  };
}
