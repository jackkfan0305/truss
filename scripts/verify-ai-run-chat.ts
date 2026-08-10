import assert from "node:assert/strict";

import {
  AI_RUN_CHAT_FLUSH_MS,
  createAiRunChatPublisher,
  fitAiRunToBudget,
} from "../lib/ai-run-chat";
import {
  upsertAiChatMessageWithClient,
  type AiChatFeedClient,
} from "../lib/ai-chat-server";
import { AI_CHAT_FEED_ID, type AiChatMessage } from "../types/tasks";

type ScheduledCallback = () => Promise<void>;

function createFakeScheduler() {
  let scheduled: ScheduledCallback | null = null;
  let scheduleCount = 0;
  const cancelled: unknown[] = [];

  return {
    schedule: (callback: ScheduledCallback, delayMs: number): number => {
      assert.equal(delayMs, AI_RUN_CHAT_FLUSH_MS);
      scheduleCount += 1;
      scheduled = callback;
      return scheduleCount;
    },
    cancel: (handle: unknown): void => {
      cancelled.push(handle);
    },
    getScheduled: (): ScheduledCallback => {
      assert.ok(scheduled, "expected a coalesced flush to be scheduled");
      return scheduled;
    },
    scheduleCount: (): number => scheduleCount,
    cancelled,
  };
}

async function checkPublisherCoalescesAReasoningBurst(): Promise<void> {
  const writes: AiChatMessage[] = [];
  const scheduler = createFakeScheduler();
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "run-1",
    promptMessageId: "chat-prompt",
    write: async (_roomId, messageId, message) => {
      assert.equal(messageId, "chat-run-1");
      writes.push(structuredClone(message));
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();
  publisher.emit({ type: "reasoning", text: "First " });
  publisher.emit({ type: "reasoning", text: "second" });

  assert.equal(writes.length, 1, "bursts wait for the shared flush window");
  assert.equal(scheduler.scheduleCount(), 1, "a burst shares one scheduled flush");

  await scheduler.getScheduled()();

  assert.equal(writes.at(-1)?.run?.activity[0]?.text, "First second");
  console.log("✅ publisher coalesces reasoning bursts");
}

async function checkPublisherKeepsActivityChronological(): Promise<void> {
  const writes: AiChatMessage[] = [];
  const scheduler = createFakeScheduler();
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "ordered",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      writes.push(structuredClone(message));
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();
  publisher.emit({ type: "reasoning", text: "Reading " });
  publisher.emit({ type: "action", text: "addNode", detail: "Gateway" });
  publisher.emit({ type: "reasoning", text: "the result" });
  await scheduler.getScheduled()();

  assert.deepEqual(
    writes.at(-1)?.run?.activity,
    [
      { type: "reasoning", text: "Reading " },
      { type: "action", text: "addNode", detail: "Gateway" },
      { type: "reasoning", text: "the result" },
    ],
    "reasoning merges only when it remains adjacent",
  );
  console.log("✅ publisher preserves activity ordering");
}

async function checkPublisherBoundsActivityAtTwoHundredParts(): Promise<void> {
  const writes: AiChatMessage[] = [];
  const scheduler = createFakeScheduler();
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "bounded",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      writes.push(structuredClone(message));
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();

  for (let index = 0; index < 201; index += 1) {
    publisher.emit({ type: "step", text: `Step ${index}` });
  }

  await scheduler.getScheduled()();

  assert.equal(writes.at(-1)?.run?.activity.length, 200);
  assert.equal(writes.at(-1)?.run?.activity.at(-1)?.text, "Step 199");
  console.log("✅ publisher bounds durable activity");
}

function checkOversizedRunLogsPreserveTheRunAnchor(): void {
  const base = {
    runId: "run-budget",
    promptMessageId: "chat-prompt",
    phase: "complete" as const,
  };
  const small = {
    ...base,
    activity: [{ type: "step" as const, text: "Reading" }],
  };

  assert.equal(fitAiRunToBudget(small), small, "a small snapshot is unchanged");

  const wordy = {
    ...base,
    activity: [
      { type: "reasoning" as const, text: "x".repeat(200_000) },
      { type: "action" as const, text: "addNode", detail: "Gateway" },
    ],
  };

  assert.deepEqual(
    fitAiRunToBudget(wordy).activity,
    [{ type: "action", text: "addNode", detail: "Gateway" }],
    "reasoning gives way before canvas actions",
  );

  const enormous = {
    ...base,
    activity: Array.from({ length: 200 }, () => ({
      type: "action" as const,
      text: "x".repeat(2_000),
      detail: "y".repeat(2_000),
    })),
  };

  assert.deepEqual(
    fitAiRunToBudget(enormous),
    { ...base, activity: [] },
    "an enormous log keeps its run and prompt association",
  );
  console.log("✅ oversized run logs preserve their durable anchor");
}

async function checkPublisherFlushesTerminalStateImmediately(): Promise<void> {
  const writes: AiChatMessage[] = [];
  const scheduler = createFakeScheduler();
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "terminal",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      writes.push(structuredClone(message));
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();
  publisher.emit({ type: "step", text: "Building the diagram" });
  await publisher.finish("complete", "Canvas updated.");

  assert.deepEqual(scheduler.cancelled, [1], "finish cancels the pending timer");
  assert.equal(writes.length, 2, "finish writes instead of waiting for the timer");
  assert.equal(writes.at(-1)?.run?.phase, "complete");
  assert.equal(writes.at(-1)?.content, "Canvas updated.");
  assert.equal(writes.at(-1)?.run?.activity[0]?.text, "Building the diagram");
  console.log("✅ publisher flushes terminal state immediately");
}

async function checkPublisherRetainsPartialActivityOnError(): Promise<void> {
  const writes: AiChatMessage[] = [];
  const scheduler = createFakeScheduler();
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "error",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      writes.push(structuredClone(message));
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();
  publisher.emit({ type: "action", text: "addNode", detail: "API" });
  await publisher.finish("error", "The model stopped early.");

  assert.deepEqual(writes.at(-1)?.run, {
    runId: "error",
    promptMessageId: "chat-prompt",
    phase: "error",
    activity: [{ type: "action", text: "addNode", detail: "API" }],
  });
  console.log("✅ publisher retains partial activity on errors");
}

async function checkConcurrentFinishCallsAwaitOneTerminalWrite(): Promise<void> {
  let releaseTerminalWrite: (() => void) | undefined;
  const terminalWriteStarted = new Promise<void>((resolve) => {
    releaseTerminalWrite = resolve;
  });
  let allowTerminalWrite: (() => void) | undefined;
  const terminalWrite = new Promise<void>((resolve) => {
    allowTerminalWrite = resolve;
  });
  const scheduler = createFakeScheduler();
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "concurrent-finish",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      if (message.run?.phase === "complete") {
        releaseTerminalWrite?.();
        await terminalWrite;
      }
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();
  const firstFinish = publisher.finish("complete", "Canvas updated.");
  const secondFinish = publisher.finish("complete", "Canvas updated.");

  assert.equal(
    secondFinish,
    firstFinish,
    "concurrent callers receive the same terminal completion promise",
  );

  let firstFinished = false;
  let secondFinished = false;
  firstFinish.then(() => {
    firstFinished = true;
  });
  secondFinish.then(() => {
    secondFinished = true;
  });

  await terminalWriteStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(
    firstFinished,
    false,
    "the first finish remains blocked on its terminal write",
  );
  assert.equal(
    secondFinished,
    false,
    "a concurrent finish must wait for the blocked terminal write",
  );

  allowTerminalWrite?.();
  await Promise.all([firstFinish, secondFinish]);
  console.log("✅ concurrent finish calls share the terminal write");
}

async function checkPublisherRepairsAfterAnIntermediateWriteFails(): Promise<void> {
  const writes: AiChatMessage[] = [];
  const scheduler = createFakeScheduler();
  let attempt = 0;
  const publisher = createAiRunChatPublisher({
    roomId: "project-1",
    runId: "repair",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      attempt += 1;

      if (attempt === 2) {
        throw new Error("temporary Liveblocks failure");
      }

      writes.push(structuredClone(message));
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  await publisher.start();
  publisher.emit({ type: "step", text: "Reading the canvas" });
  await scheduler.getScheduled()();
  publisher.emit({ type: "action", text: "addNode", detail: "Cache" });
  await scheduler.getScheduled()();

  assert.equal(attempt, 3, "the publisher keeps writing after a failed snapshot");
  assert.deepEqual(
    writes.at(-1)?.run?.activity,
    [
      { type: "step", text: "Reading the canvas" },
      { type: "action", text: "addNode", detail: "Cache" },
    ],
    "the later success repairs the missed full snapshot",
  );
  console.log("✅ publisher repairs a failed intermediate write");
}

const SERVER_MESSAGE: AiChatMessage = {
  role: "assistant",
  senderId: "truss-ai-architect",
  senderName: "AI Architect",
  content: "Canvas updated.",
  sentAt: 1_700_000_000_000,
};

type FeedOperation = "update" | "create-message" | "create-feed";

function createFakeFeedClient(
  outcomes: readonly (number | null)[]
): { client: AiChatFeedClient; calls: FeedOperation[] } {
  const calls: FeedOperation[] = [];
  let outcomeIndex = 0;

  const respond = async (operation: FeedOperation): Promise<void> => {
    calls.push(operation);
    const outcome = outcomes[outcomeIndex];
    outcomeIndex += 1;

    if (typeof outcome === "number") {
      throw Object.assign(new Error(`${operation} failed`), { status: outcome });
    }
  };

  const client: AiChatFeedClient = {
    updateFeedMessage: async (params) => {
      assert.equal(params.roomId, "project-1");
      assert.equal(params.feedId, AI_CHAT_FEED_ID);
      assert.equal(params.messageId, "chat-run-1");
      assert.deepEqual(params.data, SERVER_MESSAGE);
      await respond("update");
    },
    createFeedMessage: async (params) => {
      assert.equal(params.roomId, "project-1");
      assert.equal(params.feedId, AI_CHAT_FEED_ID);
      assert.equal(params.id, "chat-run-1");
      assert.deepEqual(params.data, SERVER_MESSAGE);
      await respond("create-message");
    },
    createFeed: async (params) => {
      assert.equal(params.roomId, "project-1");
      assert.equal(params.feedId, AI_CHAT_FEED_ID);
      await respond("create-feed");
    },
  };

  return { client, calls };
}

/**
 * The server upsert's recovery ladder, against the statuses Liveblocks *actually*
 * returns rather than the ones a REST API would be expected to.
 *
 * Measured against the live v2 API: a PATCH of a missing message, a POST of a
 * duplicate message ID, and a POST into a missing feed all come back as
 * `500 Internal Room Error`. Only "this feed already exists" answers honestly,
 * with a 409.
 *
 * That is why these fixtures are almost all 500s. A previous version of this
 * check used 404 and 409 — the statuses the ladder was written against — and
 * passed while the real thing rethrew on the first write of every run, leaving
 * the assistant row uncreated and the whole turn unrecorded. Fixtures that
 * describe a nicer API than the one being called are worse than no fixtures.
 */
async function checkServerUpsertRecoveryPaths(): Promise<void> {
  const cases: readonly [string, readonly (number | null)[], FeedOperation[]][] = [
    ["updates an existing message", [null], ["update"]],
    [
      "creates the message when the update reports the opaque 500",
      [500, null],
      ["update", "create-message"],
    ],
    [
      "creates a missing feed before its message",
      [500, 500, null, null],
      ["update", "create-message", "create-feed", "create-message"],
    ],
    [
      "carries on when the feed turns out to already exist",
      [500, 500, 409, null],
      ["update", "create-message", "create-feed", "create-message"],
    ],
    [
      "falls back to update when another worker won the create race",
      [500, 500, 409, 500, null],
      ["update", "create-message", "create-feed", "create-message", "update"],
    ],
    // The historical fixtures, kept: the ladder must not start *depending* on
    // 500 either, or it breaks again the day Liveblocks reports 404 properly.
    [
      "still recovers if the API ever reports a missing message honestly",
      [404, null],
      ["update", "create-message"],
    ],
    [
      "still recovers from a 409 on a duplicate message ID",
      [404, 409, null, null],
      ["update", "create-message", "create-feed", "create-message"],
    ],
  ];

  for (const [description, outcomes, expectedCalls] of cases) {
    const { client, calls } = createFakeFeedClient(outcomes);

    await upsertAiChatMessageWithClient(
      client,
      "project-1",
      "chat-run-1",
      SERVER_MESSAGE,
    );

    assert.deepEqual(calls, expectedCalls, description);
  }

  // A key that is wrong is not a message that is missing. Walking the ladder
  // against it would spend four extra round trips per flush — at a 400ms
  // cadence, for the length of a run — arriving at the same refusal.
  for (const status of [401, 403, 429]) {
    const { client, calls } = createFakeFeedClient([status]);

    await assert.rejects(
      () =>
        upsertAiChatMessageWithClient(
          client,
          "project-1",
          "chat-run-1",
          SERVER_MESSAGE,
        ),
      (error: unknown) => hasStatus(error, status),
      `${status} is refused rather than retried`,
    );

    assert.deepEqual(calls, ["update"], `${status} stops at the first rung`);
  }

  // Out of rungs. The *first* error is what surfaces: the later ones are
  // consequences of it, and "feed already exists" explains nothing.
  const { client, calls } = createFakeFeedClient([500, 502, 409, 503, 504]);

  await assert.rejects(
    () =>
      upsertAiChatMessageWithClient(
        client,
        "project-1",
        "chat-run-1",
        SERVER_MESSAGE,
      ),
    (error: unknown) => hasStatus(error, 500),
    "the first failure is what the caller is told about",
  );

  assert.deepEqual(calls, [
    "update",
    "create-message",
    "create-feed",
    "create-message",
    "update",
  ]);

  console.log("✅ server upsert recovers deterministic Liveblocks races");
}

function hasStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === status
  );
}

async function main(): Promise<void> {
  await checkPublisherCoalescesAReasoningBurst();
  await checkPublisherKeepsActivityChronological();
  await checkPublisherBoundsActivityAtTwoHundredParts();
  checkOversizedRunLogsPreserveTheRunAnchor();
  await checkPublisherFlushesTerminalStateImmediately();
  await checkPublisherRetainsPartialActivityOnError();
  await checkConcurrentFinishCallsAwaitOneTerminalWrite();
  await checkPublisherRepairsAfterAnIntermediateWriteFails();
  await checkServerUpsertRecoveryPaths();
}

main().catch((error: unknown) => {
  console.error("❌ AI run chat publisher verification failed", error);
  process.exitCode = 1;
});
