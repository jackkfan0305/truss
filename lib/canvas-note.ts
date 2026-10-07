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

/** Gaps between the diagram and the column of agent-placed notes, and between notes. */
const NOTE_GAP_X = 80;
const NOTE_GAP_Y = 24;

/**
 * Puts unplaced notes in a column 80px right of the laid-out diagram, top
 * aligned; placed notes keep their spot. Roots bound the diagram because every
 * child sits inside its root boundary.
 */
export function placeNotes(
  laidOut: readonly CanvasNode[],
  notes: readonly CanvasNode[],
  unplaced: ReadonlySet<string>,
): CanvasNode[] {
  const roots = laidOut.filter((node) => !node.parentId);
  const right = roots.length
    ? Math.max(...roots.map((node) => node.position.x + (node.width ?? 0))) + NOTE_GAP_X
    : 0;
  let y = roots.length ? Math.min(...roots.map((node) => node.position.y)) : 0;

  return notes.map((note) => {
    if (!unplaced.has(note.id)) return note;
    const placed = { ...note, position: { x: right, y } };
    y += (note.height ?? NOTE_DEFAULT_SIZE.height) + NOTE_GAP_Y;
    return placed;
  });
}
