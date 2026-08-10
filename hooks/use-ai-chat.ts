"use client";

import { useCallback, useMemo, useState } from "react";
import { useFeedMessages, useRoom, useSelf } from "@liveblocks/react";

import { selectAiChatMessages, type ChatMessage } from "@/lib/ai-chat";
import { AI_CHAT_FEED_ID } from "@/types/tasks";

/**
 * The room's chat transcript and the one way to add to it (25-sidebar-chat-feed).
 *
 * The same feed shape as `useAiStatus`, read the opposite way: status keeps only
 * the newest line, chat keeps all of them in order. Nothing here touches
 * `ai-status-feed`, and nothing here starts a background task. Sends go through
 * an authenticated server route so feed identity is never caller-authored.
 */
export interface AiChat {
  /** Every valid message on the feed, oldest first. */
  messages: ChatMessage[];
  hasOlderMessages: boolean;
  isFetchingOlder: boolean;
  fetchOlderMessages: () => void;
  /** Resolves to the server-generated feed ID that anchors a run. */
  send: (text: string) => Promise<string | null>;
  /** Set when the last send failed, cleared by the next one that works. */
  error: string | null;
  isSending: boolean;
  /** False until Liveblocks knows who this user is — there is no sender before that. */
  canSend: boolean;
  /** The reader's own `senderId`, so the list can tell their messages apart. */
  selfId: string | null;
}

export function useAiChat(): AiChat {
  const roomId = useRoom().id;
  // Non-suspense, like `useAiStatus`: the sidebar sits outside the canvas'
  // suspense boundary, and an empty transcript is the right thing to render
  // while this loads. A room whose feed has never been written resolves to an
  // error here, which is the same nothing — the first send creates the feed.
  const feedMessages = useFeedMessages(AI_CHAT_FEED_ID, { limit: 50 });
  const entries = feedMessages.messages;
  const self = useSelf();

  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Validated, not trusted: every entry was written by another client.
  const messages = useMemo(() => selectAiChatMessages(entries), [entries]);

  // `id` is set by the auth handler but optional on the Liveblocks type, so an
  // ID-less connection falls back to itself rather than to a shared empty string
  // that would read as everyone being the same person.
  const selfId = self ? (self.id ?? `connection:${self.connectionId}`) : null;
  const send = useCallback(
    async (text: string): Promise<string | null> => {
      const content = text.trim();

      if (!content || !selfId) {
        return null;
      }

      setIsSending(true);

      try {
        const response = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: roomId, content }),
        });

        if (!response.ok) {
          throw new Error(`Chat request failed (${response.status})`);
        }

        const payload = (await response.json()) as { id?: unknown };

        if (typeof payload.id !== "string" || payload.id.length === 0) {
          throw new Error("Chat response did not include a message ID");
        }

        setError(null);
        return payload.id;
      } catch (sendError: unknown) {
        console.error("Chat message failed to send", sendError);
        setError("Message not sent. Try again.");
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [roomId, selfId]
  );

  return {
    messages,
    hasOlderMessages: feedMessages.hasFetchedAll === false,
    isFetchingOlder: feedMessages.isFetchingMore === true,
    fetchOlderMessages: feedMessages.fetchMore ?? (() => undefined),
    send,
    error,
    isSending,
    canSend: selfId !== null,
    selfId,
  };
}
