"use client";

import { useCallback, useEffect, useRef } from "react";

import type { CanvasAutosave } from "@/hooks/use-canvas-autosave";
import { fetchCanvas, type RemoteCanvas } from "@/lib/canvas-client";

/**
 * How often an idle editor asks whether the canvas moved.
 *
 * ponytail: polling costs one small function call per open, visible tab every
 * interval. A server-sent event stream is the upgrade if open tabs ever make
 * that cost show up.
 */
const CANVAS_POLL_MS = 4_000;

/**
 * Keeps an idle editor current with writes made elsewhere: the terminal agent
 * through `agent-graph-edit`, or the owner's other tab. A tab with unsaved
 * edits does not poll, so nothing overwrites work in progress.
 */
export function useCanvasRemoteSync(
  diagramId: string,
  autosave: CanvasAutosave,
  onRemoteCanvas: (canvas: RemoteCanvas) => Promise<void>,
): { syncNow: () => void } {
  const isSyncing = useRef(false);
  const apply = useRef(onRemoteCanvas);

  useEffect(() => {
    apply.current = onRemoteCanvas;
  }, [onRemoteCanvas]);

  const syncNow = useCallback(() => {
    if (isSyncing.current || !autosave.isClean()) {
      return;
    }

    isSyncing.current = true;

    void fetchCanvas(diagramId, autosave.getVersion())
      .then(async (remote) => {
        // Re-checked: the owner may have started editing while this was in flight.
        if (remote && autosave.isClean()) {
          await apply.current(remote);
        }
      })
      .catch((error: unknown) => {
        console.error("Canvas sync failed", error);
      })
      .finally(() => {
        isSyncing.current = false;
      });
  }, [autosave, diagramId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        syncNow();
      }
    }, CANVAS_POLL_MS);

    return () => window.clearInterval(timer);
  }, [syncNow]);

  return { syncNow };
}
