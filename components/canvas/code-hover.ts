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
  for (const listener of listeners) listener();
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

const ARROW_SIDES: Record<string, CardSide> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };

/** The side an arrow key moves the card to, or null for any other key. */
export function arrowCardSide(key: string): CardSide | null {
  return ARROW_SIDES[key] ?? null;
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
  for (const listener of listeners) listener();
}

export function useHoveredCodeModule(): string | null {
  return useSyncExternalStore(subscribe, () => (hovered === null && pinned === null ? hoveredModule : null), () => null);
}

/** Whether `id` is `moduleId` or sits somewhere inside it. */
export function isInsideModule(id: string, moduleId: string, parentOf: (id: string) => string | undefined): boolean {
  const seen = new Set<string>();
  for (let at: string | undefined = id; at && !seen.has(at); at = parentOf(at)) {
    if (at === moduleId) return true;
    seen.add(at);
  }
  return false;
}

export type CardSide = "right" | "left" | "bottom" | "top";
interface Box { x: number; y: number; width: number; height: number }

/**
 * The side of `block` where the card covers the fewest connected blocks, so
 * the lit path stays visible beside the pseudocode. A connected block counts
 * against a side when its centre lies past that edge. Ties keep the order
 * right, left, bottom, top; the positioner still flips if the side has no room.
 */
export function quietCardSide(block: Box, connected: readonly Box[]): CardSide {
  const counts: Record<CardSide, number> = { right: 0, left: 0, bottom: 0, top: 0 };
  for (const other of connected) {
    const cx = other.x + other.width / 2;
    const cy = other.y + other.height / 2;
    if (cx > block.x + block.width) counts.right++;
    if (cx < block.x) counts.left++;
    if (cy > block.y + block.height) counts.bottom++;
    if (cy < block.y) counts.top++;
  }
  return (["right", "left", "bottom", "top"] as const).reduce((best, side) => (counts[side] < counts[best] ? side : best));
}
