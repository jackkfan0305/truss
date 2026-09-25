import {
  drawPacedCanvasActions,
  type CanvasDrawingDependencies,
  type PacedCanvasAction,
} from "@/lib/canvas-drawing";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { Authorization } from "@/lib/access";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * The `MutableFlow` surface the agent write paths share.
 *
 * Both paths see the whole surface, mutation included: `mutateFlow`'s callback
 * type is fixed once here, and the import path and the edit path consume the
 * same dependencies object. The import path nevertheless only ever adds — that
 * is held by `AgentCanvasAddFlow` below for the shared drawing step, and by the
 * throwing stubs in `scripts/verify-agent-graph-import.ts` for the handler
 * itself. It is not, and should not be read as, a compile-time guarantee at the
 * handler's own `flow` binding.
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

export interface AgentCanvasWriteDependencies extends CanvasDrawingDependencies {
  authorizeDiagram: (diagramId: string) => Promise<Authorization>;
  mutateFlow: (
    diagramId: string,
    callback: (flow: AgentCanvasFlow) => void | Promise<void>,
  ) => Promise<void>;
  saveCanvasSnapshot: (diagramId: string, snapshot: CanvasSnapshot) => Promise<unknown>;
}

/**
 * The add-only view of a flow. Narrowing the shared drawing step to this is
 * self-contained — it proves the step cannot remove or rewrite anything without
 * reaching into `AgentCanvasWriteDependencies`, which both write paths share.
 */
export type AgentCanvasAddFlow = Pick<
  AgentCanvasFlow,
  "nodes" | "edges" | "addNodes" | "addEdges"
>;

/**
 * Nodes first, then edges, each paced so a mounted editor sees the cursor
 * arrive before the item does. Shared by the create import and the edit apply
 * so both draw at the same rhythm.
 */
export async function drawNodesThenEdges(
  diagramId: string,
  flow: AgentCanvasAddFlow,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  positionsById: Map<string, { x: number; y: number }>,
  dependencies: CanvasDrawingDependencies,
): Promise<void> {
  const actions: PacedCanvasAction<AgentCanvasAddFlow>[] = [
    ...nodes.map((node) => ({
      target: () => node.position,
      apply: (target: AgentCanvasAddFlow) => {
        target.addNodes([node]);
      },
    })),
    ...edges.map((edge) => ({
      target: () => positionsById.get(edge.target) ?? null,
      apply: (target: AgentCanvasAddFlow) => {
        target.addEdges([edge]);
      },
    })),
  ];

  await drawPacedCanvasActions(diagramId, flow, actions, dependencies);
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
