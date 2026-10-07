"use client";

import { useCallback, useState, type CSSProperties, type KeyboardEvent } from "react";
import { NodeResizer, NodeToolbar, Position, useReactFlow, type NodeProps } from "@xyflow/react";

import { consumeNoteEdit } from "@/lib/canvas-note-edit";
import { cn } from "@/lib/utils";
import {
  DEFAULT_NOTE_COLOR,
  MAX_NOTE_TEXT_LENGTH,
  NOTE_COLORS,
  NOTE_MIN_SIZE,
  type CanvasEdge,
  type CanvasNode,
  type NoteColor,
} from "@/types/canvas";

const NOTE_PLACEHOLDER = "Write a note…";
const COLOR_KEYS = Object.keys(NOTE_COLORS) as NoteColor[];

/** Clear of the note's selected outline and its top resize handle. */
const TOOLBAR_OFFSET = 14;

/**
 * A sticky note: paper fill, dark ink, folded top-right corner. No handles, so
 * nothing can connect to it. Text scrolls inside the note (`nowheel`).
 */
export function CanvasNoteRenderer({ id, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>();
  const [isEditing, setIsEditing] = useState(() => consumeNoteEdit(id));
  const noteColor = data.noteColor ?? DEFAULT_NOTE_COLOR;
  const { fill, ink } = NOTE_COLORS[noteColor];

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter stays a newline; only Escape leaves the editor.
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setIsEditing(false);
  }, []);

  return (
    <>
      <div
        className="relative h-full w-full rounded-[4px] text-sm leading-relaxed shadow-[0_6px_18px_rgb(0_0_0/0.45),0_1px_2px_rgb(0_0_0/0.3)]"
        style={{ backgroundColor: fill, color: ink }}
      >
        {isEditing ? (
          <textarea
            autoFocus
            className="nodrag nowheel nopan nokey h-full w-full resize-none bg-transparent py-3 pl-3 pr-5 outline-none placeholder:text-current placeholder:opacity-50"
            value={data.label}
            maxLength={MAX_NOTE_TEXT_LENGTH}
            placeholder={NOTE_PLACEHOLDER}
            aria-label="Note text"
            onChange={(event) => updateNodeData(id, { label: event.target.value })}
            onBlur={() => setIsEditing(false)}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <div
            data-note-text
            className={cn(
              "nowheel nopan h-full overflow-auto whitespace-pre-wrap break-words py-3 pl-3 pr-5",
              !data.label && "opacity-50",
            )}
            onDoubleClick={() => setIsEditing(true)}
          >
            {data.label || NOTE_PLACEHOLDER}
          </div>
        )}
        {/* The folded corner: page colour above the diagonal, a soft shade below. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 h-[18px] w-[18px] rounded-bl-[3px]"
          style={{ background: "linear-gradient(225deg, var(--bg-base) 50%, rgb(0 0 0 / 0.18) 50%)" }}
        />
      </div>
      {selected ? (
        <NodeResizer
          minWidth={NOTE_MIN_SIZE.width}
          minHeight={NOTE_MIN_SIZE.height}
          handleClassName="nokey"
          lineClassName="nokey"
        />
      ) : null}
      <NodeToolbar
        nodeId={id}
        position={Position.Top}
        offset={TOOLBAR_OFFSET}
        className="nodrag nopan nokey flex items-center gap-1.5 rounded-xl border border-surface-border bg-elevated/90 px-2 py-1.5 shadow-lg backdrop-blur-md"
        role="toolbar"
        aria-label="Note color"
      >
        {COLOR_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="node-color-swatch"
            style={{ backgroundColor: NOTE_COLORS[key].fill, "--swatch-accent": NOTE_COLORS[key].ink } as CSSProperties}
            aria-label={key}
            aria-pressed={key === noteColor}
            onClick={() => updateNodeData(id, { noteColor: key })}
          />
        ))}
      </NodeToolbar>
    </>
  );
}
