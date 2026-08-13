import assert from "node:assert/strict";

import { createAiPromptSubmit } from "../hooks/use-ai-prompt-submission";
import { submitAiPrompt } from "../lib/ai-prompt-submission";
import { submitAiSidebarPrompt } from "../lib/ai-sidebar-submission";
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

async function checkSendAndCallbackFailuresPropagate(): Promise<void> {
  await assert.rejects(
    () =>
      submitAiPrompt({
        text: "Design checkout",
        runOptions,
        send: async () => {
          throw new Error("send failed");
        },
        start: async () => ({ runId: "unreachable", token: "unreachable" }),
      }),
    /send failed/,
    "a rejected send is not mistaken for a run-start error",
  );

  let startAfterPromptCallback = false;
  await assert.rejects(
    () =>
      submitAiPrompt({
        text: "Design checkout",
        runOptions,
        options: {
          onPromptSent: () => {
            throw new Error("prompt callback failed");
          },
        },
        send: async () => "chat-3",
        start: async () => {
          startAfterPromptCallback = true;
          return { runId: "unreachable", token: "unreachable" };
        },
      }),
    /prompt callback failed/,
    "a rejected prompt callback is not mistaken for a run-start error",
  );
  assert.equal(startAfterPromptCallback, false, "a failed prompt callback stops the run");

  let startAfterRunCallback = false;
  await assert.rejects(
    () =>
      submitAiPrompt({
        text: "Design checkout",
        runOptions,
        options: {
          onRunStarting: () => {
            throw new Error("run callback failed");
          },
        },
        send: async () => "chat-4",
        start: async () => {
          startAfterRunCallback = true;
          return { runId: "unreachable", token: "unreachable" };
        },
      }),
    /run callback failed/,
    "a rejected run callback is not mistaken for a run-start error",
  );
  assert.equal(startAfterRunCallback, false, "a failed run callback stops the run");
}

async function checkManualSidebarSubmissionUsesTheComposedController(): Promise<void> {
  const events: string[] = [];
  let clearedDrafts = 0;
  const submitPrompt = createAiPromptSubmit(
    {
      send: async (text) => {
        const content = text.trim();
        events.push(`send:${content}`);
        return content ? "chat-manual" : null;
      },
    },
    {
      start: async (prompt, promptMessageId, options) => {
        events.push(`start:${prompt}:${promptMessageId}:${options.modelId}`);
        return { runId: "run-manual", token: "token-manual" };
      },
    },
  );

  await submitAiSidebarPrompt({
    text: "  Design checkout  ",
    isComposerDisabled: false,
    modelId: DEFAULT_AI_DESIGN_MODEL_ID,
    thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
    submitPrompt,
    clearDraft: () => {
      clearedDrafts += 1;
    },
  });

  assert.deepEqual(events, [
    "send:Design checkout",
    `start:  Design checkout  :chat-manual:${DEFAULT_AI_DESIGN_MODEL_ID}`,
  ]);
  assert.equal(clearedDrafts, 1, "a started manual prompt clears the draft");

  const messageErrorSubmit = createAiPromptSubmit(
    { send: async () => null },
    { start: async () => ({ runId: "unreachable", token: "unreachable" }) },
  );
  await submitAiSidebarPrompt({
    text: "   ",
    isComposerDisabled: false,
    modelId: DEFAULT_AI_DESIGN_MODEL_ID,
    thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
    submitPrompt: messageErrorSubmit,
    clearDraft: () => {
      clearedDrafts += 1;
    },
  });
  assert.equal(clearedDrafts, 1, "a rejected empty prompt keeps the draft");

  const runErrorSubmit = createAiPromptSubmit(
    { send: async () => "chat-run-error" },
    {
      start: async () => {
        throw new Error("offline");
      },
    },
  );
  await submitAiSidebarPrompt({
    text: "Design checkout",
    isComposerDisabled: false,
    modelId: DEFAULT_AI_DESIGN_MODEL_ID,
    thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
    submitPrompt: runErrorSubmit,
    clearDraft: () => {
      clearedDrafts += 1;
    },
  });
  assert.equal(clearedDrafts, 2, "a visible run-start error still clears the draft");

  await submitAiSidebarPrompt({
    text: "Ignored while running",
    isComposerDisabled: true,
    modelId: DEFAULT_AI_DESIGN_MODEL_ID,
    thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
    submitPrompt,
    clearDraft: () => {
      clearedDrafts += 1;
    },
  });
  assert.equal(clearedDrafts, 2, "a disabled manual composer does not submit or clear");
  assert.equal(events.length, 2, "a disabled manual composer skips the controller");
}

async function main(): Promise<void> {
  await checkMessageFailure();
  await checkRunFailure();
  await checkExistingPromptReusesItsIdentity();
  await checkLaunchAndLifecycleCallbacks();
  await checkSendAndCallbackFailuresPropagate();
  await checkManualSidebarSubmissionUsesTheComposedController();

  console.info("AI prompt submission checks passed");
}

void main();
