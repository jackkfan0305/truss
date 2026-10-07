"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";

import { cn } from "@/lib/utils";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/** Shown at rest and as the textarea placeholder, so the hint never moves. */
const LABEL_PLACEHOLDER = "Untitled";

interface CanvasLabelProps {
  id: string;
  label: string;
  ariaLabel: string;
  /** Applied to the double-click target, which is what lays the label out. */
  className?: string;
}

/**
 * Inline label editor shared by generic nodes, AWS blocks and boundaries.
 *
 * The label is written through React Flow's controlled flow on every
 * keystroke, so each change lands in the stored snapshot via `onNodesChange`.
 */
export function CanvasLabel({ id, label, ariaLabel, className }: CanvasLabelProps) {
  const { updateNodeData } = useReactFlow<CanvasNode, CanvasEdge>();
  const store = useStoreApi<CanvasNode, CanvasEdge>();
  const [isEditing, setIsEditing] = useState(false);

  const stopEditing = useCallback(() => setIsEditing(false), []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter commits; Shift+Enter falls through to the textarea's own newline.
      const isCommit = event.key === "Enter" && !event.shiftKey;

      if (!isCommit && event.key !== "Escape") {
        return;
      }

      // Without this the textarea inserts the newline before it unmounts.
      if (isCommit) event.preventDefault();

      // React Flow's node key handler also reads Enter and would toggle the
      // selection straight back on.
      event.stopPropagation();
      setIsEditing(false);

      // Leave the node: deselect it, then hand focus to the canvas, since the
      // textarea is about to unmount and the browser would drop focus on <body>.
      const { domNode, resetSelectedElements } = store.getState();

      resetSelectedElements();
      domNode?.focus({ preventScroll: true });
    },
    [store],
  );

  return (
    // `nopan` covers the whole label area: React Flow reads it off the event
    // target to veto the pane's double-click zoom.
    <div className={cn("nopan", className)} onDoubleClick={() => setIsEditing(true)}>
      {/* The label stays in the layout while editing so the node never shifts. */}
      <div className="relative w-full">
        <span className={cn("break-words", isEditing && "invisible", !label && "opacity-50")}>
          {label || LABEL_PLACEHOLDER}
        </span>
        {isEditing ? (
          <textarea
            autoFocus
            // `nodrag` so selecting text does not drag the node, `nokey` so
            // Shift+click extends the selection instead of the pane's box.
            className="nodrag nopan nokey absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-center outline-none"
            value={label}
            placeholder={LABEL_PLACEHOLDER}
            aria-label={ariaLabel}
            onChange={(event) => updateNodeData(id, { label: event.target.value })}
            onBlur={stopEditing}
            onKeyDown={handleKeyDown}
          />
        ) : null}
      </div>
    </div>
  );
}
