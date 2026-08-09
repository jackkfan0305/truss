import type { FeedEntry } from "@/lib/ai-status";
import { parseAiChatMessage, type AiChatMessage } from "@/types/tasks";

/**
 * Turning the raw `ai-chat` feed into a transcript (25-sidebar-chat-feed).
 *
 * In `lib/` for the same reason `selectLatestAiStatus` is: the verify script
 * imports it without pulling in React and Liveblocks.
 */

/** A feed message, plus the ID the list needs as a React key. */
export interface ChatFeedEntry extends FeedEntry {
  id: string;
}

export interface ChatMessage extends AiChatMessage {
  id: string;
}

/**
 * A client-chosen feed message ID doubles as the stable anchor for the local
 * Trigger.dev activity turn that follows that prompt.
 */
export function createAiChatMessageId(
  randomUuid: () => string = () => crypto.randomUUID()
): string {
  return `chat-${randomUuid()}`;
}

/**
 * Every message on the feed that validates, oldest first.
 *
 * Ordered by the server's `createdAt` rather than by the sender's `sentAt`,
 * because `sentAt` comes off whoever's laptop wrote it: a clock five minutes
 * behind would otherwise reorder the whole transcript for everyone. `sentAt` is
 * still what gets *displayed* — a skewed label is cosmetic, a skewed order is a
 * conversation that no longer reads as one.
 */
export function selectAiChatMessages(
  entries: readonly ChatFeedEntry[] | undefined
): ChatMessage[] {
  // Copied before sorting: the array belongs to the Liveblocks cache.
  // `sort` is stable, so entries stamped the same millisecond keep the order the
  // server listed them in.
  return [...(entries ?? [])]
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((entry) => {
      const parsed = parseAiChatMessage(entry.data);

      return parsed ? [{ ...parsed, id: entry.id }] : [];
    });
}
