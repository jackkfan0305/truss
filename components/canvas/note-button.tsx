"use client";

import { StickyNote } from "lucide-react";

import { NOTE_DRAG_MIME } from "@/lib/canvas-drag";

interface NoteButtonProps {
  onAdd: () => void;
}

/**
 * The sticky-note button beside the section dock, on the same floating
 * surface. Click adds a note in the middle of the view; dragging drops one on
 * the cursor.
 */
export function NoteButton({ onAdd }: NoteButtonProps) {
  return (
    // ponytail: same classes as FLOATING_SURFACE in lib/floating-surface.ts; import it once that file is committed.
    <div className="rounded-[28px] border border-surface-border bg-elevated p-1.5 shadow-lg shadow-page/60">
      <button
        type="button"
        aria-label="Add sticky note"
        title="Sticky note (N)"
        draggable
        onClick={onAdd}
        onDragStart={(event) => {
          event.dataTransfer.setData(NOTE_DRAG_MIME, "note");
          event.dataTransfer.effectAllowed = "copy";
        }}
        className="flex h-11 w-11 items-center justify-center rounded-full text-copy-secondary transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <StickyNote className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
