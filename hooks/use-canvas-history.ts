"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  CANVAS_HISTORY_COALESCE_MS,
  EMPTY_CANVAS_HISTORY,
  pushCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
  type CanvasHistoryCheckpointOptions,
  type CanvasHistoryStacks,
} from "@/lib/canvas-history";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";

export interface CanvasHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Call from an event handler *before* applying an edit. */
  checkpoint: (options?: CanvasHistoryCheckpointOptions) => void;
  /** Forget everything, after the canvas was replaced from outside this tab. */
  reset: () => void;
}

/**
 * History is recorded from event handlers, never from effects: the caller
 * checkpoints before it applies an edit, which is the only moment the
 * pre-edit state is still in hand.
 */
export function useCanvasHistory(
  current: CanvasSnapshot,
  restore: (snapshot: CanvasSnapshot) => void,
): CanvasHistoryControls {
  const [stacks, setStacks] = useState<CanvasHistoryStacks>(EMPTY_CANVAS_HISTORY);
  const lastEditAt = useRef(Number.NEGATIVE_INFINITY);

  const checkpoint = useCallback(
    (options?: CanvasHistoryCheckpointOptions) => {
      const now = Date.now();
      const isSameBurst = now - lastEditAt.current < CANVAS_HISTORY_COALESCE_MS;

      lastEditAt.current = now;

      if (options?.force || !isSameBurst) {
        setStacks((previous) => pushCanvasHistory(previous, current));
      }
    },
    [current],
  );

  const step = useCallback(
    (move: typeof undoCanvasHistory) => {
      const result = move(stacks, current);

      if (!result) {
        return;
      }

      // The next edit must start its own step, even straight after an undo.
      lastEditAt.current = Number.NEGATIVE_INFINITY;
      setStacks(result.stacks);
      restore(result.snapshot);
    },
    [current, restore, stacks],
  );

  const undo = useCallback(() => step(undoCanvasHistory), [step]);
  const redo = useCallback(() => step(redoCanvasHistory), [step]);
  const reset = useCallback(() => {
    lastEditAt.current = Number.NEGATIVE_INFINITY;
    setStacks(EMPTY_CANVAS_HISTORY);
  }, []);

  return useMemo(
    () => ({
      undo,
      redo,
      checkpoint,
      reset,
      canUndo: stacks.past.length > 0,
      canRedo: stacks.future.length > 0,
    }),
    [checkpoint, redo, reset, stacks, undo],
  );
}
