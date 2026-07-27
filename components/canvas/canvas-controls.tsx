"use client";

import {
  useCanRedo,
  useCanUndo,
  useRedo,
  useUndo,
} from "@liveblocks/react/suspense";
import { useReactFlow } from "@xyflow/react";
import {
  Maximize,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import {
  VIEWPORT_TRANSITION_MS,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";

const TRANSITION = { duration: VIEWPORT_TRANSITION_MS };

interface ControlButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

function ControlButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-full text-copy-muted transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}

/**
 * The floating zoom and history bar (17-canvas-ergonomics).
 *
 * Undo/redo are Liveblocks room history rather than a local stack: every canvas
 * edit is a Storage mutation, so the room is the only place that knows what the
 * last one was. It is per-client — undo takes back *your* last change, not a
 * collaborator's.
 *
 * The keyboard shortcuts are registered here because this is the one component
 * that already holds all four handlers.
 */
export function CanvasControls() {
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const undo = useUndo();
  const redo = useRedo();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  useKeyboardShortcuts({ flow, undo, redo });

  return (
    <div
      role="toolbar"
      aria-label="Canvas controls"
      aria-orientation="horizontal"
      className="flex items-center gap-1 rounded-full border border-surface-border bg-elevated/90 p-1.5 shadow-lg backdrop-blur"
    >
      <ControlButton
        label="Zoom out"
        icon={ZoomOut}
        onClick={() => void flow.zoomOut(TRANSITION)}
      />
      <ControlButton
        label="Fit view"
        icon={Maximize}
        onClick={() => void flow.fitView(TRANSITION)}
      />
      <ControlButton
        label="Zoom in"
        icon={ZoomIn}
        onClick={() => void flow.zoomIn(TRANSITION)}
      />

      <span aria-hidden className="mx-1 h-5 w-px bg-surface-border" />

      <ControlButton
        label="Undo"
        icon={Undo2}
        onClick={undo}
        disabled={!canUndo}
      />
      <ControlButton
        label="Redo"
        icon={Redo2}
        onClick={redo}
        disabled={!canRedo}
      />
    </div>
  );
}
