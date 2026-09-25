import type { EdgeChange, NodeChange } from "@xyflow/react";

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * Undo and redo for one editor tab. Liveblocks room history did this before
 * (ADR 0005); React Flow has no equivalent.
 *
 * Entries are whole snapshots. React state arrays are immutable, so an entry
 * shares every node object it did not change and costs little.
 *
 * ponytail: snapshot stack, O(diagram) per entry and capped at
 * MAX_CANVAS_HISTORY. Switch to stored change arrays if a large diagram makes
 * the cap felt.
 */
export const MAX_CANVAS_HISTORY = 100;

/** Edits closer together than this share one undo step, so typing a label is one step. */
export const CANVAS_HISTORY_COALESCE_MS = 500;

export interface CanvasHistoryStacks {
  past: readonly CanvasSnapshot[];
  future: readonly CanvasSnapshot[];
}

export const EMPTY_CANVAS_HISTORY: CanvasHistoryStacks = { past: [], future: [] };

/** Records the state *before* an edit. A new edit drops the redo branch. */
export function pushCanvasHistory(
  stacks: CanvasHistoryStacks,
  snapshot: CanvasSnapshot,
): CanvasHistoryStacks {
  return { past: [...stacks.past, snapshot].slice(-MAX_CANVAS_HISTORY), future: [] };
}

export function undoCanvasHistory(
  stacks: CanvasHistoryStacks,
  current: CanvasSnapshot,
): { stacks: CanvasHistoryStacks; snapshot: CanvasSnapshot } | null {
  const snapshot = stacks.past.at(-1);

  return snapshot
    ? { snapshot, stacks: { past: stacks.past.slice(0, -1), future: [current, ...stacks.future] } }
    : null;
}

export function redoCanvasHistory(
  stacks: CanvasHistoryStacks,
  current: CanvasSnapshot,
): { stacks: CanvasHistoryStacks; snapshot: CanvasSnapshot } | null {
  const [snapshot, ...future] = stacks.future;

  return snapshot
    ? { snapshot, stacks: { past: [...stacks.past, current].slice(-MAX_CANVAS_HISTORY), future } }
    : null;
}

/**
 * Whether a React Flow change starts an undoable edit. A drag or a resize is
 * one edit: only its first frame counts, detected by the node not yet
 * carrying the `dragging` or `resizing` flag that frame sets. A dimensions
 * change without `resizing` is React Flow measuring a node, not an edit.
 */
export function isCanvasHistoryCommit(
  change: NodeChange<CanvasNode> | EdgeChange<CanvasEdge>,
  nodes: readonly CanvasNode[],
): boolean {
  switch (change.type) {
    case "add":
    case "remove":
    case "replace":
      return true;
    case "position":
      return !nodes.find((node) => node.id === change.id)?.dragging;
    case "dimensions":
      return change.resizing === true && !nodes.find((node) => node.id === change.id)?.resizing;
    default:
      return false;
  }
}
