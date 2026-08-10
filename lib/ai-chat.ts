import type { FeedEntry } from "@/lib/ai-status";
import {
  parseAiChatMessage,
  type AiChatMessage,
  type AiChatRunPhase,
  type AiStatusMessage,
} from "@/types/tasks";

/**
 * Turning the raw `ai-chat` feed into a transcript (25-sidebar-chat-feed).
 *
 * In `lib/` for the same reason `selectLatestAiStatus` is: the verify script
 * imports it without pulling in React and Liveblocks.
 */

/** A feed message, plus the ID the list needs as a React key. */
export interface ChatFeedEntry extends FeedEntry {
  id: string;
  updatedAt: number;
}

export interface ChatMessage extends AiChatMessage {
  id: string;
  updatedAt: number;
}

/** A room activity snapshot older than this cannot keep the composer-looking live. */
export const AI_RUN_STALE_AFTER_MS = 315_000;
/** Browser timers coerce values beyond this signed 32-bit limit. */
export const MAX_AI_RUN_STALE_TIMER_DELAY_MS = 2 ** 31 - 1;

export interface AiChatRunStaleTimerScheduler {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
}

/**
 * A durable activity snapshot cannot receive a terminal update after a worker
 * disappears. Treat only an *elapsed* deadline as stopped so the precise
 * boundary does not flicker while a normal update is landing.
 */
export function resolveAiChatRunPhase(
  phase: AiChatRunPhase,
  updatedAt: number,
  now: number
): AiChatRunPhase | "incomplete" {
  return phase === "running" && now - updatedAt > AI_RUN_STALE_AFTER_MS
    ? "incomplete"
    : phase;
}

/**
 * Keeps checking a durable running snapshot until it crosses the stale
 * threshold. A timeout is only a wake-up hint: browsers can fire it early and
 * wall clocks can move backwards, so each callback recomputes phase and arms
 * one bounded replacement instead of assuming the deadline has arrived.
 */
export function armAiChatRunStaleTimer(
  updatedAt: number,
  scheduler: AiChatRunStaleTimerScheduler,
  onStale: () => void
): () => void {
  let timer: number | null = null;
  let isStopped = false;

  const checkAndArm = () => {
    if (isStopped) return;

    const now = scheduler.now();

    if (resolveAiChatRunPhase("running", updatedAt, now) === "incomplete") {
      onStale();
      return;
    }

    const remaining = AI_RUN_STALE_AFTER_MS - (now - updatedAt) + 1;
    const delay = Math.min(
      MAX_AI_RUN_STALE_TIMER_DELAY_MS,
      Math.max(1, remaining)
    );

    timer = scheduler.setTimeout(() => {
      timer = null;
      checkAndArm();
    }, delay);
  };

  checkAndArm();

  return () => {
    isStopped = true;

    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
  };
}

/** Local terminal start failures must survive the durable run appearing first. */
export function shouldShowLocalAiRunActivity(
  turn: { phase: "starting" | "running" | "complete" | "error"; runId: string | null },
  hasPersistedRun: boolean
): boolean {
  return (
    !hasPersistedRun || (turn.phase === "error" && turn.runId === null)
  );
}

interface RemoteRunStatusInput {
  isRoomActive: boolean;
  hasLocalActiveTurn: boolean;
  messages: readonly ChatMessage[];
  status: AiStatusMessage | null;
  now: number;
}

/** Avoids repeating a coarse status when the matching durable run is visible. */
export function shouldShowRemoteRunStatus({
  isRoomActive,
  hasLocalActiveTurn,
  messages,
  status,
  now,
}: RemoteRunStatusInput): boolean {
  if (!isRoomActive || hasLocalActiveTurn) {
    return false;
  }

  if (!status || status.kind !== "design") {
    return true;
  }

  const hasMatchingVisibleRun = messages.some(
    (message) =>
      message.run?.runId === status.runId &&
      resolveAiChatRunPhase(message.run.phase, message.updatedAt, now) ===
        "running",
  );

  return !hasMatchingVisibleRun;
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

      return parsed
        ? [{ ...parsed, id: entry.id, updatedAt: entry.updatedAt }]
        : [];
    });
}

/**
 * Keep the server feed's chronology except for durable run snapshots, whose
 * meaningful place is immediately after the loaded prompt they answer. The
 * selector already establishes server-created order and JavaScript's stable
 * iteration keeps multiple snapshots for one prompt in that order.
 */
export function arrangeAiChatMessages(
  messages: readonly ChatMessage[]
): ChatMessage[] {
  const promptIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "user") {
      promptIds.add(message.id);
    }
  }
  const runsByPrompt = new Map<string, ChatMessage[]>();

  for (const message of messages) {
    const promptMessageId = message.run?.promptMessageId;

    if (!promptMessageId || !promptIds.has(promptMessageId)) {
      continue;
    }

    const runs = runsByPrompt.get(promptMessageId) ?? [];
    runs.push(message);
    runsByPrompt.set(promptMessageId, runs);
  }

  return messages.flatMap((message) => {
    const promptMessageId = message.run?.promptMessageId;

    if (promptMessageId && promptIds.has(promptMessageId)) {
      return [];
    }

    return [message, ...(runsByPrompt.get(message.id) ?? [])];
  });
}
