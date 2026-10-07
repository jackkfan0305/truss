import {
  canonicalCanvasSnapshotsEqual,
  parseAgentGraphInput,
  canvasToAgentGraph,
  canvasFingerprint,
  type AgentGraphInput,
} from "@/lib/agent-graph";
import { resolveAgentGraphLayout } from "@/lib/agent-graph-layout";
import { CanvasVersionConflictError, type CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { AgentCanvasWriteDependencies } from "@/lib/agent-canvas-write";
import { isAgentLaunchId } from "@/lib/agent-launch";
import { jsonError, readJsonBody } from "@/lib/api-requests";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";
import { buildDiagramSpatialContext, invalidGeometryResponse } from "@/lib/diagram-spatial-context";
import { DiagramLayoutError } from "@/lib/diagram-geometry";
import { isSupportedGraphVersion, unsupportedGraphVersionResponse } from "@/lib/agent-graph-version";

export type AgentGraphImportDependencies = AgentCanvasWriteDependencies;

type ImportDecision = "empty" | "exact" | "resume" | "conflict";

function parseImportRequest(value: unknown, requestedVersion: number = 1): AgentGraphInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value);

  if (keys.length !== 2 || !keys.includes("launchId") || !keys.includes("graph")) {
    return null;
  }

  const { launchId, graph } = value as { launchId?: unknown; graph?: unknown };

  if (!isAgentLaunchId(launchId)) {
    return null;
  }

  return parseAgentGraphInput(graph, false, requestedVersion);
}

function isExactNode(
  existing: CanvasNode,
  requested: CanvasNode,
): boolean {
  return canonicalCanvasSnapshotsEqual(
    { nodes: [existing], edges: [] },
    { nodes: [requested], edges: [] },
  );
}

function isExactEdge(
  existing: CanvasEdge,
  requested: CanvasEdge,
): boolean {
  return canonicalCanvasSnapshotsEqual(
    { nodes: [], edges: [existing] },
    { nodes: [], edges: [requested] },
  );
}

function findMissingCanonicalItems(
  existing: CanvasSnapshot,
  requested: CanvasSnapshot,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } | null {
  const existingNodeIds = new Set<string>();
  const existingEdgeIds = new Set<string>();

  for (const node of existing.nodes) {
    if (existingNodeIds.has(node.id)) {
      return null;
    }
    existingNodeIds.add(node.id);
  }

  for (const edge of existing.edges) {
    if (existingEdgeIds.has(edge.id)) {
      return null;
    }
    existingEdgeIds.add(edge.id);
  }

  const requestedNodes = new Map(requested.nodes.map((node) => [node.id, node]));
  const requestedEdges = new Map(requested.edges.map((edge) => [edge.id, edge]));

  for (const node of existing.nodes) {
    const requestedNode = requestedNodes.get(node.id);

    if (!requestedNode || !isExactNode(node, requestedNode)) {
      return null;
    }
  }

  for (const edge of existing.edges) {
    const requestedEdge = requestedEdges.get(edge.id);

    if (!requestedEdge || !isExactEdge(edge, requestedEdge)) {
      return null;
    }
  }

  return {
    nodes: requested.nodes.filter((node) => !existingNodeIds.has(node.id)),
    edges: requested.edges.filter((edge) => !existingEdgeIds.has(edge.id)),
  };
}

/**
 * Injectable owner-only import workflow. Authentication intentionally precedes
 * JSON parsing, so an unauthorised caller cannot probe graph validation.
 */
export async function handleAgentGraphImportPost(
  request: Request,
  diagramId: string,
  dependencies: AgentGraphImportDependencies,
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

  const graph = parseImportRequest(body, version);

  if (!graph) {
    return jsonError("Invalid graph import request", 400);
  }

  let decision: ImportDecision = "conflict";
  let committedSnapshot: CanvasSnapshot | null = null;

  try {
    const requestedSnapshot = await resolveAgentGraphLayout(graph);
    await dependencies.mutateCanvas(diagramId, (flow) => {
      const existingSnapshot: CanvasSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };
      const missingItems = findMissingCanonicalItems(existingSnapshot, requestedSnapshot);

      if (!missingItems) {
        decision = "conflict";
        return;
      }

      if (missingItems.nodes.length === 0 && missingItems.edges.length === 0) {
        decision = "exact";
        committedSnapshot = existingSnapshot;
        return;
      }

      decision =
        existingSnapshot.nodes.length === 0 && existingSnapshot.edges.length === 0
          ? "empty"
          : "resume";

      if (missingItems.nodes.length > 0) {
        flow.addNodes(missingItems.nodes);
      }

      if (missingItems.edges.length > 0) {
        flow.addEdges(missingItems.edges);
      }

      committedSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };
    });
  } catch (error: unknown) {
    if (error instanceof CanvasVersionConflictError) {
      return jsonError("The canvas changed since it was read", 409);
    }

    if (error instanceof DiagramLayoutError) {
      return invalidGeometryResponse(error);
    }

    return jsonError("Could not import the graph", 502);
  }

  if (decision === "conflict") {
    return jsonError("Canvas already contains a different graph", 409);
  }

  // Version 1 keeps the original `{ imported }` body; version 2 adds the committed geometry.
  if (committedSnapshot && version === 2) {
    const snapshot: CanvasSnapshot = committedSnapshot;
    const view = canvasToAgentGraph(snapshot, 2);
    const spatial = buildDiagramSpatialContext(
      snapshot,
      new Set(view.opaqueNodeIds),
      new Set(view.opaqueEdgeIds),
    );
    return Response.json({
      imported: decision === "empty" || decision === "resume",
      ...view,
      spatial,
      fingerprint: canvasFingerprint(snapshot),
    });
  }

  return Response.json({ imported: decision === "empty" || decision === "resume" });
}
