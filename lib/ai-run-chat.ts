import {
  appendAiActivityTimelinePart,
  toPersistedAiActivity,
  type AiTimelinePart,
} from "@/lib/ai-timeline";
import { upsertServerAiChatMessage } from "@/lib/ai-chat-server";
import {
  AI_USER_ID,
  AI_USER_NAME,
  MAX_CHAT_CONTENT_LENGTH,
  type AiActivityPart,
  type AiChatMessage,
  type AiChatRun,
  type AiChatRunPhase,
} from "@/types/tasks";

/** The Liveblocks write cadence for durable activity snapshots. */
export const AI_RUN_CHAT_FLUSH_MS = 400;

/** Leave headroom for the rest of the feed message and Liveblocks metadata. */
export const MAX_AI_RUN_SNAPSHOT_BYTES = 96_000;

type AiRunChatWrite = (
  roomId: string,
  messageId: string,
  message: AiChatMessage
) => Promise<void>;

type AiRunChatSchedule = (
  callback: () => Promise<void>,
  delayMs: number
) => unknown;

export interface CreateAiRunChatPublisherOptions {
  roomId: string;
  runId: string;
  promptMessageId: string;
  write?: AiRunChatWrite;
  schedule?: AiRunChatSchedule;
  cancel?: (handle: unknown) => void;
  now?: () => number;
}

export interface AiRunChatPublisher {
  start: () => Promise<void>;
  emit: (part: AiActivityPart) => void;
  /**
   * Grows the answer the reader is waiting on, in place. Separate from `emit`
   * because a text delta is the message itself, not a step in its work log —
   * routing it through the activity list would print the final answer twice.
   */
  appendContent: (delta: string) => void;
  /**
   * Writes the pending snapshot now instead of on the debounce.
   *
   * Useful at any boundary that needs the pending debounced snapshot to be
   * durable before continuing. Normal inline orchestration does not need it.
   */
  flush: () => Promise<void>;
  finish: (
    phase: Exclude<AiChatRunPhase, "running">,
    content: string
  ) => Promise<void>;
}

/**
 * Which run's chat row a task writes into.
 *
 * A subagent publishes into its *parent's* row, so one user prompt produces one
 * assistant message with the delegated work nested inside it. A run with no
 * parent — a direct trigger, a dashboard replay — owns its own row.
 *
 * Not a bare `??`: an empty string is a caller that meant to pass a parent and
 * did not, and `chat-` is a row every such run would collide on.
 */
export function resolveAiChatRunId(
  chatRunId: string | undefined,
  runId: string
): string {
  return chatRunId ? chatRunId : runId;
}

/**
 * Publishes one run as a deterministic assistant message. Each update carries
 * the complete snapshot, so a later successful write repairs an earlier miss.
 * This module stays server-only by defaulting to the node-side feed upsert.
 */
export function createAiRunChatPublisher(
  options: CreateAiRunChatPublisherOptions
): AiRunChatPublisher {
  const write = options.write ?? upsertServerAiChatMessage;
  const schedule = options.schedule ?? scheduleFlush;
  const cancel = options.cancel ?? cancelFlush;
  const messageId = `chat-${options.runId}`;
  const sentAt = (options.now ?? Date.now)();
  let timeline: AiTimelinePart[] = [];
  let phase: AiChatRunPhase = "running";
  let content = "";
  let nextSourceIndex = 0;
  let scheduledHandle: unknown;
  let started = false;
  let finished = false;
  let queuedWrite: Promise<void> = Promise.resolve();
  let finishPromise: Promise<void> | undefined;

  const snapshot = (): AiChatMessage => {
    const run: AiChatRun = {
      runId: options.runId,
      promptMessageId: options.promptMessageId,
      phase,
      activity: toPersistedAiActivity(timeline),
    };

    return {
      role: "assistant",
      senderId: AI_USER_ID,
      senderName: AI_USER_NAME,
      content,
      sentAt,
      run: fitAiRunToBudget(run),
    };
  };

  const enqueueSnapshot = (): Promise<void> => {
    const message = snapshot();

    queuedWrite = queuedWrite
      .then(() => write(options.roomId, messageId, message))
      .catch((error: unknown) => {
        console.error(
          `AI run chat update failed for room ${options.roomId}`,
          error
        );
      });

    return queuedWrite;
  };

  const flush = async (): Promise<void> => {
    scheduledHandle = undefined;

    if (!finished) {
      await enqueueSnapshot();
    }
  };

  const start = async (): Promise<void> => {
    if (!started) {
      started = true;
      await enqueueSnapshot();
    } else {
      await queuedWrite;
    }
  };

  const emit = (part: AiActivityPart): void => {
    if (finished) {
      return;
    }

    const nextTimeline = appendAiActivityTimelinePart(
      timeline,
      part,
      nextSourceIndex
    );
    nextSourceIndex += 1;

    if (!timelineChanged(timeline, nextTimeline)) {
      return;
    }

    timeline = nextTimeline;

    if (scheduledHandle === undefined) {
      scheduledHandle = schedule(flush, AI_RUN_CHAT_FLUSH_MS);
    }
  };

  const appendContent = (delta: string): void => {
    if (finished || delta.length === 0) {
      return;
    }

    // Clamped here rather than at `finish`, because `parseAiChatMessage` slices
    // on the way back out: a message that grew past the cap would render
    // truncated while the worker went on appending to something nobody sees.
    const next = (content + delta).slice(0, MAX_CHAT_CONTENT_LENGTH);

    if (next === content) {
      return;
    }

    content = next;

    if (scheduledHandle === undefined) {
      scheduledHandle = schedule(flush, AI_RUN_CHAT_FLUSH_MS);
    }
  };

  const flushNow = async (): Promise<void> => {
    if (scheduledHandle !== undefined) {
      cancel(scheduledHandle);
      scheduledHandle = undefined;
    }

    if (!finished) {
      await enqueueSnapshot();
    }
  };

  const finish = (
    terminalPhase: Exclude<AiChatRunPhase, "running">,
    terminalContent: string
  ): Promise<void> => {
    if (finishPromise) {
      return finishPromise;
    }

    finished = true;

    if (scheduledHandle !== undefined) {
      cancel(scheduledHandle);
      scheduledHandle = undefined;
    }

    finishPromise = (async (): Promise<void> => {
      await queuedWrite;
      phase = terminalPhase;
      content = terminalContent;
      await enqueueSnapshot();
    })();

    return finishPromise;
  };

  return { start, emit, appendContent, flush: flushNow, finish };
}

/**
 * Keeps the durable run anchor even when its optional detail exceeds the feed
 * write budget. Reasoning gives way first; if actions alone are still too
 * large, the state and prompt association survive on artifacts alone.
 *
 * Artifacts are never dropped. Every other part is a description of work that
 * already happened, but an `artifact` part is the only pointer the transcript
 * has to a generated document — losing it to a byte budget would strand a spec
 * that was written, paid for and saved.
 */
export function fitAiRunToBudget(run: AiChatRun): AiChatRun {
  if (measureRun(run) <= MAX_AI_RUN_SNAPSHOT_BYTES) {
    return run;
  }

  const withoutReasoning: AiChatRun = {
    ...run,
    activity: run.activity.filter((part) => part.type !== "reasoning"),
  };

  if (measureRun(withoutReasoning) <= MAX_AI_RUN_SNAPSHOT_BYTES) {
    return withoutReasoning;
  }

  return {
    ...run,
    activity: run.activity.filter((part) => part.type === "artifact"),
  };
}

function measureRun(run: AiChatRun): number {
  return Buffer.byteLength(JSON.stringify(run), "utf8");
}

function timelineChanged(
  previous: readonly AiTimelinePart[],
  next: readonly AiTimelinePart[]
): boolean {
  return (
    previous.length !== next.length ||
    next.some((part, index) => part !== previous[index])
  );
}

function scheduleFlush(callback: () => Promise<void>, delayMs: number): unknown {
  return setTimeout(() => {
    void callback();
  }, delayMs);
}

function cancelFlush(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
