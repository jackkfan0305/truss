import assert from "node:assert/strict";

import {
  drawPacedCanvasActions,
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

void checkNativeDrawingCadenceIsShared().then(() => {
  console.log("✅ Shared native canvas drawing verified");
});
