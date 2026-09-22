import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { DesignContext, DesignPlan } from "@/lib/design-plan";
import { layoutDiagramAdditions } from "@/lib/layout-diagram-additions";

/** Resolve layout after the complete plan has established its connections. */
export async function layoutDesignPlan(plan: DesignPlan, context: DesignContext): Promise<DesignPlan> {
  const newIds = new Set(plan.actions.flatMap((action) => action.type === "addNode" ? [action.node.id] : []));
  if (!newIds.size) return plan;
  const nodes = new Map(context.nodes.map((node) => [node.id, node]));
  const edges = new Map(context.edges.map((edge) => [edge.id, edge]));
  for (const action of plan.actions) {
    switch (action.type) {
      case "addNode": nodes.set(action.node.id, action.node); break;
      case "addEdge": edges.set(action.edge.id, action.edge); break;
      case "deleteNode": nodes.delete(action.id); newIds.delete(action.id); break;
      case "deleteEdge": edges.delete(action.id); break;
      case "moveNode": {
        const node = nodes.get(action.id);
        if (node) nodes.set(action.id, { ...node, position: action.position });
        break;
      }
      case "resizeNode": {
        const node = nodes.get(action.id);
        if (node) nodes.set(action.id, { ...node, width: action.width, height: action.height });
        break;
      }
      case "updateNodeData": {
        const node = nodes.get(action.id);
        if (node) nodes.set(action.id, { ...node, data: { ...node.data, ...action.data } });
        break;
      }
    }
  }
  const snapshot: CanvasSnapshot = { nodes: [...nodes.values()], edges: [...edges.values()] };
  const laidOut = await layoutDiagramAdditions(snapshot, newIds);
  const placed = new Map(laidOut.nodes.map((node) => [node.id, node]));
  const routed = new Map(laidOut.edges.map((edge) => [edge.id, edge]));
  return {
    ...plan,
    actions: plan.actions.filter((action) =>
      !((action.type === "moveNode" || action.type === "resizeNode") && newIds.has(action.id)))
      .map((action) => {
        if (action.type === "addNode") return { ...action, node: placed.get(action.node.id) ?? action.node };
        if (action.type === "addEdge") return { ...action, edge: routed.get(action.edge.id) ?? action.edge };
        return action;
      }),
  };
}
