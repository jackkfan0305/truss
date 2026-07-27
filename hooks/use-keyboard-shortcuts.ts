"use client";

import { useEffect } from "react";
import type { ReactFlowInstance } from "@xyflow/react";

import { resolveShortcut } from "@/lib/canvas-shortcuts";
import {
  VIEWPORT_TRANSITION_MS,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";

interface KeyboardShortcutsOptions {
  flow: ReactFlowInstance<CanvasNode, CanvasEdge>;
  undo: () => void;
  redo: () => void;
}

/**
 * Typing "-" in a node label must not zoom the canvas out, and Cmd+Z inside the
 * label editor belongs to the text field rather than to room history.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA"
  );
}

/**
 * Canvas keyboard shortcuts (17-canvas-ergonomics): the same four actions the
 * control bar exposes, bound on `window` so they work wherever focus sits on
 * the canvas rather than only while a node is focused.
 */
export function useKeyboardShortcuts({
  flow,
  undo,
  redo,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    const transition = { duration: VIEWPORT_TRANSITION_MS };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const shortcut = resolveShortcut(event);

      if (!shortcut) {
        return;
      }

      // Cmd+Z would otherwise also reach the browser's own undo stack, and "-"
      // is a browser zoom shortcut on some platforms.
      event.preventDefault();

      switch (shortcut) {
        case "zoom-in":
          void flow.zoomIn(transition);
          break;
        case "zoom-out":
          void flow.zoomOut(transition);
          break;
        case "undo":
          undo();
          break;
        case "redo":
          redo();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flow, undo, redo]);
}
