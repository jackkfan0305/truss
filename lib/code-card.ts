/** Pure geometry and tree checks for code block hover cards. */

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

const ARROW_SIDES: Record<string, CardSide> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };

/** The side an arrow key moves the card to, or null for any other key. */
export function arrowCardSide(key: string): CardSide | null {
  return ARROW_SIDES[key] ?? null;
}
