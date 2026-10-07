import {
  canvasFingerprint,
  canvasToAgentGraph,
  parseAgentGraphInput,
  type AgentGraphInput,
} from "@/lib/agent-graph";
import { resolveAgentGraphLayout } from "@/lib/agent-graph-layout";
import {
  collidesWithOpaque,
  diffAgentGraph,
  type AgentGraphDiff,
} from "@/lib/agent-graph-diff";
import { collectDescendantIds } from "@/lib/canvas-hierarchy";
import { CanvasVersionConflictError, type CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { AgentCanvasFlow, AgentCanvasWriteDependencies } from "@/lib/agent-canvas-write";
import { jsonError, readJsonBody } from "@/lib/api-requests";
import { buildDiagramSpatialContext, invalidGeometryResponse } from "@/lib/diagram-spatial-context";
import { DiagramLayoutError } from "@/lib/diagram-geometry";
import {
  isSupportedGraphVersion,
  NESTED_V1_DETAIL,
  unsupportedGraphVersionResponse,
} from "@/lib/agent-graph-version";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type AgentGraphEditDependencies = AgentCanvasWriteDependencies;

interface EditRequest {
  fingerprint: string;
  graph: AgentGraphInput;
}

function parseEditRequest(value: unknown, requestedVersion: number = 1): EditRequest | null {
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

  const parsedGraph = parseAgentGraphInput(graph, true, requestedVersion);

  return parsedGraph ? { fingerprint, graph: parsedGraph } : null;
}

type EditDecision = "applied" | "stale" | "collision" | "opaque-descendants" | "unsupported-version";

/**
 * Applies removals and updates as one batch, then adds the new nodes and edges.
 *
 * Order is deliberate: the diagram makes room before it is drawn into, so a
 * reader sees an intentional rearrangement rather than new nodes appearing on
 * top of geometry that is about to change.
 */
function applyDiff(
  flow: AgentCanvasFlow,
  diff: AgentGraphDiff,
  desired: CanvasSnapshot,
  live: CanvasSnapshot,
): void {
  const desiredNodes = new Map(desired.nodes.map((node) => [node.id, node]));
  const desiredEdges = new Map(desired.edges.map((edge) => [edge.id, edge]));

  /*
   * Edges anchored to a removed node go with it, opaque ones included.
   *
   * `removeNodes` does not cascade (see `createSnapshotFlow`) and
   * `diff.removedEdgeIds` only ever names edges the agent could see. An opaque
   * edge touching a removed node would therefore survive pointing at a node
   * that no longer exists, and because opaque items are invisible to every
   * future diff, nothing could ever clean it up. That is permanent corruption
   * of the room.
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
        parentId: target.parentId,
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

  /*
   * Re-laying out a boundary moves blocks the agent never mentioned, and every
   * route that touches them. Those edges are not in the graph diff, so write any
   * saved route that now differs, or the canvas would keep stale geometry.
   */
  const handled = new Set([...edgeIdsToRemove, ...diff.updatedEdges.map((edge) => edge.id), ...diff.addedEdges.map((edge) => edge.id)]);
  for (const edge of live.edges) {
    const target = desiredEdges.get(edge.id);
    if (target && !handled.has(edge.id) && JSON.stringify(target.data?.layout) !== JSON.stringify(edge.data?.layout)) {
      flow.updateEdge(edge.id, { data: target.data });
    }
  }

  flow.addNodes(diff.addedNodes.map((node) => desiredNodes.get(node.id)!));
  flow.addEdges(diff.addedEdges.map((edge) => desiredEdges.get(edge.id)!));
}

/**
 * Injectable owner-only edit workflow. Authorization precedes body parsing, so
 * an unauthorised caller cannot probe graph validation.
 *
 * The fingerprint is recomputed inside `mutateCanvas`, and the version swap
 * closes the window between that check and the write.
 */
export async function handleAgentGraphEditPost(
  request: Request,
  diagramId: string,
  dependencies: AgentGraphEditDependencies,
  version: number = 1,
): Promise<Response> {
  const access = await dependencies.authorizeDiagram(diagramId);

  if (!access.ok) {
    return access.response;
  }

  if (!isSupportedGraphVersion(version)) {
    return unsupportedGraphVersionResponse(400, "Unsupported graph version.");
  }

  const body = await readJsonBody(request);

  if (version === 1 && (body as { graph?: { version?: unknown } } | null)?.graph?.version === 2) {
    return unsupportedGraphVersionResponse(409, "This graph uses version 2.");
  }

  const parsed = parseEditRequest(body, version);

  if (!parsed) {
    return jsonError("Invalid graph edit request", 400);
  }

  let decision = "stale" as EditDecision;
  let opaqueInfo = null as { boundaryId: string; itemIds: string[] } | null;
  let committedSnapshot = null as CanvasSnapshot | null;

  try {
    await dependencies.mutateCanvas(diagramId, async (flow) => {
      const liveSnapshot: CanvasSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };

      // Negotiation first: a guessed fingerprint must not bypass it.
      const hasAwsOrNested = liveSnapshot.nodes.some(
        (node) => node.data?.kind || node.data?.catalogId || node.parentId,
      );

      if (version === 1 && hasAwsOrNested) {
        decision = "unsupported-version";
        return;
      }

      if (canvasFingerprint(liveSnapshot) !== parsed.fingerprint) {
        decision = "stale";
        return;
      }

      const live = canvasToAgentGraph(liveSnapshot, version === 2 ? 2 : 1);
      const desiredSnapshot = await resolveAgentGraphLayout(parsed.graph, liveSnapshot);
      const desiredGraph = canvasToAgentGraph(desiredSnapshot, version === 2 ? 2 : 1).graph;

      // Check for opaque descendant removal (trying to delete a readable boundary with opaque children)
      const liveNodeIds = new Set(live.graph.nodes.map((n) => n.id));
      const liveById = new Map(liveSnapshot.nodes.map((n) => [n.id, n]));
      const desiredNodeIds = new Set(desiredGraph.nodes.map((n) => n.id));

      for (const liveNode of live.graph.nodes) {
        // If this boundary is being removed and it has opaque descendants
        const isBoundary = liveById.get(liveNode.id)?.data.kind === "boundary";
        if (!desiredNodeIds.has(liveNode.id) && isBoundary) {
          const descendants = collectDescendantIds(liveNode.id, liveSnapshot.nodes);
          const opaqueDescendants = [...descendants].filter((id) => !liveNodeIds.has(id));
          if (opaqueDescendants.length > 0) {
            decision = "opaque-descendants";
            opaqueInfo = { boundaryId: liveNode.id, itemIds: opaqueDescendants };
            return;
          }
        }
      }

      if (collidesWithOpaque(live, desiredGraph)) {
        decision = "collision";
        return;
      }

      applyDiff(flow, diffAgentGraph(live, desiredGraph), desiredSnapshot, liveSnapshot);
      committedSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };
      decision = "applied";
    });
  } catch (error: unknown) {
    if (error instanceof CanvasVersionConflictError) {
      return jsonError("The canvas changed since it was read", 409);
    }

    if (error instanceof DiagramLayoutError) {
      return invalidGeometryResponse(error);
    }

    console.error(`Agent graph edit failed for ${diagramId}`, error);
    return jsonError("Could not apply the graph edit", 502);
  }

  if (decision === "opaque-descendants") {
    return Response.json(
      {
        code: "opaqueDescendants",
        boundaryId: opaqueInfo?.boundaryId,
        itemIds: opaqueInfo?.itemIds,
        message: "Cannot remove a boundary that contains opaque descendants.",
      },
      { status: 422 },
    );
  }

  if (decision === "unsupported-version") {
    return unsupportedGraphVersionResponse(409, NESTED_V1_DETAIL);
  }

  if (decision === "stale") {
    return jsonError("The canvas changed since it was read", 409);
  }

  if (decision === "collision") {
    return jsonError("The edit reuses an ID that is already in use", 409);
  }

  if (committedSnapshot && version === 2) {
    const view = canvasToAgentGraph(committedSnapshot, 2);
    const spatial = buildDiagramSpatialContext(
      committedSnapshot,
      new Set(view.opaqueNodeIds),
      new Set(view.opaqueEdgeIds),
    );
    return Response.json({
      applied: true,
      ...view,
      spatial,
      fingerprint: canvasFingerprint(committedSnapshot),
    });
  }

  return Response.json({ applied: true });
}
