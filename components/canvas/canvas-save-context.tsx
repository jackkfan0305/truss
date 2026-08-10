"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { SaveStatus } from "@/hooks/use-canvas-autosave";

/**
 * Shared autosave state for the workspace (21-canvas-autosave).
 *
 * The producer and the display sit on opposite sides of the tree: only the
 * canvas can see the flow state that drives a save, and only the navbar has
 * somewhere to show it. A context rather than a prop callback because pushing
 * the status up through `onChange` in an effect re-renders the whole shell an
 * extra time on every transition — and status is an *event* here (a save
 * started, finished, failed), not state derived from anything.
 */
interface CanvasSaveValue {
  status: SaveStatus;
  /** Called from the save lifecycle itself, never from an effect. */
  setStatus: (status: SaveStatus) => void;
  /** The canvas hands up its flush; the navbar button calls it. */
  registerSaveNow: (saveNow: (() => void) | null) => void;
  saveNow: () => void;
}

const CanvasSaveContext = createContext<CanvasSaveValue | null>(null);

export function CanvasSaveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  // A ref, not state: swapping the flush handle must not re-render the tree,
  // and nothing renders differently because of it.
  const saveNowRef = useRef<(() => void) | null>(null);

  const registerSaveNow = useCallback((saveNow: (() => void) | null) => {
    saveNowRef.current = saveNow;
  }, []);

  const saveNow = useCallback(() => saveNowRef.current?.(), []);

  const value = useMemo(
    () => ({ status, setStatus, registerSaveNow, saveNow }),
    [status, registerSaveNow, saveNow],
  );

  return <CanvasSaveContext value={value}>{children}</CanvasSaveContext>;
}

export function useCanvasSave(): CanvasSaveValue {
  const value = useContext(CanvasSaveContext);

  if (!value) {
    throw new Error("useCanvasSave must be used inside a CanvasSaveProvider");
  }

  return value;
}
