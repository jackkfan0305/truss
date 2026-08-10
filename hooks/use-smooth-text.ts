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

  useEffect(() => {
    /*
     * A plain binding rather than a ref: only this effect run schedules frames,
     * and only its own cleanup cancels them, so the handle has no reason to
     * outlive the closure. Every path returns the same teardown, including the
     * two that never schedule anything — `cancelAnimationFrame(0)` is a no-op,
     * so they cost a call rather than a branch.
     */
    let frameId = 0;

    // Nothing to animate toward: render already returns the whole string.
    if (settled) {
      return () => cancelAnimationFrame(frameId);
    }

    // A shorter target is different text, not a rewind. Clamping the ref (never
    // state — this runs in the effect body) keeps the cursor inside the string
    // it is now revealing.
    if (revealedRef.current > target.length) {
      revealedRef.current = target.length;
    }

    if (isFullyRevealed(revealedRef.current, target)) {
      return () => cancelAnimationFrame(frameId);
    }

    const step = () => {
      // Read per frame rather than once: reduced motion is a preference the
      // reader can change while a long run is still streaming.
      const next = prefersReducedMotion()
        ? target.length
        : nextRevealLength(revealedRef.current, target);

      revealedRef.current = next;
      setRevealed(next);

      if (isFullyRevealed(next, target)) {
        frameId = 0;
        return;
      }

      frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frameId);
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
