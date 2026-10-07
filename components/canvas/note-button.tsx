"use client";

import { StickyNote } from "lucide-react";

import { NOTE_DRAG_MIME } from "@/lib/canvas-drag";
import { FLOATING_SURFACE } from "@/lib/floating-surface";
import { cn } from "@/lib/utils";

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
    <div className={cn(FLOATING_SURFACE, "rounded-[24px] p-[5px]")}>
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
        className="flex h-9 w-9 items-center justify-center rounded-full text-copy-secondary transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <StickyNote className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
