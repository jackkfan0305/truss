import {
  canvasFingerprint,
  materializeAgentGraph,
  parseAgentGraphAllowingEmpty,
  projectCanvasToAgentGraph,
  type AgentGraphView,
} from "@/lib/agent-graph";
import {
  collidesWithOpaque,
  diffAgentGraph,
  type AgentGraphDiff,
} from "@/lib/agent-graph-diff";
import {
  drawNodesThenEdges,
  type AgentCanvasFlow,
  type AgentCanvasWriteDependencies,
} from "@/lib/agent-canvas-write";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { jsonError, readJsonBody } from "@/lib/project-requests";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type AgentGraphEditDependencies = AgentCanvasWriteDependencies;

interface EditRequest {
  fingerprint: string;
  graph: AgentGraphView["graph"];
}

function parseEditRequest(value: unknown): EditRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value);

  if (keys.length !== 2 || !keys.includes("fingerprint") || !keys.includes("graph")) {
    return null;
  }

  const { fingerprint, graph } = value as { fingerprint?: unknown; graph?: unknown };

  if (typeof fingerprint !== "string" || !FINGERPRINT_PATTERN.test(fingerprint)) {
    return null;
  }

  const parsedGraph = parseAgentGraphAllowingEmpty(graph);

  return parsedGraph ? { fingerprint, graph: parsedGraph } : null;
}

type EditDecision = "applied" | "stale" | "collision";

/**
 * Applies removals and updates as one batch, then draws additions paced.
 *
 * Order is deliberate: the diagram makes room before it is drawn into, so a
 * reader sees an intentional rearrangement rather than new nodes appearing on
 * top of geometry that is about to change.
 */
function applyDiff(
  projectId: string,
  flow: AgentCanvasFlow,
  diff: AgentGraphDiff,
  desired: CanvasSnapshot,
  live: CanvasSnapshot,
  dependencies: AgentCanvasWriteDependencies,
): Promise<void> {
  const desiredNodes = new Map(desired.nodes.map((node) => [node.id, node]));
  const desiredEdges = new Map(desired.edges.map((edge) => [edge.id, edge]));

  /*
   * Edges anchored to a removed node go with it, opaque ones included.
   *
   * `removeNodes` is a plain per-ID map delete in @liveblocks/react-flow — it
   * does not cascade — and `diff.removedEdgeIds` only ever names edges the
   * agent could see. An opaque edge touching a removed node would therefore
   * survive pointing at a node that no longer exists, and because opaque items
   * are invisible to every future diff, nothing could ever clean it up. That is
   * permanent corruption of the room.
   *
   * This does not weaken the never-remove-what-you-did-not-see rule. An edge is
   * not independent of its endpoints: deleting the node is what deletes it, the
   * same as it would be for a human dragging that node to the bin.
   */
  const removedNodeIds = new Set(diff.removedNodeIds);
  const edgeIdsToRemove = new Set(diff.removedEdgeIds);

  for (const edge of live.edges) {
    if (removedNodeIds.has(edge.source) || removedNodeIds.has(edge.target)) {
      edgeIdsToRemove.add(edge.id);
    }
  }

  if (edgeIdsToRemove.size > 0) {
    flow.removeEdges([...edgeIdsToRemove]);
  }

  if (diff.removedNodeIds.length > 0) {
    flow.removeNodes(diff.removedNodeIds);
  }

  for (const node of diff.updatedNodes) {
    const target = desiredNodes.get(node.id);

    if (target) {
      flow.updateNode(node.id, {
        position: target.position,
        width: target.width,
        height: target.height,
        data: target.data,
      });
    }
  }

  for (const edge of diff.updatedEdges) {
    const target = desiredEdges.get(edge.id);

    if (target) {
      flow.updateEdge(edge.id, {
        source: target.source,
        target: target.target,
        data: target.data,
      });
    }
  }

  return drawNodesThenEdges(
    projectId,
    flow,
    diff.addedNodes.map((node) => desiredNodes.get(node.id)!),
    diff.addedEdges.map((edge) => desiredEdges.get(edge.id)!),
    new Map(desired.nodes.map((node) => [node.id, node.position])),
    dependencies,
  );
}

/**
 * Injectable owner-only edit workflow. Authorization precedes body parsing, so
 * an unauthorised caller cannot probe graph validation.
 *
 * The fingerprint is recomputed *inside* the mutate callback rather than before
 * it: checking outside would reintroduce exactly the read-then-write race the
 * fingerprint exists to close.
 */
export async function handleAgentGraphEditPost(
  request: Request,
  projectId: string,
  dependencies: AgentGraphEditDependencies,
): Promise<Response> {
  const access = await dependencies.authorizeProject(projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const parsed = parseEditRequest(await readJsonBody(request));

  if (!parsed) {
    return jsonError("Invalid graph edit request", 400);
  }

  const desiredSnapshot = materializeAgentGraph(parsed.graph);

  let decision: EditDecision = "stale";
  let appliedSnapshot: CanvasSnapshot | null = null;

  try {
    await dependencies.mutateFlow(projectId, async (flow) => {
      const liveSnapshot: CanvasSnapshot = {
        nodes: [...flow.nodes],
        edges: [...flow.edges],
      };

      if (canvasFingerprint(liveSnapshot) !== parsed.fingerprint) {
        decision = "stale";
        return;
      }

      const live = projectCanvasToAgentGraph(liveSnapshot);

      if (collidesWithOpaque(live, parsed.graph)) {
        decision = "collision";
        return;
      }

      const diff = diffAgentGraph(live, parsed.graph);
      await applyDiff(projectId, flow, diff, desiredSnapshot, liveSnapshot, dependencies);
      decision = "applied";
      appliedSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };
    });
  } catch (error: unknown) {
    console.error(`Agent graph edit failed for ${projectId}`, error);
    return jsonError("Could not apply the graph edit", 502);
  }

  if (decision === "stale") {
    return jsonError("The canvas changed since it was read", 409);
  }

  if (decision === "collision") {
    return jsonError("The edit reuses an ID that is already in use", 409);
  }

  if (!appliedSnapshot) {
    return jsonError("Could not apply the graph edit", 502);
  }

  try {
    await dependencies.saveCanvasSnapshot(projectId, appliedSnapshot);
  } catch (error: unknown) {
    console.error(`Canvas persistence failed after edit for ${projectId}`, error);
    return jsonError("Could not save the edited canvas", 502);
  }

  return Response.json({ applied: true });
}
