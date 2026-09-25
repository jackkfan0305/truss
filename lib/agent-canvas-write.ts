import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { Authorization } from "@/lib/access";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * The flow surface the agent write paths share. `createSnapshotFlow` implements it
 * over a stored snapshot.
 */
export interface AgentCanvasFlow {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  addNodes(nodes: CanvasNode[]): void;
  addEdges(edges: CanvasEdge[]): void;
  updateNode(id: string, partial: Partial<CanvasNode>): void;
  updateEdge(id: string, partial: Partial<CanvasEdge>): void;
  removeNodes(ids: string[]): void;
  removeEdges(ids: string[]): void;
}

export interface AgentCanvasWriteDependencies {
  authorizeDiagram: (diagramId: string) => Promise<Authorization>;
  /** Read, modify and write the stored canvas under one version. */
  mutateCanvas: (
    diagramId: string,
    callback: (flow: AgentCanvasFlow) => void | Promise<void>,
  ) => Promise<void>;
}

/** An `AgentCanvasFlow` over a plain snapshot, for writes against Blob. */
export interface SnapshotFlow extends AgentCanvasFlow {
  readonly hasChanged: boolean;
  toSnapshot(): CanvasSnapshot;
}

/**
 * Same semantics the Liveblocks flow had: `updateNode` and `updateEdge` merge
 * shallowly, and `removeNodes` does not cascade to edges. Callers that remove
 * a node remove its edges themselves (see `applyDiff`).
 */
export function createSnapshotFlow(snapshot: CanvasSnapshot): SnapshotFlow {
  let nodes = [...snapshot.nodes];
  let edges = [...snapshot.edges];
  let hasChanged = false;
  const touch = () => {
    hasChanged = true;
  };

  return {
    get nodes() {
      return nodes;
    },
    get edges() {
      return edges;
    },
    get hasChanged() {
      return hasChanged;
    },
    addNodes: (added) => {
      nodes = [...nodes, ...added];
      touch();
    },
    addEdges: (added) => {
      edges = [...edges, ...added];
      touch();
    },
    updateNode: (id, partial) => {
      nodes = nodes.map((node) => (node.id === id ? ({ ...node, ...partial } as CanvasNode) : node));
      touch();
    },
    updateEdge: (id, partial) => {
      edges = edges.map((edge) => (edge.id === id ? ({ ...edge, ...partial } as CanvasEdge) : edge));
      touch();
    },
    removeNodes: (ids) => {
      nodes = nodes.filter((node) => !ids.includes(node.id));
      touch();
    },
    removeEdges: (ids) => {
      edges = edges.filter((edge) => !ids.includes(edge.id));
      touch();
    },
    toSnapshot: () => ({ nodes, edges }),
  };
}
