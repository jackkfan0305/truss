import assert from "node:assert/strict";

import { submitAiPrompt } from "../lib/ai-prompt-submission";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
} from "../types/tasks";

const runOptions = {
  modelId: DEFAULT_AI_DESIGN_MODEL_ID,
  thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
};

async function checkMessageFailure(): Promise<void> {
  assert.deepEqual(
    await submitAiPrompt({
      text: "Design checkout",
      runOptions,
      send: async () => null,
      start: async () => ({ runId: "unreachable", token: "unreachable" }),
    }),
    { status: "message-error" },
  );
}

async function checkRunFailure(): Promise<void> {
  assert.deepEqual(
    await submitAiPrompt({
      text: "Design checkout",
      runOptions,
      send: async () => "chat-1",
      start: async () => {
        throw new Error("offline");
      },
    }),
    { status: "run-error", promptMessageId: "chat-1" },
  );
}

async function checkExistingPromptReusesItsIdentity(): Promise<void> {
  assert.deepEqual(
    await submitAiPrompt({
      text: "Design checkout",
      runOptions,
      options: { promptMessageId: "chat-existing" },
      send: async () => {
        throw new Error("must be skipped");
      },
      start: async () => ({ runId: "run-1", token: "token-1" }),
    }),
    {
      status: "started",
      promptMessageId: "chat-existing",
      subscription: { runId: "run-1", token: "token-1" },
    },
  );
}

async function checkLaunchAndLifecycleCallbacks(): Promise<void> {
  const events: string[] = [];

  await submitAiPrompt({
    text: "Design checkout",
    runOptions,
    options: {
      launchId: "launch-1",
      onPromptSent: (promptMessageId) => events.push(`sent:${promptMessageId}`),
      onRunStarting: (promptMessageId) => events.push(`start:${promptMessageId}`),
    },
    send: async (_text, options) => {
      assert.deepEqual(options, { launchId: "launch-1" });
      return "chat-2";
    },
    start: async (_text, promptMessageId) => {
      events.push(`starting:${promptMessageId}`);
      return { runId: "run-2", token: "token-2" };
    },
  });

  assert.deepEqual(events, ["sent:chat-2", "start:chat-2", "starting:chat-2"]);
}

async function main(): Promise<void> {
  await checkMessageFailure();
  await checkRunFailure();
  await checkExistingPromptReusesItsIdentity();
  await checkLaunchAndLifecycleCallbacks();

  console.info("AI prompt submission checks passed");
}

void main();
