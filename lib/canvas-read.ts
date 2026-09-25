import { readStoredCanvas } from "@/lib/canvas-persistence";
import type { DesignContext } from "@/types/canvas";

/** The stored canvas, or an empty one before the first save. Throws on a failed read. */
export async function readCanvas(diagramId: string): Promise<DesignContext> {
  const { snapshot } = await readStoredCanvas(diagramId);

  return snapshot ?? { nodes: [], edges: [] };
}
