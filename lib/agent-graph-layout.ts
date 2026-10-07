import {
  materializeAgentGraph,
  canvasToAgentGraph,
  type AgentGraphInput,
} from "@/lib/agent-graph";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasNode } from "@/types/canvas";
import { layoutDiagramAdditions } from "@/lib/layout-diagram-additions";
import { layoutDiagramContents } from "@/lib/layout-diagram-contents";
import { isNote, placeNotes } from "@/lib/canvas-note";

/** The v1 graph, or a v2 graph whose nodes may name a parent boundary. */
export interface AgentGraphLayoutInput {
  version: number;
  nodes: Array<AgentGraphInput["nodes"][number] & { parentId?: string; width?: number; height?: number }>;
  edges: AgentGraphInput["edges"];
}

/** Resolve omitted coordinates using live placement, then lay out new blocks. */
export async function resolveAgentGraphLayout(
  graph: AgentGraphLayoutInput,
  existing: CanvasSnapshot = { nodes: [], edges: [] },
): Promise<CanvasSnapshot> {
  const existingNodes = new Map(existing.nodes.map((node) => [node.id, node]));
  const existingEdges = new Map(existing.edges.map((edge) => [edge.id, edge]));
  const addedIds = new Set(graph.nodes.filter((node) =>
    node.x === undefined && !existingNodes.has(node.id)).map((node) => node.id));
  const materialized = materializeAgentGraph({
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      x: node.x ?? existingNodes.get(node.id)?.position.x ?? 0,
      y: node.y ?? existingNodes.get(node.id)?.position.y ?? 0,
    })),
  });
  const desired: CanvasSnapshot = {
    nodes: materialized.nodes.map((node) => {
      const previous = existingNodes.get(node.id);
      if (!previous) return node;
      // A v2 graph states every node's parent, so it overrides the live one.
      const parentId = graph.version === 2 ? node.parentId : previous.parentId;
      const kept: CanvasNode = { ...previous, position: node.position, data: node.data };
      if (node.width !== undefined) kept.width = node.width;
      if (node.height !== undefined) kept.height = node.height;
      if (parentId) kept.parentId = parentId; else delete kept.parentId;
      return kept;
    }),
    edges: materialized.edges.map((edge) => {
      const previous = existingEdges.get(edge.id);
      if (!previous) return edge;
      // The graph states an edge's kind, so a missing one clears the stored kind.
      const { kind: _previousKind, ...previousData } = previous.data ?? { label: "" };
      return { ...previous, source: edge.source, target: edge.target, data: { ...previousData, ...edge.data! } };
    }),
  };
  // Notes never enter ELK: lay out the diagram without them, then place them beside it.
  const notes = desired.nodes.filter(isNote);
  const diagram: CanvasSnapshot = { ...desired, nodes: desired.nodes.filter((node) => !isNote(node)) };
  const liveDiagram: CanvasSnapshot = { ...existing, nodes: existing.nodes.filter((node) => !isNote(node)) };
  const withNotes = (result: CanvasSnapshot): CanvasSnapshot => {
    const laid = result.nodes.filter((node) => desiredIds.has(node.id));
    return { ...result, nodes: [...laid, ...placeNotes(laid, notes, addedIds)] };
  };

  const opaqueIds = new Set(canvasToAgentGraph(liveDiagram).opaqueNodeIds);
  const desiredIds = new Set(diagram.nodes.map((node) => node.id));
  const obstacles = liveDiagram.nodes.filter((node) => opaqueIds.has(node.id) && !desiredIds.has(node.id));

  // Nested graphs re-lay out the boundary holding the change; flat ones keep the additions-only path.
  if (graph.nodes.some((node) => node.parentId) || liveDiagram.nodes.some((node) => node.parentId)) {
    const result = await layoutDiagramContents(diagram, {
      previous: liveDiagram,
      changedNodeIds: addedIds,
      changedEdgeIds: new Set(diagram.edges.filter((edge) => !existingEdges.has(edge.id)).map((edge) => edge.id)),
      opaqueNodeIds: opaqueIds,
      pinnedNodeIds: new Set(graph.nodes.filter((node) => node.x !== undefined).map((node) => node.id)),
    });
    return withNotes(result);
  }

  const result = await layoutDiagramAdditions({ ...diagram, nodes: [...diagram.nodes, ...obstacles] }, addedIds);
  return withNotes(result);
}
