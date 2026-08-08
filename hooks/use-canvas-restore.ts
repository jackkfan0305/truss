"use client";

import { useEffect, useRef } from "react";

import { parseCanvasSnapshot, type CanvasSnapshot } from "@/lib/canvas-snapshot";

/**
 * Loads the saved canvas into an empty room (21-canvas-autosave).
 *
 * Liveblocks Storage is the live source of truth, so this only ever runs as a
 * cold start: if the room already holds nodes or edges, the saved blob is
 * ignored entirely rather than merged, because a merge would resurrect deleted
 * nodes and fight whoever is editing right now.
 *
 * `isEmpty` is passed in rather than derived here so the caller decides what
 * "empty" means with the flow state it already has.
 */
export function useCanvasRestore(
  projectId: string,
  isEmpty: boolean,
  onRestore: (snapshot: CanvasSnapshot) => void,
): void {
  /**
   * One attempt per mount, whatever the outcome. Without this a project with no
   * saved canvas would re-fetch on every render that leaves the room empty.
   */
  const hasAttempted = useRef(false);

  // The callback is read through a ref so an inline arrow from the caller does
  // not re-trigger the fetch on every render. Assigned in an effect rather than
  // during render, which `react-hooks/refs` rejects — the fetch that reads it
  // resolves long after commit, so the timing is equivalent.
  const restore = useRef(onRestore);

  useEffect(() => {
    restore.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    if (hasAttempted.current || !isEmpty) {
      return;
    }

    hasAttempted.current = true;

    // Cancels the apply, not the request: a canvas unmounted mid-fetch must not
    // write into a room it has left.
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/canvas`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Canvas load responded ${response.status}`);
        }

        const snapshot = parseCanvasSnapshot(
          ((await response.json()) as { canvas?: unknown }).canvas,
        );

        // `null` is the ordinary "never saved" answer, so there is nothing to
        // restore and nothing to report.
        if (!snapshot || controller.signal.aborted) {
          return;
        }

        restore.current(snapshot);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return;
        }

        // Deliberately silent in the UI: the canvas is usable and still saves,
        // and an empty room that failed to restore looks the same as a new one.
        console.error("Canvas restore failed", error);
      }
    };

    void load();

    return () => controller.abort();
  }, [isEmpty, projectId]);
}
