"use client";

import { useSyncExternalStore } from "react";

/**
 * False on the server and through hydration, true from the first client render
 * after it.
 *
 * For values that are only knowable in the browser — the reader's locale and
 * timezone being the case here. Rendering those directly would have the server
 * format with *its* locale and the browser with the reader's, which is a
 * hydration mismatch; gating on this renders something stable until the browser
 * is the one answering.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: this is a read of
 * something outside React, not a state change, and writing state from an effect
 * to represent it is the thing `react-hooks/set-state-in-effect` objects to.
 */
const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
