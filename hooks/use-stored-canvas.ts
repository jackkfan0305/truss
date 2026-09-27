"use client";

import { useEffect, useState } from "react";

import { fetchCanvas, type RemoteCanvas } from "@/lib/canvas-client";

export type StoredCanvasState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; canvas: RemoteCanvas };

/**
 * Loads the stored canvas before the editor mounts, so the canvas never renders
 * empty and then fills in. The caller keys this by diagram ID, so a new
 * diagram always starts from `loading`.
 */
export function useStoredCanvas(diagramId: string): StoredCanvasState {
  const [state, setState] = useState<StoredCanvasState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchCanvas(diagramId, undefined, controller.signal)
      .then((canvas) => {
        setState(canvas ? { status: "ready", canvas } : { status: "error" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        console.error("Canvas load failed", error);
        setState({ status: "error" });
      });

    return () => controller.abort();
  }, [diagramId]);

  return state;
}
