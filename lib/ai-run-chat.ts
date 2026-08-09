import {
  appendAiActivityTimelinePart,
  toPersistedAiActivity,
  type AiTimelinePart,
} from "@/lib/ai-timeline";
import { upsertServerAiChatMessage } from "@/lib/ai-chat-server";
import {
  AI_USER_ID,
  AI_USER_NAME,
  type AiActivityPart,
  type AiChatMessage,
  type AiChatRunPhase,
} from "@/types/tasks";

/** The Liveblocks write cadence for durable activity snapshots. */
export const AI_RUN_CHAT_FLUSH_MS = 400;

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
  finish: (
    phase: Exclude<AiChatRunPhase, "running">,
    content: string
  ) => Promise<void>;
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

  const snapshot = (): AiChatMessage => ({
    role: "assistant",
    senderId: AI_USER_ID,
    senderName: AI_USER_NAME,
    content,
    sentAt,
    run: {
      runId: options.runId,
      promptMessageId: options.promptMessageId,
      phase,
      activity: toPersistedAiActivity(timeline),
    },
  });

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

  return { start, emit, finish };
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
