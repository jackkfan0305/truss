import type { XYPosition } from "@xyflow/react";

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { AI_CURSOR_ARRIVAL_PAD_MS, AI_CURSOR_SWEEP_MS, AI_EDIT_HOLD_MS } from "@/types/tasks";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * How an open editor shows an agent write it picked up: one edit at a time,
 * the agent cursor travelling to each and the edited item lit for
 * `AI_EDIT_HOLD_MS` before the next one starts.
 */
export interface AgentEditing {
  kind: "node" | "edge";
  id: string;
}

export interface CanvasEdit extends AgentEditing {
  /** Where the cursor goes for this edit. */
  at: XYPosition | null;
  /** A removal stays lit while it is still there, then disappears. */
  removes: boolean;
  apply: (target: CanvasEditTarget) => void;
}

export interface CanvasEditTarget {
  setNodes: (update: (nodes: CanvasNode[]) => CanvasNode[]) => void;
  setEdges: (update: (edges: CanvasEdge[]) => CanvasEdge[]) => void;
}

export interface CanvasReplayDependencies {
  showAgent: (cursor: XYPosition, editing: AgentEditing | null) => void;
  clearAgent: () => void;
  sleep: (milliseconds: number) => Promise<void>;
}

// Only what the canvas draws; flow state also carries `measured`, `selected` and the like.
const nodeShape = (node: CanvasNode) =>
  JSON.stringify([node.position, node.width, node.height, node.data]);
const edgeShape = (edge: CanvasEdge) =>
  JSON.stringify([edge.source, edge.target, edge.sourceHandle, edge.targetHandle, edge.data]);

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Removals first, edges before their nodes, then node updates and additions,
 * then edges, so an edge never lands before both of its endpoints.
 */
export function planCanvasEdits(current: CanvasSnapshot, remote: CanvasSnapshot): CanvasEdit[] {
  const currentNodes = byId(current.nodes);
  const currentEdges = byId(current.edges);
  const remoteNodes = byId(remote.nodes);
  const remoteEdges = byId(remote.edges);
  const positionOf = (id: string) =>
    (remoteNodes.get(id) ?? currentNodes.get(id))?.position ?? null;

  const putNode = (node: CanvasNode, isNew: boolean): CanvasEdit => ({
    kind: "node",
    id: node.id,
    at: node.position,
    removes: false,
    apply: ({ setNodes }) =>
      setNodes((nodes) => (isNew ? [...nodes, node] : nodes.map((n) => (n.id === node.id ? node : n)))),
  });
  const putEdge = (edge: CanvasEdge, isNew: boolean): CanvasEdit => ({
    kind: "edge",
    id: edge.id,
    at: positionOf(edge.target),
    removes: false,
    apply: ({ setEdges }) =>
      setEdges((edges) => (isNew ? [...edges, edge] : edges.map((e) => (e.id === edge.id ? edge : e)))),
  });

  return [
    ...current.edges
      .filter((edge) => !remoteEdges.has(edge.id))
      .map((edge): CanvasEdit => ({
        kind: "edge",
        id: edge.id,
        at: positionOf(edge.target),
        removes: true,
        apply: ({ setEdges }) => setEdges((edges) => edges.filter((e) => e.id !== edge.id)),
      })),
    ...current.nodes
      .filter((node) => !remoteNodes.has(node.id))
      .map((node): CanvasEdit => ({
        kind: "node",
        id: node.id,
        at: node.position,
        removes: true,
        apply: ({ setNodes }) => setNodes((nodes) => nodes.filter((n) => n.id !== node.id)),
      })),
    ...remote.nodes.flatMap((node) => {
      const before = currentNodes.get(node.id);
      if (!before) return [putNode(node, true)];
      return nodeShape(before) === nodeShape(node) ? [] : [putNode(node, false)];
    }),
    ...remote.edges.flatMap((edge) => {
      const before = currentEdges.get(edge.id);
      if (!before) return [putEdge(edge, true)];
      return edgeShape(before) === edgeShape(edge) ? [] : [putEdge(edge, false)];
    }),
  ];
}

/** Plays the edits in order, the cursor arriving before each one lands. */
export async function playCanvasEdits(
  edits: readonly CanvasEdit[],
  target: CanvasEditTarget,
  dependencies: CanvasReplayDependencies,
): Promise<void> {
  let cursor: XYPosition | null = null;

  try {
    for (const edit of edits) {
      const editing = { kind: edit.kind, id: edit.id };

      if (edit.at) {
        cursor = edit.at;
        dependencies.showAgent(cursor, null);
        await dependencies.sleep(AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS);
      }
      if (cursor) dependencies.showAgent(cursor, editing);

      if (!edit.removes) edit.apply(target);
      await dependencies.sleep(AI_EDIT_HOLD_MS);
      if (edit.removes) edit.apply(target);
    }
  } finally {
    dependencies.clearAgent();
  }
}
