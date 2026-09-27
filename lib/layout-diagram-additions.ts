import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { layoutDiagram } from "@/lib/diagram-layout";
import { diagramGeometryKey } from "@/lib/diagram-route";
import { NODE_DEFAULT_SIZES } from "@/types/canvas";

/** Lay out new content together without rearranging existing blocks. */
export async function layoutDiagramAdditions(
  snapshot: CanvasSnapshot,
  addedIds: ReadonlySet<string>,
): Promise<CanvasSnapshot> {
  if (addedIds.size === 0) return snapshot;

  const fixed = snapshot.nodes.filter((node) => !addedIds.has(node.id));
  const laidOut = await layoutDiagram({
    nodes: snapshot.nodes.filter((node) => addedIds.has(node.id)),
    edges: snapshot.edges.filter((edge) => addedIds.has(edge.source) && addedIds.has(edge.target)),
  });
  const offset = {
    x: fixed.length ? Math.ceil(Math.max(...fixed.map((node) =>
      node.position.x + (node.width ?? NODE_DEFAULT_SIZES[node.data.shape].width))) + 240) : 0,
    y: fixed.length ? Math.floor(Math.min(...fixed.map((node) => node.position.y))) : 0,
  };
  const placed = new Map(laidOut.nodes.map((node) => [node.id, {
    ...node,
    position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
  }]));
  const nodes = snapshot.nodes.map((node) => placed.get(node.id) ?? node);
  const geometryKey = diagramGeometryKey(nodes);
  const routed = new Map(laidOut.edges.map((edge) => {
    const layout = edge.data?.layout;
    if (!layout) return [edge.id, edge] as const;
    return [edge.id, {
      ...edge,
      data: {
        ...edge.data!,
        layout: {
          ...layout,
          geometryKey,
          points: layout.points.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y })),
          label: layout.label ? {
            ...layout.label, x: layout.label.x + offset.x, y: layout.label.y + offset.y,
          } : null,
        },
      },
    }] as const;
  }));
  return { nodes, edges: snapshot.edges.map((edge) => routed.get(edge.id) ?? edge) };
}
