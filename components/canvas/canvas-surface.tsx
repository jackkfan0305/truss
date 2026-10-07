"use client";

import type { ReactNode } from "react";

import { Canvas } from "@/components/canvas/canvas";
import { TrussLoader } from "@/components/ui/truss-loader";
import { useStoredCanvas } from "@/hooks/use-stored-canvas";

interface CanvasSurfaceProps {
  diagramId: string;
  /** Owned by the editor shell, since the navbar is what opens the picker. */
  /** Mounted only once the stored canvas has loaded. */
  children?: ReactNode;
}

/** The canvas, with its loading and failure states around it. */
export function CanvasSurface({
  diagramId,
  children,
}: CanvasSurfaceProps) {
  const stored = useStoredCanvas(diagramId);

  if (stored.status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <TrussLoader label="Loading the canvas" />
      </div>
    );
  }

  if (stored.status === "error") {
    // An editor that failed to load must not open empty: its first autosave
    // would overwrite the diagram it could not read.
    return <CanvasStatus>Could not load the canvas. Try reloading the page.</CanvasStatus>;
  }

  return (
    <>
      <Canvas
        diagramId={diagramId}
        initial={stored.canvas}
      />
      {children}
    </>
  );
}

function CanvasStatus({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-copy-muted"
    >
      {children}
    </div>
  );
}
