import assert from "node:assert/strict";

import {
  drawPacedCanvasActions,
  runWithAiPresenceCleanup,
  type PacedCanvasAction,
} from "../lib/canvas-drawing";
import {
  AI_CURSOR_ARRIVAL_PAD_MS,
  AI_CURSOR_SWEEP_MS,
  getBuildStepMs,
} from "../types/tasks";

interface FakeFlow {
  writes: string[];
}

/** Whole native runs clear presence even when nothing reaches the drawing loop. */
async function checkWholeRunCleanupCoversZeroActionAndPreBuildFailure(): Promise<void> {
  const cleared: string[] = [];
  const dependencies = {
    clearAiPresence: async (roomId: string) => {
      cleared.push(roomId);
    },
  };

  const zeroAction = await runWithAiPresenceCleanup(
    "room-zero",
    async () => ({ applied: 0 }),
    dependencies,
  );
  assert.deepEqual(zeroAction, { applied: 0 });

  await assert.rejects(
    runWithAiPresenceCleanup(
      "room-failed-before-build",
      async () => {
        throw new Error("model unavailable");
      },
      dependencies,
    ),
  );
  assert.deepEqual(cleared, ["room-zero", "room-failed-before-build"]);
}

async function checkNativeDrawingCadenceIsShared(): Promise<void> {
  const flow: FakeFlow = { writes: [] };
  const events: string[] = [];
  const actions: PacedCanvasAction<FakeFlow>[] = [
    {
      target: () => ({ x: 0, y: 0 }),
      apply: (target) => {
        target.writes.push("node:client");
      },
    },
    {
      target: () => ({ x: 280, y: 0 }),
      apply: (target) => {
        target.writes.push("edge:client-to-orders");
      },
    },
  ];

  const applied = await drawPacedCanvasActions("project-1", flow, actions, {
    setAiPresence: async (_roomId, presence) => {
      events.push(`cursor:${presence.cursor?.x},${presence.cursor?.y}`);
    },
    clearAiPresence: async () => {
      events.push("clear");
    },
    sleep: async (milliseconds) => {
      events.push(`delay:${milliseconds}`);
    },
  });

  assert.equal(applied, 2);
  assert.deepEqual(flow.writes, ["node:client", "edge:client-to-orders"]);
  assert.deepEqual(events, [
    "cursor:0,0",
    `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`,
    `delay:${getBuildStepMs(2)}`,
    "cursor:280,0",
    `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`,
    `delay:${getBuildStepMs(2)}`,
    "clear",
  ]);
}

void (async () => {
  await checkNativeDrawingCadenceIsShared();
  await checkWholeRunCleanupCoversZeroActionAndPreBuildFailure();
  console.log("✅ Shared native canvas drawing verified");
})();
