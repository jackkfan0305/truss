import type { XYPosition } from "@xyflow/react";

import { AI_CURSOR_ARRIVAL_PAD_MS, AI_CURSOR_SWEEP_MS, getBuildStepMs } from "@/types/tasks";

export interface PacedCanvasAction<Target> {
  target: () => XYPosition | null;
  apply: (target: Target) => void;
}

export interface CanvasDrawingDependencies {
  moveCursor: (cursor: XYPosition) => void;
  clearCursor: () => void;
  sleep: (milliseconds: number) => Promise<void>;
}

/**
 * Applies actions at a watchable pace, with the agent cursor arriving before
 * each one lands (32-live-canvas-building). Runs in the browser now: the
 * server writes an agent's change at once, and the open editor replays it.
 */
export async function drawPacedCanvasActions<Target>(
  target: Target,
  actions: readonly PacedCanvasAction<Target>[],
  dependencies: CanvasDrawingDependencies,
): Promise<number> {
  const stepMs = getBuildStepMs(actions.length);
  let applied = 0;

  try {
    for (const action of actions) {
      const cursor = action.target();

      if (cursor) {
        dependencies.moveCursor(cursor);
        await dependencies.sleep(AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS);
      }

      action.apply(target);
      applied += 1;
      await dependencies.sleep(stepMs);
    }
  } finally {
    dependencies.clearCursor();
  }

  return applied;
}
