/**
 * The shared constants behind the paced canvas draw.
 *
 * Truss runs no model of its own (ADR 0001): the only writer here is the
 * terminal agent, arriving through the graph import and edit routes. What
 * survives is the pacing that makes those writes legible on a mounted editor,
 * plus the identity the agent's cursor and avatar carry.
 */

/**
 * The agent's identity on the canvas. Deliberately not a Clerk ID, so it can
 * never match a user.
 */
export const AI_USER_ID = "truss-ai-architect";

export const AI_USER_NAME = "AI Architect";

/** `--accent-ai`, as a raw hex because inline styles need a value, not a token. */
export const AI_USER_COLOR = "#6457f9";

/**
 * How long the agent cursor takes to travel to its next target, in
 * milliseconds.
 *
 * Shared rather than duplicated because it is one behaviour split across two
 * processes: the replay waits this out before applying an edit
 * (`lib/canvas-replay.ts`), and the browser spends it animating the cursor
 * there (`components/canvas/live-cursors.tsx`). If the two drift, nodes appear
 * before the cursor arrives — precisely the effect this pacing exists to avoid.
 */
export const AI_CURSOR_SWEEP_MS = 420;

/**
 * Padding between the cursor arriving and the node landing.
 *
 * Deliberately asymmetric. A node that lands slightly late reads as "the cursor
 * placed that"; one that lands early reads as broken. This absorbs React batching
 * the cursor move and the node landing, so it is a floor rather than a delay to
 * minimise.
 */
export const AI_CURSOR_ARRIVAL_PAD_MS = 120;

/**
 * How long each agent edit stays lit on the canvas before the next one starts.
 * The highlight animation in `globals.css` runs for the same time.
 */
export const AI_EDIT_HOLD_MS = 200;
