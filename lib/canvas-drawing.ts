import type { XYPosition } from "@xyflow/react";

import {
  AI_CURSOR_ARRIVAL_PAD_MS,
  AI_CURSOR_SWEEP_MS,
  getBuildStepMs,
} from "@/types/tasks";

export interface PacedCanvasAction<Flow> {
  target: () => XYPosition | null;
  apply: (flow: Flow) => void;
}

export interface CanvasDrawingDependencies {
  setAiPresence: (
    roomId: string,
    presence: { cursor: XYPosition | null; isThinking: boolean },
  ) => Promise<void>;
  clearAiPresence: (roomId: string) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
}

/** Cleans the native AI presence across the full run, including pre-build work. */
export async function runWithAiPresenceCleanup<T>(
  roomId: string,
  operation: () => Promise<T>,
  dependencies: Pick<CanvasDrawingDependencies, "clearAiPresence">,
): Promise<T> {
  try {
    return await operation();
  } finally {
    await dependencies.clearAiPresence(roomId);
  }
}

/**
 * The native server drawing loop used by both AI plans and caller-supplied
 * graph imports. Call this inside one `mutateFlow` callback: each wait lets
 * Liveblocks flush incremental operations without another Storage fetch.
 */
export async function drawPacedCanvasActions<Flow>(
  roomId: string,
  flow: Flow,
  actions: readonly PacedCanvasAction<Flow>[],
  dependencies: CanvasDrawingDependencies,
): Promise<number> {
  const stepMs = getBuildStepMs(actions.length);
  let applied = 0;

  try {
    for (const action of actions) {
      const target = action.target();

      if (target) {
        // Presence is cosmetic: it must not delay a canvas write beyond the
        // actual cursor travel time below.
        void dependencies
          .setAiPresence(roomId, { cursor: target, isThinking: true })
          .catch(() => undefined);
        await dependencies.sleep(AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS);
      }

      action.apply(flow);
      applied += 1;
      await dependencies.sleep(stepMs);
    }
  } finally {
    try {
      await dependencies.clearAiPresence(roomId);
    } catch {
      // A presence clear is cosmetic and cannot invalidate the persisted graph.
    }
  }

  return applied;
}
