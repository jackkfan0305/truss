import { createContext } from "react";

import type { CanvasBounds } from "@/types/canvas";

/**
 * Resizing goes through the canvas, not React Flow's own node changes: a
 * boundary resize has to clamp to its contents and keep descendants at their
 * absolute positions, which is the `resizeCanvasBoundary` transaction.
 */
export interface BoundaryResizeActions {
  start: () => void;
  resize: (id: string, bounds: CanvasBounds) => void;
}

export const BoundaryResizeContext = createContext<BoundaryResizeActions | null>(null);
