/**
 * The shared constants behind the paced canvas draw.
 *
 * Truss runs no model of its own (ADR 0001): the only writer here is the
 * terminal agent, arriving through the graph import and edit routes. What
 * survives is the pacing that makes those writes legible on a mounted editor,
 * plus the identity the agent's cursor and avatar carry.
 */

/**
 * The agent's identity in the room's presence.
 *
 * Deliberately not a Clerk ID — `useCollaborators` filters the current user out
 * by Clerk ID, and this must never match anyone.
 */
export const AI_USER_ID = "truss-ai-architect";

export const AI_USER_NAME = "AI Architect";

/**
 * How long the agent cursor takes to travel to its next target, in
 * milliseconds.
 *
 * Shared rather than duplicated because it is one behaviour split across two
 * processes: the server waits this out before writing the node
 * (`lib/canvas-drawing.ts`), and the browser spends it animating the cursor
 * there (`components/canvas/live-cursors.tsx`). If the two drift, nodes appear
 * before the cursor arrives — precisely the effect this pacing exists to avoid.
 */
export const AI_CURSOR_SWEEP_MS = 420;

/**
 * Padding between the cursor arriving and the node landing.
 *
 * Deliberately asymmetric. A node that lands slightly late reads as "the cursor
 * placed that"; one that lands early reads as broken. This absorbs the
 * variability in a presence write plus Liveblocks' 200ms storage flush
 * debounce, so it is a floor rather than a delay to minimise.
 */
export const AI_CURSOR_ARRIVAL_PAD_MS = 120;

/**
 * The whole draw's time budget, spread across however many actions it has. A
 * large graph is more than half a minute of watching at a comfortable pace, so
 * pace is derived from the action count rather than fixed, and a big graph
 * simply moves faster.
 *
 * Calibration values, not derived truths: tune them by watching a real draw.
 */
const AI_BUILD_BUDGET_MS = 15_000;
const MIN_BUILD_STEP_MS = 220;
const MAX_BUILD_STEP_MS = 900;

/**
 * The delay between one action landing and the next cursor move.
 *
 * Floored at `MIN_BUILD_STEP_MS` because Liveblocks flushes storage ops on a
 * 200ms debounce: below that, several actions coalesce into one broadcast and
 * the reveal stops being per-action no matter what this returns.
 */
export function getBuildStepMs(actionCount: number): number {
  if (actionCount <= 0) {
    return MIN_BUILD_STEP_MS;
  }

  const step = AI_BUILD_BUDGET_MS / actionCount;

  return Math.min(Math.max(step, MIN_BUILD_STEP_MS), MAX_BUILD_STEP_MS);
}
