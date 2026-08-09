/**
 * Paces streamed text onto the screen (33-thinking-disclosure).
 *
 * Reasoning arrives from the worker in bursts, not in a steady trickle: the
 * provider emits deltas at its own rhythm and the Trigger.dev stream batches
 * transport on top of that. Appending each burst as it lands makes the panel
 * jump a paragraph at a time, which reads as sloppy rather than as live.
 *
 * So the burst is the *target* and this decides how much of it to show on any
 * given frame. Pure and DOM-free, so `scripts/verify-design-agent.ts` can
 * exercise the pacing without a browser or a clock.
 */

/** Never slower than this, or a long tail crawls once the backlog is small. */
const MIN_CHARS_PER_FRAME = 2;

/**
 * How aggressively the reveal closes a gap. Rate is proportional to the
 * backlog, so a big burst is consumed fast and a trickle stays gentle — and the
 * text can never fall permanently behind a stream that keeps arriving.
 */
const CATCH_UP_DIVISOR = 6;

/**
 * How far past the frame's target to look for a space before giving up.
 *
 * Stopping mid-word is what makes a typewriter effect look cheap, but chasing a
 * boundary that is not there is worse: an unbroken 400-character token (a URL,
 * a base64 blob) would reveal in one jump. Bounded, so the worst case is a word
 * of this length appearing at once.
 */
const WORD_BOUNDARY_LOOKAHEAD = 12;

/**
 * The revealed length for the next frame.
 *
 * Monotonic and clamped: it never returns less than `revealed` and never more
 * than the target's length, so a caller cannot walk backwards over text the
 * reader has already seen.
 */
export function nextRevealLength(revealed: number, target: string): number {
  const total = target.length;
  const current = Math.max(0, Math.min(revealed, total));

  if (current >= total) {
    return total;
  }

  const backlog = total - current;
  const step = Math.max(
    MIN_CHARS_PER_FRAME,
    Math.ceil(backlog / CATCH_UP_DIVISOR)
  );
  const candidate = current + step;

  // Close enough to the end that a boundary search would only stall the finish.
  if (candidate >= total) {
    return total;
  }

  return snapToWordBoundary(target, candidate);
}

function snapToWordBoundary(target: string, candidate: number): number {
  const limit = Math.min(target.length, candidate + WORD_BOUNDARY_LOOKAHEAD);

  for (let index = candidate; index < limit; index += 1) {
    if (isBoundary(target[index])) {
      // Past the separator, so the revealed text ends with it rather than
      // holding a word back until the following frame.
      return index + 1;
    }
  }

  return candidate;
}

function isBoundary(character: string): boolean {
  return character === " " || character === "\n" || character === "\t";
}

/**
 * Whether a target has fully arrived on screen — the caller's cue to stop
 * scheduling frames rather than spinning on a stream that has finished.
 */
export function isFullyRevealed(revealed: number, target: string): boolean {
  return revealed >= target.length;
}
