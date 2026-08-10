"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Tells a node or edge whether it arrived while the canvas was already on
 * screen, so only new arrivals animate in (32-live-canvas-building).
 *
 * Without this, opening a project with thirty nodes plays thirty arrival
 * animations at once, because every one of them mounts for the first time
 * during hydration. The AI's build is the thing worth animating; loading a
 * saved diagram is not.
 *
 * A ref rather than state, and read through a `useState` initializer at the
 * consumer, because this must be a *non-reactive* read. As reactive context
 * value it would re-render every node the moment the flag flipped, and a
 * `className` derived from it would then animate the entire canvas at once —
 * exactly the effect it exists to prevent.
 */
interface CanvasMotionValue {
  /** True once the initial diagram has settled and later mounts are arrivals. */
  hasSettled: () => boolean;
}

const CanvasMotionContext = createContext<CanvasMotionValue | null>(null);

/**
 * How long after mount the canvas stops treating new elements as part of the
 * initial load. Long enough to cover Liveblocks Storage resolving and React
 * Flow's first render, short enough that a generated node arriving straight
 * after open still animates.
 */
const SETTLE_MS = 800;

export function CanvasMotionProvider({ children }: { children: ReactNode }) {
  const hasSettledRef = useRef(false);

  // A plain object identity that never changes, so no consumer re-renders
  // because of this provider. The ref inside it is what carries the answer.
  const [value] = useState<CanvasMotionValue>(() => ({
    hasSettled: () => hasSettledRef.current,
  }));

  useEffect(() => {
    const timer = setTimeout(() => {
      hasSettledRef.current = true;
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
      // Remounting the canvas (a different project, a route change) is a fresh
      // initial load, not a continuation of the last one.
      hasSettledRef.current = false;
    };
  }, []);

  return <CanvasMotionContext value={value}>{children}</CanvasMotionContext>;
}

/**
 * Whether *this* element should play its arrival animation. Decided once, at
 * first render, and never revisited — re-evaluating on a later render would
 * animate something that is already sitting on the canvas.
 *
 * Safe outside a provider: returns `false`, which means "do not animate".
 */
export function useIsFreshArrival(): boolean {
  const value = useContext(CanvasMotionContext);
  const [isFresh] = useState(() => value?.hasSettled() ?? false);

  return isFresh;
}
