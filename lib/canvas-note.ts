import type { XYPosition } from "@xyflow/react";

import {
  CANVAS_NOTE_TYPE,
  DEFAULT_NODE_COLOR,
  DEFAULT_NOTE_COLOR,
  NOTE_COLORS,
  NOTE_DEFAULT_SIZE,
  type CanvasNode,
  type NoteColor,
} from "@/types/canvas";

/**
 * Sticky notes: free-floating nodes with no parent, no edges and no layout.
 * Free of React so the snapshot parser and the agent layout can share it.
 */

export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === "string" && Object.hasOwn(NOTE_COLORS, value);
}

export function isNote(node: { data?: { kind?: string } }): boolean {
  return node.data?.kind === "note";
}

/** A fresh yellow 200×200 note centred on `center`. */
export function createNoteNode(center: XYPosition): CanvasNode {
  const { width, height } = NOTE_DEFAULT_SIZE;

  return {
    id: `note-${crypto.randomUUID()}`,
    type: CANVAS_NOTE_TYPE,
    position: { x: center.x - width / 2, y: center.y - height / 2 },
    width,
    height,
    data: {
      kind: "note",
      label: "",
      noteColor: DEFAULT_NOTE_COLOR,
      // Unused by notes; kept so every node satisfies `CanvasNodeData`.
      color: DEFAULT_NODE_COLOR,
      shape: "rectangle",
    },
  };
}
