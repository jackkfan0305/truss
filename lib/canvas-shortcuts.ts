/**
 * Keyboard shortcut matching for the canvas (17-canvas-ergonomics).
 *
 * Pure and DOM-free so `scripts/verify-canvas.ts` can assert the whole table:
 * a shortcut that silently matches nothing — or one that fires on a modifier
 * combination the browser already owns — is invisible in review.
 */

export type CanvasShortcut = "zoom-in" | "zoom-out" | "undo" | "redo";

/** The parts of a `KeyboardEvent` the matcher reads. */
export interface ShortcutKeys {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export function resolveShortcut(event: ShortcutKeys): CanvasShortcut | null {
  const key = event.key.toLowerCase();

  // Cmd on macOS, Ctrl everywhere else — one branch, because neither modifier
  // carries a different meaning for any shortcut here.
  if (event.metaKey || event.ctrlKey) {
    if (key === "z") {
      return event.shiftKey ? "redo" : "undo";
    }

    if (key === "y") {
      return "redo";
    }

    return null;
  }

  // "+" is Shift+"=" on most layouts, so the shift state is deliberately not
  // checked: the browser reports the shifted character, not the physical key.
  if (key === "+" || key === "=") {
    return "zoom-in";
  }

  if (key === "-") {
    return "zoom-out";
  }

  return null;
}
