import assert from "node:assert/strict";

import {
  AI_RUN_CHAT_FLUSH_MS,
  createAiRunChatPublisher,
} from "../lib/ai-run-chat";
import type { AiChatMessage } from "../types/tasks";

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

async function main(): Promise<void> {
  await checkPublisherCoalescesAReasoningBurst();
  await checkPublisherKeepsActivityChronological();
  await checkPublisherBoundsActivityAtTwoHundredParts();
  await checkPublisherFlushesTerminalStateImmediately();
  await checkPublisherRetainsPartialActivityOnError();
  await checkPublisherRepairsAfterAnIntermediateWriteFails();
}

main().catch((error: unknown) => {
  console.error("❌ AI run chat publisher verification failed", error);
  process.exitCode = 1;
});
