import { useSyncExternalStore } from "react";

/**
 * Which code block has its pseudocode card open. Edges read it to light the
 * block's own connections and dim the rest.
 *
 * ponytail: one module-level value, so two canvases on one page would share it.
 * Move it into a canvas-scoped context if that ever happens.
 */
let hovered: string | null = null;
const listeners = new Set<() => void>();

export function setHoveredCodeBlock(id: string | null, open: boolean): void {
  const next = open ? id : hovered === id ? null : hovered;
  if (next === hovered) return;
  hovered = next;
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The block whose card is pinned open with P; it stays lit when nothing else is hovered. */
let pinned: string | null = null;

export function setPinnedCodeBlock(id: string | null): void {
  if (id === pinned) return;
  pinned = id;
  notify();
}

/** Drops the pin only when `id` holds it, so one block unmounting leaves another's pin alone. */
export function unpinCodeBlock(id: string): void {
  if (pinned === id) setPinnedCodeBlock(null);
}

/** The card keys act on: the hovered block's, else the pinned one. */
export function activeCodeBlock(): string | null {
  return hovered ?? pinned;
}

export function usePinnedCodeBlock(): string | null {
  return useSyncExternalStore(subscribe, () => pinned, () => null);
}

export function useHoveredCodeBlock(): string | null {
  return useSyncExternalStore(subscribe, () => hovered ?? pinned, () => null);
}

/**
 * Which code module the pointer is over, while no block in it is hovered.
 * Everything inside it stays lit; other blocks and edges that do not touch it
 * fade. A hovered block takes precedence, since it is the more specific focus.
 */
let hoveredModule: string | null = null;

export function setHoveredCodeModule(id: string, over: boolean): void {
  const next = over ? id : hoveredModule === id ? null : hoveredModule;
  if (next === hoveredModule) return;
  hoveredModule = next;
  notify();
}

export function useHoveredCodeModule(): string | null {
  return useSyncExternalStore(subscribe, () => (hovered === null && pinned === null ? hoveredModule : null), () => null);
}
