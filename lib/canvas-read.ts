import { mutateFlow } from "@liveblocks/react-flow/node";

import { getLiveblocks } from "@/lib/liveblocks";
import type { CanvasEdge, CanvasNode, DesignContext } from "@/types/canvas";

/**
 * Reads the diagram without changing it. `mutateFlow` is the read path as well
 * as the write path: it is the only thing that knows how `@liveblocks/react-flow`
 * lays nodes and edges out in Storage, and a callback that mutates nothing
 * flushes nothing.
 *
 * Node-only — it holds the Liveblocks secret — so the pure canvas modules stay
 * importable by the verify scripts.
 */
export async function readCanvas(roomId: string): Promise<DesignContext> {
  let context: DesignContext = { nodes: [], edges: [] };

  await mutateFlow<CanvasNode, CanvasEdge>(
    { client: getLiveblocks(), roomId },
    (flow) => {
      context = flow.toJSON();
    }
  );

  return context;
}
