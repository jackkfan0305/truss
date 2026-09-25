"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { putCanvas } from "@/lib/canvas-client";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

/**
 * Long enough that dragging a node is one save rather than sixty, short enough
 * that a person who edits and immediately closes the tab keeps their work.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface CanvasAutosave {
  /** Flushes immediately, ignoring the debounce. Backs the navbar Save button. */
  saveNow: () => void;
  /** Every local edit has reached the server and nothing is in flight. */
  isClean: () => boolean;
  /** The version this tab last read or wrote. */
  getVersion: () => number;
  /** Takes a server canvas as the saved baseline, so applying it is not an edit. */
  adopt: (payload: string, version: number) => void;
  /** Holds saves while `run` applies a remote canvas, then flushes any local edit. */
  whilePaused: (run: () => Promise<void>) => Promise<void>;
}

/**
 * Debounced canvas persistence against a versioned store (ADR 0005).
 *
 * Every save sends the version it is based on. A `409` means someone else
 * wrote first: the tab stops saving and the navbar asks for a reload, because
 * saving over that write would silently discard it.
 */
export function useCanvasAutosave(
  diagramId: string,
  payload: string,
  initialVersion: number,
  onStatusChange: (status: SaveStatus) => void,
): CanvasAutosave {
  const setStatus = useRef(onStatusChange);

  useEffect(() => {
    setStatus.current = onStatusChange;
  }, [onStatusChange]);

  /**
   * Seeded with the payload the editor opened on, so merely opening a diagram
   * never writes. The payload is canonical (Task 4), so React Flow measuring
   * nodes does not count as a change either.
   */
  const savedPayload = useRef(payload);
  const latestPayload = useRef(payload);
  const version = useRef(initialVersion);
  const isSaving = useRef(false);
  const isPendingResave = useRef(false);
  const isPaused = useRef(false);
  const hasConflict = useRef(false);
  const saveRef = useRef<((body: string) => Promise<void>) | null>(null);

  useEffect(() => {
    latestPayload.current = payload;
  }, [payload]);

  const save = useCallback(
    async (body: string) => {
      if (isPaused.current || hasConflict.current) {
        return;
      }

      if (isSaving.current) {
        isPendingResave.current = true;
        return;
      }

      isSaving.current = true;
      setStatus.current("saving");

      try {
        const result = await putCanvas(diagramId, body, version.current);

        if (result.status === "conflict") {
          hasConflict.current = true;
          setStatus.current("conflict");
          return;
        }

        version.current = result.version;
        savedPayload.current = body;
        setStatus.current("saved");
      } catch (error: unknown) {
        // Left visible in the navbar rather than retried on a timer: a retry
        // loop against a failing endpoint is how a save bug becomes a bill.
        console.error("Canvas autosave failed", error);
        setStatus.current("error");
      } finally {
        isSaving.current = false;

        if (isPendingResave.current) {
          isPendingResave.current = false;

          if (latestPayload.current !== savedPayload.current) {
            void saveRef.current?.(latestPayload.current);
          }
        }
      }
    },
    [diagramId],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const saveNow = useCallback(() => {
    if (latestPayload.current !== savedPayload.current) {
      void save(latestPayload.current);
    }
  }, [save]);

  useEffect(() => {
    if (payload === savedPayload.current) {
      return;
    }

    const timer = setTimeout(() => void save(payload), AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [payload, save]);

  return useMemo(
    () => ({
      saveNow,
      isClean: () =>
        !isSaving.current && !hasConflict.current && latestPayload.current === savedPayload.current,
      getVersion: () => version.current,
      adopt: (nextPayload: string, nextVersion: number) => {
        savedPayload.current = nextPayload;
        version.current = nextVersion;
      },
      whilePaused: async (run: () => Promise<void>) => {
        isPaused.current = true;

        try {
          await run();
        } finally {
          isPaused.current = false;
          saveNow();
        }
      },
    }),
    [saveNow],
  );
}
