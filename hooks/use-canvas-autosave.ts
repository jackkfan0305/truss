"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { serializeCanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Long enough that dragging a node is one save rather than sixty, short enough
 * that a person who edits and immediately closes the tab keeps their work.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

interface CanvasAutosave {
  status: SaveStatus;
  /** Flushes immediately, ignoring the debounce. Backs the navbar Save button. */
  saveNow: () => void;
}

/**
 * Debounced canvas persistence (21-canvas-autosave).
 *
 * Liveblocks already syncs the room between clients; this is the separate,
 * slower job of getting that state into durable storage. Every client in the
 * room runs its own copy — the writes are idempotent overwrites of the same
 * blob path, so the last one wins and none of them conflict.
 */
export function useCanvasAutosave(
  projectId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasAutosave {
  const [status, setStatus] = useState<SaveStatus>("idle");

  /**
   * Serializing is what detects a change, so it runs on every flow update — but
   * keyed on the arrays rather than on render, or dragging a node would
   * re-stringify the whole diagram on every animation frame.
   */
  const payload = useMemo(
    () => serializeCanvasSnapshot({ nodes, edges }),
    [nodes, edges],
  );

  /**
   * The last payload that reached the server. Seeded with the first render's
   * payload so an editor that is merely *opened* never writes: without this,
   * every client that joins a room immediately saves a copy of what it just
   * loaded, and opening a project would be a write.
   */
  const savedPayload = useRef(payload);
  const isSaving = useRef(false);
  /** Set when an edit lands mid-flight, so the newer state is not lost. */
  const isPendingResave = useRef(false);

  const save = useCallback(
    async (body: string) => {
      if (isSaving.current) {
        isPendingResave.current = true;
        return;
      }

      isSaving.current = true;
      setStatus("saving");

      try {
        const response = await fetch(`/api/projects/${projectId}/canvas`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (!response.ok) {
          throw new Error(`Canvas save responded ${response.status}`);
        }

        savedPayload.current = body;
        setStatus("saved");
      } catch (error: unknown) {
        // Left visible in the navbar rather than retried on a timer: a retry
        // loop against a failing endpoint is how a save bug becomes a bill.
        console.error("Canvas autosave failed", error);
        setStatus("error");
      } finally {
        isSaving.current = false;
      }
    },
    [projectId],
  );

  /**
   * A ref, so `saveNow` stays a stable callback instead of a new identity on
   * every edit. Assigned in an effect rather than during render, which
   * `react-hooks/refs` rejects — both readers (a click, a completed request)
   * run after commit.
   */
  const latestPayload = useRef(payload);

  useEffect(() => {
    latestPayload.current = payload;
  }, [payload]);

  const saveNow = useCallback(() => {
    if (latestPayload.current === savedPayload.current) {
      return;
    }

    void save(latestPayload.current);
  }, [save]);

  useEffect(() => {
    if (payload === savedPayload.current) {
      return;
    }

    const timer = setTimeout(() => void save(payload), AUTOSAVE_DEBOUNCE_MS);

    // Each new edit cancels the previous timer, which is what makes this a
    // debounce rather than one save per change.
    return () => clearTimeout(timer);
  }, [payload, save]);

  // A save that finished while another edit was waiting leaves the newest state
  // unwritten; this picks it up once the in-flight request has cleared.
  useEffect(() => {
    if (status !== "saved" || !isPendingResave.current) {
      return;
    }

    isPendingResave.current = false;

    if (latestPayload.current !== savedPayload.current) {
      void save(latestPayload.current);
    }
  }, [status, save]);

  return { status, saveNow };
}
