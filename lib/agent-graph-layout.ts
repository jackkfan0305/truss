import {
  materializeAgentGraph,
  projectCanvasToAgentGraph,
  type AgentGraphInput,
} from "@/lib/agent-graph";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { layoutDiagramAdditions } from "@/lib/layout-diagram-additions";

/** Resolve omitted coordinates using live placement, then lay out new blocks. */
export async function resolveAgentGraphLayout(
  graph: AgentGraphInput,
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
      return previous ? {
        ...previous, position: node.position, data: node.data,
      } : node;
    }),
    edges: materialized.edges.map((edge) => {
      const previous = existingEdges.get(edge.id);
      return previous ? {
        ...previous, source: edge.source, target: edge.target,
        data: { ...previous.data, ...edge.data! },
      } : edge;
    }),
  };
  const opaqueIds = new Set(projectCanvasToAgentGraph(existing).opaqueNodeIds);
  const desiredIds = new Set(desired.nodes.map((node) => node.id));
  const obstacles = existing.nodes.filter((node) => opaqueIds.has(node.id) && !desiredIds.has(node.id));
  const result = await layoutDiagramAdditions({ ...desired, nodes: [...desired.nodes, ...obstacles] }, addedIds);
  return { ...result, nodes: result.nodes.filter((node) => desiredIds.has(node.id)) };
}
