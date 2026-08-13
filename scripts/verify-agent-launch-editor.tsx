import assert from "node:assert/strict";
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react/suspense";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentLaunchFailure,
  AiSidebar,
} from "../components/editor/ai-sidebar";
import { EditorNavbar } from "../components/editor/editor-navbar";
import {
  useAgentLaunchPrompt,
} from "../hooks/use-agent-launch-prompt";
import type { AiPromptSubmit } from "../hooks/use-ai-prompt-submission";
import { initialEditorSidebar } from "../lib/editor-sidebar-state";
import {
  runAgentLaunchPrompt,
  startAgentLaunchPromptOnce,
  type AgentLaunchPromptDependencies,
} from "../lib/agent-launch-runner";
import {
  agentLaunchStorageKey,
  createAgentLaunchRecord,
  type AgentLaunchRecord,
} from "../lib/agent-launch";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
} from "../types/tasks";
import { createReactHookHarness } from "./testing/react-hook-harness";

const launchId = "00000000-0000-4a00-8000-000000000006";
const roomId = "global-checkout-a1b2c3";

interface Harness {
  dependencies: AgentLaunchPromptDependencies;
  getRecord: () => AgentLaunchRecord | null;
  getEvents: () => string[];
  getSubmitCount: () => number;
  getRemoveCount: () => number;
  getScrubCount: () => number;
}

function record(overrides: Partial<AgentLaunchRecord> = {}): AgentLaunchRecord {
  return {
    ...createAgentLaunchRecord({
      version: 1,
      launchId,
      title: "Global Checkout",
      description: "Design a global checkout service.",
    }),
    projectId: roomId,
    stage: "project-created",
    ...overrides,
  };
}

function createHarness(
  initial: AgentLaunchRecord | null,
  submitResult: Awaited<ReturnType<AgentLaunchPromptDependencies["submit"]>> = {
    status: "started",
    promptMessageId: "prompt-1",
    subscription: { runId: "run-1", token: "token-1" },
  },
): Harness {
  let stored = initial;
  let submitCount = 0;
  let removeCount = 0;
  let scrubCount = 0;
  const events: string[] = [];

  return {
    dependencies: {
      load: () => stored,
      save: (next) => {
        stored = next;
        events.push(`save:${next.stage}:${next.promptMessageId ?? ""}`);
      },
      remove: () => {
        removeCount += 1;
        events.push("remove");
        stored = null;
      },
      submit: async (text, runOptions, options) => {
        submitCount += 1;
        events.push(`submit:${text}`);
        assert.deepEqual(runOptions, {
          modelId: DEFAULT_AI_DESIGN_MODEL_ID,
          thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
        });
        assert.equal(options.launchId, launchId);
        if (submitResult.status !== "message-error" && !options.promptMessageId) {
          options.onPromptSent?.("prompt-1");
          options.onRunStarting?.("prompt-1");
        }
        return submitResult;
      },
      scrubQuery: () => {
        scrubCount += 1;
        events.push("scrub");
      },
    },
    getRecord: () => stored,
    getEvents: () => events,
    getSubmitCount: () => submitCount,
    getRemoveCount: () => removeCount,
    getScrubCount: () => scrubCount,
  };
}

async function checkSameTabLaunchSharesOneOperation(): Promise<void> {
  let submitCount = 0;
  const operation = async () => {
    submitCount += 1;
    return { status: "started" as const, runId: "run-1" };
  };

  const first = startAgentLaunchPromptOnce(launchId, operation);
  const second = startAgentLaunchPromptOnce(launchId, operation);
  assert.equal(first, second, "Strict Mode shares one in-tab prompt operation");
  await Promise.all([first, second]);
  assert.equal(submitCount, 1, "the shared operation starts one prompt");

  await startAgentLaunchPromptOnce(launchId, operation);
  assert.equal(submitCount, 2, "a settled operation permits an explicit retry");
}

async function checkSuccessfulLaunchPersistsLifecycleBeforeCleanup(): Promise<void> {
  const harness = createHarness(record());
  const started = await runAgentLaunchPrompt({
    launchId,
    roomId,
    dependencies: harness.dependencies,
  });

  assert.deepEqual(started, { status: "started", runId: "run-1" });
  assert.equal(harness.getSubmitCount(), 1);
  assert.deepEqual(harness.getEvents(), [
    "save:sending-prompt:",
    "submit:Design a global checkout service.",
    "save:prompt-sent:prompt-1",
    "save:starting-run:prompt-1",
    "save:run-started:prompt-1",
    "remove",
    "scrub",
  ]);
  assert.equal(harness.getRemoveCount(), 1);
  assert.equal(harness.getScrubCount(), 1);
}

async function checkMismatchedProjectIsIgnored(): Promise<void> {
  const harness = createHarness(record({ projectId: "other-project-a1b2c3" }));
  const result = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(harness.getSubmitCount(), 0);
  assert.equal(harness.getRemoveCount(), 0);
  assert.equal(harness.getScrubCount(), 0);
}

async function checkMismatchedLaunchIsIgnored(): Promise<void> {
  const harness = createHarness(record({ launchId: "00000000-0000-4a00-8000-000000000099" }));
  const result = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(harness.getSubmitCount(), 0);
}

async function checkPromptFailureIsDurableAndRetryable(): Promise<void> {
  const harness = createHarness(record(), { status: "message-error" });
  const failed = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

  assert.deepEqual(failed, {
    status: "failed",
    message: "We couldn't send your request. Please try again.",
  });
  assert.deepEqual(harness.getRecord(), record({
    stage: "failed",
    error: "We couldn't send your request. Please try again.",
  }));
  assert.equal(harness.getRemoveCount(), 0, "a failure retains the durable retry record");
  assert.equal(harness.getScrubCount(), 0, "a failure retains the opaque query state");
}

async function checkRunFailureKeepsPromptIdentityForRetry(): Promise<void> {
  const harness = createHarness(
    record({ stage: "prompt-sent", promptMessageId: "prompt-1" }),
    { status: "run-error", promptMessageId: "prompt-1" },
  );
  const failed = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

  assert.deepEqual(failed, {
    status: "failed",
    message: "We couldn't start diagram generation. Please try again.",
  });
  assert.deepEqual(harness.getRecord(), record({
    stage: "failed",
    promptMessageId: "prompt-1",
    error: "We couldn't start diagram generation. Please try again.",
  }));
  assert.equal(harness.getSubmitCount(), 1);
}

async function checkPromptSentAndStartingRunResumeWithoutPromptWrite(): Promise<void> {
  for (const stage of ["prompt-sent", "starting-run"] as const) {
    const harness = createHarness(record({ stage, promptMessageId: "prompt-1" }));
    const result = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

    assert.deepEqual(result, { status: "started", runId: "run-1" });
    assert.equal(harness.getSubmitCount(), 1);
    assert.equal(
      harness.getEvents().includes("save:sending-prompt:"),
      false,
      `${stage} resumes without returning to the prompt-write stage`,
    );
    assert.equal(
      harness.getEvents().includes("save:prompt-sent:prompt-1"),
      false,
      `${stage} reuses the durable prompt ID without a duplicate chat write`,
    );
  }
}

async function checkSendingPromptResumesTheServerIdempotentPromptWrite(): Promise<void> {
  const harness = createHarness(record({ stage: "sending-prompt" }));
  const result = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

  assert.deepEqual(result, { status: "started", runId: "run-1" });
  assert.deepEqual(harness.getEvents().slice(0, 4), [
    "submit:Design a global checkout service.",
    "save:prompt-sent:prompt-1",
    "save:starting-run:prompt-1",
    "save:run-started:prompt-1",
  ]);
}

async function checkFailedLaunchUsesDurableIdsToChooseItsRetryStage(): Promise<void> {
  const messageHarness = createHarness(record({ stage: "failed", error: "old failure" }));
  await runAgentLaunchPrompt({ launchId, roomId, dependencies: messageHarness.dependencies });
  assert.equal(messageHarness.getEvents()[0], "save:sending-prompt:");

  const runHarness = createHarness(
    record({ stage: "failed", promptMessageId: "prompt-1", error: "old failure" }),
  );
  await runAgentLaunchPrompt({ launchId, roomId, dependencies: runHarness.dependencies });
  assert.equal(runHarness.getEvents()[0], "save:starting-run:prompt-1");
  assert.equal(
    runHarness.getEvents().includes("save:prompt-sent:prompt-1"),
    false,
    "a durable prompt ID skips the prompt-write retry path",
  );
}

async function checkTerminalLaunchDoesNoWork(): Promise<void> {
  const harness = createHarness(record({ stage: "run-started", promptMessageId: "prompt-1" }));
  const result = await runAgentLaunchPrompt({ launchId, roomId, dependencies: harness.dependencies });

  assert.deepEqual(result, { status: "ignored" });
  assert.equal(harness.getEvents().length, 0);
}

interface SessionStorageProbe {
  storage: Storage;
  setCount: () => number;
  removeCount: () => number;
}

function createSessionStorageProbe(initial: AgentLaunchRecord): SessionStorageProbe {
  const entries = new Map([[agentLaunchStorageKey(initial.launchId), JSON.stringify(initial)]]);
  let setCalls = 0;
  let removeCalls = 0;

  return {
    storage: {
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: () => null,
      get length() {
        return entries.size;
      },
      removeItem: (key) => {
        removeCalls += 1;
        entries.delete(key);
      },
      setItem: (key, value) => {
        setCalls += 1;
        entries.set(key, value);
      },
    },
    setCount: () => setCalls,
    removeCount: () => removeCalls,
  };
}

function installBrowser(storage: Storage): () => void {
  const previousWindow = globalThis.window;
  const browser = {
    history: { replaceState: () => undefined },
    location: { href: `https://truss.example/editor/${roomId}?launch=${launchId}` },
    sessionStorage: storage,
  };
  Object.assign(globalThis, { window: browser });

  return () => {
    Object.assign(globalThis, { window: previousWindow });
  };
}

async function checkLaunchHookWaitsForTheMountedRoom(): Promise<void> {
  const mountedRoomId = roomId;
  const storage = createSessionStorageProbe(record());
  const restoreBrowser = installBrowser(storage.storage);
  let submitCount = 0;
  const submit: AiPromptSubmit = async (text, runOptions, options) => {
    submitCount += 1;
    assert.equal(text, "Design a global checkout service.");
    assert.deepEqual(runOptions, {
      modelId: DEFAULT_AI_DESIGN_MODEL_ID,
      thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
    });
    options?.onPromptSent?.("prompt-hook");
    options?.onRunStarting?.("prompt-hook");
    return {
      status: "started" as const,
      promptMessageId: "prompt-hook",
      subscription: { runId: "run-hook", token: "token-hook" },
    };
  };
  const hook = createReactHookHarness(useAgentLaunchPrompt);

  try {
    hook.render({
      launchId,
      roomId: mountedRoomId,
      canStart: false,
      submit,
    });
    await hook.flush();
    assert.equal(storage.setCount(), 0, "a room that cannot send does not persist launch progress");
    assert.equal(submitCount, 0, "a room that cannot send does not submit a prompt");

    hook.render({
      launchId,
      roomId: mountedRoomId,
      canStart: true,
      submit,
    });
    await hook.flush();
    assert.equal(submitCount, 1, "the mounted send-ready room starts one launch operation");
    assert.equal(storage.setCount(), 4, "the launch lifecycle persists in the send-ready room");
    assert.equal(storage.removeCount(), 1, "only the accepted mounted-room run clears session state");
  } finally {
    hook.unmount();
    restoreBrowser();
  }
}

async function checkLaunchHookRejectsTheWrongMountedRoom(): Promise<void> {
  const storage = createSessionStorageProbe(record({ projectId: "other-project-a1b2c3" }));
  const restoreBrowser = installBrowser(storage.storage);
  let submitCount = 0;
  const hook = createReactHookHarness(useAgentLaunchPrompt);

  try {
    hook.render({
      launchId,
      roomId,
      canStart: true,
      submit: async () => {
        submitCount += 1;
        return {
          status: "started" as const,
          promptMessageId: "unreachable",
          subscription: { runId: "unreachable", token: "unreachable" },
        };
      },
    });
    await hook.flush();

    assert.equal(submitCount, 0, "a project record never starts inside another mounted room");
    assert.equal(storage.setCount(), 0, "a room mismatch makes no launch storage writes");
    assert.equal(storage.removeCount(), 0, "a room mismatch retains the stored launch");
  } finally {
    hook.unmount();
    restoreBrowser();
  }
}

async function checkLaunchUiKeepsTheSidebarOpenAndFailureRetryNeutral(): Promise<void> {
  assert.equal(initialEditorSidebar(), null, "normal editor URLs start closed");
  assert.equal(initialEditorSidebar(launchId), "ai");

  const navbar = renderToStaticMarkup(
    <EditorNavbar
      isSidebarOpen={false}
      isAiSidebarOpen
      onToggleSidebar={() => undefined}
      onToggleAiSidebar={() => undefined}
      projectName="Global Checkout"
      profile={<span>Profile</span>}
    />,
  );
  assert.match(navbar, /aria-controls="ai-sidebar"[^>]*aria-expanded="true"/);

  const sidebar = renderToStaticMarkup(
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={roomId}
        initialPresence={{ cursor: null, isThinking: false }}
      >
        <AiSidebar isOpen launchId={launchId} useCollaboratorsSource={() => []} />
      </RoomProvider>
    </LiveblocksProvider>,
  );
  assert.doesNotMatch(sidebar, />Retry</, "a pending launch does not look failed");
  assert.doesNotMatch(
    sidebar,
    /Design a global checkout service\./,
    "a launch description is never rendered in the editor",
  );

  const failure = renderToStaticMarkup(
    <AgentLaunchFailure
      message="We couldn't start diagram generation. Please try again."
      onRetry={() => undefined}
    />,
  );
  assert.match(failure, /role="alert"/);
  assert.match(failure, />Retry</);
  assert.doesNotMatch(failure, /accent-|state-error/);
}

async function main(): Promise<void> {
  await checkSameTabLaunchSharesOneOperation();
  await checkSuccessfulLaunchPersistsLifecycleBeforeCleanup();
  await checkMismatchedProjectIsIgnored();
  await checkMismatchedLaunchIsIgnored();
  await checkPromptFailureIsDurableAndRetryable();
  await checkRunFailureKeepsPromptIdentityForRetry();
  await checkPromptSentAndStartingRunResumeWithoutPromptWrite();
  await checkSendingPromptResumesTheServerIdempotentPromptWrite();
  await checkFailedLaunchUsesDurableIdsToChooseItsRetryStage();
  await checkTerminalLaunchDoesNoWork();
  await checkLaunchHookWaitsForTheMountedRoom();
  await checkLaunchHookRejectsTheWrongMountedRoom();
  await checkLaunchUiKeepsTheSidebarOpenAndFailureRetryNeutral();

  console.info("Agent launch editor checks passed");
}

void main();
