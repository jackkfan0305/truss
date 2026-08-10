"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the reader has asked for reduced motion, as a *reactive* read.
 *
 * The imperative `window.matchMedia(...).matches` checks elsewhere are fine
 * where motion is decided once, at the moment it starts. This exists for the
 * other case: a value read during render, which has to re-render when the
 * preference changes and cannot be a bare `matchMedia` call because there would
 * be nothing to tell React it went stale.
 *
 * `useSyncExternalStore` rather than an effect and state: the server has no
 * preference to read, and this is exactly the shape it exists for — subscribe,
 * snapshot, server snapshot. Motion-allowed is the server answer, so a reader
 * who wants reduced motion gets it on hydration rather than a mismatch.
 */
const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);

  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
