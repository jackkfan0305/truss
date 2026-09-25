import type { XYPosition } from "@xyflow/react";

import {
  drawPacedCanvasActions,
  type CanvasDrawingDependencies,
  type PacedCanvasAction,
} from "@/lib/canvas-drawing";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * How an open editor shows an agent write it picked up by polling: removals
 * and updates at once, then additions one at a time behind the agent cursor.
 * The same order the server's paced draw uses.
 */
export interface CanvasReplayPlan {
  /** The remote canvas minus everything the replay will add. */
  base: CanvasSnapshot;
  addedNodes: CanvasNode[];
  addedEdges: CanvasEdge[];
}

export interface CanvasAddTarget {
  addNodes: (nodes: CanvasNode[]) => void;
  addEdges: (edges: CanvasEdge[]) => void;
}

export function planCanvasReplay(current: CanvasSnapshot, remote: CanvasSnapshot): CanvasReplayPlan {
  const currentNodeIds = new Set(current.nodes.map((node) => node.id));
  const currentEdgeIds = new Set(current.edges.map((edge) => edge.id));
  const addedNodes = remote.nodes.filter((node) => !currentNodeIds.has(node.id));
  const addedNodeIds = new Set(addedNodes.map((node) => node.id));
  // An edge touching a node that has not landed yet would render as nothing,
  // so it waits and is drawn after its endpoints.
  const waitsForANode = (edge: CanvasEdge) =>
    addedNodeIds.has(edge.source) || addedNodeIds.has(edge.target);

  return {
    base: {
      nodes: remote.nodes.filter((node) => currentNodeIds.has(node.id)),
      edges: remote.edges.filter((edge) => currentEdgeIds.has(edge.id) && !waitsForANode(edge)),
    },
    addedNodes,
    addedEdges: remote.edges.filter((edge) => !currentEdgeIds.has(edge.id) || waitsForANode(edge)),
  };
}

/** Nodes first, then edges, each paced so the cursor arrives before the item does. */
export async function drawNodesThenEdges(
  plan: CanvasReplayPlan,
  target: CanvasAddTarget,
  dependencies: CanvasDrawingDependencies,
): Promise<void> {
  const positions = new Map<string, XYPosition>(
    [...plan.base.nodes, ...plan.addedNodes].map((node) => [node.id, node.position]),
  );
  const actions: PacedCanvasAction<CanvasAddTarget>[] = [
    ...plan.addedNodes.map((node) => ({
      target: () => node.position,
      apply: (flow: CanvasAddTarget) => flow.addNodes([node]),
    })),
    ...plan.addedEdges.map((edge) => ({
      target: () => positions.get(edge.target) ?? null,
      apply: (flow: CanvasAddTarget) => flow.addEdges([edge]),
    })),
  ];

  await drawPacedCanvasActions(target, actions, dependencies);
}
