import type { CanvasEdge } from "@/types/canvas";

/** The label is about 20 units tall; 28 leaves a visible gap between pills. */
const PARALLEL_LABEL_LANE_STEP = 28;

type EdgeIdentity = Pick<CanvasEdge, "id" | "source" | "target">;

function endpointPair(edge: EdgeIdentity): readonly [string, string] {
  return edge.source < edge.target
    ? [edge.source, edge.target]
    : [edge.target, edge.source];
}

function endpointPairKey(edge: EdgeIdentity): string {
  return JSON.stringify(endpointPair(edge));
}

export function compareStableIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/** Groups and ranks every pair once, avoiding a full scan for each edge. */
export function computeParallelEdgeLabelOffsets(
  edges: readonly EdgeIdentity[],
): Map<string, number> {
  const groups = new Map<string, EdgeIdentity[]>();

  for (const edge of edges) {
    const key = endpointPairKey(edge);
    const group = groups.get(key);

    if (group) {
      group.push(edge);
    } else {
      groups.set(key, [edge]);
    }
  }

  const offsets = new Map<string, number>();

  for (const group of groups.values()) {
    const ordered = group.toSorted((a, b) => compareStableIds(a.id, b.id));

    ordered.forEach((edge, laneIndex) => {
      offsets.set(
        edge.id,
        (laneIndex - (ordered.length - 1) / 2) * PARALLEL_LABEL_LANE_STEP,
      );
    });
  }

  return offsets;
}

/**
 * Returns the signed distance between an edge label and its route midpoint.
 *
 * Kept DOM-free so parallel-edge layout can be verified without mounting a
 * React Flow canvas.
 */
export function getParallelEdgeLabelOffset(
  edge: EdgeIdentity,
  edges: readonly EdgeIdentity[],
): number {
  return computeParallelEdgeLabelOffsets(edges).get(edge.id) ?? 0;
}

export function positionParallelEdgeLabel({
  labelX,
  labelY,
  offset,
}: {
  labelX: number;
  labelY: number;
  offset: number;
}): { x: number; y: number } {
  return {
    x: labelX,
    y: labelY + offset,
  };
}
