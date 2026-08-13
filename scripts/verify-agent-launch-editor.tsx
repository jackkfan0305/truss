import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { useAgentLaunchImport } from "../hooks/use-agent-launch-import";
import type { AgentLaunchImportDependencies } from "../lib/agent-launch-import-runner";
import {
  runAgentLaunchImport,
  startAgentLaunchImportOnce,
} from "../lib/agent-launch-import-runner";
import {
  agentLaunchStorageKey,
  createAgentLaunchRecord,
  type AgentLaunchRecord,
} from "../lib/agent-launch";
import { initialEditorSidebar } from "../lib/editor-sidebar-state";
import { createReactHookHarness } from "./testing/react-hook-harness";

const launchId = "00000000-0000-4a00-8000-000000000006";
const roomId = "global-checkout-a1b2c3";

function record(overrides: Partial<AgentLaunchRecord> = {}): AgentLaunchRecord {
  return {
    ...createAgentLaunchRecord({
      version: 1,
      launchId,
      title: "Global Checkout",
      graph: {
        version: 1,
        nodes: [
          {
            id: "checkout",
            label: "Checkout",
            shape: "rectangle",
            color: "blue",
            x: 0,
            y: 0,
          },
        ],
        edges: [],
      },
    }),
    projectId: roomId,
    stage: "project-created",
    ...overrides,
  };
}

interface Harness {
  dependencies: AgentLaunchImportDependencies;
  getRecord: () => AgentLaunchRecord | null;
  getEvents: () => string[];
  getRemoveCount: () => number;
  getScrubCount: () => number;
}

function createHarness(
  initial: AgentLaunchRecord | null,
  response: Response | Error = Response.json({ imported: true }),
): Harness {
  let stored = initial;
  let removeCount = 0;
  let scrubCount = 0;
  const events: string[] = [];
  const dependencies: AgentLaunchImportDependencies = {
    load: () => stored,
    save: (next) => {
      stored = next;
      events.push(`save:${next.stage}`);
    },
    remove: () => {
      removeCount += 1;
      stored = null;
      events.push("remove");
    },
    importGraph: async (projectId, launch) => {
      events.push(`import:${projectId}:${launch.launchId}`);
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    scrubQuery: () => {
      scrubCount += 1;
      events.push("scrub");
    },
  };

  return {
    dependencies,
    getRecord: () => stored,
    getEvents: () => events,
    getRemoveCount: () => removeCount,
    getScrubCount: () => scrubCount,
  };
}

async function checkSameTabLaunchSharesOneOperation(): Promise<void> {
  let calls = 0;
  const operation = async () => {
    calls += 1;
    return { status: "imported" as const };
  };

  const first = startAgentLaunchImportOnce(launchId, operation);
  const second = startAgentLaunchImportOnce(launchId, operation);
  assert.equal(first, second, "Strict Mode shares one in-tab import operation");
  await Promise.all([first, second]);
  assert.equal(calls, 1, "the shared operation imports once");

  await startAgentLaunchImportOnce(launchId, operation);
  assert.equal(calls, 2, "a settled operation permits an explicit retry");
}

async function checkSuccessfulImportPersistsLifecycleBeforeCleanup(): Promise<void> {
  const harness = createHarness(record());
  const result = await runAgentLaunchImport({
    launchId,
    roomId,
    dependencies: harness.dependencies,
  });

  assert.deepEqual(result, { status: "imported" });
  assert.deepEqual(harness.getRecord(), null, "successful import clears storage");
  assert.deepEqual(harness.getEvents(), [
    "save:importing-graph",
    `import:${roomId}:${launchId}`,
    "save:graph-imported",
    "remove",
    "scrub",
  ]);
  assert.equal(harness.getRemoveCount(), 1);
  assert.equal(harness.getScrubCount(), 1);
}

async function checkImportOnlyClearsAfterHttp200(): Promise<void> {
  for (const response of [
    Response.json({ error: "retry" }, { status: 409 }),
    Response.json({ error: "retry" }, { status: 502 }),
  ]) {
    const harness = createHarness(record(), response);
    const result = await runAgentLaunchImport({
      launchId,
      roomId,
      dependencies: harness.dependencies,
    });

    assert.deepEqual(result, {
      status: "failed",
      message: "We couldn't import your diagram. Please try again.",
    });
    assert.equal(harness.getRecord()?.stage, "failed");
    assert.equal(harness.getRecord()?.graph.nodes[0]?.label, "Checkout");
    assert.equal(harness.getRemoveCount(), 0);
    assert.equal(harness.getScrubCount(), 0);
  }

  const network = createHarness(record(), new Error("offline"));
  await runAgentLaunchImport({ launchId, roomId, dependencies: network.dependencies });
  assert.equal(network.getRecord()?.stage, "failed");
  assert.equal(network.getRemoveCount(), 0);

  const retry = createHarness(record(), Response.json({ error: "retry" }, { status: 502 }));
  await runAgentLaunchImport({ launchId, roomId, dependencies: retry.dependencies });
  retry.dependencies.importGraph = async () => Response.json({ imported: true });
  assert.deepEqual(
    await runAgentLaunchImport({ launchId, roomId, dependencies: retry.dependencies }),
    { status: "imported" },
    "a failed import can safely retry through the same record",
  );
}

async function checkTerminalAndMismatchedLaunchesDoNothing(): Promise<void> {
  for (const initial of [
    record({ stage: "graph-imported" }),
    record({ projectId: "other-project-a1b2c3" }),
    record({ launchId: "00000000-0000-4a00-8000-000000000099" }),
  ]) {
    const harness = createHarness(initial);
    const result = await runAgentLaunchImport({
      launchId,
      roomId,
      dependencies: harness.dependencies,
    });
    assert.deepEqual(result, { status: "ignored" });
    assert.deepEqual(harness.getEvents(), []);
  }
}

async function checkImportHookWaitsForRoomAndRetries(): Promise<void> {
  const entries = new Map([[agentLaunchStorageKey(launchId), JSON.stringify(record())]]);
  let calls = 0;
  const previousWindow = globalThis.window;
  Object.assign(globalThis, {
    window: {
      history: { replaceState: () => undefined },
      location: { href: `https://truss.example/editor/${roomId}?launch=${launchId}` },
      sessionStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
      },
      fetch: async () => {
        calls += 1;
        return Response.json({ imported: true });
      },
    },
  });
  const hook = createReactHookHarness(useAgentLaunchImport);

  try {
    hook.render({ launchId, roomId, canStart: false });
    await hook.flush();
    assert.equal(calls, 0, "import waits for the authorized active room");

    hook.render({ launchId, roomId, canStart: true });
    await hook.flush();
    assert.equal(calls, 1, "the room starts one import");
    assert.equal(entries.has(agentLaunchStorageKey(launchId)), false);
  } finally {
    hook.unmount();
    Object.assign(globalThis, { window: previousWindow });
  }
}

async function checkNeutralFailureUiAndUnchangedManualSidebar(): Promise<void> {
  assert.equal(initialEditorSidebar(), null, "normal editor visits start closed");
  assert.equal(initialEditorSidebar(), null, "launch imports do not open AI");

  const shell = readFileSync("components/editor/editor-shell.tsx", "utf8");
  assert.match(shell, /AgentLaunchImportFailure/);
  assert.match(shell, /role="alert"/);
  assert.match(shell, /Retry/);
  assert.doesNotMatch(shell, /launchId=\{launchId\}/);
  assert.doesNotMatch(shell, /Checkout|Global Checkout|accent-|state-error/);

  const sidebar = readFileSync("components/editor/ai-sidebar.tsx", "utf8");
  assert.doesNotMatch(sidebar, /useAgentLaunchPrompt|launchId/);
  const hook = readFileSync("hooks/use-agent-launch-import.ts", "utf8");
  assert.doesNotMatch(hook, /\/api\/ai\/(?:chat|orchestrate)|Trigger/);
}

async function main(): Promise<void> {
  await checkSameTabLaunchSharesOneOperation();
  await checkSuccessfulImportPersistsLifecycleBeforeCleanup();
  await checkImportOnlyClearsAfterHttp200();
  await checkTerminalAndMismatchedLaunchesDoNothing();
  await checkImportHookWaitsForRoomAndRetries();
  await checkNeutralFailureUiAndUnchangedManualSidebar();

  console.info("Agent launch editor checks passed");
}

void main();
