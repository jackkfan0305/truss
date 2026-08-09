"use client";

import { useEffect, useRef, useState } from "react";

import { isFullyRevealed, nextRevealLength } from "@/lib/smooth-text";

/**
 * Reveals streamed text at a steady rate instead of in the bursts it arrives in
 * (33-thinking-disclosure).
 *
 * Driven by `requestAnimationFrame` rather than an interval: the reveal is
 * purely visual, so it should run on the frame clock and stop dead when the tab
 * is backgrounded — an interval would keep advancing text nobody is watching
 * and then dump the catch-up in one frame on return.
 *
 * `settled` forces the full text out. A run that has finished has no more
 * deltas coming, so trickling would leave the last words hidden behind an
 * animation with nothing left to animate toward. It is applied when computing
 * what to return rather than by writing state from an effect, which would cost
 * a second render pass on every finished run.
 */
export function useSmoothText(target: string, settled = false): string {
  const [revealed, setRevealed] = useState(0);

  // The rAF loop's own cursor. State exists to trigger the re-render; this is
  // what the next frame reads, so a burst arriving mid-frame cannot rewind it.
  const revealedRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    /*
     * Every path returns this, including the ones that never schedule a frame.
     * Whether a frame can still be pending on those paths is an argument about
     * the *previous* cleanup having run; cancelling unconditionally is one line
     * and needs no such argument.
     */
    const cancel = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    // Nothing to animate toward: render already returns the whole string.
    if (settled) {
      return cancel;
    }

    // A shorter target is different text, not a rewind. Clamping the ref (never
    // state — this runs in the effect body) keeps the cursor inside the string
    // it is now revealing.
    if (revealedRef.current > target.length) {
      revealedRef.current = target.length;
    }

    if (isFullyRevealed(revealedRef.current, target)) {
      return cancel;
    }

    const step = () => {
      // Read per frame rather than once: reduced motion is a preference the
      // reader can change while a long run is still streaming.
      const next = prefersReducedMotion()
        ? target.length
        : nextRevealLength(revealedRef.current, target);

      revealedRef.current = next;
      setRevealed(next);

      frameRef.current = isFullyRevealed(next, target)
        ? null
        : requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);

    return cancel;
  }, [target, settled]);

  // `slice` clamps on its own, so an out-of-range cursor renders the whole
  // string rather than throwing or truncating oddly.
  return settled ? target : target.slice(0, revealed);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
