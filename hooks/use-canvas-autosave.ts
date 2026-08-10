"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { serializeCanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Long enough that dragging a node is one save rather than sixty, short enough
 * that a person who edits and immediately closes the tab keeps their work.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

interface CanvasAutosave {
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
  onStatusChange: (status: SaveStatus) => void,
): CanvasAutosave {
  /**
   * Status is reported, not stored. Each transition is an event in the save
   * lifecycle, so it is emitted where it happens rather than mirrored into
   * local state and pushed outward from an effect — which would cost a second
   * render of the whole workspace on every save.
   */
  const setStatus = useRef(onStatusChange);

  useEffect(() => {
    setStatus.current = onStatusChange;
  }, [onStatusChange]);

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

  /**
   * The newest payload, readable from outside the render that produced it —
   * by a Save click and by the mid-flight flush below. Assigned in an effect
   * rather than during render, which `react-hooks/refs` rejects; both readers
   * run after commit, so the timing is equivalent.
   */
  const latestPayload = useRef(payload);

  useEffect(() => {
    latestPayload.current = payload;
  }, [payload]);

  /**
   * Self-referential so the flush below can re-enter it. Held in a ref rather
   * than passed around, because a `useCallback` cannot name itself.
   */
  const saveRef = useRef<((body: string) => Promise<void>) | null>(null);

  const save = useCallback(
    async (body: string) => {
      if (isSaving.current) {
        isPendingResave.current = true;
        return;
      }

      isSaving.current = true;
      setStatus.current("saving");

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
        setStatus.current("saved");
      } catch (error: unknown) {
        // Left visible in the navbar rather than retried on a timer: a retry
        // loop against a failing endpoint is how a save bug becomes a bill.
        console.error("Canvas autosave failed", error);
        setStatus.current("error");
      } finally {
        isSaving.current = false;

        // An edit that landed mid-flight has no timer left to fire — its
        // debounce was cancelled while this request was in the air — so the
        // flush happens here or not at all.
        if (isPendingResave.current) {
          isPendingResave.current = false;

          if (latestPayload.current !== savedPayload.current) {
            void saveRef.current?.(latestPayload.current);
          }
        }
      }
    },
    [projectId],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

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

  return { saveNow };
}
