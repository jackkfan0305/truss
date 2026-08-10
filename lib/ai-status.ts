import { parseAiStatusMessage, type AiStatusMessage } from "@/types/tasks";

/**
 * Picking the room's current AI status out of the raw `ai-status-feed`
 * (24-ai-presence-state).
 *
 * Lives in `lib/` rather than beside `useAiStatus` purely so the verify script
 * can import it without pulling in React and Liveblocks — the same reason
 * `lib/presence.ts` is separate from the avatar stack.
 */

/** The shape this needs off a Liveblocks `FeedMessage`, and nothing more. */
export interface FeedEntry {
  data: unknown;
  createdAt: number;
}

/**
 * The most recent message on the feed that validates, or `null`.
 *
 * Two things are deliberate. Entries are ranked by `createdAt` rather than by
 * array position, because the hook does not document an order and a status line
 * that silently runs backwards is invisible in review. And an entry that fails
 * validation — an older task version, a partial write, some later feature
 * sharing the feed — is *skipped* rather than allowed to win: a message this
 * build cannot read must render as nothing, not as a blank status line.
 */
export function selectLatestAiStatus(
  entries: readonly FeedEntry[] | undefined
): AiStatusMessage | null {
  let latest: AiStatusMessage | null = null;
  let latestAt = -Infinity;

  for (const entry of entries ?? []) {
    const parsed = parseAiStatusMessage(entry.data);

    // `>=` so that among entries stamped the same millisecond, the one the
    // server listed last wins — which is the order they were written in.
    if (parsed && entry.createdAt >= latestAt) {
      latest = parsed;
      latestAt = entry.createdAt;
    }
  }

  return latest;
}
