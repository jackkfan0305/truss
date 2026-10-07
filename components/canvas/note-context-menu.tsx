"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";
import type { XYPosition } from "@xyflow/react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface NoteContextMenuProps {
  /** Called with the right-click point in screen coordinates. */
  onAdd: (point: XYPosition) => void;
  children: ReactNode;
}

/** Empty canvas only: React Flow's pane, minus the nodes and edges drawn inside it. */
function isEmptyCanvas(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(".react-flow__pane") !== null &&
    target.closest(".react-flow__node, .react-flow__edge") === null
  );
}

/**
 * Right-clicking empty canvas offers "Add sticky note". Anywhere else the event
 * is stopped before it reaches the trigger, so the browser's own menu shows.
 */
export function NoteContextMenu({ onAdd, children }: NoteContextMenuProps) {
  const point = useRef<XYPosition>({ x: 0, y: 0 });

  const handleContextMenuCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!isEmptyCanvas(event.target)) {
      event.stopPropagation();
      return;
    }
    point.current = { x: event.clientX, y: event.clientY };
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div className="h-full w-full" onContextMenuCapture={handleContextMenuCapture} />}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onAdd(point.current)}>
          Add sticky note
          <kbd className="ml-auto font-mono text-xs text-copy-muted">N</kbd>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
